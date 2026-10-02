import { addDays, nextOccurrence, OPEN_TASK_STATUSES, taskSchema, type Frequency, type TaskInput } from '@life-erp/shared';
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, like, lt, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { tasks } from '../../db/schema';
import { audit, type AuditContext } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { newId, nowIso } from '../../lib/ids';
import { registerEntity } from '../../lib/registry';
import { parse } from '../../lib/validate';
import { reindexEntity } from '../search/service';
import { getTagsFor, getTagsForMany, idsWithTag, setTagsFor } from '../tags/service';
import { assertWorkspace } from '../workspaces/service';
import { assertGoal, assertPerson, today } from './common';

export type Task = typeof tasks.$inferSelect;
const live = isNull(tasks.deletedAt);
const open = inArray(tasks.status, OPEN_TASK_STATUSES);

function validate(data: ReturnType<typeof taskSchema.parse>) {
  assertWorkspace(data.workspaceId);
  assertGoal(data.goalId);
  assertPerson(data.personId);
  const { tags: _t, ...row } = data;
  return {
    ...row,
    area: data.area ?? null,
    dueDate: data.dueDate ?? null,
    dueTime: data.dueDate ? (data.dueTime ?? null) : null,
    startDate: data.startDate ?? null,
    workspaceId: data.workspaceId ?? null,
    projectId: data.projectId ?? null,
    goalId: data.goalId ?? null,
    personId: data.personId ?? null,
    recurrence: data.recurrence ?? null,
  };
}

export function getTask(id: string) {
  const t = getDb().select().from(tasks).where(and(eq(tasks.id, id), live)).get();
  if (!t) throw notFound('Task');
  return { ...t, tags: getTagsFor('task', id) };
}

export function createTask(ctx: AuditContext, input: TaskInput, extra: { source?: string } = {}) {
  const data = parse(taskSchema, input);
  const row = validate(data);
  // A task with a due date is planned, not inbox — unless the caller said otherwise explicitly.
  const status = input.status === undefined && row.dueDate ? 'planned' : row.status;
  const id = newId();
  getDb()
    .insert(tasks)
    .values({ id, ...row, status, completedAt: status === 'done' ? nowIso() : null, source: extra.source ?? null, sortOrder: Date.now() })
    .run();
  if (data.tags?.length) setTagsFor('task', id, data.tags);
  audit(ctx, 'task.create', { type: 'task', id }, `Created task "${row.title}"`);
  reindexEntity('task', id);
  return getTask(id);
}

/** When a recurring task is completed, the next one is created automatically (once). */
function spawnNext(ctx: AuditContext, t: Task) {
  if (!t.recurrence) return null;
  const base = t.dueDate ?? today();
  let next = nextOccurrence(base, t.recurrence as Frequency, t.recurrenceInterval);
  // Don't create a pile of overdue copies if it was completed late.
  while (next < today()) next = nextOccurrence(next, t.recurrence as Frequency, t.recurrenceInterval);
  const source = `recur:${t.id}`;
  if (getDb().select({ id: tasks.id }).from(tasks).where(eq(tasks.source, source)).get()) return null;
  const tagList = getTagsFor('task', t.id);
  return createTask(
    ctx,
    {
      title: t.title,
      description: t.description,
      status: 'planned',
      priority: t.priority,
      area: t.area as TaskInput['area'],
      dueDate: next,
      dueTime: t.dueTime,
      workspaceId: t.workspaceId,
      projectId: t.projectId,
      goalId: t.goalId,
      personId: t.personId,
      assignee: t.assignee,
      recurrence: t.recurrence as Frequency,
      recurrenceInterval: t.recurrenceInterval,
      tags: tagList,
    },
    { source },
  );
}

export function updateTask(ctx: AuditContext, id: string, input: Partial<TaskInput>) {
  const before = getTask(id);
  const data = parse(taskSchema, { ...before, ...input });
  const row = validate(data);
  const becameDone = row.status === 'done' && before.status !== 'done';
  const reopened = row.status !== 'done' && before.status === 'done';
  getDb()
    .update(tasks)
    .set({ ...row, completedAt: becameDone ? nowIso() : reopened ? null : before.completedAt, updatedAt: nowIso() })
    .where(eq(tasks.id, id))
    .run();
  if (input.tags) setTagsFor('task', id, input.tags);
  audit(ctx, becameDone ? 'task.complete' : 'task.update', { type: 'task', id }, becameDone ? `Completed "${row.title}"` : `Updated task "${row.title}"`, before, row);
  reindexEntity('task', id);
  const after = getTask(id);
  const next = becameDone ? spawnNext(ctx, after) : null;
  return { ...after, nextTaskId: next?.id ?? null };
}

export function setTaskStatus(ctx: AuditContext, id: string, status: Task['status']) {
  return updateTask(ctx, id, { status: status as TaskInput['status'] });
}

