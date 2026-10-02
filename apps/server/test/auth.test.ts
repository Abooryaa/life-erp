import * as OTPAuth from 'otpauth';
import { afterEach, describe, expect, it } from 'vitest';
import { call, json, makeApp, OWNER, type TestCtx } from './helpers';

let ctx: TestCtx;
afterEach(async () => ctx?.close());

describe('first-run setup', () => {
  it('reports that setup is required, then creates owner + workspaces', async () => {
    ctx = await makeApp({ setup: false });
    const status = json(await call(ctx, 'GET', '/api/auth/status'));
    expect(status.setupRequired).toBe(true);
    expect(status.setupAllowedHere).toBe(true);

    const res = await call(ctx, 'POST', '/api/auth/setup', OWNER);
    expect(res.statusCode).toBe(200);
    expect(json(res).user.username).toBe('mohamed');
    expect(ctx.cookie).toMatch(/^lerp_session=/);

    const ws = json(await call(ctx, 'GET', '/api/workspaces'));
    expect(ws.map((w: any) => w.name)).toEqual(['Personal', 'MMA Spaces', 'Basira']);
    expect(ws[0].kind).toBe('personal');
  });

  it('cannot be run twice', async () => {
    ctx = await makeApp();
    const res = await call(ctx, 'POST', '/api/auth/setup', { ...OWNER, username: 'intruder' });
    expect(res.statusCode).toBe(409);
  });

  it('is refused when proxied (e.g. through Tailscale) — only the laptop itself may set up', async () => {
    ctx = await makeApp({ setup: false });
    const res = await call(ctx, 'POST', '/api/auth/setup', OWNER, { 'x-forwarded-for': '100.64.0.5' });
    expect(res.statusCode).toBe(403);
  });

  it('validates password strength and confirmation', async () => {
    ctx = await makeApp({ setup: false });
    const weak = await call(ctx, 'POST', '/api/auth/setup', { ...OWNER, password: 'short', confirmPassword: 'short' });
    expect(weak.statusCode).toBe(400);
    expect(json(weak).error.fields[0].path).toBe('password');
    const mismatch = await call(ctx, 'POST', '/api/auth/setup', { ...OWNER, confirmPassword: 'something else entirely' });
    expect(json(mismatch).error.fields.some((f: any) => f.path === 'confirmPassword')).toBe(true);
  });
});

describe('sign in / out', () => {
  it('requires authentication for private APIs', async () => {
    ctx = await makeApp();
    ctx.cookie = '';
    const res = await call(ctx, 'GET', '/api/workspaces');
    expect(res.statusCode).toBe(401);
  });

  it('signs in with username or email, and signs out', async () => {
    ctx = await makeApp();
    await call(ctx, 'POST', '/api/auth/logout');
    expect(ctx.cookie).toBe('');
    expect((await call(ctx, 'POST', '/api/auth/login', { identifier: 'MOHAMED@example.com', password: OWNER.password })).statusCode).toBe(200);
    expect((await call(ctx, 'GET', '/api/auth/me')).statusCode).toBe(200);
    const old = ctx.cookie;
    await call(ctx, 'POST', '/api/auth/logout');
    ctx.cookie = old; // a revoked session token must no longer work
    expect((await call(ctx, 'GET', '/api/auth/me')).statusCode).toBe(401);
  });

  it('rejects wrong passwords with a generic message and locks after repeated failures', async () => {
    ctx = await makeApp();
    ctx.cookie = '';
    for (let i = 0; i < 5; i++) {
      const r = await call(ctx, 'POST', '/api/auth/login', { identifier: 'mohamed', password: 'wrong password!' });
      expect(r.statusCode).toBe(401);
      expect(json(r).error.message).toBe('Incorrect username or password');
    }
    const locked = await call(ctx, 'POST', '/api/auth/login', { identifier: 'mohamed', password: OWNER.password });
    expect(locked.statusCode).toBe(429);
  });

  it('never stores the password in plain text', async () => {
    ctx = await makeApp();
    const { getDb } = await import('../src/db/client');
    const { users } = await import('../src/db/schema');
    const u = getDb().select().from(users).get()!;
    expect(u.passwordHash).toMatch(/^\$argon2id\$/);
    expect(u.passwordHash).not.toContain(OWNER.password);
  });
});

