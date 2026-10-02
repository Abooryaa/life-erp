import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { and, eq, lt, or } from 'drizzle-orm';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import { getDb } from '../../db/client';
import { sessions, users } from '../../db/schema';
import { AppError, badRequest, unauthorized } from '../../lib/errors';
import { newId, nowIso } from '../../lib/ids';

export type User = typeof users.$inferSelect;
export type PublicUser = Pick<User, 'id' | 'username' | 'email' | 'fullName' | 'role' | 'totpEnabled'>;

export function publicUser(u: User): PublicUser {
  return { id: u.id, username: u.username, email: u.email, fullName: u.fullName, role: u.role, totpEnabled: u.totpEnabled };
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// ---------- passwords ----------
// @node-rs/argon2 defaults to Argon2id (m=19 MiB, t=2, p=1) — OWASP's recommended baseline.
export const hashPassword = (password: string) => hash(password);
export const verifyPassword = (passwordHash: string, password: string) => verify(passwordHash, password).catch(() => false);

let dummyHash: Promise<string> | null = null;
/** Spend the same time verifying when the user doesn't exist, so usernames can't be probed by timing. */
async function burnVerify(password: string) {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(await dummyHash, password);
}

export function hasUsers(): boolean {
  return !!getDb().select({ id: users.id }).from(users).limit(1).get();
}

export function findUserByIdentifier(identifier: string): User | undefined {
  return getDb()
    .select()
    .from(users)
    .where(or(eq(users.username, identifier), eq(users.email, identifier)))
    .get();
}

export function getUser(id: string) {
  return getDb().select().from(users).where(eq(users.id, id)).get();
}

// ---------- brute-force protection (per account, in memory) ----------
const failures = new Map<string, { count: number; lockedUntil: number }>();

function checkLock(key: string) {
  const f = failures.get(key);
  if (f && f.lockedUntil > Date.now()) {
    const secs = Math.ceil((f.lockedUntil - Date.now()) / 1000);
    throw new AppError(429, 'locked', `Too many failed attempts. Try again in ${secs} seconds.`);
  }
}
function recordFailure(key: string) {
  const f = failures.get(key) ?? { count: 0, lockedUntil: 0 };
  f.count++;
  if (f.count >= 5) {
    const minutes = Math.min(15, 2 ** (f.count - 5));
    f.lockedUntil = Date.now() + minutes * 60_000;
  }
  failures.set(key, f);
}
const clearFailures = (key: string) => failures.delete(key);
export function resetLoginThrottle() {
  failures.clear();
  challenges.clear();
}

export async function verifyCredentials(identifier: string, password: string): Promise<User> {
  const key = identifier.toLowerCase();
  checkLock(key);
  const user = findUserByIdentifier(key);
  if (!user) {
    await burnVerify(password);
    recordFailure(key);
    throw unauthorized('Incorrect username or password');
  }
  if (!(await verifyPassword(user.passwordHash, password))) {
    recordFailure(key);
    throw unauthorized('Incorrect username or password');
  }
  clearFailures(key);
  return user;
}

// ---------- two-step login challenges ----------
const challenges = new Map<string, { userId: string; expires: number; attempts: number }>();

export function createChallenge(userId: string) {
  const token = randomBytes(24).toString('base64url');
  challenges.set(token, { userId, expires: Date.now() + 5 * 60_000, attempts: 0 });
  return token;
}

export function consumeChallenge(token: string, code: string): User {
  const c = challenges.get(token);
  if (!c || c.expires < Date.now()) {
    challenges.delete(token);
    throw unauthorized('Sign-in expired. Enter your password again.');
  }
  const user = getUser(c.userId);
  if (!user) throw unauthorized();
  if (!checkSecondFactor(user, code)) {
    if (++c.attempts >= 5) challenges.delete(token);
    throw new AppError(401, 'bad_code', 'That code is not valid');
  }
  challenges.delete(token);
  return user;
}

// ---------- TOTP ----------
function totpFor(user: Pick<User, 'username'>, secret: string) {
  return new OTPAuth.TOTP({
    issuer: 'LIFE ERP',
    label: user.username,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}

export function verifyTotp(user: Pick<User, 'username'>, secret: string, code: string) {
  return totpFor(user, secret).validate({ token: code.trim(), window: 1 }) !== null;
}

/** Accepts a current TOTP code or an unused recovery code (which is then consumed). */
export function checkSecondFactor(user: User, code: string): boolean {
  if (!user.totpEnabled || !user.totpSecret) return true;
  const trimmed = code.trim().toLowerCase();
  if (/^\d{6}$/.test(trimmed)) return verifyTotp(user, user.totpSecret, trimmed);
  const hashes: string[] = user.recoveryCodes ? JSON.parse(user.recoveryCodes) : [];
  const h = sha256(trimmed);
  const idx = hashes.findIndex((x) => timingSafeEqual(Buffer.from(x), Buffer.from(h)));
  if (idx < 0) return false;
  hashes.splice(idx, 1);
  getDb()
    .update(users)
    .set({ recoveryCodes: JSON.stringify(hashes), updatedAt: nowIso() })
    .where(eq(users.id, user.id))
    .run();
  return true;
}

export async function beginTotpSetup(user: User) {
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  getDb().update(users).set({ totpSecret: secret, totpEnabled: false, updatedAt: nowIso() }).where(eq(users.id, user.id)).run();
  const uri = totpFor(user, secret).toString();
  return { secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 240 }) };
}

export function confirmTotpSetup(user: User, code: string) {
  if (!user.totpSecret) throw badRequest('Start the two-factor setup first');
  if (!verifyTotp(user, user.totpSecret, code)) throw new AppError(400, 'bad_code', 'That code is not valid. Check the time on your phone and try again.');
  const codes = Array.from({ length: 10 }, () => {
    const s = randomBytes(5).toString('hex').slice(0, 8);
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
  getDb()
    .update(users)
    .set({ totpEnabled: true, recoveryCodes: JSON.stringify(codes.map(sha256)), updatedAt: nowIso() })
    .where(eq(users.id, user.id))
    .run();
  return codes;
}

export function disableTotp(userId: string) {
  getDb()
    .update(users)
    .set({ totpEnabled: false, totpSecret: null, recoveryCodes: null, updatedAt: nowIso() })
    .where(eq(users.id, userId))
    .run();
}

// ---------- sessions ----------
export function createSession(userId: string, days: number, meta: { userAgent?: string; ip?: string }) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
  getDb()
    .insert(sessions)
    .values({ id: sha256(token), userId, expiresAt, userAgent: meta.userAgent?.slice(0, 300), ip: meta.ip })
    .run();
  return { token, expiresAt };
}

export function validateSession(token: string, days: number): { user: User; sessionId: string } | null {
  if (!token || token.length > 100) return null;
  const id = sha256(token);
  const db = getDb();
  const s = db.select().from(sessions).where(eq(sessions.id, id)).get();
  if (!s) return null;
  if (s.expiresAt < nowIso()) {
    db.delete(sessions).where(eq(sessions.id, id)).run();
    return null;
  }
  const user = getUser(s.userId);
  if (!user) return null;
  // Sliding expiry, written at most once an hour to avoid a write per request.
  if (Date.now() - Date.parse(s.lastSeenAt) > 3_600_000) {
    db.update(sessions)
      .set({ lastSeenAt: nowIso(), expiresAt: new Date(Date.now() + days * 86_400_000).toISOString() })
      .where(eq(sessions.id, id))
      .run();
  }
  return { user, sessionId: id };
}

export function revokeSession(sessionId: string, userId?: string) {
  const where = userId ? and(eq(sessions.id, sessionId), eq(sessions.userId, userId)) : eq(sessions.id, sessionId);
  getDb().delete(sessions).where(where).run();
}

export function revokeOtherSessions(userId: string, keepSessionId: string) {
  const db = getDb();
  const all = db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId)).all();
  for (const s of all) if (s.id !== keepSessionId) db.delete(sessions).where(eq(sessions.id, s.id)).run();
}

export function listSessions(userId: string) {
  return getDb().select().from(sessions).where(eq(sessions.userId, userId)).all();
}

export function purgeExpiredSessions() {
  getDb().delete(sessions).where(lt(sessions.expiresAt, nowIso())).run();
}
