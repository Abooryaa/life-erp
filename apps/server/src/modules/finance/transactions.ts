import { minorToInput, signedAmount, transactionSchema, transferSchema, type TransactionInput, type TransferInput } from '@life-erp/shared';
import { and, desc, eq, gte, inArray, isNull, like, lte, or, sql, type SQL } from 'drizzle-orm';
import { getDb, tx } from '../../db/client';
import { accounts, categories, debtPayments, installmentPayments, transactions } from '../../db/schema';
import { audit, type AuditContext } from '../../lib/audit';
import { AppError, badRequest, notFound } from '../../lib/errors';
import { newId, nowIso } from '../../lib/ids';
import { assertRef, registerEntity } from '../../lib/registry';
import { parse } from '../../lib/validate';
import { reindexEntity } from '../search/service';
import { getTagsFor, getTagsForMany, idsWithTag, setTagsFor } from '../tags/service';
import { assertWorkspace } from '../workspaces/service';
import { usableAccount } from './accounts';
import { assertCategoryKind, categorySubtree } from './categories';
import { minorOf } from './currency';

export type TransactionRow = typeof transactions.$inferSelect;
const live = isNull(transactions.deletedAt);

export interface TxExtra {
  recurringId?: string | null;
  installmentPaymentId?: string | null;
  debtPaymentId?: string | null;
}

function getRow(id: string): TransactionRow {
  const t = getDb().select().from(transactions).where(and(eq(transactions.id, id), live)).get();
  if (!t) throw notFound('Transaction');
  return t;
}

function categoryKindFor(type: string): 'income' | 'expense' | null {
  if (type === 'income') return 'income';
  if (type === 'expense' || type === 'refund') return 'expense';
  return null;
}

/** Same account, date, amount and payee/description = probably entered twice. */
function findDuplicate(row: { accountId: string; date: string; amount: number; payee: string | null; description: string | null }, exceptId?: string) {
  const conds = [live, eq(transactions.accountId, row.accountId), eq(transactions.date, row.date), eq(transactions.amount, row.amount)];
  const candidates = getDb().select().from(transactions).where(and(...conds)).all();
  return candidates.find(
    (c) => c.id !== exceptId && (c.payee ?? '').toLowerCase() === (row.payee ?? '').toLowerCase() && (c.description ?? '').toLowerCase() === (row.description ?? '').toLowerCase(),
  );
}

function buildRow(data: ReturnType<typeof transactionSchema.parse>) {
  const account = usableAccount(data.accountId);
  const kind = categoryKindFor(data.type);
  if (kind) assertCategoryKind(data.categoryId, kind);
  else if (data.categoryId) {
    const c = getDb().select().from(categories).where(eq(categories.id, data.categoryId)).get();
    if (!c) throw new AppError(400, 'validation', 'Category not found', [{ path: 'categoryId', message: 'Category not found' }]);
  }
  assertWorkspace(data.workspaceId);
  assertRef('project', data.projectId, 'projectId', 'Project');
  const amount = signedAmount(data.type, minorOf(data.amount, account.currency), data.direction);
  return {
    date: data.date,
    type: data.type,
    accountId: account.id,
    amount,
    currency: account.currency,
    categoryId: data.categoryId ?? null,
    payee: data.payee,
    description: data.description,
    notes: data.notes,
    workspaceId: data.workspaceId ?? account.workspaceId ?? null,
    projectId: data.projectId ?? null,
  };
}

export function createTransaction(ctx: AuditContext, input: TransactionInput, extra: TxExtra = {}) {
  const data = parse(transactionSchema, input);
  const row = buildRow(data);
  if (!data.allowDuplicate) {
    const dupe = findDuplicate(row);
    if (dupe) throw new AppError(409, 'possible_duplicate', 'A transaction with the same date, account, amount and payee already exists. Save anyway?');
  }
  const id = newId();
  getDb()
    .insert(transactions)
    .values({ id, ...row, ...extra })
    .run();
  if (data.tags?.length) setTagsFor('transaction', id, data.tags);
  audit(ctx, 'transaction.create', { type: 'transaction', id }, `${data.type} ${minorToInput(row.amount, row.currency)} ${row.currency} on ${row.date}`, null, row);
  reindexEntity('transaction', id);
  return getTransaction(id);
}

