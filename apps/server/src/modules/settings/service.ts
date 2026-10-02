import { settingsSchema, type Settings, type SettingsPatch } from '@life-erp/shared';
import { getDb } from '../../db/client';
import { settings } from '../../db/schema';
import { audit, type AuditContext } from '../../lib/audit';
import { nowIso } from '../../lib/ids';
import { parse } from '../../lib/validate';

const KEY = 'app';

export function getSettings(): Settings {
  const row = getDb().select().from(settings).all().find((r) => r.key === KEY);
  const stored = row ? JSON.parse(row.value) : {};
  // Parsing fills defaults for any newly added setting; unknown keys are dropped.
  const r = settingsSchema.safeParse(stored);
  return r.success ? r.data : settingsSchema.parse({});
}

export function saveSettings(ctx: AuditContext, patch: SettingsPatch): Settings {
  const before = getSettings();
  const merged = parse(settingsSchema, {
    ...before,
    ...patch,
    backup: { ...before.backup, ...(patch.backup ?? {}) },
    ai: { ...before.ai, ...(patch.ai ?? {}) },
  });
  getDb()
    .insert(settings)
    .values({ key: KEY, value: JSON.stringify(merged) })
    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(merged), updatedAt: nowIso() } })
    .run();
  const changed = Object.keys(patch).join(', ');
  audit(ctx, 'settings.update', { type: 'settings', id: KEY }, `Changed settings: ${changed}`, before, merged);
  return merged;
}
