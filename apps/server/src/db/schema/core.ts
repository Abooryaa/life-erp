import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/** ISO-8601 UTC timestamp columns, defaulted by SQLite. */
const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;
export const timestamps = {
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
};
export const softDelete = { deletedAt: text('deleted_at') };

export const appMeta = sqliteTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  email: text('email').notNull().unique(),
  fullName: text('full_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  passwordChangedAt: text('password_changed_at').notNull().default(now),
  totpSecret: text('totp_secret'),
  totpEnabled: integer('totp_enabled', { mode: 'boolean' }).notNull().default(false),
  /** JSON array of SHA-256 hashes of unused recovery codes. */
  recoveryCodes: text('recovery_codes'),
  role: text('role').notNull().default('owner'),
  ...timestamps,
});

export const sessions = sqliteTable(
  'sessions',
  {
    /** SHA-256 of the session token; the raw token only lives in the cookie. */
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull().default(now),
    lastSeenAt: text('last_seen_at').notNull().default(now),
    expiresAt: text('expires_at').notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull().default(now),
});

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  kind: text('kind', { enum: ['personal', 'business'] }).notNull(),
  description: text('description'),
  industry: text('industry'),
  color: text('color').notNull().default('#4f46e5'),
  currency: text('currency').notNull().default('EGP'),
  website: text('website'),
  notes: text('notes'),
  sortOrder: integer('sort_order').notNull().default(0),
  archivedAt: text('archived_at'),
  ...timestamps,
  ...softDelete,
});

export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  color: text('color'),
  createdAt: text('created_at').notNull().default(now),
});

export const taggings = sqliteTable(
  'taggings',
  {
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [
    primaryKey({ columns: [t.tagId, t.entityType, t.entityId] }),
    index('taggings_entity_idx').on(t.entityType, t.entityId),
  ],
);

/** Generic any-to-any relationship between records ("everything is connected"). */
export const entityLinks = sqliteTable(
  'entity_links',
  {
    id: text('id').primaryKey(),
    fromType: text('from_type').notNull(),
    fromId: text('from_id').notNull(),
    toType: text('to_type').notNull(),
    toId: text('to_id').notNull(),
    relation: text('relation').notNull().default('related'),
    note: text('note'),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('entity_links_unique').on(t.fromType, t.fromId, t.toType, t.toId, t.relation),
    index('entity_links_to_idx').on(t.toType, t.toId),
  ],
);

/** Physical file blobs, content-addressed by SHA-256 (identical uploads are stored once). */
export const files = sqliteTable('files', {
  id: text('id').primaryKey(),
  sha256: text('sha256').notNull().unique(),
  size: integer('size').notNull(),
  mime: text('mime').notNull(),
  storagePath: text('storage_path').notNull(),
  createdAt: text('created_at').notNull().default(now),
});

export const documents = sqliteTable(
  'documents',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').references(() => workspaces.id),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id),
    title: text('title').notNull(),
    originalName: text('original_name').notNull(),
    description: text('description'),
    docType: text('doc_type').notNull().default('other'),
    documentDate: text('document_date'),
    expiresOn: text('expires_on'),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index('documents_ws_idx').on(t.workspaceId)],
);

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    at: text('at').notNull().default(now),
    userId: text('user_id'),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    summary: text('summary'),
    before: text('before'),
    after: text('after'),
    ip: text('ip'),
  },
  (t) => [index('audit_entity_idx').on(t.entityType, t.entityId), index('audit_at_idx').on(t.at)],
);

export const notifications = sqliteTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    createdAt: text('created_at').notNull().default(now),
    severity: text('severity', { enum: ['critical', 'warning', 'reminder', 'info'] }).notNull(),
    title: text('title').notNull(),
    body: text('body'),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    link: text('link'),
    /** Prevents automations from raising the same alert twice. */
    dedupeKey: text('dedupe_key').unique(),
    readAt: text('read_at'),
    dismissedAt: text('dismissed_at'),
  },
  (t) => [index('notifications_created_idx').on(t.createdAt)],
);

export const backups = sqliteTable('backups', {
  id: text('id').primaryKey(),
  createdAt: text('created_at').notNull().default(now),
  kind: text('kind', { enum: ['manual', 'auto', 'safety'] }).notNull(),
  status: text('status', { enum: ['ok', 'failed'] }).notNull(),
  path: text('path'),
  size: integer('size'),
  error: text('error'),
  manifest: text('manifest'),
});
