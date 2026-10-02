import { addDays, addMonthsToMonth, LIQUID_ACCOUNT_TYPES, monthEnd, monthStart, savingsRate, type AccountType } from '@life-erp/shared';
import { and, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { debts, transactions } from '../../db/schema';
import { getSettings } from '../settings/service';
import { listAccounts } from './accounts';
import { listCategories, topLevelMap } from './categories';
import { makeConverter } from './currency';
import { listDebts } from './debts';
import { unpaidUntil } from './installments';
import { projectedOccurrences } from './recurring';

interface Scope {
  workspaceId?: string | null;
}

function scopeConds(s: Scope): SQL[] {
  const conds: SQL[] = [isNull(transactions.deletedAt)];
  if (s.workspaceId) conds.push(eq(transactions.workspaceId, s.workspaceId));
  return conds;
}

/**
 * Raw totals grouped by month, currency, type and category. Transfers are excluded by
 * construction: only income, expense and refund rows are counted as income/spending.
 */
function grouped(from: string, to: string, s: Scope) {
  return getDb()
    .select({
      month: sql<string>`substr(${transactions.date}, 1, 7)`,
      currency: transactions.currency,
      type: transactions.type,
      categoryId: transactions.categoryId,
      total: sql<number>`sum(${transactions.amount})`,
    })
    .from(transactions)
    .where(and(...scopeConds(s), gte(transactions.date, from), lte(transactions.date, to), inArray(transactions.type, ['income', 'expense', 'refund'])))
    .groupBy(sql`1`, transactions.currency, transactions.type, transactions.categoryId)
    .all();
}

export interface MonthTotals {
  month: string;
  income: number;
  expenses: number;
  net: number;
  savingsRate: number | null;
}

/** Income, expenses (net of refunds) and savings per month, converted to the base currency. */
export function monthlySeries(endMonth: string, count: number, s: Scope = {}) {
  const base = getSettings().baseCurrency;
  const startMonth = addMonthsToMonth(endMonth, -(count - 1));
  const rows = grouped(monthStart(startMonth), monthEnd(endMonth), s);
  const missing = new Set<string>();
  const months: MonthTotals[] = [];
  for (let i = 0; i < count; i++) {
    const month = addMonthsToMonth(startMonth, i);
    const conv = makeConverter(base, monthEnd(month));
    let income = 0;
    let expenses = 0;
    for (const r of rows.filter((x) => x.month === month)) {
      const v = conv.convert(Number(r.total), r.currency);
      if (r.type === 'income') income += v;
      else expenses -= v; // expenses are negative, refunds positive → net spending
    }
    conv.missing.forEach((c) => missing.add(c));
    months.push({ month, income, expenses, net: income - expenses, savingsRate: savingsRate(income, expenses) });
  }
  return { base, months, missingRates: [...missing] };
}

/** Spending (or income) per category for a period, rolled up to top-level categories. */
export function categoryBreakdown(from: string, to: string, kind: 'income' | 'expense', s: Scope = {}) {
  const base = getSettings().baseCurrency;
  const conv = makeConverter(base, to);
  const tops = topLevelMap();
  const cats = new Map(listCategories({ includeArchived: true }).map((c) => [c.id, c]));
  const rows = grouped(from, to, s).filter((r) => (kind === 'income' ? r.type === 'income' : r.type !== 'income'));
  const byTop = new Map<string, { id: string; name: string; nameAr: string | null; color: string | null; total: number; children: Map<string, { id: string; name: string; nameAr: string | null; total: number }> }>();
  for (const r of rows) {
    const value = kind === 'income' ? conv.convert(Number(r.total), r.currency) : -conv.convert(Number(r.total), r.currency);
    const cat = r.categoryId ? cats.get(r.categoryId) : undefined;
    const top = r.categoryId ? tops.get(r.categoryId) : undefined;
    const key = top?.id ?? 'uncategorized';
    const entry = byTop.get(key) ?? { id: key, name: top?.name ?? 'Uncategorized', nameAr: top?.nameAr ?? 'بدون تصنيف', color: top?.color ?? '#94a3b8', total: 0, children: new Map() };
    entry.total += value;
    if (cat && cat.id !== top?.id) {
      const ch = entry.children.get(cat.id) ?? { id: cat.id, name: cat.name, nameAr: cat.nameAr, total: 0 };
      ch.total += value;
      entry.children.set(cat.id, ch);
    }
    byTop.set(key, entry);
  }
  const items = [...byTop.values()]
    .map((e) => ({ ...e, children: [...e.children.values()].sort((a, b) => b.total - a.total) }))
    .filter((e) => e.total !== 0)
    .sort((a, b) => b.total - a.total);
  return { base, total: items.reduce((s2, i) => s2 + i.total, 0), items, missingRates: [...conv.missing] };
}

/** Spending for a set of categories in one month (budget actuals), in the base currency. */
export function spendingFor(categoryIds: string[], month: string, s: Scope = {}) {
  if (!categoryIds.length) return { total: 0, missing: [] as string[] };
  const base = getSettings().baseCurrency;
  const conv = makeConverter(base, monthEnd(month));
  const rows = getDb()
    .select({ currency: transactions.currency, total: sql<number>`sum(${transactions.amount})` })
    .from(transactions)
    .where(
      and(
        ...scopeConds(s),
        gte(transactions.date, monthStart(month)),
        lte(transactions.date, monthEnd(month)),
        inArray(transactions.type, ['expense', 'refund']),
        inArray(transactions.categoryId, categoryIds),
      ),
    )
    .groupBy(transactions.currency)
    .all();
  const total = rows.reduce((sum, r) => sum - conv.convert(Number(r.total), r.currency), 0);
  return { total, missing: [...conv.missing] };
}

/**
 * Net worth from what the finance module knows: account balances, minus remaining
 * installments and debts you owe, plus money owed to you. (Physical assets arrive in Phase 5.)
 */
export function netPosition(today: string) {
  const base = getSettings().baseCurrency;
  const conv = makeConverter(base, today);
  const accts = listAccounts();
  let liquid = 0;
  let otherAssets = 0;
  let accountLiabilities = 0;
  for (const a of accts) {
    if (!a.includeInNetWorth) continue;
    // A negative balance (credit card spending, overdraft, loan) is money owed;
    // a positive balance is an asset, liquid if it's spendable cash.
    const v = conv.convert(a.balance, a.currency);
    if (v < 0) accountLiabilities += -v;
    else if (LIQUID_ACCOUNT_TYPES.includes(a.type as AccountType)) liquid += v;
    else otherAssets += v;
  }
  let installmentsRemaining = 0;
  for (const x of unpaidUntil('9999-12-31')) installmentsRemaining += conv.convert(x.p.amount, x.i.currency);
  let debtsOwed = 0;
  let receivables = 0;
  for (const d of listDebts({ status: 'open' })) {
    const v = conv.convert(d.remaining, d.currency);
    if (d.direction === 'i_owe') debtsOwed += v;
    else receivables += v;
  }
  const assets = liquid + otherAssets + receivables;
  const liabilities = accountLiabilities + installmentsRemaining + debtsOwed;
  return {
    base,
    liquid,
    otherAssets,
    receivables,
    accountLiabilities,
    installmentsRemaining,
    debtsOwed,
    assets,
    liabilities,
    netWorth: assets - liabilities,
    missingRates: [...conv.missing],
  };
}

export interface UpcomingItem {
  kind: 'recurring' | 'installment' | 'debt';
  id: string;
  refId: string;
  date: string;
  name: string;
  amount: number;
  currency: string;
  direction: 'in' | 'out';
  overdue: boolean;
  link: string;
}

/** Everything expected to come in or go out between now and `days` ahead (plus anything overdue). */
export function upcoming(today: string, days: number, s: Scope = {}): UpcomingItem[] {
  const until = addDays(today, days);
  const items: UpcomingItem[] = [];
  for (const { rule, date } of projectedOccurrences(until)) {
    if (s.workspaceId && rule.workspaceId !== s.workspaceId) continue;
    items.push({
      kind: 'recurring',
      id: `${rule.id}:${date}`,
      refId: rule.id,
      date,
      name: rule.name,
      amount: rule.amount,
      currency: rule.currency,
      direction: rule.type === 'income' ? 'in' : 'out',
      overdue: date < today,
      link: '/finance/recurring',
    });
  }
  for (const { p, i } of unpaidUntil(until)) {
    if (s.workspaceId && i.workspaceId !== s.workspaceId) continue;
    items.push({
      kind: 'installment',
      id: p.id,
      refId: i.id,
      date: p.dueDate,
      name: `${i.name} (${p.seq}/${i.paymentCount})`,
      amount: p.amount,
      currency: i.currency,
      direction: 'out',
      overdue: p.dueDate < today,
      link: `/finance/installments/${i.id}`,
    });
  }
  for (const d of listDebts({ status: 'open' })) {
    if (!d.dueDate || d.dueDate > until) continue;
    if (s.workspaceId && d.workspaceId !== s.workspaceId) continue;
    items.push({
      kind: 'debt',
      id: d.id,
      refId: d.id,
      date: d.dueDate,
      name: d.counterparty,
      amount: d.remaining,
      currency: d.currency,
      direction: d.direction === 'i_owe' ? 'out' : 'in',
      overdue: d.dueDate < today,
      link: `/finance/debts?open=${d.id}`,
    });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

/** Count of open debts, used by alerts. */
export function openDebtCount() {
  return getDb().select({ n: sql<number>`count(*)` }).from(debts).where(and(isNull(debts.deletedAt), eq(debts.status, 'open'))).get()?.n ?? 0;
}
