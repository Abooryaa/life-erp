import { organizationSchema, relationSchema, type OrganizationInput, type RelationInput } from '@life-erp/shared';
import { and, asc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { businessRelations, opportunities, organizations, people, projects } from '../../db/schema';
import { audit, type AuditContext } from '../../lib/audit';
import { AppError, conflict, notFound } from '../../lib/errors';
import { newId, nowIso } from '../../lib/ids';
import { registerEntity } from '../../lib/registry';
import { parse } from '../../lib/validate';
import { reindexEntity } from '../search/service';
import { getTagsFor, getTagsForMany, setTagsFor } from '../tags/service';
import { getWorkspace } from '../workspaces/service';

export type Organization = typeof organizations.$inferSelect;
const live = isNull(organizations.deletedAt);

export function assertOrganization(id: string | null | undefined, field = 'organizationId') {
  if (!id) return;
  const o = getDb().select({ id: organizations.id }).from(organizations).where(and(eq(organizations.id, id), live)).get();
  if (!o) throw new AppError(400, 'validation', 'Company not found', [{ path: field, message: 'Company not found' }]);
}

export function listOrganizations(f: { q?: string; type?: string } = {}) {
  const conds = [live];
  if (f.type) conds.push(eq(organizations.type, f.type));
  if (f.q) {
    const q = `%${f.q.replace(/[%_]/g, '')}%`;
    conds.push(or(like(organizations.name, q), like(organizations.industry, q), like(organizations.city, q))!);
  }
  const rows = getDb().select().from(organizations).where(and(...conds)).orderBy(asc(organizations.name)).all();
  const ids = rows.map((r) => r.id);
  const counts = (table: typeof people | typeof opportunities | typeof projects) =>
    ids.length
      ? new Map(
          getDb()
            .select({ id: table.organizationId, n: sql<number>`count(*)` })
            .from(table)
            .where(and(inArray(table.organizationId, ids), isNull(table.deletedAt)))
            .groupBy(table.organizationId)
            .all()
            .map((r) => [r.id!, r.n]),
        )
      : new Map<string, number>();
  const pc = counts(people);
  const oc = counts(opportunities);
  const prc = counts(projects);
  const tags = getTagsForMany('organization', ids);
  return rows.map((o) => ({ ...o, peopleCount: pc.get(o.id) ?? 0, opportunityCount: oc.get(o.id) ?? 0, projectCount: prc.get(o.id) ?? 0, tags: tags.get(o.id) ?? [] }));
}

export function getOrganization(id: string) {
  const o = getDb().select().from(organizations).where(and(eq(organizations.id, id), live)).get();
  if (!o) throw notFound('Company');
  const staff = getDb()
    .select({ id: people.id, fullName: people.fullName, role: people.role, phone: people.phone, email: people.email })
    .from(people)
    .where(and(eq(people.organizationId, id), isNull(people.deletedAt)))
    .orderBy(asc(people.fullName))
    .all();
  return { ...o, people: staff, relations: listRelations({ organizationId: id }), tags: getTagsFor('organization', id) };
}

export function createOrganization(ctx: AuditContext, input: OrganizationInput) {
  const data = parse(organizationSchema, input);
  const dupe = getDb().select().from(organizations).where(and(live, sql`lower(${organizations.name}) = lower(${data.name})`)).get();
  if (dupe) throw conflict(`A company named "${data.name}" already exists`);
  const { tags, ...row } = data;
  const id = newId();
  getDb().insert(organizations).values({ id, ...row }).run();
  if (tags?.length) setTagsFor('organization', id, tags);
  audit(ctx, 'organization.create', { type: 'organization', id }, `Added company ${row.name}`);
  reindexEntity('organization', id);
  return getOrganization(id);
}

export function updateOrganization(ctx: AuditContext, id: string, input: Partial<OrganizationInput>) {
  const before = getOrganization(id);
  const data = parse(organizationSchema, { ...before, ...input });
  const { tags, ...row } = data;
  getDb().update(organizations).set({ ...row, updatedAt: nowIso() }).where(eq(organizations.id, id)).run();
  if (input.tags) setTagsFor('organization', id, input.tags);
  audit(ctx, 'organization.update', { type: 'organization', id }, `Updated company ${row.name}`, before, row);
  reindexEntity('organization', id);
  return getOrganization(id);
}

export function deleteOrganization(ctx: AuditContext, id: string) {
  const o = getOrganization(id);
  const db = getDb();
  db.update(people).set({ organizationId: null }).where(eq(people.organizationId, id)).run();
  db.delete(businessRelations).where(eq(businessRelations.organizationId, id)).run();
  db.update(organizations).set({ deletedAt: nowIso() }).where(eq(organizations.id, id)).run();
  audit(ctx, 'organization.delete', { type: 'organization', id }, `Deleted company ${o.name}`, o);
  reindexEntity('organization', id);
}

// ---------- business relations ----------

export function listRelations(f: { workspaceId?: string; role?: string; personId?: string; organizationId?: string } = {}) {
  const conds = [];
  if (f.workspaceId) conds.push(eq(businessRelations.workspaceId, f.workspaceId));
  if (f.role) conds.push(eq(businessRelations.role, f.role));
  if (f.personId) conds.push(eq(businessRelations.personId, f.personId));
  if (f.organizationId) conds.push(eq(businessRelations.organizationId, f.organizationId));
  return getDb()
    .select({ r: businessRelations, personName: people.fullName, personPhone: people.phone, orgName: organizations.name })
    .from(businessRelations)
    .leftJoin(people, eq(people.id, businessRelations.personId))
    .leftJoin(organizations, eq(organizations.id, businessRelations.organizationId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(businessRelations.role))
    .all()
    .filter((x) => x.personName || x.orgName)
    .map((x) => ({ ...x.r, name: x.personName ?? x.orgName!, phone: x.personPhone ?? null, kind: x.r.personId ? ('person' as const) : ('organization' as const) }));
}

export function addRelation(ctx: AuditContext, input: RelationInput) {
  const data = parse(relationSchema, input);
  const ws = getWorkspace(data.workspaceId);
  if (data.personId) {
    const p = getDb().select({ id: people.id }).from(people).where(and(eq(people.id, data.personId), isNull(people.deletedAt))).get();
    if (!p) throw new AppError(400, 'validation', 'Contact not found', [{ path: 'personId', message: 'Contact not found' }]);
  }
  assertOrganization(data.organizationId);
  const existing = listRelations({ workspaceId: data.workspaceId, personId: data.personId ?? undefined, organizationId: data.organizationId ?? undefined }).find(
    (r) => r.role === data.role && (r.personId ?? null) === (data.personId ?? null) && (r.organizationId ?? null) === (data.organizationId ?? null),
  );
  if (existing) throw conflict(`Already a ${data.role} of ${ws.name}`);
  const id = newId();
  getDb()
    .insert(businessRelations)
    .values({ id, ...data, personId: data.personId ?? null, organizationId: data.organizationId ?? null, since: data.since ?? null })
    .run();
  audit(ctx, 'relation.create', { type: 'workspace', id: ws.id }, `Added ${data.role} to ${ws.name}`);
  return getDb().select().from(businessRelations).where(eq(businessRelations.id, id)).get()!;
}

/** Ensure a contact has a role for a business (idempotent — used when a deal is won). */
export function ensureRelation(ctx: AuditContext, input: RelationInput) {
  try {
    return addRelation(ctx, input);
  } catch (err) {
    if (err instanceof AppError && err.status === 409) return null;
    throw err;
  }
}

export function updateRelation(ctx: AuditContext, id: string, input: { role?: string; status?: string; notes?: string | null }) {
  const r = getDb().select().from(businessRelations).where(eq(businessRelations.id, id)).get();
  if (!r) throw notFound('Relation');
  const data = parse(relationSchema, { ...r, ...input });
  getDb().update(businessRelations).set({ role: data.role, status: data.status, notes: data.notes, updatedAt: nowIso() }).where(eq(businessRelations.id, id)).run();
  audit(ctx, 'relation.update', { type: 'workspace', id: r.workspaceId }, `Changed ${r.role} → ${data.role}`);
}

export function removeRelation(ctx: AuditContext, id: string) {
  const r = getDb().select().from(businessRelations).where(eq(businessRelations.id, id)).get();
  if (!r) throw notFound('Relation');
  getDb().delete(businessRelations).where(eq(businessRelations.id, id)).run();
  audit(ctx, 'relation.delete', { type: 'workspace', id: r.workspaceId }, `Removed ${r.role}`, r);
}

registerEntity({
  type: 'organization',
  exists: (id) => !!getDb().select({ id: organizations.id }).from(organizations).where(and(eq(organizations.id, id), live)).get(),
  resolve: (ids) =>
    getDb()
      .select()
      .from(organizations)
      .where(and(inArray(organizations.id, ids), live))
      .all()
      .map((o) => ({ id: o.id, type: 'organization', title: o.name, url: `/companies/${o.id}`, subtitle: o.industry })),
  searchDocs: (ids) =>
    getDb()
      .select()
      .from(organizations)
      .where(ids ? and(inArray(organizations.id, ids), live) : live)
      .all()
      .map((o) => ({ id: o.id, title: o.name, body: [o.industry, o.type, o.city, o.phone, o.email, o.notes].filter(Boolean).join('\n') })),
});
