import { accountSchema, LIABILITY_ACCOUNT_TYPES, LIQUID_ACCOUNT_TYPES, minorToInput, type AccountInput, type AccountType } from '@life-erp/shared';
import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { accounts, transactions } from '../../db/schema';
import { audit, type AuditContext } from '../../lib/audit';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors';
import { newId, nowIso } from '../../lib/ids';
import { registerEntity } from '../../lib/registry';
import { parse } from '../../lib/validate';
import { reindexEntity } from '../search/service';
import { assertWorkspace } from '../workspaces/service';
import { assertCurrency, minorOf } from './currency';

export type AccountRow = typeof accounts.$inferSelect;
const live = isNull(accounts.deletedAt);

/** Balance of every account (opening balance + all live transactions), optionally as of a date. */
export function balances(asOf?: string): Map<string, number> {
  const conds = [isNull(transactions.deletedAt)];
  if (asOf) conds.push(lte(transactions.date, asOf));
  const sums = getDb()
    .select({ accountId: transactions.accountId, total: sql<number>`coalesce(sum(${transactions.amount}), 0)` })
    .from(transactions)
    .where(and(...conds))
    .groupBy(transactions.accountId)
    .all();
  const bySum = new Map(sums.map((s) => [s.accountId, Number(s.total)]));
  const out = new Map<string, number>();
  for (const a of getDb().select().from(accounts).where(live).all()) {
    const opening = !asOf || !a.openingDate || a.openingDate <= asOf ? a.openingBalance : 0;
    out.set(a.id, opening + (bySum.get(a.id) ?? 0));
  }
  return out;
}

export function listAccounts(opts: { includeArchived?: boolean; workspaceId?: string | null } = {}) {
  const conds = [live];
  if (!opts.includeArchived) conds.push(isNull(accounts.archivedAt));
  if (opts.workspaceId) conds.push(eq(accounts.workspaceId, opts.workspaceId));
  const rows = getDb().select().from(accounts).where(and(...conds)).orderBy(asc(accounts.sortOrder), asc(accounts.createdAt)).all();
  const bal = balances();
  return rows.map((a) => ({
    ...a,
    balance: bal.get(a.id) ?? a.openingBalance,
    liquid: LIQUID_ACCOUNT_TYPES.includes(a.type as AccountType),
    liability: LIABILITY_ACCOUNT_TYPES.includes(a.type as AccountType),
  }));
}

export function getAccount(id: string) {
  const a = getDb().select().from(accounts).where(and(eq(accounts.id, id), live)).get();
  if (!a) throw notFound('Account');
  return { ...a, balance: balances().get(a.id) ?? a.openingBalance };
}

/** For writes: the account must exist and be active. */
export function usableAccount(id: string, field = 'accountId'): AccountRow {
  const a = getDb().select().from(accounts).where(and(eq(accounts.id, id), live)).get();
  if (!a) throw new AppError(400, 'validation', 'Account not found', [{ path: field, message: 'Account not found' }]);
  if (a.archivedAt) {
    const msg = `"${a.name}" is archived. Restore it first to add transactions.`;
    throw new AppError(400, 'validation', msg, [{ path: field, message: msg }]);
  }
  return a;
}

function toRow(data: ReturnType<typeof accountSchema.parse>) {
  assertCurrency(data.currency);
  assertWorkspace(data.workspaceId);
  return {
    name: data.name,
    type: data.type,
    currency: data.currency,
    openingBalance: minorOf(data.openingBalance, data.currency, 'openingBalance'),
    openingDate: data.openingDate ?? null,
    institution: data.institution,
    reference: data.reference,
    creditLimit: data.creditLimit ? minorOf(data.creditLimit, data.currency, 'creditLimit') : null,
    workspaceId: data.workspaceId ?? null,
    color: data.color ?? null,
    includeInNetWorth: data.includeInNetWorth,
    notes: data.notes,
  };
}

export function createAccount(ctx: AuditContext, input: AccountInput) {
  const data = parse(accountSchema, input);
  const dupe = listAccounts({ includeArchived: true }).find((a) => a.name.toLowerCase() === data.name.toLowerCase());
  if (dupe) throw conflict(`An account named "${data.name}" already exists`);
  const id = newId();
  const maxOrder = Math.max(0, ...listAccounts({ includeArchived: true }).map((a) => a.sortOrder));
  getDb()
    .insert(accounts)
    .values({ id, sortOrder: maxOrder + 1, ...toRow(data) })
    .run();
  const created = getAccount(id);
  audit(ctx, 'account.create', { type: 'account', id }, `Created account "${data.name}"`, null, created);
  reindexEntity('account', id);
  return created;
}

export function updateAccount(ctx: AuditContext, id: string, input: Partial<AccountInput>) {
  const before = getAccount(id);
  // Stored minor units are re-expressed as decimal strings for fields the caller didn't send.
  const data = parse(accountSchema, {
    ...before,
    openingBalance: minorToInput(before.openingBalance, before.currency),
    creditLimit: before.creditLimit == null ? null : minorToInput(before.creditLimit, before.currency),
    ...input,
  });
  if (data.currency !== before.currency) {
    const used = getDb().select({ id: transactions.id }).from(transactions).where(eq(transactions.accountId, id)).get();
    if (used) throw badRequest('The currency of an account with transactions cannot be changed. Create a new account instead.');
  }
  getDb()
    .update(accounts)
    .set({ ...toRow(data), updatedAt: nowIso() })
    .where(eq(accounts.id, id))
    .run();
  const after = getAccount(id);
  audit(ctx, 'account.update', { type: 'account', id }, `Updated account "${after.name}"`, before, after);
  reindexEntity('account', id);
  return after;
}

export function setAccountArchived(ctx: AuditContext, id: string, archived: boolean) {
  const a = getAccount(id);
  getDb()
    .update(accounts)
    .set({ archivedAt: archived ? nowIso() : null, updatedAt: nowIso() })
    .where(eq(accounts.id, id))
    .run();
  audit(ctx, archived ? 'account.archive' : 'account.unarchive', { type: 'account', id }, `${archived ? 'Archived' : 'Restored'} account "${a.name}"`);
}

/** Accounts with transactions can only be archived (history must stay intact). */
export function deleteAccount(ctx: AuditContext, id: string) {
  const a = getAccount(id);
  const used = getDb()
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.accountId, id), isNull(transactions.deletedAt)))
    .get();
  if (used) throw badRequest(`"${a.name}" has transactions. Archive it instead, so your history stays correct.`);
  getDb().update(accounts).set({ deletedAt: nowIso() }).where(eq(accounts.id, id)).run();
  audit(ctx, 'account.delete', { type: 'account', id }, `Deleted account "${a.name}"`, a);
  reindexEntity('account', id);
}

registerEntity({
  type: 'account',
  exists: (id) => !!getDb().select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, id), live)).get(),
  resolve: (ids) =>
    getDb()
      .select()
      .from(accounts)
      .where(and(inArray(accounts.id, ids), live))
      .all()
      .map((a) => ({ id: a.id, type: 'account', title: a.name, url: `/finance/accounts/${a.id}`, subtitle: a.institution, workspaceId: a.workspaceId })),
  searchDocs: (ids) =>
    getDb()
      .select()
      .from(accounts)
      .where(ids ? and(inArray(accounts.id, ids), live) : live)
      .all()
      .map((a) => ({ id: a.id, workspaceId: a.workspaceId, title: a.name, body: [a.institution, a.type, a.currency, a.notes].filter(Boolean).join('\n') })),
});
