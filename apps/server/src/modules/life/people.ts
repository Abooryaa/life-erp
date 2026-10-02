import { interactionSchema, personSchema, type PersonInput } from '@life-erp/shared';
import { and, asc, desc, eq, inArray, isNotNull, isNull, like, lte, or, sql } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { interactions, people } from '../../db/schema';
import { audit, type AuditContext } from '../../lib/audit';
import { conflict, notFound } from '../../lib/errors';
import { newId, nowIso } from '../../lib/ids';
import { registerEntity } from '../../lib/registry';
import { parse } from '../../lib/validate';
import { reindexEntity } from '../search/service';
import { getTagsFor, getTagsForMany, idsWithTag, setTagsFor } from '../tags/service';
import { assertWorkspace } from '../workspaces/service';
import { today } from './common';
import { assertOrganization } from '../business/organizations';

export type Person = typeof people.$inferSelect;
const live = isNull(people.deletedAt);

function lastContacts(ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = getDb()
    .select({ personId: interactions.personId, last: sql<string>`max(${interactions.date})` })
    .from(interactions)
    .where(and(inArray(interactions.personId, ids), isNull(interactions.deletedAt)))
    .groupBy(interactions.personId)
    .all();
  return new Map(rows.map((r) => [r.personId, r.last]));
}

export interface PeopleFilter {
  q?: string;
  relationship?: string;
  workspaceId?: string;
  tag?: string;
  followUpDue?: boolean;
}

export function listPeople(f: PeopleFilter = {}) {
  const conds = [live];
  if (f.relationship) conds.push(eq(people.relationship, f.relationship));
  if (f.workspaceId) conds.push(eq(people.workspaceId, f.workspaceId));
  if (f.tag) conds.push(inArray(people.id, idsWithTag('person', f.tag)));
  if (f.followUpDue) conds.push(and(isNotNull(people.nextFollowUp), lte(people.nextFollowUp, today()))!);
  if (f.q) {
    const q = `%${f.q.replace(/[%_]/g, '')}%`;
    conds.push(or(like(people.fullName, q), like(people.nickname, q), like(people.company, q), like(people.phone, q), like(people.email, q))!);
  }
  const rows = getDb().select().from(people).where(and(...conds)).orderBy(asc(people.fullName)).all();
  const last = lastContacts(rows.map((r) => r.id));
  const tags = getTagsForMany('person', rows.map((r) => r.id));
  return rows.map((p) => ({ ...p, lastContact: last.get(p.id) ?? null, tags: tags.get(p.id) ?? [] }));
}

export function getPerson(id: string) {
  const p = getDb().select().from(people).where(and(eq(people.id, id), live)).get();
  if (!p) throw notFound('Contact');
  const history = getDb()
    .select()
    .from(interactions)
    .where(and(eq(interactions.personId, id), isNull(interactions.deletedAt)))
    .orderBy(desc(interactions.date), desc(interactions.createdAt))
    .all();
  return { ...p, lastContact: history[0]?.date ?? null, interactions: history, tags: getTagsFor('person', id) };
}

function validate(data: ReturnType<typeof personSchema.parse>) {
  assertWorkspace(data.workspaceId);
  assertOrganization(data.organizationId);
  const { tags: _t, ...row } = data;
  return { ...row, organizationId: data.organizationId ?? null, workspaceId: data.workspaceId ?? null, birthday: data.birthday ?? null, nextFollowUp: data.nextFollowUp ?? null };
}

export function createPerson(ctx: AuditContext, input: PersonInput) {
  const data = parse(personSchema, input);
  const row = validate(data);
  // Same name and same phone/email = the same person.
  const dupe = getDb()
    .select()
    .from(people)
    .where(and(live, eq(people.fullName, row.fullName)))
    .all()
    .find((p) => (row.phone && p.phone === row.phone) || (row.email && p.email === row.email));
  if (dupe) throw conflict(`${row.fullName} already exists with the same phone or email`);
  const id = newId();
  getDb().insert(people).values({ id, ...row }).run();
  if (data.tags?.length) setTagsFor('person', id, data.tags);
  audit(ctx, 'person.create', { type: 'person', id }, `Added contact ${row.fullName}`);
  reindexEntity('person', id);
  return getPerson(id);
}

