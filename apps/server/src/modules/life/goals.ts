import { checkinSchema, goalHealth, goalSchema, numericProgress, type GoalHealth, type GoalInput } from '@life-erp/shared';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { goalCheckins, goals, savingsGoals, tasks } from '../../db/schema';
import { audit, type AuditContext } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { newId, nowIso } from '../../lib/ids';
import { registerEntity } from '../../lib/registry';
import { parse } from '../../lib/validate';
import { getGoal as getSavingsGoal } from '../finance/goals';
import { reindexEntity } from '../search/service';
import { getTagsFor, setTagsFor } from '../tags/service';
import { assertWorkspace } from '../workspaces/service';
import { today } from './common';

export type GoalRow = typeof goals.$inferSelect;
const live = isNull(goals.deletedAt);

function allGoals() {
  return getDb().select().from(goals).where(live).orderBy(asc(goals.sortOrder), asc(goals.createdAt)).all();
}

function taskStats(goalIds: string[]) {
  if (!goalIds.length) return new Map<string, { done: number; total: number }>();
  const rows = getDb()
    .select({ goalId: tasks.goalId, status: tasks.status, n: sql<number>`count(*)` })
    .from(tasks)
    .where(and(isNull(tasks.deletedAt), inArray(tasks.goalId, goalIds)))
    .groupBy(tasks.goalId, tasks.status)
    .all();
  const m = new Map<string, { done: number; total: number }>();
  for (const r of rows) {
    if (!r.goalId || r.status === 'cancelled') continue;
    const s = m.get(r.goalId) ?? { done: 0, total: 0 };
    s.total += r.n;
    if (r.status === 'done') s.done += r.n;
    m.set(r.goalId, s);
  }
  return m;
}

export interface GoalView extends GoalRow {
  progress: number | null;
  health: GoalHealth | null;
  value: number | null;
  tasksDone: number;
  tasksTotal: number;
  childCount: number;
}

/**
 * Compute progress for every goal in one pass:
 * numeric → check-ins/current value, tasks → share of linked tasks done,
 * children → average of sub-goals, savings → linked savings goal, none → done or not.
 */
export function computeGoals(rows: GoalRow[] = allGoals()): Map<string, GoalView> {
  const d = today();
  const stats = taskStats(rows.map((r) => r.id));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const children = new Map<string, GoalRow[]>();
  for (const r of rows) if (r.parentId && byId.has(r.parentId)) children.set(r.parentId, [...(children.get(r.parentId) ?? []), r]);
  const out = new Map<string, GoalView>();
  const visiting = new Set<string>();

  const calc = (g: GoalRow): GoalView => {
    const cached = out.get(g.id);
    if (cached) return cached;
    visiting.add(g.id);
    const st = stats.get(g.id) ?? { done: 0, total: 0 };
    const kids = (children.get(g.id) ?? []).filter((k) => !visiting.has(k.id) && k.status !== 'dropped');
    let progress: number | null = null;
    let value: number | null = g.currentValue;
    switch (g.metric) {
      case 'numeric':
        progress = g.targetValue == null || g.currentValue == null ? null : numericProgress(g.startValue, g.targetValue, g.currentValue);
        break;
      case 'tasks':
        progress = st.total ? st.done / st.total : null;
        break;
      case 'children': {
        const ps = kids.map((k) => calc(k).progress).filter((p): p is number => p != null);
        progress = ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : null;
        break;
      }
      case 'savings':
        if (g.savingsGoalId) {
          try {
            const s = getSavingsGoal(g.savingsGoalId, d);
            progress = s.forecast.progress;
            value = s.current;
          } catch {
            progress = null;
          }
        }
        break;
      default:
        progress = g.status === 'achieved' ? 1 : null;
    }
    if (g.status === 'achieved') progress = 1;
    const health = g.status === 'active' && progress != null ? goalHealth(progress, g.startDate ?? g.createdAt.slice(0, 10), g.deadline, d) : g.status === 'achieved' ? 'achieved' : null;
    const view: GoalView = { ...g, progress, health, value, tasksDone: st.done, tasksTotal: st.total, childCount: (children.get(g.id) ?? []).length };
    visiting.delete(g.id);
    out.set(g.id, view);
    return view;
  };
  for (const r of rows) calc(r);
  return out;
}

