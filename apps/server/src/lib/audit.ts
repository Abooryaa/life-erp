import { getDb } from '../db/client';
import { auditLog } from '../db/schema';
import { newId } from './ids';

export interface AuditContext {
  userId?: string | null;
  ip?: string | null;
}

const SECRET_KEYS = /password|secret|token|recovery/i;

function redact(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value, (k, v) => (k && SECRET_KEYS.test(k) ? '[redacted]' : v));
}

/**
 * Record an important operation. `before`/`after` are stored as JSON snapshots
 * (secrets are always redacted) so changes can be traced and debugged.
 */
export function audit(
  ctx: AuditContext,
  action: string,
  entity: { type: string; id: string } | null,
  summary: string,
  before?: unknown,
  after?: unknown,
) {
  getDb()
    .insert(auditLog)
    .values({
      id: newId(),
      userId: ctx.userId ?? null,
      ip: ctx.ip ?? null,
      action,
      entityType: entity?.type ?? null,
      entityId: entity?.id ?? null,
      summary,
      before: redact(before),
      after: redact(after),
    })
    .run();
}
