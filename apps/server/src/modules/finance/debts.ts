import { debtPaymentSchema, debtSchema, minorToInput, type DebtInput } from '@life-erp/shared';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { debtPayments, debts, transactions } from '../../db/schema';
import { audit, type AuditContext } from '../../lib/audit';
import { AppError, badRequest, notFound } from '../../lib/errors';
import { newId, nowIso } from '../../lib/ids';
import { registerEntity } from '../../lib/registry';
import { parse } from '../../lib/validate';
import { reindexEntity } from '../search/service';
import { assertWorkspace } from '../workspaces/service';
import { usableAccount } from './accounts';
import { assertCurrency, minorOf } from './currency';
import { createTransaction, deleteTransaction } from './transactions';

export type Debt = typeof debts.$inferSelect;
const live = isNull(debts.deletedAt);

/**
 * Money you owe people (i_owe) or that people owe you (owed_to_me): personal loans,
 * advances, client balances. Payments can record a matching transaction in an account.
 */
function withTotals(rows: Debt[]) {
  if (!rows.length) return [];
  const pays = getDb().select().from(debtPayments).where(inArray(debtPayments.debtId, rows.map((r) => r.id))).orderBy(asc(debtPayments.date)).all();
  return rows.map((d) => {
    const mine = pays.filter((p) => p.debtId === d.id);
    const paid = mine.reduce((s, p) => s + p.amount, 0);
    return { ...d, paid, remaining: Math.max(0, d.principal - paid), payments: mine };
  });
}

export function listDebts(opts: { status?: string; workspaceId?: string } = {}) {
  const conds = [live];
  if (opts.status) conds.push(eq(debts.status, opts.status as Debt['status']));
  if (opts.workspaceId) conds.push(eq(debts.workspaceId, opts.workspaceId));
  return withTotals(getDb().select().from(debts).where(and(...conds)).orderBy(desc(debts.startDate)).all());
}

export function getDebt(id: string) {
  const d = getDb().select().from(debts).where(and(eq(debts.id, id), live)).get();
  if (!d) throw notFound('Debt');
  return withTotals([d])[0];
}

function validate(data: ReturnType<typeof debtSchema.parse>) {
  assertCurrency(data.currency);
  assertWorkspace(data.workspaceId);
  if (data.dueDate && data.dueDate < data.startDate) throw new AppError(400, 'validation', 'Due date must be after the start date', [{ path: 'dueDate', message: 'Must be after the start date' }]);
  return {
    direction: data.direction,
    counterparty: data.counterparty,
    principal: minorOf(data.principal, data.currency, 'principal'),
    currency: data.currency,
    startDate: data.startDate,
    dueDate: data.dueDate ?? null,
    workspaceId: data.workspaceId ?? null,
    notes: data.notes,
  };
}

export function createDebt(ctx: AuditContext, input: DebtInput) {
  const row = validate(parse(debtSchema, input));
  const id = newId();
  getDb().insert(debts).values({ id, ...row }).run();
  audit(ctx, 'debt.create', { type: 'debt', id }, `${row.direction === 'i_owe' ? 'I owe' : 'Owed to me by'} ${row.counterparty}`, null, row);
  reindexEntity('debt', id);
  return getDebt(id);
}

export function updateDebt(ctx: AuditContext, id: string, input: Partial<DebtInput>) {
  const before = getDebt(id);
  const row = validate(parse(debtSchema, { ...before, principal: minorToInput(before.principal, before.currency), ...input }));
  if (row.currency !== before.currency && before.payments.length) throw badRequest('Currency cannot change after payments were recorded');
  getDb().update(debts).set({ ...row, updatedAt: nowIso() }).where(eq(debts.id, id)).run();
  refreshStatus(id);
  const after = getDebt(id);
  audit(ctx, 'debt.update', { type: 'debt', id }, `Updated debt with ${after.counterparty}`, before, after);
  reindexEntity('debt', id);
  return after;
}

export function deleteDebt(ctx: AuditContext, id: string) {
  const d = getDebt(id);
  getDb().update(debts).set({ deletedAt: nowIso() }).where(eq(debts.id, id)).run();
  audit(ctx, 'debt.delete', { type: 'debt', id }, `Deleted debt with ${d.counterparty}`, d);
  reindexEntity('debt', id);
}

