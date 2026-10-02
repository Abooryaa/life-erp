import { getSqlite } from '../../db/client';
import { getConfig } from '../../runtime';
import pkg from '../../../package.json';

/** Tables that must never leave the machine in a plain export. */
const EXCLUDED = new Set(['sessions']);
const REDACT_COLUMNS: Record<string, string[]> = {
  users: ['password_hash', 'totp_secret', 'recovery_codes'],
};

/**
 * Every table as plain JSON — readable by any tool, no lock-in.
 * (A full backup .zip is the restorable format; this is for inspection and portability.)
 */
export function exportAllJson() {
  const sqlite = getSqlite();
  const tables = (
    sqlite
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
           AND name NOT LIKE 'search_index%' AND name NOT LIKE '__drizzle%' ORDER BY name`,
      )
      .all() as { name: string }[]
  )
    .map((t) => t.name)
    .filter((t) => !EXCLUDED.has(t));
  const data: Record<string, unknown[]> = {};
  for (const t of tables) {
    const rows = sqlite.prepare(`SELECT * FROM "${t}"`).all() as Record<string, unknown>[];
    const redact = REDACT_COLUMNS[t] ?? [];
    data[t] = rows.map((r) => {
      for (const c of redact) if (c in r) r[c] = null;
      return r;
    });
  }
  return {
    format: 'life-erp-export',
    version: 1,
    appVersion: pkg.version,
    exportedAt: new Date().toISOString(),
    demo: getConfig().demo,
    notes: 'Amounts are integer minor units (e.g. piasters). Files are not included — use a full backup for documents.',
    tables: data,
  };
}
