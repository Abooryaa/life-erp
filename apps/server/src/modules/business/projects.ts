import { milestoneSchema, minorToInput, projectHealth, projectSchema, type ProjectInput } from '@life-erp/shared';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { milestones, organizations, people, projects, tasks, transactions } from '../../db/schema';
import { audit, type AuditContext } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { newId, nowIso } from '../../lib/ids';
import { registerEntity } from '../../lib/registry';
import { parse } from '../../lib/validate';
import { assertCurrency, makeConverter, minorOf } from '../finance/currency';
import { assertGoal, assertPerson, today } from '../life/common';
import { reindexEntity } from '../search/service';
import { getTagsFor, getTagsForMany, setTagsFor } from '../tags/service';
import { assertWorkspace } from '../workspaces/service';
import { assertOrganization } from './organizations';
import { getOpportunity } from './pipeline';

export type Project = typeof projects.$inferSelect;
const live = isNull(projects.deletedAt);

export function assertProject(id: string | null | undefined, field = 'projectId') {
  if (!id) return;
  const p = getDb().select({ id: projects.id }).from(projects).where(and(eq(projects.id, id), live)).get();
  if (!p) throw new AppError(400, 'validation', 'Project not found', [{ path: field, message: 'Project not found' }]);
}

/** Revenue (income − refunds out) and costs (expenses − refunds) per project, converted to each project's currency. */
function financials(rows: Project[]) {
  const out = new Map<string, { revenue: number; spent: number; missingRates: string[] }>();
  if (!rows.length) return out;
  const sums = getDb()
    .select({ projectId: transactions.projectId, type: transactions.type, currency: transactions.currency, total: sql<number>`sum(${transactions.amount})` })
    .from(transactions)
    .where(and(isNull(transactions.deletedAt), inArray(transactions.projectId, rows.map((r) => r.id)), inArray(transactions.type, ['income', 'expense', 'refund'])))
    .groupBy(transactions.projectId, transactions.type, transactions.currency)
    .all();
  for (const p of rows) {
    const conv = makeConverter(p.currency, today());
    let revenue = 0;
    let spent = 0;
    for (const s of sums.filter((x) => x.projectId === p.id)) {
      const v = conv.convert(Number(s.total), s.currency);
      if (s.type === 'income') revenue += v;
      else spent -= v; // expenses negative, refunds positive
    }
    out.set(p.id, { revenue, spent, missingRates: [...conv.missing] });
  }
  return out;
}

function progressOf(rows: Project[]) {
  const ids = rows.map((r) => r.id);
  const out = new Map<string, { progress: number | null; milestonesDone: number; milestonesTotal: number; tasksDone: number; tasksTotal: number }>();
  if (!ids.length) return out;
  const ms = getDb()
    .select({ projectId: milestones.projectId, done: milestones.done, n: sql<number>`count(*)` })
    .from(milestones)
    .where(inArray(milestones.projectId, ids))
    .groupBy(milestones.projectId, milestones.done)
    .all();
  const ts = getDb()
    .select({ projectId: tasks.projectId, status: tasks.status, n: sql<number>`count(*)` })
    .from(tasks)
    .where(and(isNull(tasks.deletedAt), inArray(tasks.projectId, ids)))
    .groupBy(tasks.projectId, tasks.status)
    .all();
  for (const id of ids) {
    const m = ms.filter((x) => x.projectId === id);
    const mt = m.reduce((s, x) => s + x.n, 0);
    const md = m.filter((x) => x.done).reduce((s, x) => s + x.n, 0);
    const t = ts.filter((x) => x.projectId === id && x.status !== 'cancelled');
    const tt = t.reduce((s, x) => s + x.n, 0);
    const td = t.filter((x) => x.status === 'done').reduce((s, x) => s + x.n, 0);
    // Milestones describe progress better than task counts when both exist.
    const progress = mt ? md / mt : tt ? td / tt : null;
    out.set(id, { progress, milestonesDone: md, milestonesTotal: mt, tasksDone: td, tasksTotal: tt });
  }
  return out;
}

