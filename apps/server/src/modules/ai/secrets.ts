import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { secrets } from '../../db/schema';
import { nowIso } from '../../lib/ids';
import { getConfig } from '../../runtime';

/** 32-byte master key in <data>/keys — created once, readable only by you, never backed up. */
function masterKey(): Buffer {
  const file = join(getConfig().paths.keys, 'master.key');
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o600 });
  return Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
}

export function setSecret(name: string, value: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', masterKey(), iv);
  const ciphertext = Buffer.concat([c.update(value, 'utf8'), c.final()]);
  const row = { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), hint: value.slice(-4) };
  getDb()
    .insert(secrets)
    .values({ name, ...row })
    .onConflictDoUpdate({ target: secrets.name, set: { ...row, updatedAt: nowIso() } })
    .run();
}

/** The stored value, or null if missing or no longer decryptable (e.g. restored on another machine). */
export function getSecret(name: string): string | null {
  const r = getDb().select().from(secrets).where(eq(secrets.name, name)).get();
  if (!r) return null;
  try {
    const d = createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(r.iv, 'base64'));
    d.setAuthTag(Buffer.from(r.tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(r.ciphertext, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function deleteSecret(name: string) {
  getDb().delete(secrets).where(eq(secrets.name, name)).run();
}

/** Safe to show: whether it is set, usable, its last 4 characters. Never the value. */
export function secretInfo(name: string) {
  const r = getDb().select().from(secrets).where(eq(secrets.name, name)).get();
  if (!r) return { set: false, usable: false, hint: null as string | null, updatedAt: null as string | null };
  return { set: true, usable: getSecret(name) !== null, hint: r.hint, updatedAt: r.updatedAt };
}
