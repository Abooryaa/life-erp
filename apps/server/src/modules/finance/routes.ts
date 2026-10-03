import { addMonthsToMonth, minorToInput, monthEnd, monthStart } from '@life-erp/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ctxOf, type Q } from '../../http';
import { badRequest } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { getSettings } from '../settings/service';
import { createAccount, deleteAccount, getAccount, listAccounts, setAccountArchived, updateAccount } from './accounts';
import { budgetReport, createBudget, deleteBudget, getBudget, listBudgets, updateBudget } from './budgets';
import { createCategory, deleteCategory, listCategories, setCategoryArchived, updateCategory } from './categories';
import { addCurrency, allCurrencies, deleteRate, listRates, setRate } from './currency';
import { addDebtPayment, createDebt, deleteDebt, deleteDebtPayment, getDebt, listDebts, updateDebt } from './debts';
import { addContribution, averageMonthlySavings, createGoal, deleteContribution, deleteGoal, getGoal, goalScenario, listGoals, setGoalStatus, updateGoal } from './goals';
import { createInstallment, deleteInstallment, getInstallment, listInstallments, payInstallment, setInstallmentStatus, unpayInstallment, updateInstallment } from './installments';
import { todayLocal } from './jobs';
import { createRecurring, deleteRecurring, getRecurring, listRecurring, postRecurring, setRecurringActive, skipRecurring, updateRecurring } from './recurring';
import { categoryBreakdown, monthlySeries, netPosition, upcoming } from './reports';
import { createTransaction, createTransfer, deleteTransaction, frequentCategories, getTransaction, listTransactions, updateTransaction } from './transactions';
import { minorOf } from './currency';
import {
  addRate as addInterestRate,
  deleteRate as deleteInterestRate,
  getInterest,
  ratesByAccount,
  recalculateInterest,
  removeInterest,
  setupInterest,
} from './interest';

type Id = { Params: { id: string } };
const monthRe = /^\d{4}-\d{2}$/;
const monthParam = (m: string | undefined) => {
  if (!m) return todayLocal().slice(0, 7);
  if (!monthRe.test(m)) throw badRequest('Month must look like 2026-10');
  return m;
};

