import { applicationFunnel, applicationSchema, applicationStatusSchema, DEFAULT_APPLICATION_STATUSES, interviewSchema, minorToInput, type ApplicationInput, type ApplicationStatusKind, type InterviewInput } from '@life-erp/shared';
import { and, asc, desc, eq, inArray, isNull, lte, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { afterDbOpen, getDb, tx } from '../../db/client';
import { appMeta, applicationStatuses, interviews, jobApplications } from '../../db/schema';
import { audit, type AuditContext } from '../../lib/audit';
import { AppError, badRequest, notFound } from '../../lib/errors';
import { newId, nowIso } from '../../lib/ids';
import { registerEntity } from '../../lib/registry';
import { parse } from '../../lib/validate';
import { assertOrganization } from '../business/organizations';
import { assertCurrency, minorOf } from '../finance/currency';
import { assertPerson, today } from '../life/common';
import { reindexEntity } from '../search/service';
import { getTagsFor, getTagsForMany, setTagsFor } from '../tags/service';

export type Application = typeof jobApplications.$inferSelect;
const live = isNull(jobApplications.deletedAt);
const CLOSED: ApplicationStatusKind[] = ['accepted', 'rejected', 'withdrawn'];

/** Default statuses (Saved → Applied → HR screening → … → Accepted / Rejected / Withdrawn), created once. */
export function ensureApplicationStatuses() {
  const db = getDb();
  if (db.select().from(appMeta).where(eq(appMeta.key, 'app_statuses_seeded')).get()) return;
  tx(() => {
    DEFAULT_APPLICATION_STATUSES.forEach((s, i) => db.insert(applicationStatuses).values({ id: newId(), name: s.name, kind: s.kind, sortOrder: i }).run());
    db.insert(appMeta).values({ key: 'app_statuses_seeded', value: nowIso() }).run();
  });
}
afterDbOpen(ensureApplicationStatuses);

export function listStatuses() {
  return getDb().select().from(applicationStatuses).orderBy(asc(applicationStatuses.sortOrder)).all();
}

/** Replace the status list. Statuses still used by applications can't be removed. */
export function saveStatuses(ctx: AuditContext, input: unknown) {
  const items = parse(z.array(applicationStatusSchema).min(2).max(30), input);
  const before = listStatuses();
  const keep = new Set(items.filter((s) => s.id).map((s) => s.id!));
  const removed = before.filter((s) => !keep.has(s.id));
  if (removed.length) {
    const used = getDb().select({ id: jobApplications.id }).from(jobApplications).where(and(live, inArray(jobApplications.statusId, removed.map((s) => s.id)))).get();
    if (used) throw badRequest(`Move applications out of "${removed.map((s) => s.name).join('", "')}" before removing it`);
  }
  tx((db) => {
    for (const s of removed) db.delete(applicationStatuses).where(eq(applicationStatuses.id, s.id)).run();
    items.forEach((s, i) => {
      if (s.id && before.some((b) => b.id === s.id)) db.update(applicationStatuses).set({ name: s.name, kind: s.kind, sortOrder: i }).where(eq(applicationStatuses.id, s.id)).run();
      else db.insert(applicationStatuses).values({ id: newId(), name: s.name, kind: s.kind, sortOrder: i }).run();
    });
  });
  audit(ctx, 'career.statuses', null, 'Updated application statuses', before, items);
  return listStatuses();
}

function enrich(rows: Application[]) {
  const statuses = new Map(listStatuses().map((s) => [s.id, s]));
  const ids = rows.map((r) => r.id);
  const ivs = ids.length ? getDb().select().from(interviews).where(inArray(interviews.applicationId, ids)).orderBy(asc(interviews.date), asc(interviews.time)).all() : [];
  const tags = getTagsForMany('job_application', ids);
  const d = today();
  return rows.map((a) => {
    const s = statuses.get(a.statusId);
    const mine = ivs.filter((i) => i.applicationId === a.id);
    const next = mine.find((i) => i.date >= d && i.outcome === 'pending') ?? null;
    return { ...a, statusName: s?.name ?? '?', statusKind: (s?.kind ?? 'active') as ApplicationStatusKind, interviewCount: mine.length, nextInterview: next, tags: tags.get(a.id) ?? [] };
  });
}

export function listApplications(f: { statusId?: string; open?: boolean } = {}) {
  const conds = [live];
  if (f.statusId) conds.push(eq(jobApplications.statusId, f.statusId));
  const rows = enrich(getDb().select().from(jobApplications).where(and(...conds)).orderBy(desc(jobApplications.appliedDate), desc(jobApplications.createdAt)).all());
  return f.open ? rows.filter((r) => !CLOSED.includes(r.statusKind)) : rows;
}

export function getApplication(id: string) {
  const a = getDb().select().from(jobApplications).where(and(eq(jobApplications.id, id), live)).get();
  if (!a) throw notFound('Application');
  const ivs = getDb().select().from(interviews).where(eq(interviews.applicationId, id)).orderBy(asc(interviews.date), asc(interviews.time)).all();
  return { ...enrich([a])[0], interviews: ivs, tags: getTagsFor('job_application', id) };
}

function validate(data: ReturnType<typeof applicationSchema.parse>) {
  assertOrganization(data.organizationId);
  assertPerson(data.recruiterPersonId, 'recruiterPersonId');
  assertCurrency(data.currency);
  const statuses = listStatuses();
  const status = data.statusId ? statuses.find((s) => s.id === data.statusId) : statuses.find((s) => s.kind === (data.appliedDate ? 'active' : 'saved'));
  if (!status) throw new AppError(400, 'validation', 'Status not found', [{ path: 'statusId', message: 'Status not found' }]);
  const { tags: _t, ...row } = data;
  return {
    row: {
      ...row,
      statusId: status.id,
      organizationId: data.organizationId ?? null,
      recruiterPersonId: data.recruiterPersonId ?? null,
      workMode: data.workMode ?? null,
      appliedDate: data.appliedDate ?? (status.kind !== 'saved' ? today() : null),
      followUpDate: data.followUpDate ?? null,
      salaryMin: data.salaryMin ? minorOf(data.salaryMin, data.currency, 'salaryMin') : null,
      salaryMax: data.salaryMax ? minorOf(data.salaryMax, data.currency, 'salaryMax') : null,
    },
    status,
  };
}

export function createApplication(ctx: AuditContext, input: ApplicationInput) {
  const data = parse(applicationSchema, input);
  const { row, status } = validate(data);
  const id = newId();
  getDb()
    .insert(jobApplications)
    .values({ id, ...row, closedAt: CLOSED.includes(status.kind as ApplicationStatusKind) ? today() : null })
    .run();
  if (data.tags?.length) setTagsFor('job_application', id, data.tags);
  audit(ctx, 'application.create', { type: 'job_application', id }, `Application: ${row.position} at ${row.company} (${status.name})`);
  reindexEntity('job_application', id);
  return getApplication(id);
}

export function updateApplication(ctx: AuditContext, id: string, input: Partial<ApplicationInput>) {
  const before = getApplication(id);
  const data = parse(applicationSchema, {
    ...before,
    salaryMin: before.salaryMin == null ? null : minorToInput(before.salaryMin, before.currency),
    salaryMax: before.salaryMax == null ? null : minorToInput(before.salaryMax, before.currency),
    ...input,
  });
  const { row, status } = validate(data);
  const closed = CLOSED.includes(status.kind as ApplicationStatusKind);
  getDb()
    .update(jobApplications)
    .set({ ...row, closedAt: closed ? (before.closedAt ?? today()) : null, updatedAt: nowIso() })
    .where(eq(jobApplications.id, id))
    .run();
  if (input.tags) setTagsFor('job_application', id, input.tags);
  const moved = status.id !== before.statusId;
  audit(ctx, moved ? 'application.status' : 'application.update', { type: 'job_application', id }, moved ? `${row.company}: ${before.statusName} → ${status.name}` : `Updated application at ${row.company}`, before, row);
  reindexEntity('job_application', id);
  return getApplication(id);
}

export function deleteApplication(ctx: AuditContext, id: string) {
  const a = getApplication(id);
  getDb().update(jobApplications).set({ deletedAt: nowIso() }).where(eq(jobApplications.id, id)).run();
  audit(ctx, 'application.delete', { type: 'job_application', id }, `Deleted application at ${a.company}`, a);
  reindexEntity('job_application', id);
}

/** Logging an interview moves an early-stage application into an interview status automatically. */
export function addInterview(ctx: AuditContext, input: InterviewInput) {
  const data = parse(interviewSchema, input);
  const app = getApplication(data.applicationId);
  const id = newId();
  getDb()
    .insert(interviews)
    .values({ id, ...data, time: data.time ?? null })
    .run();
  if (app.statusKind === 'saved' || app.statusKind === 'active') {
    const firstInterview = listStatuses().find((s) => s.kind === 'interview');
    if (firstInterview) updateApplication(ctx, app.id, { statusId: firstInterview.id });
  }
  audit(ctx, 'interview.create', { type: 'job_application', id: app.id }, `Interview (${data.stage}) with ${app.company} on ${data.date}`);
  return getApplication(app.id);
}

export function updateInterview(ctx: AuditContext, id: string, input: Partial<InterviewInput>) {
  const iv = getDb().select().from(interviews).where(eq(interviews.id, id)).get();
  if (!iv) throw notFound('Interview');
  const data = parse(interviewSchema, { ...iv, ...input });
  getDb().update(interviews).set({ ...data, time: data.time ?? null, updatedAt: nowIso() }).where(eq(interviews.id, id)).run();
  audit(ctx, 'interview.update', { type: 'job_application', id: iv.applicationId }, `Interview ${data.stage}: ${data.outcome}`);
  return getApplication(iv.applicationId);
}

export function deleteInterview(ctx: AuditContext, id: string) {
  const iv = getDb().select().from(interviews).where(eq(interviews.id, id)).get();
  if (!iv) throw notFound('Interview');
  getDb().delete(interviews).where(eq(interviews.id, id)).run();
  audit(ctx, 'interview.delete', { type: 'job_application', id: iv.applicationId }, 'Deleted an interview');
  return getApplication(iv.applicationId);
}

export function upcomingInterviews(from: string, to: string) {
  return getDb()
    .select({ i: interviews, company: jobApplications.company, position: jobApplications.position })
    .from(interviews)
    .innerJoin(jobApplications, eq(jobApplications.id, interviews.applicationId))
    .where(and(live, eq(interviews.outcome, 'pending'), lte(interviews.date, to), isNotNull(interviews.date)))
    .orderBy(asc(interviews.date), asc(interviews.time))
    .all()
    .filter((x) => x.i.date >= from);
}

export function followUpsDue(until: string) {
  return enrich(getDb().select().from(jobApplications).where(and(live, isNotNull(jobApplications.followUpDate), lte(jobApplications.followUpDate, until))).all()).filter(
    (a) => !CLOSED.includes(a.statusKind),
  );
}

export function funnel() {
  return applicationFunnel(listApplications().map((a) => ({ kind: a.statusKind, interviewed: a.interviewCount > 0 })));
}

registerEntity({
  type: 'job_application',
  exists: (id) => !!getDb().select({ id: jobApplications.id }).from(jobApplications).where(and(eq(jobApplications.id, id), live)).get(),
  resolve: (ids) =>
    getDb()
      .select()
      .from(jobApplications)
      .where(and(inArray(jobApplications.id, ids), live))
      .all()
      .map((a) => ({ id: a.id, type: 'job_application', title: `${a.position} — ${a.company}`, url: `/career/applications?open=${a.id}`, subtitle: a.appliedDate })),
  searchDocs: (ids) =>
    getDb()
      .select()
      .from(jobApplications)
      .where(ids ? and(inArray(jobApplications.id, ids), live) : live)
      .all()
      .map((a) => ({ id: a.id, title: `${a.position} — ${a.company}`, body: [a.source, a.location, a.notes, a.jobDescription?.slice(0, 2000)].filter(Boolean).join('\n') })),
});
