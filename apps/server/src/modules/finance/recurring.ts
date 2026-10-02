import { minorToInput, nextOccurrence, occurrences, recurringSchema, type Frequency, type RecurringInput } from '@life-erp/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { accounts, categories, recurringRules } from '../../db/schema';
import { audit, type AuditContext } from '../../lib/audit';
import { badRequest, notFound } from '../../lib/errors';
import { newId, nowIso } from '../../lib/ids';
import { parse } from '../../lib/validate';
import { assertWorkspace } from '../workspaces/service';
import { usableAccount } from './accounts';
import { assertCategoryKind } from './categories';
import { minorOf } from './currency';
import { createTransaction, createTransfer } from './transactions';

export type RecurringRule = typeof recurringRules.$inferSelect;
const live = isNull(recurringRules.deletedAt);

/** First scheduled date on or after `from` (or null if the rule has ended). */
export function firstOnOrAfter(rule: Pick<RecurringRule, 'startDate' | 'frequency' | 'interval' | 'endDate'>, from: string): string | null {
  const anchor = Number(rule.startDate.slice(8, 10));
  let d = rule.startDate;
  for (let i = 0; i < 5000 && d < from; i++) d = nextOccurrence(d, rule.frequency as Frequency, rule.interval, anchor);
  if (rule.endDate && d > rule.endDate) return null;
  return d;
}

function validate(data: ReturnType<typeof recurringSchema.parse>) {
  const account = usableAccount(data.accountId);
  if (data.type === 'transfer') usableAccount(data.toAccountId!, 'toAccountId');
  else assertCategoryKind(data.categoryId, data.type);
  assertWorkspace(data.workspaceId);
  return {
    name: data.name,
    type: data.type,
    amount: minorOf(data.amount, account.currency),
    currency: account.currency,
    accountId: account.id,
    toAccountId: data.type === 'transfer' ? data.toAccountId! : null,
    categoryId: data.type === 'transfer' ? null : (data.categoryId ?? null),
    payee: data.payee,
    workspaceId: data.workspaceId ?? account.workspaceId ?? null,
    frequency: data.frequency,
    interval: data.interval,
    startDate: data.startDate,
    endDate: data.endDate ?? null,
    autoPost: data.autoPost,
    remindDaysBefore: data.remindDaysBefore,
    notes: data.notes,
  };
}

export function listRecurring() {
  return getDb()
    .select({ r: recurringRules, accountName: accounts.name, categoryName: categories.name, categoryNameAr: categories.nameAr })
    .from(recurringRules)
    .innerJoin(accounts, eq(accounts.id, recurringRules.accountId))
    .leftJoin(categories, eq(categories.id, recurringRules.categoryId))
    .where(live)
    .orderBy(asc(recurringRules.nextDue))
    .all()
    .map((x) => ({ ...x.r, accountName: x.accountName, categoryName: x.categoryName, categoryNameAr: x.categoryNameAr }));
}

export function getRecurring(id: string): RecurringRule {
  const r = getDb().select().from(recurringRules).where(and(eq(recurringRules.id, id), live)).get();
  if (!r) throw notFound('Recurring item');
  return r;
}

/**
 * Create a rule. Its first due date is the first occurrence from today on — past occurrences
 * are never auto-posted retroactively (record them as normal transactions if needed).
 */
export function createRecurring(ctx: AuditContext, input: RecurringInput, today: string) {
  const row = validate(parse(recurringSchema, input));
  const id = newId();
  const nextDue = firstOnOrAfter(row, today < row.startDate ? row.startDate : today);
  getDb()
    .insert(recurringRules)
    .values({ id, ...row, nextDue })
    .run();
  audit(ctx, 'recurring.create', { type: 'recurring', id }, `Created recurring ${row.type} "${row.name}"`, null, row);
  return getRecurring(id);
}