export async function financeRoutes(app: FastifyInstance) {
  const P = '/api/finance';

  // ---------- overview ----------
  app.get<{ Querystring: Q }>(`${P}/overview`, async (req) => {
    const today = todayLocal();
    const month = monthParam(req.query.month);
    const scope = { workspaceId: req.query.workspaceId || null };
    const series = monthlySeries(month, 12, scope);
    const current = series.months[series.months.length - 1];
    const previous = series.months[series.months.length - 2];
    return {
      today,
      month,
      base: series.base,
      current,
      previous,
      series: series.months,
      categories: categoryBreakdown(monthStart(month), monthEnd(month), 'expense', scope),
      net: netPosition(today),
      upcoming: upcoming(today, 30, scope),
      accounts: listAccounts({ workspaceId: scope.workspaceId }),
      missingRates: [...new Set([...series.missingRates])],
    };
  });
  app.get<{ Querystring: Q }>(`${P}/reports/series`, async (req) =>
    monthlySeries(monthParam(req.query.month), Math.min(Number(req.query.months ?? 12), 60), { workspaceId: req.query.workspaceId || null }),
  );
  app.get<{ Querystring: Q }>(`${P}/reports/categories`, async (req) => {
    const from = req.query.from ?? monthStart(addMonthsToMonth(todayLocal().slice(0, 7), -2));
    const to = req.query.to ?? todayLocal();
    return categoryBreakdown(from, to, req.query.kind === 'income' ? 'income' : 'expense', { workspaceId: req.query.workspaceId || null });
  });
  app.get<{ Querystring: Q }>(`${P}/upcoming`, async (req) => upcoming(todayLocal(), Math.min(Number(req.query.days ?? 30), 366), { workspaceId: req.query.workspaceId || null }));
  app.get(`${P}/net-worth`, async () => netPosition(todayLocal()));

  // ---------- currencies & rates ----------
  app.get(`${P}/currencies`, async () => allCurrencies());
  app.post(`${P}/currencies`, async (req) => addCurrency(ctxOf(req), req.body));
  app.get(`${P}/rates`, async () => ({ base: getSettings().baseCurrency, items: listRates() }));
  app.post(`${P}/rates`, async (req) => setRate(ctxOf(req), req.body));
  app.delete<Id>(`${P}/rates/:id`, async (req) => {
    deleteRate(ctxOf(req), req.params.id);
    return { ok: true };
  });

  // ---------- accounts ----------
  app.get<{ Querystring: Q }>(`${P}/accounts`, async (req) => {
    const rates = ratesByAccount();
    return listAccounts({ includeArchived: req.query.archived === '1', workspaceId: req.query.workspaceId || null }).map((a) => ({ ...a, interest: rates.get(a.id) ?? null }));
  });
  // ---------- interest ----------
  app.get<Id>(`${P}/accounts/:id/interest`, async (req) => getInterest(req.params.id));
  app.put<Id>(`${P}/accounts/:id/interest`, async (req) => setupInterest(ctxOf(req), req.params.id, req.body as never));
  app.delete<Id>(`${P}/accounts/:id/interest`, async (req) => {
    removeInterest(ctxOf(req), req.params.id);
    return { ok: true };
  });
  app.post<Id>(`${P}/accounts/:id/interest/rates`, async (req) => addInterestRate(ctxOf(req), req.params.id, req.body));
  app.delete<{ Params: { id: string; rid: string } }>(`${P}/accounts/:id/interest/rates/:rid`, async (req) => deleteInterestRate(ctxOf(req), req.params.id, req.params.rid));
  app.post<Id>(`${P}/accounts/:id/interest/recalculate`, async (req) => {
    const { from } = parse(z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD') }), req.body);
    return recalculateInterest(ctxOf(req), req.params.id, from);
  });
  app.get<Id>(`${P}/accounts/:id`, async (req) => getAccount(req.params.id));
  app.post(`${P}/accounts`, async (req) => createAccount(ctxOf(req), req.body as never));
  app.put<Id>(`${P}/accounts/:id`, async (req) => updateAccount(ctxOf(req), req.params.id, req.body as never));
  app.post<Id>(`${P}/accounts/:id/archive`, async (req) => {
    setAccountArchived(ctxOf(req), req.params.id, parse(z.object({ archived: z.boolean() }), req.body).archived);
    return getAccount(req.params.id);
  });
  app.delete<Id>(`${P}/accounts/:id`, async (req) => {
    deleteAccount(ctxOf(req), req.params.id);
    return { ok: true };
  });
  /** Reconcile: create an adjustment so the balance matches the real statement balance. */
  app.post<Id>(`${P}/accounts/:id/reconcile`, async (req) => {
    const { balance, date } = parse(z.object({ balance: z.union([z.string(), z.number()]).transform(String), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), req.body);
    const a = getAccount(req.params.id);
    const target = minorOf(balance, a.currency, 'balance');
    const diff = target - a.balance;
    if (diff === 0) return { adjusted: false, account: a };
    createTransaction(ctxOf(req), {
      type: 'adjustment',
      direction: diff > 0 ? 'in' : 'out',
      date,
      amount: minorToInput(Math.abs(diff), a.currency),
      accountId: a.id,
      description: 'Balance reconciliation',
      allowDuplicate: true,
    });
    return { adjusted: true, account: getAccount(a.id) };
  });

  // ---------- categories ----------
  app.get<{ Querystring: Q }>(`${P}/categories`, async (req) => listCategories({ includeArchived: req.query.archived === '1' }));
  app.get<{ Querystring: Q }>(`${P}/categories/frequent`, async (req) => frequentCategories(req.query.kind === 'income' ? 'income' : 'expense'));
  app.post(`${P}/categories`, async (req) => createCategory(ctxOf(req), req.body as never));
  app.put<Id>(`${P}/categories/:id`, async (req) => updateCategory(ctxOf(req), req.params.id, req.body as never));
  app.post<Id>(`${P}/categories/:id/archive`, async (req) => {
    setCategoryArchived(ctxOf(req), req.params.id, parse(z.object({ archived: z.boolean() }), req.body).archived);
    return { ok: true };
  });
  app.delete<Id>(`${P}/categories/:id`, async (req) => {
    deleteCategory(ctxOf(req), req.params.id);
    return { ok: true };
  });

  // ---------- transactions ----------
  app.get<{ Querystring: Q }>(`${P}/transactions`, async (req) => {
    const q = req.query;
    return listTransactions({
      from: q.from,
      to: q.to,
      accountId: q.accountId,
      categoryId: q.categoryId,
      type: q.type,
      workspaceId: q.workspaceId,
      projectId: q.projectId,
      q: q.q,
      tag: q.tag,
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
    });
  });
  app.get<Id>(`${P}/transactions/:id`, async (req) => getTransaction(req.params.id));
  app.post(`${P}/transactions`, async (req) => createTransaction(ctxOf(req), req.body as never));
  app.post(`${P}/transfers`, async (req) => createTransfer(ctxOf(req), req.body as never));
  app.put<Id>(`${P}/transactions/:id`, async (req) => updateTransaction(ctxOf(req), req.params.id, req.body as never));
  app.delete<Id>(`${P}/transactions/:id`, async (req) => {
    deleteTransaction(ctxOf(req), req.params.id);
    return { ok: true };
  });

  // ---------- recurring ----------
  app.get(`${P}/recurring`, async () => listRecurring());
  app.get<Id>(`${P}/recurring/:id`, async (req) => getRecurring(req.params.id));
  app.post(`${P}/recurring`, async (req) => createRecurring(ctxOf(req), req.body as never, todayLocal()));
  app.put<Id>(`${P}/recurring/:id`, async (req) => updateRecurring(ctxOf(req), req.params.id, req.body as never, todayLocal()));
  app.post<Id>(`${P}/recurring/:id/post`, async (req) => {
    const b = parse(z.object({ date: z.string().optional(), amount: z.union([z.string(), z.number()]).transform(String).optional() }), req.body ?? {});
    return postRecurring(ctxOf(req), req.params.id, b);
  });
  app.post<Id>(`${P}/recurring/:id/skip`, async (req) => skipRecurring(ctxOf(req), req.params.id));
  app.post<Id>(`${P}/recurring/:id/active`, async (req) => {
    setRecurringActive(ctxOf(req), req.params.id, parse(z.object({ active: z.boolean() }), req.body).active);
    return getRecurring(req.params.id);
  });
  app.delete<Id>(`${P}/recurring/:id`, async (req) => {
    deleteRecurring(ctxOf(req), req.params.id);
    return { ok: true };
  });

  // ---------- installments ----------
  app.get<{ Querystring: Q }>(`${P}/installments`, async (req) => listInstallments(todayLocal(), { status: req.query.status, workspaceId: req.query.workspaceId }));
  app.get<Id>(`${P}/installments/:id`, async (req) => getInstallment(req.params.id, todayLocal()));
  app.post(`${P}/installments`, async (req) => createInstallment(ctxOf(req), req.body as never, todayLocal()));
  app.put<Id>(`${P}/installments/:id`, async (req) => updateInstallment(ctxOf(req), req.params.id, req.body as never, todayLocal()));
  app.post<Id>(`${P}/installments/:id/status`, async (req) => {
    const { status } = parse(z.object({ status: z.enum(['active', 'completed', 'cancelled']) }), req.body);
    setInstallmentStatus(ctxOf(req), req.params.id, status, todayLocal());
    return getInstallment(req.params.id, todayLocal());
  });
  app.delete<Id>(`${P}/installments/:id`, async (req) => {
    deleteInstallment(ctxOf(req), req.params.id, todayLocal());
    return { ok: true };
  });
  app.post<{ Params: { id: string; pid: string } }>(`${P}/installments/:id/payments/:pid/pay`, async (req) =>
    payInstallment(ctxOf(req), req.params.id, req.params.pid, req.body, todayLocal()),
  );
  app.post<{ Params: { id: string; pid: string } }>(`${P}/installments/:id/payments/:pid/unpay`, async (req) =>
    unpayInstallment(ctxOf(req), req.params.id, req.params.pid, todayLocal()),
  );

  // ---------- debts ----------
  app.get<{ Querystring: Q }>(`${P}/debts`, async (req) => listDebts({ status: req.query.status, workspaceId: req.query.workspaceId }));
  app.get<Id>(`${P}/debts/:id`, async (req) => getDebt(req.params.id));
  app.post(`${P}/debts`, async (req) => createDebt(ctxOf(req), req.body as never));
  app.put<Id>(`${P}/debts/:id`, async (req) => updateDebt(ctxOf(req), req.params.id, req.body as never));
  app.delete<Id>(`${P}/debts/:id`, async (req) => {
    deleteDebt(ctxOf(req), req.params.id);
    return { ok: true };
  });
  app.post<Id>(`${P}/debts/:id/payments`, async (req) => addDebtPayment(ctxOf(req), req.params.id, req.body));
  app.delete<{ Params: { id: string; pid: string } }>(`${P}/debts/:id/payments/:pid`, async (req) => deleteDebtPayment(ctxOf(req), req.params.id, req.params.pid));

  // ---------- budgets ----------
  app.get(`${P}/budgets`, async () => {
    const today = todayLocal();
    return listBudgets().map((b) => ({ ...b, report: budgetReport(b.id, today.slice(0, 7), today) }));
  });
  app.get<Id>(`${P}/budgets/:id`, async (req) => getBudget(req.params.id));
  app.get<Id & { Querystring: Q }>(`${P}/budgets/:id/report`, async (req) => budgetReport(req.params.id, monthParam(req.query.month), todayLocal()));
  app.post(`${P}/budgets`, async (req) => createBudget(ctxOf(req), req.body as never));
  app.put<Id>(`${P}/budgets/:id`, async (req) => updateBudget(ctxOf(req), req.params.id, req.body as never));
  app.delete<Id>(`${P}/budgets/:id`, async (req) => {
    deleteBudget(ctxOf(req), req.params.id);
    return { ok: true };
  });

  // ---------- savings goals ----------
  app.get(`${P}/goals`, async () => ({ goals: listGoals(todayLocal()), averageSavings: averageMonthlySavings(todayLocal()) }));
  app.get<Id>(`${P}/goals/:id`, async (req) => getGoal(req.params.id, todayLocal()));
  app.get<Id & { Querystring: Q }>(`${P}/goals/:id/scenario`, async (req) => {
    const g = getGoal(req.params.id, todayLocal());
    const extra = minorOf(req.query.extra ?? '0', g.currency, 'extra');
    return goalScenario(req.params.id, todayLocal(), extra);
  });
  app.post(`${P}/goals`, async (req) => createGoal(ctxOf(req), req.body as never, todayLocal()));
  app.put<Id>(`${P}/goals/:id`, async (req) => updateGoal(ctxOf(req), req.params.id, req.body as never, todayLocal()));
  app.post<Id>(`${P}/goals/:id/status`, async (req) => {
    const { status } = parse(z.object({ status: z.enum(['active', 'achieved', 'paused']) }), req.body);
    setGoalStatus(ctxOf(req), req.params.id, status);
    return getGoal(req.params.id, todayLocal());
  });
  app.delete<Id>(`${P}/goals/:id`, async (req) => {
    deleteGoal(ctxOf(req), req.params.id);
    return { ok: true };
  });
  app.post<Id>(`${P}/goals/:id/contributions`, async (req) => addContribution(ctxOf(req), req.params.id, req.body, todayLocal()));
  app.delete<{ Params: { id: string; cid: string } }>(`${P}/goals/:id/contributions/:cid`, async (req) =>
    deleteContribution(ctxOf(req), req.params.id, req.params.cid, todayLocal()),
  );
}