function describe(rows: Project[]) {
  const fin = financials(rows);
  const prog = progressOf(rows);
  const d = today();
  const pIds = rows.map((r) => r.personId).filter(Boolean) as string[];
  const oIds = rows.map((r) => r.organizationId).filter(Boolean) as string[];
  const pNames = new Map(pIds.length ? getDb().select({ id: people.id, n: people.fullName }).from(people).where(inArray(people.id, pIds)).all().map((x) => [x.id, x.n]) : []);
  const oNames = new Map(oIds.length ? getDb().select({ id: organizations.id, n: organizations.name }).from(organizations).where(inArray(organizations.id, oIds)).all().map((x) => [x.id, x.n]) : []);
  const tags = getTagsForMany('project', rows.map((r) => r.id));
  return rows.map((p) => {
    const f = fin.get(p.id) ?? { revenue: 0, spent: 0, missingRates: [] };
    const pr = prog.get(p.id) ?? { progress: null, milestonesDone: 0, milestonesTotal: 0, tasksDone: 0, tasksTotal: 0 };
    const h = projectHealth({ status: p.status, startDate: p.startDate, deadline: p.deadline, progress: pr.progress, budget: p.budget, spent: f.spent, today: d });
    return {
      ...p,
      ...pr,
      revenue: f.revenue,
      spent: f.spent,
      profit: f.revenue - f.spent,
      budgetRemaining: p.budget == null ? null : p.budget - f.spent,
      health: h.health,
      timeElapsed: h.timeElapsed,
      budgetUsed: h.budgetUsed,
      missingRates: f.missingRates,
      clientName: p.personId ? (pNames.get(p.personId) ?? null) : p.organizationId ? (oNames.get(p.organizationId) ?? null) : null,
      tags: tags.get(p.id) ?? [],
    };
  });
}

export function listProjects(f: { workspaceId?: string; status?: string; personal?: boolean; organizationId?: string; personId?: string } = {}) {
  const conds = [live];
  if (f.workspaceId) conds.push(eq(projects.workspaceId, f.workspaceId));
  if (f.status) conds.push(f.status === 'open' ? inArray(projects.status, ['planning', 'active', 'on_hold']) : eq(projects.status, f.status));
  if (f.organizationId) conds.push(eq(projects.organizationId, f.organizationId));
  if (f.personId) conds.push(eq(projects.personId, f.personId));
  return describe(
    getDb()
      .select()
      .from(projects)
      .where(and(...conds))
      .orderBy(sql`case ${projects.status} when 'active' then 0 when 'planning' then 1 when 'on_hold' then 2 else 3 end`, asc(projects.deadline), desc(projects.createdAt))
      .all(),
  );
}

export function getProject(id: string) {
  const p = getDb().select().from(projects).where(and(eq(projects.id, id), live)).get();
  if (!p) throw notFound('Project');
  const ms = getDb().select().from(milestones).where(eq(milestones.projectId, id)).orderBy(asc(milestones.sortOrder), asc(milestones.dueDate)).all();
  return { ...describe([p])[0], milestones: ms, tags: getTagsFor('project', id) };
}

function validate(data: ReturnType<typeof projectSchema.parse>) {
  assertWorkspace(data.workspaceId);
  assertPerson(data.personId);
  assertOrganization(data.organizationId);
  assertGoal(data.goalId);
  assertCurrency(data.currency);
  if (data.opportunityId) getOpportunity(data.opportunityId);
  const { tags: _t, ...row } = data;
  return {
    ...row,
    workspaceId: data.workspaceId ?? null,
    personId: data.personId ?? null,
    organizationId: data.organizationId ?? null,
    opportunityId: data.opportunityId ?? null,
    goalId: data.goalId ?? null,
    startDate: data.startDate ?? null,
    deadline: data.deadline ?? null,
    budget: data.budget ? minorOf(data.budget, data.currency, 'budget') : null,
    contractValue: data.contractValue ? minorOf(data.contractValue, data.currency, 'contractValue') : null,
    color: data.color ?? null,
  };
}

export function createProject(ctx: AuditContext, input: ProjectInput) {
  const data = parse(projectSchema, input);
  const row = validate(data);
  const id = newId();
  getDb()
    .insert(projects)
    .values({ id, ...row, completedAt: row.status === 'completed' ? nowIso() : null })
    .run();
  if (data.tags?.length) setTagsFor('project', id, data.tags);
  audit(ctx, 'project.create', { type: 'project', id }, `Created project "${row.name}"`);
  reindexEntity('project', id);
  return getProject(id);
}

/** Create a project from a won deal, carrying over the client, value and business. */
export function projectFromOpportunity(ctx: AuditContext, opportunityId: string) {
  const o = getOpportunity(opportunityId);
  const existing = getDb().select().from(projects).where(and(eq(projects.opportunityId, o.id), live)).get();
  if (existing) return getProject(existing.id);
  return createProject(ctx, {
    name: o.title,
    workspaceId: o.workspaceId,
    personId: o.personId,
    organizationId: o.organizationId,
    opportunityId: o.id,
    status: 'planning',
    currency: o.currency,
    contractValue: o.value ? minorToInput(o.value, o.currency) : null,
    startDate: today(),
  });
}