export function updateRecurring(ctx: AuditContext, id: string, input: Partial<RecurringInput>, today: string) {
  const before = getRecurring(id);
  const row = validate(
    parse(recurringSchema, {
      ...before,
      amount: minorToInput(before.amount, before.currency),
      ...input,
    }),
  );
  const scheduleChanged =
    row.startDate !== before.startDate || row.frequency !== before.frequency || row.interval !== before.interval || row.endDate !== before.endDate;
  const from = before.nextDue && before.nextDue > today ? before.nextDue : today;
  const nextDue = scheduleChanged ? firstOnOrAfter(row, from < row.startDate ? row.startDate : from) : before.nextDue;
  getDb()
    .update(recurringRules)
    .set({ ...row, nextDue, updatedAt: nowIso() })
    .where(eq(recurringRules.id, id))
    .run();
  const after = getRecurring(id);
  audit(ctx, 'recurring.update', { type: 'recurring', id }, `Updated recurring "${after.name}"`, before, after);
  return after;
}

export function setRecurringActive(ctx: AuditContext, id: string, active: boolean) {
  const r = getRecurring(id);
  getDb().update(recurringRules).set({ active, updatedAt: nowIso() }).where(eq(recurringRules.id, id)).run();
  audit(ctx, active ? 'recurring.resume' : 'recurring.pause', { type: 'recurring', id }, `${active ? 'Resumed' : 'Paused'} "${r.name}"`);
}

export function deleteRecurring(ctx: AuditContext, id: string) {
  const r = getRecurring(id);
  getDb().update(recurringRules).set({ deletedAt: nowIso() }).where(eq(recurringRules.id, id)).run();
  audit(ctx, 'recurring.delete', { type: 'recurring', id }, `Deleted recurring "${r.name}" (past transactions are kept)`, r);
}

function advance(rule: RecurringRule) {
  if (!rule.nextDue) return null;
  const n = nextOccurrence(rule.nextDue, rule.frequency as Frequency, rule.interval, Number(rule.startDate.slice(8, 10)));
  return rule.endDate && n > rule.endDate ? null : n;
}

/** Record the next due occurrence as a real transaction (optionally with a different amount/date). */
export function postRecurring(ctx: AuditContext, id: string, opts: { date?: string; amount?: string } = {}) {
  const rule = getRecurring(id);
  if (!rule.nextDue) throw badRequest('This recurring item has ended');
  const date = opts.date ?? rule.nextDue;
  const amount = opts.amount ?? minorToInput(rule.amount, rule.currency);
  let txId: string;
  if (rule.type === 'transfer') {
    const t = createTransfer(ctx, { date, fromAccountId: rule.accountId, toAccountId: rule.toAccountId!, amount, toAmount: amount, description: rule.name, workspaceId: rule.workspaceId });
    txId = t.id;
  } else {
    const t = createTransaction(
      ctx,
      { type: rule.type, date, amount, accountId: rule.accountId, categoryId: rule.categoryId, payee: rule.payee ?? rule.name, description: rule.name, workspaceId: rule.workspaceId, allowDuplicate: true },
      { recurringId: rule.id },
    );
    txId = t.id;
  }
  getDb().update(recurringRules).set({ nextDue: advance(rule), updatedAt: nowIso() }).where(eq(recurringRules.id, id)).run();
  return { transactionId: txId, nextDue: advance(rule) };
}

export function skipRecurring(ctx: AuditContext, id: string) {
  const rule = getRecurring(id);
  if (!rule.nextDue) throw badRequest('This recurring item has ended');
  getDb().update(recurringRules).set({ nextDue: advance(rule), updatedAt: nowIso() }).where(eq(recurringRules.id, id)).run();
  audit(ctx, 'recurring.skip', { type: 'recurring', id }, `Skipped ${rule.nextDue} of "${rule.name}"`);
  return getRecurring(id);
}

/** Expected occurrences between dates (for upcoming payments and cash-flow forecasts). */
export function projectedOccurrences(until: string) {
  const rules = getDb().select().from(recurringRules).where(and(live, eq(recurringRules.active, true))).all();
  return rules.flatMap((r) =>
    r.nextDue
      ? occurrences(r.nextDue, r.frequency as Frequency, r.interval, until, r.endDate, 120, Number(r.startDate.slice(8, 10))).map((date) => ({ rule: r, date }))
      : [],
  );
}

export function rulesByIds(ids: string[]) {
  return ids.length ? getDb().select().from(recurringRules).where(inArray(recurringRules.id, ids)).all() : [];
}
