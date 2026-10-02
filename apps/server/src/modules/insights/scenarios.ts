import { addMonthsToMonth, minorToInput, projectScenario, scenarioSchema, type ScenarioAdjustment, type ScenarioInput } from '@life-erp/shared';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { scenarios } from '../../db/schema';
import { audit, type AuditContext } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { newId, nowIso } from '../../lib/ids';
import { registerEntity } from '../../lib/registry';
import { parse } from '../../lib/validate';
import { minorOf } from '../finance/currency';
import { monthlySeries, netPosition } from '../finance/reports';
import { today } from '../life/common';
import { reindexEntity } from '../search/service';
import { getSettings } from '../settings/service';

const live = isNull(scenarios.deletedAt);

/** What the projection starts from when you don't override it: your actual recent numbers. */
export function scenarioBaseline() {
  const d = today();
  const lastFull = addMonthsToMonth(d.slice(0, 7), -1);
  const s = monthlySeries(lastFull, 3);
  const withData = s.months.filter((m) => m.income || m.expenses);
  const avg = (k: 'income' | 'expenses') => (withData.length ? Math.round(withData.reduce((sum, m) => sum + m[k], 0) / withData.length) : 0);
  const net = netPosition(d);
  return {
    base: s.base,
    months: s.months.map((m) => m.month),
    monthsWithData: withData.length,
    monthlyIncome: avg('income'),
    monthlyExpenses: avg('expenses'),
    startBalance: net.liquid,
    firstMonth: addMonthsToMonth(d.slice(0, 7), 1),
    missingRates: [...new Set([...s.missingRates, ...net.missingRates])],
  };
}

type Row = typeof scenarios.$inferSelect;

function compute(r: Row) {
  const b = scenarioBaseline();
  const adjustments = JSON.parse(r.adjustments) as ScenarioAdjustment[];
  const inputs = {
    monthlyIncome: r.monthlyIncome ?? b.monthlyIncome,
    monthlyExpenses: r.monthlyExpenses ?? b.monthlyExpenses,
    startBalance: r.startBalance ?? b.startBalance,
  };
  return {
    ...r,
    adjustments,
    baseline: b,
    inputs,
    result: projectScenario({ firstMonth: b.firstMonth, horizon: r.horizonMonths, ...inputs, adjustments }),
  };
}

export function listScenarios() {
  return getDb().select().from(scenarios).where(live).orderBy(desc(scenarios.updatedAt)).all().map(compute);
}

export function getScenario(id: string) {
  const r = getDb().select().from(scenarios).where(and(eq(scenarios.id, id), live)).get();
  if (!r) throw notFound('Scenario');
  return compute(r);
}

function rowOf(data: ReturnType<typeof scenarioSchema.parse>) {
  const base = getSettings().baseCurrency;
  return {
    name: data.name,
    horizonMonths: data.horizonMonths,
    monthlyIncome: data.monthlyIncome ? minorOf(data.monthlyIncome, base, 'monthlyIncome') : null,
    monthlyExpenses: data.monthlyExpenses ? minorOf(data.monthlyExpenses, base, 'monthlyExpenses') : null,
    startBalance: data.startBalance != null ? minorOf(data.startBalance, base, 'startBalance') : null,
    adjustments: JSON.stringify(
      data.adjustments.map((a, i) => ({
        label: a.label,
        amount: minorOf(a.amount, base, `adjustments.${i}.amount`),
        kind: a.kind,
        startMonth: a.startMonth,
        endMonth: a.kind === 'monthly' ? (a.endMonth ?? null) : null,
      })),
    ),
    notes: data.notes ?? null,
  };
}

export function createScenario(ctx: AuditContext, input: ScenarioInput) {
  const data = parse(scenarioSchema, input);
  const id = newId();
  getDb().insert(scenarios).values({ id, ...rowOf(data) }).run();
  audit(ctx, 'scenario.create', { type: 'scenario', id }, `Scenario: ${data.name}`);
  reindexEntity('scenario', id);
  return getScenario(id);
}

export function updateScenario(ctx: AuditContext, id: string, input: Partial<ScenarioInput>) {
  const before = getScenario(id);
  const base = getSettings().baseCurrency;
  const asInput = (m: number | null) => (m == null ? null : minorToInput(m, base));
  const data = parse(scenarioSchema, {
    name: before.name,
    horizonMonths: before.horizonMonths,
    monthlyIncome: asInput(before.monthlyIncome),
    monthlyExpenses: asInput(before.monthlyExpenses),
    startBalance: asInput(before.startBalance),
    adjustments: before.adjustments.map((a) => ({ ...a, amount: minorToInput(a.amount, base) })),
    notes: before.notes,
    ...input,
  });
  getDb()
    .update(scenarios)
    .set({ ...rowOf(data), updatedAt: nowIso() })
    .where(eq(scenarios.id, id))
    .run();
  audit(ctx, 'scenario.update', { type: 'scenario', id }, `Updated scenario ${data.name}`);
  reindexEntity('scenario', id);
  return getScenario(id);
}

export function deleteScenario(ctx: AuditContext, id: string) {
  const s = getScenario(id);
  getDb().update(scenarios).set({ deletedAt: nowIso() }).where(eq(scenarios.id, id)).run();
  audit(ctx, 'scenario.delete', { type: 'scenario', id }, `Deleted scenario ${s.name}`);
  reindexEntity('scenario', id);
}

registerEntity({
  type: 'scenario',
  exists: (id) => !!getDb().select({ id: scenarios.id }).from(scenarios).where(and(eq(scenarios.id, id), live)).get(),
  resolve: (ids) =>
    getDb()
      .select()
      .from(scenarios)
      .where(and(inArray(scenarios.id, ids), live))
      .all()
      .map((s) => ({ id: s.id, type: 'scenario', title: s.name, url: `/scenarios/${s.id}` })),
  searchDocs: (ids) =>
    getDb()
      .select()
      .from(scenarios)
      .where(ids ? and(inArray(scenarios.id, ids), live) : live)
      .all()
      .map((s) => ({ id: s.id, title: s.name, body: [s.notes, (JSON.parse(s.adjustments) as ScenarioAdjustment[]).map((a) => a.label).join(', ')].filter(Boolean).join('\n') })),
});