export function updatePerson(ctx: AuditContext, id: string, input: Partial<PersonInput>) {
  const before = getPerson(id);
  const data = parse(personSchema, { ...before, ...input });
  getDb()
    .update(people)
    .set({ ...validate(data), updatedAt: nowIso() })
    .where(eq(people.id, id))
    .run();
  if (input.tags) setTagsFor('person', id, input.tags);
  audit(ctx, 'person.update', { type: 'person', id }, `Updated contact ${data.fullName}`, before, data);
  reindexEntity('person', id);
  return getPerson(id);
}

export function deletePerson(ctx: AuditContext, id: string) {
  const p = getPerson(id);
  getDb().update(people).set({ deletedAt: nowIso() }).where(eq(people.id, id)).run();
  audit(ctx, 'person.delete', { type: 'person', id }, `Deleted contact ${p.fullName}`, p);
  reindexEntity('person', id);
}

/** Log a call/WhatsApp/meeting…, optionally scheduling the next follow-up in the same step. */
export function addInteraction(ctx: AuditContext, input: unknown) {
  const data = parse(interactionSchema, input);
  const p = getPerson(data.personId);
  assertWorkspace(data.workspaceId);
  const id = newId();
  getDb()
    .insert(interactions)
    .values({ id, personId: p.id, kind: data.kind, date: data.date, summary: data.summary, workspaceId: data.workspaceId ?? p.workspaceId ?? null })
    .run();
  if (data.nextFollowUp !== undefined) {
    getDb().update(people).set({ nextFollowUp: data.nextFollowUp, updatedAt: nowIso() }).where(eq(people.id, p.id)).run();
  } else if (p.nextFollowUp && p.nextFollowUp <= data.date) {
    // Contacting someone satisfies a follow-up that was due.
    getDb().update(people).set({ nextFollowUp: null, followUpNote: null, updatedAt: nowIso() }).where(eq(people.id, p.id)).run();
  }
  audit(ctx, 'interaction.create', { type: 'person', id: p.id }, `${data.kind} with ${p.fullName}`);
  return getPerson(p.id);
}

export function deleteInteraction(ctx: AuditContext, id: string) {
  const i = getDb().select().from(interactions).where(and(eq(interactions.id, id), isNull(interactions.deletedAt))).get();
  if (!i) throw notFound('Interaction');
  getDb().update(interactions).set({ deletedAt: nowIso() }).where(eq(interactions.id, id)).run();
  audit(ctx, 'interaction.delete', { type: 'person', id: i.personId }, 'Deleted an interaction', i);
  return getPerson(i.personId);
}

export function followUpsDue(until: string) {
  return getDb()
    .select()
    .from(people)
    .where(and(live, isNotNull(people.nextFollowUp), lte(people.nextFollowUp, until)))
    .orderBy(asc(people.nextFollowUp))
    .all();
}

export function birthdaysBetween(from: string, to: string) {
  const all = getDb().select().from(people).where(and(live, isNotNull(people.birthday))).all();
  const out: { person: Person; date: string; age: number }[] = [];
  for (const p of all) {
    for (const year of new Set([Number(from.slice(0, 4)), Number(to.slice(0, 4))])) {
      const md = p.birthday!.slice(5);
      const date = md === '02-29' && !(year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? `${year}-02-28` : `${year}-${md}`;
      if (date >= from && date <= to) out.push({ person: p, date, age: year - Number(p.birthday!.slice(0, 4)) });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

registerEntity({
  type: 'person',
  exists: (id) => !!getDb().select({ id: people.id }).from(people).where(and(eq(people.id, id), live)).get(),
  resolve: (ids) =>
    getDb()
      .select()
      .from(people)
      .where(and(inArray(people.id, ids), live))
      .all()
      .map((p) => ({ id: p.id, type: 'person', title: p.fullName, url: `/people/${p.id}`, subtitle: [p.role, p.company].filter(Boolean).join(' · ') || null, workspaceId: p.workspaceId })),
  searchDocs: (ids) =>
    getDb()
      .select()
      .from(people)
      .where(ids ? and(inArray(people.id, ids), live) : live)
      .all()
      .map((p) => ({
        id: p.id,
        workspaceId: p.workspaceId,
        title: p.fullName,
        body: [p.nickname, p.company, p.role, p.phone, p.phone2, p.email, p.city, p.relationship, p.notes].filter(Boolean).join('\n'),
      })),
});
