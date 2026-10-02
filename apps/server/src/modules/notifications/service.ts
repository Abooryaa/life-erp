import type { NotificationSeverity } from '@life-erp/shared';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { notifications } from '../../db/schema';
import { notFound } from '../../lib/errors';
import { newId, nowIso } from '../../lib/ids';

export interface NotifyInput {
  severity: NotificationSeverity;
  title: string;
  body?: string | null;
  link?: string | null;
  entity?: { type: string; id: string } | null;
  /** When set, the same alert is only ever raised once (until deleted). */
  dedupeKey?: string | null;
}

export function notify(n: NotifyInput): boolean {
  const res = getDb()
    .insert(notifications)
    .values({
      id: newId(),
      severity: n.severity,
      title: n.title,
      body: n.body ?? null,
      link: n.link ?? null,
      entityType: n.entity?.type ?? null,
      entityId: n.entity?.id ?? null,
      dedupeKey: n.dedupeKey ?? null,
    })
    .onConflictDoNothing()
    .run();
  return res.changes > 0;
}

export function listNotifications(opts: { unreadOnly?: boolean; limit?: number } = {}) {
  const where = opts.unreadOnly
    ? and(isNull(notifications.dismissedAt), isNull(notifications.readAt))
    : isNull(notifications.dismissedAt);
  return getDb()
    .select()
    .from(notifications)
    .where(where)
    .orderBy(desc(notifications.createdAt))
    .limit(opts.limit ?? 100)
    .all();
}

export function notificationCounts() {
  const rows = getDb()
    .select({ severity: notifications.severity, n: sql<number>`count(*)` })
    .from(notifications)
    .where(and(isNull(notifications.dismissedAt), isNull(notifications.readAt)))
    .groupBy(notifications.severity)
    .all();
  const by = Object.fromEntries(rows.map((r) => [r.severity, r.n])) as Record<string, number>;
  return { unread: rows.reduce((s, r) => s + r.n, 0), critical: by.critical ?? 0, warning: by.warning ?? 0 };
}

export function markRead(id: string) {
  const r = getDb().update(notifications).set({ readAt: nowIso() }).where(eq(notifications.id, id)).run();
  if (!r.changes) throw notFound('Notification');
}

export function markAllRead() {
  getDb().update(notifications).set({ readAt: nowIso() }).where(isNull(notifications.readAt)).run();
}

export function dismiss(id: string) {
  const r = getDb().update(notifications).set({ dismissedAt: nowIso(), readAt: nowIso() }).where(eq(notifications.id, id)).run();
  if (!r.changes) throw notFound('Notification');
}
