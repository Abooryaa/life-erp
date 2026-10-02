import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { and, desc, eq, inArray, isNotNull, isNull, lte } from 'drizzle-orm';
import { getDb } from '../db/client';
import { backups, documents, idempotencyKeys } from '../db/schema';
import { hasUsers, purgeExpiredSessions } from '../modules/auth/service';
import { createBackup } from '../modules/backup/service';
import { notify } from '../modules/notifications/service';
import { getSettings } from '../modules/settings/service';
import { getConfig } from '../runtime';
import { localDateTime, addDays } from '../lib/dates';
import { registerJob } from './scheduler';

/** Nightly automatic backup. Runs once per local day at/after the configured time. */
registerJob({
  name: 'auto-backup',
  everyMs: 60_000,
  async run() {
    const s = getSettings();
    if (!s.backup.auto || !hasUsers()) return; // nothing worth backing up before first-run setup
    const { date, time } = localDateTime(s.timezone);
    if (time < s.backup.time) return;
    const last = getDb()
      .select()
      .from(backups)
      .where(and(eq(backups.kind, 'auto'), inArray(backups.status, ['ok', 'failed'])))
      .orderBy(desc(backups.createdAt))
      .get();
    if (last && localDateTime(s.timezone, new Date(last.createdAt)).date === date) return; // one attempt per day
    await createBackup('auto');
  },
});

/** Warn about documents (IDs, contracts, certificates…) that expire within 30 days. */
registerJob({
  name: 'document-expiry',
  everyMs: 6 * 3_600_000,
  run() {
    const s = getSettings();
    const { date: today } = localDateTime(s.timezone);
    const horizon = addDays(today, 30);
    const docs = getDb()
      .select()
      .from(documents)
      .where(and(isNull(documents.deletedAt), isNotNull(documents.expiresOn), lte(documents.expiresOn, horizon)))
      .all();
    for (const d of docs) {
      const expired = d.expiresOn! < today;
      notify({
        severity: expired ? 'warning' : 'reminder',
        title: expired ? `Document expired: ${d.title}` : `Document expires soon: ${d.title}`,
        body: `Expiry date ${d.expiresOn}`,
        link: `/documents/${d.id}`,
        entity: { type: 'document', id: d.id },
        dedupeKey: `doc-expiry:${d.id}:${d.expiresOn}:${expired ? 'expired' : 'soon'}`,
      });
    }
  },
});

registerJob({
  name: 'housekeeping',
  everyMs: 6 * 3_600_000,
  run() {
    purgeExpiredSessions();
    getDb()
      .delete(idempotencyKeys)
      .where(lte(idempotencyKeys.createdAt, new Date(Date.now() - 7 * 86_400_000).toISOString()))
      .run();
    // Remove abandoned temporary files (failed uploads, interrupted restores) older than a day.
    const tmp = getConfig().paths.tmp;
    for (const f of readdirSync(tmp)) {
      const p = join(tmp, f);
      if (Date.now() - statSync(p).mtimeMs > 86_400_000) rmSync(p, { recursive: true, force: true });
    }
  },
});
