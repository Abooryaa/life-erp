import { installmentSchedule, installmentSchema, minorToInput, payInstallmentSchema, type Frequency, type InstallmentInput } from '@life-erp/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { getDb, tx } from '../../db/client';
import { installmentPayments, installments, transactions } from '../../db/schema';
import { audit, type AuditContext } from '../../lib/audit';
import { AppError, badRequest, notFound } from '../../lib/errors';
import { newId, nowIso } from '../../lib/ids';
import { registerEntity } from '../../lib/registry';
import { parse } from '../../lib/validate';
import { reindexEntity } from '../search/service';
import { assertWorkspace } from '../workspaces/service';
import { usableAccount } from './accounts';
import { assertCategoryKind } from './categories';
import { assertCurrency, minorOf } from './currency';
import { createTransaction, deleteTransaction } from './transactions';

export type Installment = typeof installments.$inferSelect;
export type InstallmentPayment = typeof installmentPayments.$inferSelect;
const live = isNull(installments.deletedAt);

function validate(data: ReturnType<typeof installmentSchema.parse>) {
  assertCurrency(data.currency);
  assertWorkspace(data.workspaceId);
  if (data.accountId) {
    const a = usableAccount(data.accountId);
    if (a.currency !== data.currency) {
      throw new AppError(400, 'validation', `The account uses ${a.currency}; the installment is in ${data.currency}`, [{ path: 'accountId', message: `Account currency is ${a.currency}` }]);
    }
  }
  assertCategoryKind(data.categoryId, 'expense');
  const total = minorOf(data.totalAmount, data.currency, 'totalAmount');
  const down = minorOf(data.downPayment, data.currency, 'downPayment');
  const fees = minorOf(data.interestFees, data.currency, 'interestFees');
  if (down >= total) throw new AppError(400, 'validation', 'The down payment must be less than the total', [{ path: 'downPayment', message: 'Must be less than the total' }]);
  if (fees > total) throw new AppError(400, 'validation', 'Interest/fees cannot exceed the total', [{ path: 'interestFees', message: 'Cannot exceed the total' }]);
  return {
    name: data.name,
    payee: data.payee,
    totalAmount: total,
    downPayment: down,
    interestFees: fees,
    currency: data.currency,
    paymentCount: data.paymentCount,
    firstDueDate: data.firstDueDate,
    frequency: data.frequency,
    accountId: data.accountId ?? null,
    categoryId: data.categoryId ?? null,
    workspaceId: data.workspaceId ?? null,
    remindDaysBefore: data.remindDaysBefore,
    notes: data.notes,
  };
}

function writeSchedule(installmentId: string, row: ReturnType<typeof validate>) {
  const db = getDb();
  db.delete(installmentPayments).where(eq(installmentPayments.installmentId, installmentId)).run();
  for (const p of installmentSchedule(row.totalAmount - row.downPayment, row.paymentCount, row.firstDueDate, row.frequency as Frequency)) {
    db.insert(installmentPayments).values({ id: newId(), installmentId, seq: p.seq, dueDate: p.dueDate, amount: p.amount }).run();
  }
}

export function summarize(inst: Installment, payments: InstallmentPayment[], today: string) {
  const paid = payments.filter((p) => p.paidDate);
  const unpaid = payments.filter((p) => !p.paidDate);
  const paidAmount = paid.reduce((s, p) => s + (p.paidAmount ?? p.amount), 0);
  const remainingAmount = unpaid.reduce((s, p) => s + p.amount, 0);
  const next = unpaid[0] ?? null;
  return {
    paidCount: paid.length,
    remainingCount: unpaid.length,
    paidAmount: paidAmount + inst.downPayment,
    remainingAmount,
    monthlyPayment: payments[0]?.amount ?? 0,
    nextDue: next?.dueDate ?? null,
    nextAmount: next?.amount ?? null,
    overdueCount: unpaid.filter((p) => p.dueDate < today).length,
    endDate: payments[payments.length - 1]?.dueDate ?? null,
    progress: payments.length ? paid.length / payments.length : 1,
  };
}

