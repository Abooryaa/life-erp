import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { loadConfig, type AppConfig } from '../src/config';
import { closeDb } from '../src/db/client';
import { resetLoginThrottle } from '../src/modules/auth/service';

export interface TestCtx {
  app: FastifyInstance;
  config: AppConfig;
  cookie: string;
  dir: string;
  close(): Promise<void>;
}

export const OWNER = {
  fullName: 'Mohamed Test',
  username: 'mohamed',
  email: 'mohamed@example.com',
  password: 'correct horse battery',
  confirmPassword: 'correct horse battery',
  businesses: ['MMA Spaces', 'Basira'],
};

export async function makeApp(opts: { setup?: boolean; demo?: boolean } = {}): Promise<TestCtx> {
  const dir = mkdtempSync(join(tmpdir(), 'life-erp-test-'));
  const config = loadConfig({ dataDir: dir, env: 'test', demo: opts.demo ?? false });
  const app = await buildApp(config);
  resetLoginThrottle();
  const ctx: TestCtx = {
    app,
    config,
    dir,
    cookie: '',
    async close() {
      await app.close();
      closeDb();
      rmSync(dir, { recursive: true, force: true });
    },
  };
  if (opts.setup !== false) {
    const res = await call(ctx, 'POST', '/api/auth/setup', OWNER);
    if (res.statusCode !== 200) throw new Error(`setup failed: ${res.body}`);
  }
  return ctx;
}

export function sessionCookieFrom(res: { headers: Record<string, unknown> }): string | null {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  const c = list.find((s) => s.startsWith('lerp_'));
  return c ? c.split(';')[0] : null;
}

/** JSON API call that carries the session cookie and CSRF header like the real client. */
export async function call(ctx: TestCtx, method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await ctx.app.inject({
    method: method as never,
    url,
    payload: body === undefined ? undefined : (body as never),
    headers: { 'x-life-erp': '1', ...(ctx.cookie ? { cookie: ctx.cookie } : {}), ...headers },
  });
  const c = sessionCookieFrom(res);
  if (c) ctx.cookie = c.endsWith('=') ? '' : c;
  return res;
}

export function json<T = any>(res: { body: string }): T {
  return JSON.parse(res.body) as T;
}

/** Build a multipart/form-data body by hand (no extra dependency needed in tests). */
export function multipart(fields: Record<string, string>, file?: { name: string; content: Buffer; type?: string }) {
  const boundary = `----lifeerp${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type ?? 'application/octet-stream'}\r\n\r\n`,
      ),
      file.content,
      Buffer.from('\r\n'),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

export async function upload(ctx: TestCtx, url: string, fields: Record<string, string>, file?: { name: string; content: Buffer }) {
  const mp = multipart(fields, file);
  return ctx.app.inject({
    method: 'POST',
    url,
    payload: mp.payload,
    headers: { ...mp.headers, 'x-life-erp': '1', cookie: ctx.cookie },
  });
}
