import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuditContext } from './lib/audit';
import { unauthorized } from './lib/errors';
import type { User } from './modules/auth/service';

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
    sessionId: string | null;
  }
}

export function ctxOf(req: FastifyRequest): AuditContext {
  return { userId: req.user?.id ?? null, ip: req.ip };
}

export function requireUser(req: FastifyRequest): User {
  if (!req.user) throw unauthorized();
  return req.user;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * True only for requests made directly on this laptop — not proxied through
 * Tailscale (which also connects from 127.0.0.1 but adds forwarding headers).
 */
export function isDirectLocalRequest(req: FastifyRequest): boolean {
  const remote = req.raw.socket.remoteAddress ?? '';
  const h = req.headers;
  const proxied = !!(h['x-forwarded-for'] || h['forwarded'] || h['tailscale-user-login'] || h['x-forwarded-host']);
  return LOOPBACK.has(remote) && !proxied;
}

export function sendFileDownload(reply: FastifyReply, name: string, mime: string, inline: boolean) {
  const safe = name.replace(/["\\\r\n]/g, '_');
  reply
    .header('Content-Type', mime)
    .header('X-Content-Type-Options', 'nosniff')
    .header('Cache-Control', 'private, max-age=0, must-revalidate')
    // Chrome's PDF viewer refuses to run in a sandboxed document; everything else is sandboxed.
    .header(
      'Content-Security-Policy',
      `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'${mime === 'application/pdf' ? '' : '; sandbox'}`,
    )
    .header(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${safe.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    );
}

export type Q = Record<string, string | undefined>;