function paymentsFor(ids: string[]) {
  if (!ids.length) return new Map<string, InstallmentPayment[]>();
  const rows = getDb().select().from(installmentPayments).where(inArray(installmentPayments.installmentId, ids)).orderBy(asc(installmentPayments.seq)).all();
  const m = new Map<string, InstallmentPayment[]>();
  for (const r of rows) m.set(r.installmentId, [...(m.get(r.installmentId) ?? []), r]);
  return m;
}

export function listInstallments(today: string, opts: { status?: string; workspaceId?: string } = {}) {
  const conds = [live];
  if (opts.status) conds.push(eq(installments.status, opts.status as Installment['status']));
  if (opts.workspaceId) conds.push(eq(installments.workspaceId, opts.workspaceId));
  const rows = getDb().select().from(installments).where(and(...conds)).orderBy(asc(installments.firstDueDate)).all();
  const pays = paymentsFor(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, ...summarize(r, pays.get(r.id) ?? [], today) }));
}

export function getInstallment(id: string, today: string) {
  const r = getDb().select().from(installments).where(and(eq(installments.id, id), live)).get();
  if (!r) throw notFound('Installment');
  const payments = paymentsFor([id]).get(id) ?? [];
  return { ...r, ...summarize(r, payments, today), payments };
}

export function createInstallment(ctx: AuditContext, input: InstallmentInput, today: string) {
  const row = validate(parse(installmentSchema, input));
  const id = newId();
  tx((db) => {
    db.insert(installments).values({ id, ...row }).run();
    writeSchedule(id, row);
  });
  audit(ctx, 'installment.create', { type: 'installment', id }, `Created installment "${row.name}" (${row.paymentCount} × ${row.frequency})`, null, row);
  reindexEntity('installment', id);
  return getInstallment(id, today);
}

const SCHEDULE_FIELDS = ['totalAmount', 'downPayment', 'paymentCount', 'firstDueDate', 'frequency', 'currency'] as const;

export function updateInstallment(ctx: AuditContext, id: string, input: Partial<InstallmentInput>, today: string) {
  const before = getInstallment(id, today);
  const row = validate(
    parse(installmentSchema, {
      ...before,
      totalAmount: minorToInput(before.totalAmount, before.currency),
      downPayment: minorToInput(before.downPayment, before.currency),
      interestFees: minorToInput(before.interestFees, before.currency),
      ...input,
    }),
  );
  const scheduleChanged = SCHEDULE_FIELDS.some((f) => row[f] !== before[f]);
  if (scheduleChanged && before.paidCount > 0) {
    throw badRequest('Payments were already recorded, so the schedule (amounts, count, dates, currency) can no longer change. Edit individual payments instead.');
  }
  tx((db) => {
    db.update(installments).set({ ...row, updatedAt: nowIso() }).where(eq(installments.id, id)).run();
    if (scheduleChanged) writeSchedule(id, row);
  });
  const after = getInstallment(id, today);
  audit(ctx, 'installment.update', { type: 'installment', id }, `Updated installment "${after.name}"`, before, after);
  reindexEntity('installment', id);
  return after;
}

export function setInstallmentStatus(ctx: AuditContext, id: string, status: Installment['status'], today: string) {
  const i = getInstallment(id, today);
  getDb().update(installments).set({ status, updatedAt: nowIso() }).where(eq(installments.id, id)).run();
  audit(ctx, 'installment.status', { type: 'installment', id }, `Installment "${i.name}" → ${status}`);
}

export function deleteInstallment(ctx: AuditContext, id: string, today: string) {
  const i = getInstallment(id, today);
  getDb().update(installments).set({ deletedAt: nowIso() }).where(eq(installments.id, id)).run();
  audit(ctx, 'installment.delete', { type: 'installment', id }, `Deleted installment "${i.name}" (recorded transactions are kept)`, i);
  reindexEntity('installment', id);
}