export function createTransfer(ctx: AuditContext, input: TransferInput) {
  const data = parse(transferSchema, input);
  const from = usableAccount(data.fromAccountId, 'fromAccountId');
  const to = usableAccount(data.toAccountId, 'toAccountId');
  assertWorkspace(data.workspaceId);
  const out = minorOf(data.amount, from.currency, 'amount');
  let inn: number;
  if (from.currency === to.currency) inn = minorOf(data.amount, to.currency, 'amount');
  else {
    if (!data.toAmount) throw new AppError(400, 'validation', `Enter the amount received in ${to.currency}`, [{ path: 'toAmount', message: `Enter the amount received in ${to.currency}` }]);
    inn = minorOf(data.toAmount, to.currency, 'toAmount');
  }
  const group = newId();
  const outId = newId();
  const inId = newId();
  const base = { date: data.date, type: 'transfer' as const, description: data.description, notes: data.notes, transferGroup: group };
  tx((db) => {
    db.insert(transactions)
      .values({ id: outId, ...base, accountId: from.id, amount: -out, currency: from.currency, payee: to.name, workspaceId: data.workspaceId ?? from.workspaceId ?? null })
      .run();
    db.insert(transactions)
      .values({ id: inId, ...base, accountId: to.id, amount: inn, currency: to.currency, payee: from.name, workspaceId: data.workspaceId ?? to.workspaceId ?? null })
      .run();
  });
  if (data.tags?.length) {
    setTagsFor('transaction', outId, data.tags);
    setTagsFor('transaction', inId, data.tags);
  }
  audit(ctx, 'transaction.transfer', { type: 'transaction', id: outId }, `Transfer ${minorToInput(out, from.currency)} ${from.currency} ${from.name} → ${to.name} on ${data.date}`);
  reindexEntity('transaction', outId);
  reindexEntity('transaction', inId);
  return getTransaction(outId);
}

export function getTransaction(id: string) {
  const t = getRow(id);
  const legs = t.transferGroup ? getDb().select().from(transactions).where(and(eq(transactions.transferGroup, t.transferGroup), live)).all() : [];
  const counterpart = legs.find((l) => l.id !== t.id) ?? null;
  return { ...t, tags: getTagsFor('transaction', id), counterpart };
}

export function updateTransaction(ctx: AuditContext, id: string, input: Partial<TransactionInput> & Partial<TransferInput>) {
  const before = getTransaction(id);
  if (before.type === 'transfer') return updateTransfer(ctx, before, input);
  const data = parse(transactionSchema, {
    type: before.type,
    date: before.date,
    amount: minorToInput(Math.abs(before.amount), before.currency),
    direction: before.amount >= 0 ? 'in' : 'out',
    accountId: before.accountId,
    categoryId: before.categoryId,
    payee: before.payee,
    description: before.description,
    notes: before.notes,
    workspaceId: before.workspaceId,
    projectId: before.projectId,
    ...input,
    allowDuplicate: true,
  });
  if ((data.type as string) === 'transfer') throw badRequest('Use a transfer to move money between accounts');
  const row = buildRow(data);
  getDb()
    .update(transactions)
    .set({ ...row, updatedAt: nowIso() })
    .where(eq(transactions.id, id))
    .run();
  if (input.tags) setTagsFor('transaction', id, input.tags);
  // Keep a linked installment/debt payment consistent with the edited amount/date.
  if (before.installmentPaymentId) {
    getDb().update(installmentPayments).set({ paidDate: row.date, paidAmount: Math.abs(row.amount) }).where(eq(installmentPayments.id, before.installmentPaymentId)).run();
  }
  if (before.debtPaymentId) {
    getDb().update(debtPayments).set({ date: row.date, amount: Math.abs(row.amount) }).where(eq(debtPayments.id, before.debtPaymentId)).run();
  }
  const after = getTransaction(id);
  audit(ctx, 'transaction.update', { type: 'transaction', id }, `Edited ${after.type} on ${after.date}`, before, after);
  reindexEntity('transaction', id);
  return after;
}