export function updateProject(ctx: AuditContext, id: string, input: Partial<ProjectInput>) {
  const before = getProject(id);
  const data = parse(projectSchema, {
    ...before,
    budget: before.budget == null ? null : minorToInput(before.budget, before.currency),
    contractValue: before.contractValue == null ? null : minorToInput(before.contractValue, before.currency),
    ...input,
  });
  const row = validate(data);
  const completedAt = row.status === 'completed' ? (before.completedAt ?? nowIso()) : null;
  getDb().update(projects).set({ ...row, completedAt, updatedAt: nowIso() }).where(eq(projects.id, id)).run();
  if (input.tags) setTagsFor('project', id, input.tags);
  audit(ctx, 'project.update', { type: 'project', id }, before.status !== row.status ? `Project "${row.name}": ${before.status} → ${row.status}` : `Updated project "${row.name}"`, before, row);
  reindexEntity('project', id);
  return getProject(id);
}

/** Tasks and transactions keep their history; they are simply unlinked from the deleted project. */
export function deleteProject(ctx: AuditContext, id: string) {
  const p = getProject(id);
  const db = getDb();
  db.update(tasks).set({ projectId: null }).where(eq(tasks.projectId, id)).run();
  db.update(transactions).set({ projectId: null }).where(eq(transactions.projectId, id)).run();
  db.update(projects).set({ deletedAt: nowIso() }).where(eq(projects.id, id)).run();
  audit(ctx, 'project.delete', { type: 'project', id }, `Deleted project "${p.name}"`, p);
  reindexEntity('project', id);
}

export function addMilestone(ctx: AuditContext, projectId: string, input: unknown) {
  const p = getProject(projectId);
  const data = parse(milestoneSchema, input);
  getDb()
    .insert(milestones)
    .values({
      id: newId(),
      projectId,
      title: data.title,
      dueDate: data.dueDate ?? null,
      done: data.done,
      doneAt: data.done ? nowIso() : null,
      amount: data.amount ? minorOf(data.amount, p.currency, 'amount') : null,
      sortOrder: p.milestones.length,
    })
    .run();
  audit(ctx, 'milestone.create', { type: 'project', id: projectId }, `Milestone "${data.title}" added to "${p.name}"`);
  return getProject(projectId);
}

export function updateMilestone(ctx: AuditContext, projectId: string, milestoneId: string, input: Record<string, unknown>) {
  const p = getProject(projectId);
  const m = p.milestones.find((x) => x.id === milestoneId);
  if (!m) throw notFound('Milestone');
  const data = parse(milestoneSchema, { ...m, amount: m.amount == null ? null : minorToInput(m.amount, p.currency), ...input });
  getDb()
    .update(milestones)
    .set({
      title: data.title,
      dueDate: data.dueDate ?? null,
      done: data.done,
      doneAt: data.done ? (m.doneAt ?? nowIso()) : null,
      amount: data.amount ? minorOf(data.amount, p.currency, 'amount') : null,
    })
    .where(eq(milestones.id, milestoneId))
    .run();
  audit(ctx, data.done && !m.done ? 'milestone.done' : 'milestone.update', { type: 'project', id: projectId }, `Milestone "${data.title}"${data.done && !m.done ? ' completed' : ' updated'}`);
  return getProject(projectId);
}

export function deleteMilestone(ctx: AuditContext, projectId: string, milestoneId: string) {
  const r = getDb().delete(milestones).where(and(eq(milestones.id, milestoneId), eq(milestones.projectId, projectId))).run();
  if (!r.changes) throw notFound('Milestone');
  audit(ctx, 'milestone.delete', { type: 'project', id: projectId }, 'Deleted a milestone');
  return getProject(projectId);
}

export function upcomingMilestones(until: string) {
  return getDb()
    .select({ m: milestones, projectName: projects.name, workspaceId: projects.workspaceId })
    .from(milestones)
    .innerJoin(projects, eq(projects.id, milestones.projectId))
    .where(and(live, eq(milestones.done, false), sql`${milestones.dueDate} <= ${until}`, inArray(projects.status, ['planning', 'active', 'on_hold'])))
    .all();
}

registerEntity({
  type: 'project',
  exists: (id) => !!getDb().select({ id: projects.id }).from(projects).where(and(eq(projects.id, id), live)).get(),
  resolve: (ids) =>
    getDb()
      .select()
      .from(projects)
      .where(and(inArray(projects.id, ids), live))
      .all()
      .map((p) => ({ id: p.id, type: 'project', title: p.name, url: `/projects/${p.id}`, subtitle: p.status, workspaceId: p.workspaceId })),
  searchDocs: (ids) =>
    getDb()
      .select()
      .from(projects)
      .where(ids ? and(inArray(projects.id, ids), live) : live)
      .all()
      .map((p) => ({ id: p.id, workspaceId: p.workspaceId, title: p.name, body: [p.description, p.owner, p.status].filter(Boolean).join('\n') })),
});