export function listGoals(f: { workspaceId?: string; status?: string } = {}) {
  let rows = allGoals();
  const views = computeGoals(rows);
  if (f.workspaceId) rows = rows.filter((r) => r.workspaceId === f.workspaceId);
  if (f.status) rows = rows.filter((r) => r.status === f.status);
  return rows.map((r) => views.get(r.id)!);
}

export function getGoal(id: string) {
  const g = getDb().select().from(goals).where(and(eq(goals.id, id), live)).get();
  if (!g) throw notFound('Goal');
  const views = computeGoals();
  const checkins = getDb().select().from(goalCheckins).where(eq(goalCheckins.goalId, id)).orderBy(desc(goalCheckins.date), desc(goalCheckins.createdAt)).all();
  const children = [...views.values()].filter((v) => v.parentId === id);
  const parent = g.parentId ? (views.get(g.parentId) ?? null) : null;
  return { ...views.get(id)!, children, parent, checkins, tags: getTagsFor('goal', id) };
}

function validate(id: string | null, data: ReturnType<typeof goalSchema.parse>) {
  assertWorkspace(data.workspaceId);
  const fail = (path: string, message: string): never => {
    throw new AppError(400, 'validation', message, [{ path, message }]);
  };
  if (data.parentId) {
    if (data.parentId === id) fail('parentId', 'A goal cannot be its own parent');
    const all = allGoals();
    const parent = all.find((g) => g.id === data.parentId);
    if (!parent) fail('parentId', 'Parent goal not found');
    // Walk up from the new parent: reaching this goal would create a loop.
    let cur = parent;
    for (let i = 0; cur && i < 50; i++) {
      if (cur.id === id) fail('parentId', 'That would make a goal its own ancestor');
      cur = all.find((g) => g.id === cur!.parentId)!;
    }
  }
  if (data.metric === 'numeric' && data.targetValue == null) fail('targetValue', 'Set a target value');
  if (data.metric === 'savings') {
    if (!data.savingsGoalId) fail('savingsGoalId', 'Choose a savings goal');
    const s = getDb().select().from(savingsGoals).where(and(eq(savingsGoals.id, data.savingsGoalId!), isNull(savingsGoals.deletedAt))).get();
    if (!s) fail('savingsGoalId', 'Savings goal not found');
  }
  if (data.startDate && data.deadline && data.deadline < data.startDate) fail('deadline', 'Deadline must be after the start date');
  const { tags: _t, ...row } = data;
  return {
    ...row,
    parentId: data.parentId ?? null,
    area: data.area ?? null,
    targetValue: data.targetValue ?? null,
    currentValue: data.currentValue ?? (data.metric === 'numeric' ? data.startValue : null),
    savingsGoalId: data.metric === 'savings' ? (data.savingsGoalId ?? null) : null,
    startDate: data.startDate ?? null,
    deadline: data.deadline ?? null,
    workspaceId: data.workspaceId ?? null,
    color: data.color ?? null,
  };
}

export function createGoal(ctx: AuditContext, input: GoalInput) {
  const data = parse(goalSchema, input);
  const row = validate(null, data);
  const id = newId();
  getDb()
    .insert(goals)
    .values({ id, ...row, startDate: row.startDate ?? today() })
    .run();
  if (data.tags?.length) setTagsFor('goal', id, data.tags);
  audit(ctx, 'goal.create', { type: 'goal', id }, `Created ${row.level} "${row.title}"`);
  reindexEntity('goal', id);
  return getGoal(id);
}

