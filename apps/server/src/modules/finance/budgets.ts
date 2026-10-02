import { budgetSchema, budgetStatus, minorToInput, type BudgetInput } from '@life-erp/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { getDb, tx } from '../../db/client';
import { budgetLines, budgets, categories } from '../../db/schema';
import { audit, type AuditContext } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { newId, nowIso } from '../../lib/ids';
import { registerEntity } from '../../lib/registry';
import { parse } from '../../lib/validate';
import { getSettings } from '../settings/service';
import { assertWorkspace } from '../workspaces/service';
import { categorySubtree } from './categories';
import { minorOf } from './currency';
import { spendingFor } from './reports';

export type Budget = typeof budgets.$inferSelect;
const live = isNull(budgets.deletedAt);

/** Budget amounts are monthly and always in the main (base) currency. */
function validate(data: ReturnType<typeof budgetSchema.parse>) {
  assertWorkspace(data.workspaceId);
  if (data.endMonth && data.endMonth < data.startMonth) {
    throw new AppError(400, 'validation', 'End month must be after the start month', [{ path: 'endMonth', message: 'Must be after the start month' }]);
  }
  const base = getSettings().baseCurrency;
  const seen = new Set<string>();
  const lines = data.lines.map((l, i) => {
    const c = getDb().select().from(categories).where(eq(categories.id, l.categoryId)).get();
    if (!c || c.kind !== 'expense') throw new AppError(400, 'validation', 'Choose an expense category', [{ path: `lines.${i}.categoryId`, message: 'Choose an expense category' }]);
    if (seen.has(l.categoryId)) throw new AppError(400, 'validation', `"${c.name}" is listed twice`, [{ path: `lines.${i}.categoryId`, message: 'Listed twice' }]);
    seen.add(l.categoryId);
    return { categoryId: l.categoryId, amount: minorOf(l.amount, base, `lines.${i}.amount`) };
  });
  // A parent and its own subcategory in the same budget would count the same spending twice.
  for (const l of lines) {
    const sub = categorySubtree(l.categoryId).slice(1);
    const clash = lines.find((o) => sub.includes(o.categoryId));
    if (clash) throw new AppError(400, 'validation', 'A category and its own subcategory cannot both be budgeted (spending would count twice)', [{ path: 'lines', message: 'Overlapping categories' }]);
  }
  return { row: { name: data.name, workspaceId: data.workspaceId ?? null, startMonth: data.startMonth, endMonth: data.endMonth ?? null, notes: data.notes }, lines };
}

export function listBudgets() {
  return getDb().select().from(budgets).where(live).orderBy(asc(budgets.name)).all();
}

export function getBudget(id: string) {
  const b = getDb().select().from(budgets).where(and(eq(budgets.id, id), live)).get();
  if (!b) throw notFound('Budget');
  const lines = getDb()
    .select({ id: budgetLines.id, categoryId: budgetLines.categoryId, amount: budgetLines.amount, name: categories.name, nameAr: categories.nameAr, color: categories.color })
    .from(budgetLines)
    .innerJoin(categories, eq(categories.id, budgetLines.categoryId))
    .where(eq(budgetLines.budgetId, id))
    .all();
  return { ...b, lines };
}

export function createBudget(ctx: AuditContext, input: BudgetInput) {
  const { row, lines } = validate(parse(budgetSchema, input));
  const id = newId();
  tx((db) => {
    db.insert(budgets).values({ id, ...row }).run();
    for (const l of lines) db.insert(budgetLines).values({ id: newId(), budgetId: id, ...l }).run();
  });
  audit(ctx, 'budget.create', { type: 'budget', id }, `Created budget "${row.name}"`, null, { row, lines });
  return getBudget(id);
}

export function updateBudget(ctx: AuditContext, id: string, input: Partial<BudgetInput>) {
  const before = getBudget(id);
  const base = getSettings().baseCurrency;
  const { row, lines } = validate(
    parse(budgetSchema, {
      ...before,
      lines: before.lines.map((l) => ({ categoryId: l.categoryId, amount: minorToInput(l.amount, base) })),
      ...input,
    }),
  );
  tx((db) => {
    db.update(budgets).set({ ...row, updatedAt: nowIso() }).where(eq(budgets.id, id)).run();
    db.delete(budgetLines).where(eq(budgetLines.budgetId, id)).run();
    for (const l of lines) db.insert(budgetLines).values({ id: newId(), budgetId: id, ...l }).run();
  });
  const after = getBudget(id);
  audit(ctx, 'budget.update', { type: 'budget', id }, `Updated budget "${after.name}"`, before, after);
  return after;
}

export function deleteBudget(ctx: AuditContext, id: string) {
  const b = getBudget(id);
  getDb().update(budgets).set({ deletedAt: nowIso() }).where(eq(budgets.id, id)).run();
  audit(ctx, 'budget.delete', { type: 'budget', id }, `Deleted budget "${b.name}"`, b);
}

export function budgetActiveIn(b: Budget, month: string) {
  return b.startMonth <= month && (!b.endMonth || b.endMonth >= month);
}

/** Budget vs actual for one month: per line and in total, with end-of-month projection. */
export function budgetReport(id: string, month: string, today: string) {
  const b = getBudget(id);
  const missing = new Set<string>();
  const lines = b.lines.map((l) => {
    const spent = spendingFor(categorySubtree(l.categoryId), month, { workspaceId: b.workspaceId });
    spent.missing.forEach((m) => missing.add(m));
    return { ...l, ...budgetStatus(l.amount, spent.total, month, today) };
  });
  const totalBudget = lines.reduce((s, l) => s + l.budget, 0);
  const totalActual = lines.reduce((s, l) => s + l.actual, 0);
  return {
    budget: { id: b.id, name: b.name, workspaceId: b.workspaceId, startMonth: b.startMonth, endMonth: b.endMonth },
    month,
    active: budgetActiveIn(b, month),
    currency: getSettings().baseCurrency,
    lines: lines.sort((a, c) => c.used - a.used),
    total: budgetStatus(totalBudget, totalActual, month, today),
    missingRates: [...missing],
  };
}

registerEntity({
  type: 'budget',
  exists: (id) => !!getDb().select({ id: budgets.id }).from(budgets).where(and(eq(budgets.id, id), live)).get(),
  resolve: (ids) =>
    getDb()
      .select()
      .from(budgets)
      .where(and(inArray(budgets.id, ids), live))
      .all()
      .map((b) => ({ id: b.id, type: 'budget', title: b.name, url: `/finance/budgets/${b.id}`, workspaceId: b.workspaceId })),
});