function updateTransfer(ctx: AuditContext, before: ReturnType<typeof getTransaction>, input: Partial<TransferInput>) {
  const legs = getDb().select().from(transactions).where(and(eq(transactions.transferGroup, before.transferGroup!), live)).all();
  const outLeg = legs.find((l) => l.amount < 0) ?? legs[0];
  const inLeg = legs.find((l) => l.id !== outLeg.id);
  if (!inLeg) throw badRequest('This transfer is incomplete');
  const data = parse(transferSchema, {
    date: outLeg.date,
    fromAccountId: outLeg.accountId,
    toAccountId: inLeg.accountId,
    amount: minorToInput(Math.abs(outLeg.amount), outLeg.currency),
    toAmount: minorToInput(Math.abs(inLeg.amount), inLeg.currency),
    description: outLeg.description,
    notes: outLeg.notes,
    workspaceId: outLeg.workspaceId,
    ...input,
  });
  const from = usableAccount(data.fromAccountId, 'fromAccountId');
  const to = usableAccount(data.toAccountId, 'toAccountId');
  const out = minorOf(data.amount, from.currency);
  const inn = from.currency === to.currency ? minorOf(data.amount, to.currency) : minorOf(data.toAmount ?? '', to.currency, 'toAmount');
  tx((db) => {
    db.update(transactions)
      .set({ date: data.date, accountId: from.id, amount: -out, currency: from.currency, payee: to.name, description: data.description, notes: data.notes, workspaceId: data.workspaceId ?? from.workspaceId ?? null, updatedAt: nowIso() })
      .where(eq(transactions.id, outLeg.id))
      .run();
    db.update(transactions)
      .set({ date: data.date, accountId: to.id, amount: inn, currency: to.currency, payee: from.name, description: data.description, notes: data.notes, workspaceId: data.workspaceId ?? to.workspaceId ?? null, updatedAt: nowIso() })
      .where(eq(transactions.id, inLeg.id))
      .run();
  });
  if (input.tags) for (const l of [outLeg, inLeg]) setTagsFor('transaction', l.id, input.tags);
  audit(ctx, 'transaction.update', { type: 'transaction', id: outLeg.id }, `Edited transfer on ${data.date}`, legs);
  reindexEntity('transaction', outLeg.id);
  reindexEntity('transaction', inLeg.id);
  return getTransaction(before.id);
}

/**
 * Soft-delete a transaction (both legs for a transfer). A payment it recorded
 * (installment/debt) is re-opened so obligations stay correct.
 */
export function deleteTransaction(ctx: AuditContext, id: string) {
  const t = getTransaction(id);
  const ids = t.transferGroup ? [t.id, ...(t.counterpart ? [t.counterpart.id] : [])] : [t.id];
  tx((db) => {
    db.update(transactions).set({ deletedAt: nowIso(), updatedAt: nowIso() }).where(inArray(transactions.id, ids)).run();
    if (t.installmentPaymentId) {
      db.update(installmentPayments).set({ paidDate: null, paidAmount: null, transactionId: null }).where(eq(installmentPayments.id, t.installmentPaymentId)).run();
    }
    if (t.debtPaymentId) db.delete(debtPayments).where(eq(debtPayments.id, t.debtPaymentId)).run();
  });
  audit(ctx, 'transaction.delete', { type: 'transaction', id }, `Deleted ${t.type} of ${minorToInput(Math.abs(t.amount), t.currency)} ${t.currency} on ${t.date}`, t);
  for (const x of ids) reindexEntity('transaction', x);
}

export interface TxFilter {
  from?: string;
  to?: string;
  accountId?: string;
  categoryId?: string;
  type?: string;
  workspaceId?: string;
  projectId?: string;
  q?: string;
  tag?: string;
  limit?: number;
  offset?: number;
}