describe('CSRF protection', () => {
  it('blocks state-changing requests without the custom header', async () => {
    ctx = await makeApp();
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: { name: 'Evil' },
      headers: { cookie: ctx.cookie },
    });
    expect(res.statusCode).toBe(403);
    expect(json(res).error.code).toBe('csrf');
  });

  it('sets a strict, httpOnly session cookie', async () => {
    ctx = await makeApp({ setup: false });
    const res = await call(ctx, 'POST', '/api/auth/setup', OWNER);
    const raw = String(res.headers['set-cookie']);
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Strict/i);
  });
});

describe('password change', () => {
  it('requires the current password and signs out other devices', async () => {
    ctx = await makeApp();
    const phone = { ...ctx };
    phone.cookie = '';
    await call(phone, 'POST', '/api/auth/login', { identifier: 'mohamed', password: OWNER.password });
    expect((await call(phone, 'GET', '/api/auth/me')).statusCode).toBe(200);

    const bad = await call(ctx, 'POST', '/api/auth/password', { currentPassword: 'nope', newPassword: 'another strong pass', confirmPassword: 'another strong pass' });
    expect(bad.statusCode).toBe(400);
    const ok = await call(ctx, 'POST', '/api/auth/password', {
      currentPassword: OWNER.password,
      newPassword: 'another strong pass',
      confirmPassword: 'another strong pass',
    });
    expect(ok.statusCode).toBe(200);
    expect((await call(ctx, 'GET', '/api/auth/me')).statusCode).toBe(200); // this device stays signed in
    expect((await call(phone, 'GET', '/api/auth/me')).statusCode).toBe(401);
  });
});

describe('two-factor authentication', () => {
  it('enables TOTP, requires a code at sign-in, and accepts a one-time recovery code', async () => {
    ctx = await makeApp();
    const setup = json(await call(ctx, 'POST', '/api/auth/totp/setup'));
    expect(setup.qr).toMatch(/^data:image\/png;base64,/);
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(setup.secret) });
    expect((await call(ctx, 'POST', '/api/auth/totp/enable', { code: '000000' })).statusCode).toBe(400);
    const enabled = json(await call(ctx, 'POST', '/api/auth/totp/enable', { code: totp.generate() }));
    expect(enabled.recoveryCodes).toHaveLength(10);

    await call(ctx, 'POST', '/api/auth/logout');
    const step1 = json(await call(ctx, 'POST', '/api/auth/login', { identifier: 'mohamed', password: OWNER.password }));
    expect(step1.mfaRequired).toBe(true);
    expect(ctx.cookie).toBe(''); // no session until the second factor is given

    const wrong = await call(ctx, 'POST', '/api/auth/login/totp', { challenge: step1.challenge, code: '123456' });
    expect(wrong.statusCode).toBe(401);
    const ok = await call(ctx, 'POST', '/api/auth/login/totp', { challenge: step1.challenge, code: totp.generate() });
    expect(ok.statusCode).toBe(200);

    // Recovery code works exactly once.
    const code = enabled.recoveryCodes[0];
    await call(ctx, 'POST', '/api/auth/logout');
    let c = json(await call(ctx, 'POST', '/api/auth/login', { identifier: 'mohamed', password: OWNER.password }));
    expect((await call(ctx, 'POST', '/api/auth/login/totp', { challenge: c.challenge, code })).statusCode).toBe(200);
    await call(ctx, 'POST', '/api/auth/logout');
    c = json(await call(ctx, 'POST', '/api/auth/login', { identifier: 'mohamed', password: OWNER.password }));
    expect((await call(ctx, 'POST', '/api/auth/login/totp', { challenge: c.challenge, code })).statusCode).toBe(401);
  });
});

describe('audit log', () => {
  it('records sign-ins and setup without leaking secrets', async () => {
    ctx = await makeApp();
    const log = json(await call(ctx, 'GET', '/api/audit'));
    const actions = log.map((l: any) => l.action);
    expect(actions).toContain('auth.setup');
    expect(actions).toContain('auth.login');
    expect(JSON.stringify(log)).not.toContain(OWNER.password);
  });
});