function refreshStatus(id: string) {
  const d = getDebt(id);
  const status = d.remaining === 0 ? 'settled' : 'open';
  if (status !== d.status) getDb().update(debts).set({ status, updatedAt: nowIso() }).where(eq(debts.id, id)).run();
}

/**
 * Record a (partial) repayment. With an account, a matching transaction is created:
 * paying a debt is an expense-free outflow, receiving one is an inflow (both as adjustments
 * so they never distort income/expense reports).
 */
export function addDebtPayment(ctx: AuditContext, debtId: string, input: unknown) {
  const d = getDebt(debtId);
  const data = parse(debtPaymentSchema, input);
  const amount = minorOf(data.amount, d.currency);
  if (amount > d.remaining) {
    throw new AppError(400, 'validation', `That is more than the remaining ${minorToInput(d.remaining, d.currency)} ${d.currency}`, [{ path: 'amount', message: 'More than the remaining balance' }]);
  }
  const account = data.accountId ? usableAccount(data.accountId) : null;
  if (account && account.currency !== d.currency) {
    throw new AppError(400, 'validation', `The account uses ${account.currency}; this debt is in ${d.currency}`, [{ path: 'accountId', message: `Account currency is ${account.currency}` }]);
  }
  const paymentId = newId();
  getDb().insert(debtPayments).values({ id: paymentId, debtId, date: data.date, amount, note: data.note }).run();
  if (account) {
    let t;
    try {
      t = createTransaction(
      ctx,
      {
        type: 'adjustment',
        direction: d.direction === 'i_owe' ? 'out' : 'in',
        date: data.date,
        amount: data.amount,
        accountId: account.id,
        payee: d.counterparty,
        description: d.direction === 'i_owe' ? `Repayment to ${d.counterparty}` : `Repayment from ${d.counterparty}`,
        workspaceId: d.workspaceId,
        allowDuplicate: true,
      },
      { debtPaymentId: paymentId },
    );
    } catch (err) {
      getDb().delete(debtPayments).where(eq(debtPayments.id, paymentId)).run();
      throw err;
    }
    getDb().update(debtPayments).set({ transactionId: t.id }).where(eq(debtPayments.id, paymentId)).run();
  }
  refreshStatus(debtId);
  audit(ctx, 'debt.payment', { type: 'debt', id: debtId }, `Payment of ${data.amount} ${d.currency} (${d.counterparty})`);
  return getDebt(debtId);
}

export function deleteDebtPayment(ctx: AuditContext, debtId: string, paymentId: string) {
  const d = getDebt(debtId);
  const p = d.payments.find((x) => x.id === paymentId);
  if (!p) throw notFound('Payment');
  const t = p.transactionId ? getDb().select().from(transactions).where(and(eq(transactions.id, p.transactionId), isNull(transactions.deletedAt))).get() : null;
  if (t) deleteTransaction(ctx, t.id); // also removes the payment row
  else getDb().delete(debtPayments).where(eq(debtPayments.id, paymentId)).run();
  refreshStatus(debtId);
  audit(ctx, 'debt.payment_delete', { type: 'debt', id: debtId }, `Removed a payment (${d.counterparty})`);
  return getDebt(debtId);
}

registerEntity({
  type: 'debt',
  exists: (id) => !!getDb().select({ id: debts.id }).from(debts).where(and(eq(debts.id, id), live)).get(),
  resolve: (ids) =>
    getDb()
      .select()
      .from(debts)
      .where(and(inArray(debts.id, ids), live))
      .all()
      .map((d) => ({ id: d.id, type: 'debt', title: d.counterparty, url: `/finance/debts?open=${d.id}`, subtitle: d.direction === 'i_owe' ? 'I owe' : 'Owed to me', workspaceId: d.workspaceId })),
  searchDocs: (ids) =>
    getDb()
      .select()
      .from(debts)
      .where(ids ? and(inArray(debts.id, ids), live) : live)
      .all()
      .map((d) => ({ id: d.id, workspaceId: d.workspaceId, title: d.counterparty, body: [d.notes, d.direction === 'i_owe' ? 'debt loan I owe' : 'receivable owed to me'].filter(Boolean).join('\n') })),
});
