import { noteSchema, type NoteInput } from '@life-erp/shared';
import { and, desc, eq, inArray, isNotNull, isNull, like, or, sql, type SQL } from 'drizzle-orm';
import { getDb, tx } from '../../db/client';
import { entityLinks, notes } from '../../db/schema';
import { audit, type AuditContext } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { newId, nowIso } from '../../lib/ids';
import { registerEntity } from '../../lib/registry';
import { parse } from '../../lib/validate';
import { reindexEntity } from '../search/service';
import { getTagsFor, getTagsForMany, idsWithTag, setTagsFor } from '../tags/service';
import { assertWorkspace } from '../workspaces/service';

export type Note = typeof notes.$inferSelect;
const live = isNull(notes.deletedAt);

/** Titles referenced as [[Title]] in a note body. */
export function wikiLinks(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/\[\[([^\[\]\n]{1,300})\]\]/g)) out.add(m[1].trim());
  return [...out];
}

/** Store [[links]] as entity links (relation "mentions") so backlinks are one query away. */
function syncMentions(noteId: string, body: string) {
  const titles = wikiLinks(body).map((t) => t.toLowerCase());
  tx((db) => {
    db.delete(entityLinks)
      .where(and(eq(entityLinks.fromType, 'note'), eq(entityLinks.fromId, noteId), eq(entityLinks.relation, 'mentions')))
      .run();
    if (!titles.length) return;
    const targets = db
      .select({ id: notes.id, title: notes.title })
      .from(notes)
      .where(and(live, inArray(sql`lower(${notes.title})`, titles)))
      .all()
      .filter((n) => n.id !== noteId);
    for (const t of targets) {
      db.insert(entityLinks)
        .values({ id: newId(), fromType: 'note', fromId: noteId, toType: 'note', toId: t.id, relation: 'mentions' })
        .onConflictDoNothing()
        .run();
    }
  });
}

export function getNote(id: string) {
  const n = getDb().select().from(notes).where(and(eq(notes.id, id), live)).get();
  if (!n) throw notFound('Note');
  const backlinks = getDb()
    .select({ id: notes.id, title: notes.title, updatedAt: notes.updatedAt })
    .from(entityLinks)
    .innerJoin(notes, eq(notes.id, entityLinks.fromId))
    .where(and(eq(entityLinks.toType, 'note'), eq(entityLinks.toId, id), eq(entityLinks.relation, 'mentions'), eq(entityLinks.fromType, 'note'), live))
    .all();
  // Resolve [[links]] in this note to ids for the client (missing ones can be created).
  const titles = wikiLinks(n.body);
  const resolved = titles.length
    ? getDb()
        .select({ id: notes.id, title: notes.title })
        .from(notes)
        .where(and(live, inArray(sql`lower(${notes.title})`, titles.map((t) => t.toLowerCase()))))
        .all()
    : [];
  const links = titles.map((t) => ({ title: t, id: resolved.find((r) => r.title.toLowerCase() === t.toLowerCase())?.id ?? null }));
  return { ...n, tags: getTagsFor('note', id), backlinks, links };
}

export function listNotes(f: { q?: string; workspaceId?: string; tag?: string; archived?: boolean; limit?: number } = {}) {
  const conds: SQL[] = [live, f.archived ? isNotNull(notes.archivedAt) : isNull(notes.archivedAt)];
  if (f.workspaceId) conds.push(eq(notes.workspaceId, f.workspaceId));
  if (f.tag) conds.push(inArray(notes.id, idsWithTag('note', f.tag)));
  if (f.q) {
    const q = `%${f.q.replace(/[%_]/g, '')}%`;
    conds.push(or(like(notes.title, q), like(notes.body, q))!);
  }
  const rows = getDb()
    .select({ id: notes.id, title: notes.title, body: sql<string>`substr(${notes.body}, 1, 240)`, workspaceId: notes.workspaceId, pinned: notes.pinned, archivedAt: notes.archivedAt, createdAt: notes.createdAt, updatedAt: notes.updatedAt })
    .from(notes)
    .where(and(...conds))
    .orderBy(desc(notes.pinned), desc(notes.updatedAt))
    .limit(Math.min(f.limit ?? 300, 1000))
    .all();
  const tags = getTagsForMany('note', rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, excerpt: r.body, tags: tags.get(r.id) ?? [] }));
}

export function createNote(ctx: AuditContext, input: NoteInput) {
  const data = parse(noteSchema, input);
  assertWorkspace(data.workspaceId);
  const id = newId();
  getDb()
    .insert(notes)
    .values({ id, title: data.title, body: data.body, pinned: data.pinned, workspaceId: data.workspaceId ?? null })
    .run();
  if (data.tags?.length) setTagsFor('note', id, data.tags);
  syncMentions(id, data.body);
  // Existing notes that already linked to this title now resolve to it.
  relinkMentionsTo(data.title);
  audit(ctx, 'note.create', { type: 'note', id }, `Created note "${data.title}"`);
  reindexEntity('note', id);
  return getNote(id);
}

function relinkMentionsTo(title: string) {
  const needle = `%[[${title.replace(/[%_]/g, '')}]]%`;
  const referencing = getDb().select({ id: notes.id, body: notes.body }).from(notes).where(and(live, like(notes.body, needle))).all();
  for (const r of referencing) syncMentions(r.id, r.body);
}

export function updateNote(ctx: AuditContext, id: string, input: Partial<NoteInput> & { archived?: boolean }) {
  const before = getNote(id);
  const data = parse(noteSchema, { ...before, ...input });
  assertWorkspace(data.workspaceId);
  getDb()
    .update(notes)
    .set({
      title: data.title,
      body: data.body,
      pinned: data.pinned,
      workspaceId: data.workspaceId ?? null,
      archivedAt: input.archived === undefined ? before.archivedAt : input.archived ? nowIso() : null,
      updatedAt: nowIso(),
    })
    .where(eq(notes.id, id))
    .run();
  if (input.tags) setTagsFor('note', id, input.tags);
  if (data.body !== before.body) syncMentions(id, data.body);
  if (data.title !== before.title) relinkMentionsTo(data.title);
  // Body changes are frequent (auto-save); only log the summary, not the full text.
  audit(ctx, 'note.update', { type: 'note', id }, `Edited note "${data.title}"`);
  reindexEntity('note', id);
  return getNote(id);
}

export function deleteNote(ctx: AuditContext, id: string) {
  const n = getNote(id);
  getDb().update(notes).set({ deletedAt: nowIso() }).where(eq(notes.id, id)).run();
  audit(ctx, 'note.delete', { type: 'note', id }, `Deleted note "${n.title}"`, { title: n.title, body: n.body });
  reindexEntity('note', id);
}

registerEntity({
  type: 'note',
  exists: (id) => !!getDb().select({ id: notes.id }).from(notes).where(and(eq(notes.id, id), live)).get(),
  resolve: (ids) =>
    getDb()
      .select({ id: notes.id, title: notes.title, workspaceId: notes.workspaceId, updatedAt: notes.updatedAt })
      .from(notes)
      .where(and(inArray(notes.id, ids), live))
      .all()
      .map((n) => ({ id: n.id, type: 'note', title: n.title, url: `/notes/${n.id}`, subtitle: n.updatedAt.slice(0, 10), workspaceId: n.workspaceId })),
  searchDocs: (ids) =>
    getDb()
      .select()
      .from(notes)
      .where(ids ? and(inArray(notes.id, ids), live) : live)
      .all()
      .map((n) => ({ id: n.id, workspaceId: n.workspaceId, title: n.title, body: n.body })),
});