export function deleteTask(ctx: AuditContext, id: string) {
  const t = getTask(id);
  getDb().update(tasks).set({ deletedAt: nowIso() }).where(eq(tasks.id, id)).run();
  audit(ctx, 'task.delete', { type: 'task', id }, `Deleted task "${t.title}"`, t);
  reindexEntity('task', id);
}

export type TaskView = 'inbox' | 'today' | 'upcoming' | 'overdue' | 'anytime' | 'waiting' | 'done' | 'open' | 'all';

export interface TaskFilter {
  view?: TaskView;
  workspaceId?: string;
  goalId?: string;
  personId?: string;
  projectId?: string;
  area?: string;
  q?: string;
  tag?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export function listTasks(f: TaskFilter = {}) {
  const d = today();
  const conds: SQL[] = [live];
  switch (f.view ?? 'open') {
    case 'inbox':
      conds.push(eq(tasks.status, 'inbox'));
      break;
    case 'today':
      conds.push(open, isNotNull(tasks.dueDate), lte(tasks.dueDate, d));
      break;
    case 'overdue':
      conds.push(open, lt(tasks.dueDate, d));
      break;
    case 'upcoming':
      conds.push(open, gt(tasks.dueDate, d));
      break;
    case 'anytime':
      conds.push(open, ne(tasks.status, 'inbox'), isNull(tasks.dueDate));
      break;
    case 'waiting':
      conds.push(eq(tasks.status, 'waiting'));
      break;
    case 'done':
      conds.push(inArray(tasks.status, ['done', 'cancelled']));
      break;
    case 'open':
      conds.push(open);
      break;
    case 'all':
      break;
  }
  if (f.workspaceId) conds.push(eq(tasks.workspaceId, f.workspaceId));
  if (f.goalId) conds.push(eq(tasks.goalId, f.goalId));
  if (f.personId) conds.push(eq(tasks.personId, f.personId));
  if (f.projectId) conds.push(eq(tasks.projectId, f.projectId));
  if (f.area) conds.push(eq(tasks.area, f.area));
  if (f.tag) conds.push(inArray(tasks.id, idsWithTag('task', f.tag)));
  if (f.from) conds.push(sql`${tasks.dueDate} >= ${f.from}`);
  if (f.to) conds.push(sql`${tasks.dueDate} <= ${f.to}`);
  if (f.q) {
    const q = `%${f.q.replace(/[%_]/g, '')}%`;
    conds.push(or(like(tasks.title, q), like(tasks.description, q))!);
  }
  const order =
    f.view === 'done'
      ? [desc(tasks.completedAt)]
      : [sql`case when ${tasks.dueDate} is null then 1 else 0 end`, asc(tasks.dueDate), asc(tasks.dueTime), asc(tasks.priority), asc(tasks.sortOrder)];
  const rows = getDb()
    .select()
    .from(tasks)
    .where(and(...conds))
    .orderBy(...order)
    .limit(Math.min(f.limit ?? 500, 2000))
    .all();
  const tags = getTagsForMany('task', rows.map((r) => r.id));
  return rows.map((t) => ({ ...t, tags: tags.get(t.id) ?? [] }));
}

export function taskCounts(workspaceId?: string | null) {
  const d = today();
  const ws = workspaceId ? [eq(tasks.workspaceId, workspaceId)] : [];
  const count = (...c: SQL[]) => getDb().select({ n: sql<number>`count(*)` }).from(tasks).where(and(live, ...ws, ...c)).get()?.n ?? 0;
  return {
    inbox: count(eq(tasks.status, 'inbox')),
    today: count(open, eq(tasks.dueDate, d)),
    overdue: count(open, lt(tasks.dueDate, d)),
    upcoming: count(open, gt(tasks.dueDate, d), lte(tasks.dueDate, addDays(d, 7))),
    waiting: count(eq(tasks.status, 'waiting')),
    open: count(open),
    doneThisWeek: count(eq(tasks.status, 'done'), sql`${tasks.completedAt} >= ${addDays(d, -7)}`),
  };
}

registerEntity({
  type: 'task',
  exists: (id) => !!getDb().select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, id), live)).get(),
  resolve: (ids) =>
    getDb()
      .select()
      .from(tasks)
      .where(and(inArray(tasks.id, ids), live))
      .all()
      .map((t) => ({ id: t.id, type: 'task', title: t.title, url: `/tasks?open=${t.id}`, subtitle: t.dueDate, workspaceId: t.workspaceId })),
  searchDocs: (ids) =>
    getDb()
      .select()
      .from(tasks)
      .where(ids ? and(inArray(tasks.id, ids), live) : live)
      .all()
      .map((t) => ({ id: t.id, workspaceId: t.workspaceId, title: t.title, body: [t.description, t.status, t.area].filter(Boolean).join('\n') })),
});
