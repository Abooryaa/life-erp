import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { timestamps } from './core';

export const automations = sqliteTable('automations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  event: text('event').notNull(),
  /** JSON ScheduleSpec for event = 'schedule'. */
  schedule: text('schedule'),
  /** JSON arrays. */
  conditions: text('conditions').notNull().default('[]'),
  actions: text('actions').notNull().default('[]'),
  /** For scheduled rules: the occurrence ('YYYY-MM-DD HH:mm') last handled. */
  lastScheduled: text('last_scheduled'),
  lastRunAt: text('last_run_at'),
  runCount: integer('run_count').notNull().default(0),
  ...timestamps,
});

export const automationRuns = sqliteTable(
  'automation_runs',
  {
    id: text('id').primaryKey(),
    automationId: text('automation_id')
      .notNull()
      .references(() => automations.id, { onDelete: 'cascade' }),
    at: text('at').notNull(),
    status: text('status').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    message: text('message'),
  },
  (t) => [index('auto_runs_idx').on(t.automationId, t.at)],
);

export const customFieldDefs = sqliteTable('custom_field_defs', {
  id: text('id').primaryKey(),
  entityType: text('entity_type').notNull(),
  label: text('label').notNull(),
  type: text('type').notNull(),
  options: text('options').notNull().default('[]'),
  required: integer('required', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps,
});

export const customFieldValues = sqliteTable(
  'custom_field_values',
  {
    fieldId: text('field_id')
      .notNull()
      .references(() => customFieldDefs.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    value: text('value').notNull(),
    updatedAt: timestamps.updatedAt,
  },
  (t) => [primaryKey({ columns: [t.fieldId, t.entityId] }), index('cf_values_entity_idx').on(t.entityType, t.entityId)],
);

/** One row per import, so it can be reviewed and undone. */
export const imports = sqliteTable('imports', {
  id: text('id').primaryKey(),
  target: text('target').notNull(),
  fileName: text('file_name'),
  rowCount: integer('row_count').notNull(),
  createdCount: integer('created_count').notNull(),
  skippedCount: integer('skipped_count').notNull(),
  undoneAt: text('undone_at'),
  createdAt: timestamps.createdAt,
});

export const importItems = sqliteTable(
  'import_items',
  {
    importId: text('import_id')
      .notNull()
      .references(() => imports.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.importId, t.entityId] })],
);

export const importPresets = sqliteTable('import_presets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  target: text('target').notNull(),
  mapping: text('mapping').notNull(),
  options: text('options').notNull(),
  ...timestamps,
});