/** Mark a scheduled payment as paid, recording the expense in the paying account. */
export function payInstallment(ctx: AuditContext, installmentId: string, paymentId: string, input: unknown, today: string) {
  const inst = getInstallment(installmentId, today);
  const p = inst.payments.find((x) => x.id === paymentId);
  if (!p) throw notFound('Payment');
  if (p.paidDate) throw badRequest('This payment is already marked as paid');
  const data = parse(payInstallmentSchema, input);
  const amount = data.amount ? minorOf(data.amount, inst.currency) : p.amount;
  let transactionId: string | null = null;
  if (data.recordTransaction) {
    const accountId = data.accountId ?? inst.accountId;
    if (!accountId) throw new AppError(400, 'validation', 'Choose the account you paid from', [{ path: 'accountId', message: 'Choose the account you paid from' }]);
    if (!inst.categoryId) throw new AppError(400, 'validation', 'Set a category on this installment first', [{ path: 'categoryId', message: 'Set a category first' }]);
    const t = createTransaction(
      ctx,
      {
        type: 'expense',
        date: data.date,
        amount: minorToInput(amount, inst.currency),
        accountId,
        categoryId: inst.categoryId,
        payee: inst.payee ?? inst.name,
        description: `${inst.name} — ${p.seq}/${inst.paymentCount}`,
        workspaceId: inst.workspaceId,
        allowDuplicate: true,
      },
      { installmentPaymentId: p.id },
    );
    transactionId = t.id;
  }
  getDb().update(installmentPayments).set({ paidDate: data.date, paidAmount: amount, transactionId }).where(eq(installmentPayments.id, p.id)).run();
  const after = getInstallment(installmentId, today);
  if (after.remainingCount === 0 && after.status === 'active') setInstallmentStatus(ctx, installmentId, 'completed', today);
  audit(ctx, 'installment.pay', { type: 'installment', id: installmentId }, `Paid ${p.seq}/${inst.paymentCount} of "${inst.name}"`);
  return getInstallment(installmentId, today);
}

/** Undo a payment (its transaction is deleted too, which restores the account balance). */
export function unpayInstallment(ctx: AuditContext, installmentId: string, paymentId: string, today: string) {
  const inst = getInstallment(installmentId, today);
  const p = inst.payments.find((x) => x.id === paymentId);
  if (!p) throw notFound('Payment');
  if (!p.paidDate) throw badRequest('This payment is not paid');
  const txRow = p.transactionId ? getDb().select().from(transactions).where(and(eq(transactions.id, p.transactionId), isNull(transactions.deletedAt))).get() : null;
  if (txRow) deleteTransaction(ctx, txRow.id);
  else getDb().update(installmentPayments).set({ paidDate: null, paidAmount: null, transactionId: null }).where(eq(installmentPayments.id, p.id)).run();
  if (inst.status === 'completed') getDb().update(installments).set({ status: 'active' }).where(eq(installments.id, installmentId)).run();
  audit(ctx, 'installment.unpay', { type: 'installment', id: installmentId }, `Marked ${p.seq}/${inst.paymentCount} of "${inst.name}" as unpaid`);
  return getInstallment(installmentId, today);
}

/** All unpaid scheduled payments up to a date (including overdue ones) for active installments. */
export function unpaidUntil(until: string) {
  return getDb()
    .select({ p: installmentPayments, i: installments })
    .from(installmentPayments)
    .innerJoin(installments, eq(installments.id, installmentPayments.installmentId))
    .where(and(live, eq(installments.status, 'active'), isNull(installmentPayments.paidDate)))
    .orderBy(asc(installmentPayments.dueDate))
    .all()
    .filter((x) => x.p.dueDate <= until);
}

registerEntity({
  type: 'installment',
  exists: (id) => !!getDb().select({ id: installments.id }).from(installments).where(and(eq(installments.id, id), live)).get(),
  resolve: (ids) =>
    getDb()
      .select()
      .from(installments)
      .where(and(inArray(installments.id, ids), live))
      .all()
      .map((i) => ({ id: i.id, type: 'installment', title: i.name, url: `/finance/installments/${i.id}`, subtitle: i.payee, workspaceId: i.workspaceId })),
  searchDocs: (ids) =>
    getDb()
      .select()
      .from(installments)
      .where(ids ? and(inArray(installments.id, ids), live) : live)
      .all()
      .map((i) => ({ id: i.id, workspaceId: i.workspaceId, title: i.name, body: [i.payee, i.notes].filter(Boolean).join('\n') })),
});
