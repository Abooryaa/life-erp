import { addDays, contributionSchema, goalForecast, minorToInput, savingsGoalSchema, type SavingsGoalInput } from '@life-erp/shared';
import { and, asc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { getDb, tx } from '../../db/client';
import { savingsContributions, savingsGoalAccounts, savingsGoals } from '../../db/schema';
import { audit, type AuditContext } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { newId, nowIso } from '../../lib/ids';
import { registerEntity } from '../../lib/registry';
import { parse } from '../../lib/validate';
import { reindexEntity } from '../search/service';
import { assertWorkspace } from '../workspaces/service';
import { balances, listAccounts, usableAccount } from './accounts';
import { assertCurrency, makeConverter, minorOf } from './currency';
import { monthlySeries } from './reports';

export type SavingsGoal = typeof savingsGoals.$inferSelect;
const live = isNull(savingsGoals.deletedAt);
const RATE_WINDOW_DAYS = 90;

function validate(data: ReturnType<typeof savingsGoalSchema.parse>) {
  assertCurrency(data.currency);
  assertWorkspace(data.workspaceId);
  if (data.mode === 'accounts') for (const id of data.accountIds) usableAccount(id, 'accountIds');
  return {
    row: {
      name: data.name,
      targetAmount: minorOf(data.targetAmount, data.currency, 'targetAmount'),
      currency: data.currency,
      deadline: data.deadline ?? null,
      priority: data.priority,
      mode: data.mode,
      monthlyTarget: data.monthlyTarget ? minorOf(data.monthlyTarget, data.currency, 'monthlyTarget') : null,
      startingAmount: minorOf(data.startingAmount, data.currency, 'startingAmount'),
      workspaceId: data.workspaceId ?? null,
      color: data.color ?? null,
      notes: data.notes,
    },
    accountIds: data.mode === 'accounts' ? [...new Set(data.accountIds)] : [],
  };
}

function linkedAccounts(goalId: string) {
  return getDb().select().from(savingsGoalAccounts).where(eq(savingsGoalAccounts.goalId, goalId)).all().map((r) => r.accountId);
}

/**
 * Current amount and observed monthly saving rate for a goal.
 * - accounts mode: balance of the linked accounts now vs. 90 days ago
 * - manual mode: starting amount + contributions, rate from contributions in the last 90 days
 */
function progressOf(g: SavingsGoal, today: string) {
  const conv = makeConverter(g.currency, today);
  if (g.mode === 'accounts') {
    const ids = linkedAccounts(g.id);
    const now = balances();
    const past = balances(addDays(today, -RATE_WINDOW_DAYS));
    const accts = listAccounts({ includeArchived: true }).filter((a) => ids.includes(a.id));
    const current = accts.reduce((s, a) => s + conv.convert(now.get(a.id) ?? 0, a.currency), 0);
    const before = accts.reduce((s, a) => s + conv.convert(past.get(a.id) ?? 0, a.currency), 0);
    return { current, monthlyRate: Math.max(0, Math.round((current - before) / 3)), accountIds: ids, missingRates: [...conv.missing] };
  }
  const total = getDb()
    .select({ s: sql<number>`coalesce(sum(${savingsContributions.amount}), 0)` })
    .from(savingsContributions)
    .where(eq(savingsContributions.goalId, g.id))
    .get()?.s ?? 0;
  const recent = getDb()
    .select({ s: sql<number>`coalesce(sum(${savingsContributions.amount}), 0)` })
    .from(savingsContributions)
    .where(and(eq(savingsContributions.goalId, g.id), gte(savingsContributions.date, addDays(today, -RATE_WINDOW_DAYS))))
    .get()?.s ?? 0;
  return { current: g.startingAmount + Number(total), monthlyRate: Math.max(0, Math.round(Number(recent) / 3)), accountIds: [], missingRates: [] };
}

function describe(g: SavingsGoal, today: string, extraMonthly = 0) {
  const p = progressOf(g, today);
  const observed = goalForecast({ target: g.targetAmount, current: p.current, monthlyRate: p.monthlyRate, extraMonthly, today, deadline: g.deadline });
  const planned = g.monthlyTarget
    ? goalForecast({ target: g.targetAmount, current: p.current, monthlyRate: g.monthlyTarget, extraMonthly, today, deadline: g.deadline })
    : null;
  return { ...g, current: p.current, monthlyRate: p.monthlyRate, accountIds: p.accountIds, forecast: observed, plannedForecast: planned, missingRates: p.missingRates };
}

export function listGoals(today: string) {
  return getDb()
    .select()
    .from(savingsGoals)
    .where(live)
    .orderBy(asc(savingsGoals.priority), asc(savingsGoals.deadline))
    .all()
    .map((g) => describe(g, today));
}

function getRow(id: string) {
  const g = getDb().select().from(savingsGoals).where(and(eq(savingsGoals.id, id), live)).get();
  if (!g) throw notFound('Savings goal');
  return g;
}

export function getGoal(id: string, today: string, extraMonthly = 0) {
  const g = getRow(id);
  const contributions = getDb().select().from(savingsContributions).where(eq(savingsContributions.goalId, id)).orderBy(asc(savingsContributions.date)).all();
  return { ...describe(g, today, extraMonthly), contributions };
}

/**
 * What-if scenario: forecast with an extra monthly amount. Pure calculation —
 * nothing is saved and real data is never changed.
 */
export function goalScenario(id: string, today: string, extraMonthly: number) {
  const base = getGoal(id, today);
  const scenario = describe(getRow(id), today, extraMonthly);
  return { goalId: id, extraMonthly, current: base.forecast, withExtra: scenario.forecast, plannedWithExtra: scenario.plannedForecast };
}

export function createGoal(ctx: AuditContext, input: SavingsGoalInput, today: string) {
  const { row, accountIds } = validate(parse(savingsGoalSchema, input));
  const id = newId();
  tx((db) => {
    db.insert(savingsGoals).values({ id, ...row }).run();
    for (const a of accountIds) db.insert(savingsGoalAccounts).values({ goalId: id, accountId: a }).run();
  });
  audit(ctx, 'goal.create', { type: 'savings_goal', id }, `Created savings goal "${row.name}"`, null, row);
  reindexEntity('savings_goal', id);
  return getGoal(id, today);
}

export function updateGoal(ctx: AuditContext, id: string, input: Partial<SavingsGoalInput>, today: string) {
  const before = getGoal(id, today);
  const { row, accountIds } = validate(
    parse(savingsGoalSchema, {
      ...before,
      targetAmount: minorToInput(before.targetAmount, before.currency),
      monthlyTarget: before.monthlyTarget == null ? null : minorToInput(before.monthlyTarget, before.currency),
      startingAmount: minorToInput(before.startingAmount, before.currency),
      ...input,
    }),
  );
  tx((db) => {
    db.update(savingsGoals).set({ ...row, updatedAt: nowIso() }).where(eq(savingsGoals.id, id)).run();
    db.delete(savingsGoalAccounts).where(eq(savingsGoalAccounts.goalId, id)).run();
    for (const a of accountIds) db.insert(savingsGoalAccounts).values({ goalId: id, accountId: a }).run();
  });
  const after = getGoal(id, today);
  if (after.forecast.achieved && after.status === 'active') getDb().update(savingsGoals).set({ status: 'achieved' }).where(eq(savingsGoals.id, id)).run();
  audit(ctx, 'goal.update', { type: 'savings_goal', id }, `Updated savings goal "${after.name}"`, before, after);
  reindexEntity('savings_goal', id);
  return getGoal(id, today);
}

export function setGoalStatus(ctx: AuditContext, id: string, status: SavingsGoal['status']) {
  const g = getRow(id);
  getDb().update(savingsGoals).set({ status, updatedAt: nowIso() }).where(eq(savingsGoals.id, id)).run();
  audit(ctx, 'goal.status', { type: 'savings_goal', id }, `Savings goal "${g.name}" → ${status}`);
}

export function deleteGoal(ctx: AuditContext, id: string) {
  const g = getRow(id);
  getDb().update(savingsGoals).set({ deletedAt: nowIso() }).where(eq(savingsGoals.id, id)).run();
  audit(ctx, 'goal.delete', { type: 'savings_goal', id }, `Deleted savings goal "${g.name}"`, g);
  reindexEntity('savings_goal', id);
}

export function addContribution(ctx: AuditContext, id: string, input: unknown, today: string) {
  const g = getRow(id);
  const data = parse(contributionSchema, input);
  getDb()
    .insert(savingsContributions)
    .values({ id: newId(), goalId: id, date: data.date, amount: minorOf(data.amount, g.currency), note: data.note })
    .run();
  audit(ctx, 'goal.contribution', { type: 'savings_goal', id }, `Contribution of ${data.amount} ${g.currency} to "${g.name}"`);
  const after = getGoal(id, today);
  if (after.forecast.achieved && after.status === 'active') setGoalStatus(ctx, id, 'achieved');
  return getGoal(id, today);
}

export function deleteContribution(ctx: AuditContext, id: string, contributionId: string, today: string) {
  const g = getRow(id);
  const r = getDb().delete(savingsContributions).where(and(eq(savingsContributions.id, contributionId), eq(savingsContributions.goalId, id))).run();
  if (!r.changes) throw notFound('Contribution');
  audit(ctx, 'goal.contribution_delete', { type: 'savings_goal', id }, `Removed a contribution from "${g.name}"`);
  return getGoal(id, today);
}

/** Average monthly savings over the last 3 full months (all workspaces), for context in the UI. */
export function averageMonthlySavings(today: string) {
  const lastFull = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
  const s = monthlySeries(lastFull, 3);
  return { base: s.base, average: Math.round(s.months.reduce((a, m) => a + m.net, 0) / 3) };
}

registerEntity({
  type: 'savings_goal',
  exists: (id) => !!getDb().select({ id: savingsGoals.id }).from(savingsGoals).where(and(eq(savingsGoals.id, id), live)).get(),
  resolve: (ids) =>
    getDb()
      .select()
      .from(savingsGoals)
      .where(and(inArray(savingsGoals.id, ids), live))
      .all()
      .map((g) => ({ id: g.id, type: 'savings_goal', title: g.name, url: `/finance/goals/${g.id}`, workspaceId: g.workspaceId })),
  searchDocs: (ids) =>
    getDb()
      .select()
      .from(savingsGoals)
      .where(ids ? and(inArray(savingsGoals.id, ids), live) : live)
      .all()
      .map((g) => ({ id: g.id, workspaceId: g.workspaceId, title: g.name, body: g.notes })),
});
