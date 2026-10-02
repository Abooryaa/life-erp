import { workspaceSchema, type WorkspaceInput } from '@life-erp/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { workspaces } from '../../db/schema';
import { audit, type AuditContext } from '../../lib/audit';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { newId, nowIso, slugify } from '../../lib/ids';
import { registerEntity } from '../../lib/registry';
import { parse } from '../../lib/validate';
import { reindexEntity } from '../search/service';

export type Workspace = typeof workspaces.$inferSelect;

const live = isNull(workspaces.deletedAt);

export function listWorkspaces(opts: { includeArchived?: boolean } = {}) {
  const rows = getDb().select().from(workspaces).where(live).orderBy(asc(workspaces.sortOrder), asc(workspaces.createdAt)).all();
  return opts.includeArchived ? rows : rows.filter((w) => !w.archivedAt);
}

export function getWorkspace(id: string): Workspace {
  const w = getDb().select().from(workspaces).where(and(eq(workspaces.id, id), live)).get();
  if (!w) throw notFound('Workspace');
  return w;
}

export function getPersonalWorkspace(): Workspace | undefined {
  return getDb().select().from(workspaces).where(and(eq(workspaces.kind, 'personal'), live)).get();
}

/** Throws unless the id refers to an existing workspace. Accepts null/undefined (= no workspace). */
export function assertWorkspace(id: string | null | undefined) {
  if (id) getWorkspace(id);
}

function uniqueSlug(name: string, exceptId?: string) {
  const db = getDb();
  const base = slugify(name);
  let slug = base;
  for (let i = 2; ; i++) {
    const hit = db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, slug)).get();
    if (!hit || hit.id === exceptId) return slug;
    slug = `${base}-${i}`;
  }
}

export function createWorkspace(ctx: AuditContext, input: WorkspaceInput): Workspace {
  const data = parse(workspaceSchema, input);
  const db = getDb();
  if (data.kind === 'personal' && getPersonalWorkspace()) throw conflict('There is already a personal workspace');
  const dupe = listWorkspaces({ includeArchived: true }).find((w) => w.name.toLowerCase() === data.name.toLowerCase());
  if (dupe) throw conflict(`A workspace named "${data.name}" already exists`);
  const maxOrder = Math.max(0, ...listWorkspaces({ includeArchived: true }).map((w) => w.sortOrder));
  const row = { id: newId(), slug: uniqueSlug(data.name), sortOrder: maxOrder + 1, ...data };
  db.insert(workspaces).values(row).run();
  const created = getWorkspace(row.id);
  audit(ctx, 'workspace.create', { type: 'workspace', id: row.id }, `Created workspace "${data.name}"`, null, created);
  reindexEntity('workspace', row.id);
  return created;
}

export function updateWorkspace(ctx: AuditContext, id: string, input: Partial<WorkspaceInput>): Workspace {
  const before = getWorkspace(id);
  const data = parse(workspaceSchema, { ...before, ...input, kind: before.kind });
  if (data.name.toLowerCase() !== before.name.toLowerCase()) {
    const dupe = listWorkspaces({ includeArchived: true }).find((w) => w.id !== id && w.name.toLowerCase() === data.name.toLowerCase());
    if (dupe) throw conflict(`A workspace named "${data.name}" already exists`);
  }
  getDb()
    .update(workspaces)
    .set({ ...data, slug: uniqueSlug(data.name, id), updatedAt: nowIso() })
    .where(eq(workspaces.id, id))
    .run();
  const after = getWorkspace(id);
  audit(ctx, 'workspace.update', { type: 'workspace', id }, `Updated workspace "${after.name}"`, before, after);
  reindexEntity('workspace', id);
  return after;
}

export function setWorkspaceArchived(ctx: AuditContext, id: string, archived: boolean) {
  const w = getWorkspace(id);
  if (w.kind === 'personal') throw badRequest('The personal workspace cannot be archived');
  getDb()
    .update(workspaces)
    .set({ archivedAt: archived ? nowIso() : null, updatedAt: nowIso() })
    .where(eq(workspaces.id, id))
    .run();
  audit(ctx, archived ? 'workspace.archive' : 'workspace.unarchive', { type: 'workspace', id }, `${archived ? 'Archived' : 'Restored'} workspace "${w.name}"`);
}

/**
 * Soft-delete a workspace. Records that belong to it are kept (they stay visible
 * under "All" and can be moved) — nothing is destroyed.
 */
export function deleteWorkspace(ctx: AuditContext, id: string) {
  const w = getWorkspace(id);
  if (w.kind === 'personal') throw badRequest('The personal workspace cannot be deleted');
  getDb().update(workspaces).set({ deletedAt: nowIso(), updatedAt: nowIso() }).where(eq(workspaces.id, id)).run();
  audit(ctx, 'workspace.delete', { type: 'workspace', id }, `Deleted workspace "${w.name}"`, w);
  reindexEntity('workspace', id);
}

export function reorderWorkspaces(ctx: AuditContext, ids: string[]) {
  const db = getDb();
  ids.forEach((id, i) => db.update(workspaces).set({ sortOrder: i }).where(eq(workspaces.id, id)).run());
  audit(ctx, 'workspace.reorder', null, 'Reordered workspaces');
}

registerEntity({
  type: 'workspace',
  exists: (id) => !!getDb().select({ id: workspaces.id }).from(workspaces).where(and(eq(workspaces.id, id), live)).get(),
  resolve: (ids) =>
    getDb()
      .select()
      .from(workspaces)
      .where(and(inArray(workspaces.id, ids), live))
      .all()
      .map((w) => ({ id: w.id, type: 'workspace', title: w.name, url: `/workspaces/${w.id}`, subtitle: w.industry, workspaceId: w.id })),
  searchDocs: (ids) =>
    getDb()
      .select()
      .from(workspaces)
      .where(ids ? and(inArray(workspaces.id, ids), live) : live)
      .all()
      .map((w) => ({ id: w.id, workspaceId: w.id, title: w.name, body: [w.description, w.industry, w.notes].filter(Boolean).join('\n') })),
});
