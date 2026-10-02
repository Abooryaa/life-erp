import { tagNameSchema } from '@life-erp/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, tx } from '../../db/client';
import { taggings, tags } from '../../db/schema';
import { audit, type AuditContext } from '../../lib/audit';
import { conflict, notFound } from '../../lib/errors';
import { newId } from '../../lib/ids';
import { parse } from '../../lib/validate';
import { reindexEntity } from '../search/service';

export function listTags() {
  return getDb()
    .select({
      id: tags.id,
      name: tags.name,
      color: tags.color,
      usage: sql<number>`(SELECT count(*) FROM taggings g WHERE g.tag_id = ${tags.id})`,
    })
    .from(tags)
    .orderBy(tags.name)
    .all();
}

function ensureTag(name: string): string {
  const db = getDb();
  const existing = db.select({ id: tags.id }).from(tags).where(eq(tags.name, name)).get();
  if (existing) return existing.id;
  const id = newId();
  db.insert(tags).values({ id, name }).run();
  return id;
}

export function createTag(ctx: AuditContext, input: { name: string; color?: string | null }) {
  const name = parse(tagNameSchema, input.name);
  if (getDb().select().from(tags).where(eq(tags.name, name)).get()) throw conflict(`Tag #${name} already exists`);
  const id = newId();
  getDb().insert(tags).values({ id, name, color: input.color ?? null }).run();
  audit(ctx, 'tag.create', { type: 'settings', id }, `Created tag #${name}`);
  return { id, name, color: input.color ?? null };
}

export function updateTag(ctx: AuditContext, id: string, input: { name?: string; color?: string | null }) {
  const db = getDb();
  const tag = db.select().from(tags).where(eq(tags.id, id)).get();
  if (!tag) throw notFound('Tag');
  const name = input.name !== undefined ? parse(tagNameSchema, input.name) : tag.name;
  if (name !== tag.name && db.select().from(tags).where(eq(tags.name, name)).get()) {
    throw conflict(`Tag #${name} already exists`);
  }
  db.update(tags).set({ name, color: input.color === undefined ? tag.color : input.color }).where(eq(tags.id, id)).run();
  audit(ctx, 'tag.update', { type: 'settings', id }, `Updated tag #${tag.name}${name !== tag.name ? ` → #${name}` : ''}`);
  if (name !== tag.name) reindexTagged(id);
}

export function deleteTag(ctx: AuditContext, id: string) {
  const db = getDb();
  const tag = db.select().from(tags).where(eq(tags.id, id)).get();
  if (!tag) throw notFound('Tag');
  const affected = db.select().from(taggings).where(eq(taggings.tagId, id)).all();
  db.delete(tags).where(eq(tags.id, id)).run();
  for (const t of affected) reindexEntity(t.entityType, t.entityId);
  audit(ctx, 'tag.delete', { type: 'settings', id }, `Deleted tag #${tag.name} (was on ${affected.length} records)`);
}

function reindexTagged(tagId: string) {
  for (const t of getDb().select().from(taggings).where(eq(taggings.tagId, tagId)).all()) {
    reindexEntity(t.entityType, t.entityId);
  }
}

export function getTagsFor(entityType: string, entityId: string): string[] {
  return getDb()
    .select({ name: tags.name })
    .from(taggings)
    .innerJoin(tags, eq(tags.id, taggings.tagId))
    .where(and(eq(taggings.entityType, entityType), eq(taggings.entityId, entityId)))
    .orderBy(tags.name)
    .all()
    .map((r) => r.name);
}

/** Tags for many records of one type at once: Map<entityId, tagNames[]>. */
export function getTagsForMany(entityType: string, ids: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!ids.length) return out;
  const rows = getDb()
    .select({ entityId: taggings.entityId, name: tags.name })
    .from(taggings)
    .innerJoin(tags, eq(tags.id, taggings.tagId))
    .where(and(eq(taggings.entityType, entityType), inArray(taggings.entityId, ids)))
    .all();
  for (const r of rows) out.set(r.entityId, [...(out.get(r.entityId) ?? []), r.name]);
  return out;
}

/** Replace the full tag set of a record, creating tags that don't exist yet. */
export function setTagsFor(entityType: string, entityId: string, names: string[]) {
  const clean = [...new Set(names.map((n) => parse(tagNameSchema, n)))];
  tx((db) => {
    db.delete(taggings).where(and(eq(taggings.entityType, entityType), eq(taggings.entityId, entityId))).run();
    for (const name of clean) {
      db.insert(taggings).values({ tagId: ensureTag(name), entityType, entityId }).onConflictDoNothing().run();
    }
  });
  reindexEntity(entityType, entityId);
  return clean;
}

/** Remove all tags of a record (used when it is permanently deleted). */
export function clearTagsFor(entityType: string, entityId: string) {
  getDb()
    .delete(taggings)
    .where(and(eq(taggings.entityType, entityType), eq(taggings.entityId, entityId)))
    .run();
}

/** Ids of records of a type that carry a tag — used by list filters in every module. */
export function idsWithTag(entityType: string, tagName: string): string[] {
  return getDb()
    .select({ id: taggings.entityId })
    .from(taggings)
    .innerJoin(tags, eq(tags.id, taggings.tagId))
    .where(and(eq(taggings.entityType, entityType), eq(tags.name, tagName.replace(/^#/, '').toLowerCase())))
    .all()
    .map((r) => r.id);
}
