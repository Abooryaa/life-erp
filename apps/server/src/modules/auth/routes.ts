import {
  changePasswordSchema,
  disableTotpSchema,
  enableTotpSchema,
  loginSchema,
  loginTotpSchema,
  setupSchema,
  updateProfileSchema,
} from '@life-erp/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDb, tx } from '../../db/client';
import { users } from '../../db/schema';
import { ctxOf, isDirectLocalRequest, requireUser } from '../../http';
import { audit } from '../../lib/audit';
import { AppError, conflict, forbidden, unauthorized } from '../../lib/errors';
import { newId, nowIso } from '../../lib/ids';
import { parse } from '../../lib/validate';
import { getConfig } from '../../runtime';
import { saveSettings } from '../settings/service';
import { createWorkspace } from '../workspaces/service';
import {
  beginTotpSetup,
  checkSecondFactor,
  confirmTotpSetup,
  consumeChallenge,
  createChallenge,
  createSession,
  disableTotp,
  hashPassword,
  hasUsers,
  listSessions,
  publicUser,
  revokeOtherSessions,
  revokeSession,
  verifyCredentials,
  verifyPassword,
  type User,
} from './service';

export function cookieName() {
  return getConfig().demo ? 'lerp_demo_session' : 'lerp_session';
}

function startSession(req: FastifyRequest, reply: FastifyReply, user: User) {
  const cfg = getConfig();
  const { token } = createSession(user.id, cfg.sessionDays, { userAgent: req.headers['user-agent'], ip: req.ip });
  reply.setCookie(cookieName(), token, {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: req.protocol === 'https',
    maxAge: cfg.sessionDays * 86_400,
  });
  audit({ userId: user.id, ip: req.ip }, 'auth.login', { type: 'user', id: user.id }, `Signed in from ${req.headers['user-agent']?.slice(0, 80) ?? 'unknown device'}`);
  return { user: publicUser(user) };
}

const loginRateLimit = { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } };

export async function authRoutes(app: FastifyInstance) {
  app.get('/api/auth/status', async (req) => ({
    setupRequired: !hasUsers(),
    setupAllowedHere: isDirectLocalRequest(req),
    demo: getConfig().demo,
    user: req.user ? publicUser(req.user) : null,
  }));

  app.post('/api/auth/setup', loginRateLimit, async (req, reply) => {
    if (hasUsers()) throw conflict('LIFE ERP is already set up. Sign in instead.');
    // First-run setup is only possible on the laptop itself, so nobody on the network can claim the system.
    if (!isDirectLocalRequest(req)) throw forbidden('Finish the first-time setup on the laptop running LIFE ERP (open http://localhost:4600 there).');
    const data = parse(setupSchema, req.body);
    const passwordHash = await hashPassword(data.password);
    const id = newId();
    tx((db) => {
      db.insert(users).values({ id, username: data.username, email: data.email, fullName: data.fullName, passwordHash }).run();
    });
    const ctx = { userId: id, ip: req.ip };
    audit(ctx, 'auth.setup', { type: 'user', id }, `Created owner account "${data.username}"`);
    saveSettings(ctx, { locale: data.locale, baseCurrency: data.baseCurrency });
    createWorkspace(ctx, { name: data.locale === 'ar' ? 'شخصي' : 'Personal', kind: 'personal', color: '#0f766e', currency: data.baseCurrency });
    const palette = ['#4f46e5', '#b45309', '#be185d', '#0369a1', '#15803d', '#7c3aed'];
    data.businesses.forEach((name, i) =>
      createWorkspace(ctx, { name, kind: 'business', color: palette[i % palette.length], currency: data.baseCurrency }),
    );
    const user = getDb().select().from(users).where(eq(users.id, id)).get()!;
    return startSession(req, reply, user);
  });

  app.post('/api/auth/login', loginRateLimit, async (req, reply) => {
    const { identifier, password } = parse(loginSchema, req.body);
    let user: User;
    try {
      user = await verifyCredentials(identifier, password);
    } catch (err) {
      audit({ ip: req.ip }, 'auth.login_failed', null, `Failed sign-in for "${identifier.slice(0, 60)}"`);
      throw err;
    }
    if (user.totpEnabled) return { mfaRequired: true, challenge: createChallenge(user.id) };
    return startSession(req, reply, user);
  });

  app.post('/api/auth/login/totp', loginRateLimit, async (req, reply) => {
    const { challenge, code } = parse(loginTotpSchema, req.body);
    try {
      return startSession(req, reply, consumeChallenge(challenge, code));
    } catch (err) {
      audit({ ip: req.ip }, 'auth.login_failed', null, 'Failed two-factor code');
      throw err;
    }
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.sessionId) revokeSession(req.sessionId);
    if (req.user) audit(ctxOf(req), 'auth.logout', { type: 'user', id: req.user.id }, 'Signed out');
    reply.clearCookie(cookieName(), { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => ({ user: publicUser(requireUser(req)) }));

  app.put('/api/auth/profile', async (req) => {
    const user = requireUser(req);
    const data = parse(updateProfileSchema, req.body);
    const clash = getDb().select().from(users).where(eq(users.email, data.email)).get();
    if (clash && clash.id !== user.id) throw conflict('That email is already used');
    getDb().update(users).set({ ...data, updatedAt: nowIso() }).where(eq(users.id, user.id)).run();
    audit(ctxOf(req), 'auth.profile', { type: 'user', id: user.id }, 'Updated profile', publicUser(user), data);
    return { ok: true };
  });

  app.post('/api/auth/password', loginRateLimit, async (req) => {
    const user = requireUser(req);
    const data = parse(changePasswordSchema, req.body);
    if (!(await verifyPassword(user.passwordHash, data.currentPassword))) throw new AppError(400, 'bad_password', 'Current password is incorrect');
    getDb()
      .update(users)
      .set({ passwordHash: await hashPassword(data.newPassword), passwordChangedAt: nowIso(), updatedAt: nowIso() })
      .where(eq(users.id, user.id))
      .run();
    // Changing the password signs out every other device.
    revokeOtherSessions(user.id, req.sessionId!);
    audit(ctxOf(req), 'auth.password_change', { type: 'user', id: user.id }, 'Changed password (other sessions signed out)');
    return { ok: true };
  });

  app.post('/api/auth/totp/setup', async (req) => {
    const user = requireUser(req);
    if (user.totpEnabled) throw conflict('Two-factor authentication is already on');
    return beginTotpSetup(user);
  });

  app.post('/api/auth/totp/enable', async (req) => {
    const user = requireUser(req);
    const { code } = parse(enableTotpSchema, req.body);
    const recoveryCodes = confirmTotpSetup(user, code);
    audit(ctxOf(req), 'auth.totp_enable', { type: 'user', id: user.id }, 'Enabled two-factor authentication');
    return { recoveryCodes };
  });

  app.post('/api/auth/totp/disable', loginRateLimit, async (req) => {
    const user = requireUser(req);
    const { password, code } = parse(disableTotpSchema, req.body);
    if (!(await verifyPassword(user.passwordHash, password))) throw new AppError(400, 'bad_password', 'Password is incorrect');
    if (!checkSecondFactor(user, code)) throw new AppError(400, 'bad_code', 'That code is not valid');
    disableTotp(user.id);
    audit(ctxOf(req), 'auth.totp_disable', { type: 'user', id: user.id }, 'Disabled two-factor authentication');
    return { ok: true };
  });

  app.get('/api/auth/sessions', async (req) => {
    const user = requireUser(req);
    return listSessions(user.id)
      .map((s) => ({
        id: s.id.slice(0, 16),
        current: s.id === req.sessionId,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        userAgent: s.userAgent,
        ip: s.ip,
      }))
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  });

  app.delete<{ Params: { id: string } }>('/api/auth/sessions/:id', async (req) => {
    const user = requireUser(req);
    const target = listSessions(user.id).find((s) => s.id.startsWith(req.params.id) && req.params.id.length >= 16);
    if (!target) throw unauthorized('Session not found');
    revokeSession(target.id, user.id);
    audit(ctxOf(req), 'auth.session_revoke', { type: 'user', id: user.id }, 'Signed out a device');
    return { ok: true };
  });
}