export function listTransactions(f: TxFilter) {
  const conds: SQL[] = [live];
  if (f.from) conds.push(gte(transactions.date, f.from));
  if (f.to) conds.push(lte(transactions.date, f.to));
  if (f.accountId) conds.push(eq(transactions.accountId, f.accountId));
  if (f.categoryId) conds.push(inArray(transactions.categoryId, categorySubtree(f.categoryId)));
  if (f.type) conds.push(eq(transactions.type, f.type as TransactionRow['type']));
  if (f.workspaceId) conds.push(eq(transactions.workspaceId, f.workspaceId));
  if (f.projectId) conds.push(eq(transactions.projectId, f.projectId));
  if (f.tag) conds.push(inArray(transactions.id, idsWithTag('transaction', f.tag)));
  if (f.q) {
    const q = `%${f.q.replace(/[%_]/g, '')}%`;
    conds.push(or(like(transactions.payee, q), like(transactions.description, q), like(transactions.notes, q))!);
  }
  const where = and(...conds);
  const rows = getDb()
    .select({
      t: transactions,
      accountName: accounts.name,
      categoryName: categories.name,
      categoryNameAr: categories.nameAr,
      categoryColor: categories.color,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(where)
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(Math.min(f.limit ?? 100, 1000))
    .offset(f.offset ?? 0)
    .all();
  const count = getDb().select({ n: sql<number>`count(*)` }).from(transactions).where(where).get()?.n ?? 0;
  // Totals per currency over the whole filtered set (transfers and adjustments excluded).
  const totals = getDb()
    .select({
      currency: transactions.currency,
      income: sql<number>`coalesce(sum(case when ${transactions.type} = 'income' then ${transactions.amount} else 0 end), 0)`,
      expenses: sql<number>`coalesce(sum(case when ${transactions.type} in ('expense','refund') then -${transactions.amount} else 0 end), 0)`,
    })
    .from(transactions)
    .where(where)
    .groupBy(transactions.currency)
    .all();
  const tags = getTagsForMany('transaction', rows.map((r) => r.t.id));
  return {
    items: rows.map((r) => ({
      ...r.t,
      accountName: r.accountName,
      categoryName: r.categoryName,
      categoryNameAr: r.categoryNameAr,
      categoryColor: r.categoryColor,
      tags: tags.get(r.t.id) ?? [],
    })),
    total: Number(count),
    totals: totals.map((t) => ({ currency: t.currency, income: Number(t.income), expenses: Number(t.expenses) })),
  };
}

/** Most used categories recently — powers the one-tap chips in quick add. */
export function frequentCategories(kind: 'income' | 'expense', limit = 8) {
  const types = kind === 'income' ? ['income'] : ['expense'];
  return getDb()
    .select({ id: categories.id, name: categories.name, nameAr: categories.nameAr, color: categories.color, n: sql<number>`count(*)` })
    .from(transactions)
    .innerJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(live, inArray(transactions.type, types as TransactionRow['type'][]), isNull(categories.archivedAt), gte(transactions.date, new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10))))
    .groupBy(categories.id)
    .orderBy(desc(sql`count(*)`))
    .limit(limit)
    .all();
}

registerEntity({
  type: 'transaction',
  exists: (id) => !!getDb().select({ id: transactions.id }).from(transactions).where(and(eq(transactions.id, id), live)).get(),
  resolve: (ids) =>
    getDb()
      .select({ t: transactions, c: categories.name })
      .from(transactions)
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .where(and(inArray(transactions.id, ids), live))
      .all()
      .map(({ t, c }) => ({
        id: t.id,
        type: 'transaction',
        title: t.payee || t.description || c || t.type,
        url: `/finance/transactions?open=${t.id}`,
        subtitle: `${t.date} · ${minorToInput(t.amount, t.currency)} ${t.currency}`,
        workspaceId: t.workspaceId,
      })),
  searchDocs: (ids) =>
    getDb()
      .select({ t: transactions, c: categories.name, cAr: categories.nameAr })
      .from(transactions)
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .where(ids ? and(inArray(transactions.id, ids), live) : live)
      .all()
      .map(({ t, c, cAr }) => ({
        id: t.id,
        workspaceId: t.workspaceId,
        title: t.payee || t.description || c || t.type,
        body: [t.description, t.notes, c, cAr, t.type, t.date, minorToInput(Math.abs(t.amount), t.currency)].filter(Boolean).join('\n'),
      })),
});