export function updateGoal(ctx: AuditContext, id: string, input: Partial<GoalInput>) {
  const before = getGoal(id);
  const data = parse(goalSchema, { ...before, ...input });
  getDb()
    .update(goals)
    .set({ ...validate(id, data), updatedAt: nowIso() })
    .where(eq(goals.id, id))
    .run();
  if (input.tags) setTagsFor('goal', id, input.tags);
  audit(ctx, 'goal.update', { type: 'goal', id }, `Updated goal "${data.title}"`, before, data);
  reindexEntity('goal', id);
  return getGoal(id);
}

/** Deleting a goal keeps its sub-goals and tasks (they move up / become unlinked). */
export function deleteGoal(ctx: AuditContext, id: string) {
  const g = getGoal(id);
  const db = getDb();
  db.update(goals).set({ parentId: g.parentId }).where(eq(goals.parentId, id)).run();
  db.update(tasks).set({ goalId: null }).where(eq(tasks.goalId, id)).run();
  db.update(goals).set({ deletedAt: nowIso() }).where(eq(goals.id, id)).run();
  audit(ctx, 'goal.delete', { type: 'goal', id }, `Deleted goal "${g.title}"`, g);
  reindexEntity('goal', id);
}

export function addCheckin(ctx: AuditContext, id: string, input: unknown) {
  const g = getGoal(id);
  const data = parse(checkinSchema, input);
  getDb().insert(goalCheckins).values({ id: newId(), goalId: id, ...data }).run();
  // The latest check-in by date is the current value.
  const latest = getDb().select().from(goalCheckins).where(eq(goalCheckins.goalId, id)).orderBy(desc(goalCheckins.date), desc(goalCheckins.createdAt)).get();
  getDb().update(goals).set({ currentValue: latest!.value, updatedAt: nowIso() }).where(eq(goals.id, id)).run();
  audit(ctx, 'goal.checkin', { type: 'goal', id }, `Check-in on "${g.title}": ${data.value}${g.unit ? ` ${g.unit}` : ''}`);
  const after = getGoal(id);
  if (after.progress === 1 && after.status === 'active' && after.metric === 'numeric') {
    getDb().update(goals).set({ status: 'achieved' }).where(eq(goals.id, id)).run();
  }
  return getGoal(id);
}

export function deleteCheckin(ctx: AuditContext, id: string, checkinId: string) {
  const g = getGoal(id);
  const r = getDb().delete(goalCheckins).where(and(eq(goalCheckins.id, checkinId), eq(goalCheckins.goalId, id))).run();
  if (!r.changes) throw notFound('Check-in');
  const latest = getDb().select().from(goalCheckins).where(eq(goalCheckins.goalId, id)).orderBy(desc(goalCheckins.date), desc(goalCheckins.createdAt)).get();
  getDb().update(goals).set({ currentValue: latest?.value ?? g.startValue }).where(eq(goals.id, id)).run();
  audit(ctx, 'goal.checkin_delete', { type: 'goal', id }, `Removed a check-in from "${g.title}"`);
  return getGoal(id);
}

registerEntity({
  type: 'goal',
  exists: (id) => !!getDb().select({ id: goals.id }).from(goals).where(and(eq(goals.id, id), live)).get(),
  resolve: (ids) =>
    getDb()
      .select()
      .from(goals)
      .where(and(inArray(goals.id, ids), live))
      .all()
      .map((g) => ({ id: g.id, type: 'goal', title: g.title, url: `/goals/${g.id}`, subtitle: g.level, workspaceId: g.workspaceId })),
  searchDocs: (ids) =>
    getDb()
      .select()
      .from(goals)
      .where(ids ? and(inArray(goals.id, ids), live) : live)
      .all()
      .map((g) => ({ id: g.id, workspaceId: g.workspaceId, title: g.title, body: [g.description, g.level, g.area].filter(Boolean).join('\n') })),
});
