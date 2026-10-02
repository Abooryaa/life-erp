import { existsSync } from 'node:fs';
import { join } from 'node:path';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import { ZodError } from 'zod';
import type { AppConfig } from './config';
import { eq } from 'drizzle-orm';
import { DatabaseError, getDb, openDb } from './db/client';
import { idempotencyKeys } from './db/schema';
import { AppError, fromZod } from './lib/errors';
import { newId } from './lib/ids';
import { authRoutes, cookieName } from './modules/auth/routes';
import { validateSession } from './modules/auth/service';
import { backupRoutes } from './modules/backup/routes';
import { coreRoutes } from './modules/core-routes';
import { WEB_DIST_DIR } from './paths';
import { setRuntimeConfig } from './runtime';
import { moduleRoutes } from './modules';

const PUBLIC_API = new Set(['/api/health', '/api/auth/status', '/api/auth/setup', '/api/auth/login', '/api/auth/login/totp']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function buildApp(config: AppConfig, opts: { logger?: FastifyBaseLogger } = {}) {
  setRuntimeConfig(config);
  openDb(config.paths.dbFile);

  const app = Fastify({
    ...(opts.logger ? { loggerInstance: opts.logger } : { logger: false }),
    // Tailscale Serve proxies from 127.0.0.1 — trust forwarded headers only from loopback.
    trustProxy: ['127.0.0.1', '::1'],
    bodyLimit: 5 * 1024 * 1024,
    genReqId: () => newId().slice(-12),
  });

  await app.register(helmet, {
    // HTTPS is provided by Tailscale; on plain-HTTP LAN access these must stay off.
    hsts: false,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        frameSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
  });
  await app.register(cookie);
  await app.register(multipart, { limits: { fieldSize: 100_000, fields: 30 } });
  await app.register(rateLimit, { global: false });

  app.decorateRequest('user', null);
  app.decorateRequest('sessionId', null);

  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    // CSRF: state-changing API calls must carry a custom header. Browsers can't add it
    // cross-site without a CORS preflight, which this server never approves.
    if (!SAFE_METHODS.has(req.method) && req.headers['x-life-erp'] !== '1') {
      throw new AppError(403, 'csrf', 'Request blocked (missing security header)');
    }
    const token = req.cookies[cookieName()];
    if (token) {
      const s = validateSession(token, config.sessionDays);
      if (s) {
        req.user = s.user;
        req.sessionId = s.sessionId;
      }
    }
    const path = req.url.split('?')[0];
    if (!req.user && !PUBLIC_API.has(path)) throw new AppError(401, 'unauthorized', 'Please sign in');
  });

  // Idempotent retries: the phone outbox re-sends queued creates with the same key; a request
  // that already succeeded returns its original response instead of creating a duplicate.
  app.addHook('preHandler', async (req, reply) => {
    const key = req.headers['x-idempotency-key'];
    if (req.method !== 'POST' || typeof key !== 'string' || !/^[\w-]{8,100}$/.test(key) || !req.user) return;
    const hit = getDb().select().from(idempotencyKeys).where(eq(idempotencyKeys.key, `${req.user.id}:${key}`)).get();
    if (hit) {
      return reply.code(hit.status).header('content-type', 'application/json; charset=utf-8').header('x-idempotent-replay', '1').send(hit.body);
    }
    (req as { idemKey?: string }).idemKey = `${req.user.id}:${key}`;
  });
  app.addHook('onSend', async (req, reply, payload) => {
    const key = (req as { idemKey?: string }).idemKey;
    if (key && reply.statusCode < 400 && typeof payload === 'string') {
      getDb().insert(idempotencyKeys).values({ key, status: reply.statusCode, body: payload }).onConflictDoNothing().run();
    }
    return payload;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) err = fromZod(err);
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, fields: err.fields } });
    }
    const e = err as Error & { statusCode?: number; code?: string; validation?: unknown };
    if (e.statusCode === 429) {
      return reply.status(429).send({ error: { code: 'rate_limited', message: 'Too many attempts. Wait a few minutes and try again.' } });
    }
    if (e.code === 'FST_REQ_FILE_TOO_LARGE' || e.statusCode === 413) {
      return reply.status(413).send({ error: { code: 'too_large', message: 'The file is larger than the upload limit' } });
    }
    if (e.statusCode && e.statusCode < 500) {
      return reply.status(e.statusCode).send({ error: { code: e.code ?? 'bad_request', message: e.message } });
    }
    if (err instanceof DatabaseError || /SQLITE_/.test(e.code ?? '')) {
      req.log.error({ err }, 'Database error');
      return reply.status(500).send({ error: { code: 'database', message: `Database error: ${e.message}`, ref: req.id } });
    }
    req.log.error({ err }, 'Unhandled error');
    return reply.status(500).send({ error: { code: 'internal', message: `Something went wrong (reference ${req.id}). Details are in the server log.`, ref: req.id } });
  });

  app.get('/api/health', async () => ({ ok: true, demo: config.demo, time: new Date().toISOString() }));
  await app.register(authRoutes);
  await app.register(coreRoutes);
  await app.register(backupRoutes);
  for (const plugin of moduleRoutes) await app.register(plugin);

  // Unknown API paths are JSON 404s; everything else is the single-page app.
  const hasWeb = existsSync(join(WEB_DIST_DIR, 'index.html'));
  if (hasWeb) {
    await app.register(fastifyStatic, {
      root: WEB_DIST_DIR,
      // Look files up on each request so a rebuilt frontend is picked up without restarting.
      wildcard: true,
      setHeaders(res, path) {
        if (/[\\/]assets[\\/]/.test(path)) res.header('Cache-Control', 'public, max-age=31536000, immutable');
        else res.header('Cache-Control', 'no-cache');
      },
    });
  }
  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split('?')[0];
    // Missing files (e.g. an old /assets/x.js) must 404 — never fall back to HTML for them.
    if (path.startsWith('/api/') || /\.[a-z0-9]{1,8}$/i.test(path) || !hasWeb || req.method !== 'GET') {
      return reply.status(404).send({ error: { code: 'not_found', message: 'Not found' } });
    }
    reply.header('Cache-Control', 'no-cache');
    return reply.sendFile('index.html');
  });

  return app;
}
