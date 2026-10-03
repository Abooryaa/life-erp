import {
  accrueDaily,
  addDays,
  creditDatesBetween,
  fromMinor,
  interestRateSchema,
  interestSetupSchema,
  LIABILITY_ACCOUNT_TYPES,
  minorToInput,
  nextCreditDate,
  periodInterest,
  rateOn,
  type AccountType,
  type InterestFrequency,
  type InterestMethod,
  type InterestSetupInput,
  type RatePoint,
} from '@life-erp/shared';
import { and, asc, eq, gte, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { getDb, tx } from '../../db/client';
import { accountInterest, accounts, categories, interestRates, transactions } from '../../db/schema';
import { audit, type AuditContext } from '../../lib/audit';
import { AppError, badRequest, notFound } from '../../lib/errors';
import { newId, nowIso } from '../../lib/ids';
import { parse } from '../../lib/validate';
import { registerJob } from '../../jobs/scheduler';
import { hasUsers } from '../auth/service';
import { notify } from '../notifications/service';
import { getAccount } from './accounts';
import { todayLocal } from './jobs';
import { createTransaction, deleteTransaction } from './transactions';

/** Interest the system credits is a system action: it never triggers automation rules. */
const SYSTEM: AuditContext = { userId: null, ip: 'automation' };
/** Catch-up limit per run (≈10 years of daily crediting). */
const MAX_DAYS = 3700;

type Config = typeof accountInterest.$inferSelect;

function getConfig(accountId: string): Config | undefined {
  return getDb().select().from(accountInterest).where(eq(accountInterest.accountId, accountId)).get();
}

export function listRates(accountId: string): (RatePoint & { id: string })[] {
  return getDb()
    .select({ id: interestRates.id, effectiveFrom: interestRates.effectiveFrom, annualRate: interestRates.annualRate })
    .from(interestRates)
    .where(eq(interestRates.accountId, accountId))
    .orderBy(asc(interestRates.effectiveFrom))
    .all();
}

/** Closing balance at the end of `date`. */
function balanceAt(accountId: string, date: string) {
  const a = getDb().select().from(accounts).where(eq(accounts.id, accountId)).get()!;
  const sum =
    getDb()
      .select({ s: sql<number>`coalesce(sum(${transactions.amount}), 0)` })
      .from(transactions)
      .where(and(eq(transactions.accountId, accountId), isNull(transactions.deletedAt), sql`${transactions.date} <= ${date}`))
      .get()?.s ?? 0;
  const opening = !a.openingDate || a.openingDate <= date ? a.openingBalance : 0;
  return opening + Number(sum);
}

/** Net change per day between two dates (the opening balance counts on its opening date). */
function deltas(accountId: string, from: string, to: string) {
  const a = getDb().select().from(accounts).where(eq(accounts.id, accountId)).get()!;
  const rows = getDb()
    .select({ date: transactions.date, amount: sql<number>`sum(${transactions.amount})` })
    .from(transactions)
    .where(and(eq(transactions.accountId, accountId), isNull(transactions.deletedAt), sql`${transactions.date} between ${from} and ${to}`))
    .groupBy(transactions.date)
    .all()
    .map((r) => ({ date: r.date, amount: Number(r.amount) }));
  if (a.openingDate && a.openingDate >= from && a.openingDate <= to) rows.push({ date: a.openingDate, amount: a.openingBalance });
  return rows;
}

function post(cfg: Config, acct: { id: string; name: string; institution: string | null; currency: string; workspaceId: string | null }, date: string, amount: number, through: string, description: string) {
  createTransaction(
    SYSTEM,
    {
      type: 'income',
      date,
      amount: minorToInput(amount, acct.currency),
      accountId: acct.id,
      categoryId: cfg.categoryId,
      payee: acct.institution || acct.name,
      description,
      workspaceId: acct.workspaceId,
      allowDuplicate: true,
    },
    { interestThrough: through },
  );
}

/**
 * Credit all interest that is due up to `today` (catching up missed days).
 * Daily: every finished day (each day's interest is added, so it compounds).
 * Monthly: on each crediting date, for the days since the last credit.
 */
export function runInterest(accountId: string, today = todayLocal()) {
  const cfg = getConfig(accountId);
  if (!cfg?.enabled) return { credited: 0, total: 0 };
  const acct = getDb().select().from(accounts).where(eq(accounts.id, accountId)).get();
  if (!acct || acct.deletedAt || acct.archivedAt) return { credited: 0, total: 0 };
  const rates = listRates(accountId);
  let from = cfg.accruedThrough ? addDays(cfg.accruedThrough, 1) : cfg.startDate;
  let credited = 0;
  let total = 0;
  return tx(() => {
    if (cfg.frequency === 'daily') {
      // Today isn't finished yet: credit up to yesterday.
      let to = addDays(today, -1);
      if (from > to) return { credited, total };
      if (addDays(from, MAX_DAYS) < to) to = addDays(from, MAX_DAYS);
      const r = accrueDaily({ opening: balanceAt(accountId, addDays(from, -1)), deltas: deltas(accountId, from, to), rates, from, to });
      for (const c of r.credits) {
        post(cfg, acct, c.date, c.amount, c.date, `Daily interest ${c.rate}%`);
        credited++;
        total += c.amount;
      }
      setThrough(accountId, to);
      return { credited, total };
    }
    for (const c of creditDatesBetween(addDays(from, -1), today, cfg.creditDay)) {
      const end = addDays(c, -1);
      if (end < from) continue;
      const r = periodInterest({ opening: balanceAt(accountId, addDays(from, -1)), deltas: deltas(accountId, from, end), rates, from, to: end, method: cfg.method as InterestMethod });
      if (r.amount > 0) {
        post(cfg, acct, c, r.amount, end, `Interest ${from} – ${end}`);
        credited++;
        total += r.amount;
        notify({
          severity: 'info',
          title: `Interest credited: ${minorToInput(r.amount, acct.currency)} ${acct.currency}`,
          body: `${acct.name} · ${from} – ${end}`,
          link: `/finance/accounts/${acct.id}`,
          entity: { type: 'account', id: acct.id },
          dedupeKey: `interest:${acct.id}:${end}`,
        });
      }
      setThrough(accountId, end);
      from = c;
    }
    return { credited, total };
  });
}

function setThrough(accountId: string, date: string) {
  getDb().update(accountInterest).set({ accruedThrough: date, updatedAt: nowIso() }).where(eq(accountInterest.accountId, accountId)).run();
}

export function runAllInterest(today = todayLocal()) {
  for (const c of getDb().select().from(accountInterest).where(eq(accountInterest.enabled, true)).all()) runInterest(c.accountId, today);
}

registerJob({
  name: 'interest',
  everyMs: 60 * 60_000,
  run: () => {
    if (hasUsers()) runAllInterest();
  },
});

/** An income category for interest: the one given, or "Bank interest" (created once, under Investment returns). */
function interestCategory(categoryId: string | null | undefined) {
  if (categoryId) {
    const c = getDb().select().from(categories).where(eq(categories.id, categoryId)).get();
    if (!c || c.kind !== 'income') throw new AppError(400, 'validation', 'Choose an income category', [{ path: 'categoryId', message: 'Choose an income category' }]);
    return c.id;
  }
  const existing = getDb().select().from(categories).where(and(eq(categories.kind, 'income'), sql`lower(${categories.name}) = 'bank interest'`)).get();
  if (existing) return existing.id;
  const parent = getDb().select().from(categories).where(and(eq(categories.kind, 'income'), eq(categories.name, 'Investment returns'), isNull(categories.parentId))).get();
  const id = newId();
  getDb().insert(categories).values({ id, kind: 'income', name: 'Bank interest', nameAr: 'فوائد بنكية', parentId: parent?.id ?? null, color: '#7c3aed' }).run();
  return id;
}

/** Interest settings, rate history and what it has earned. */
export function getInterest(accountId: string, today = todayLocal()) {
  const acct = getAccount(accountId);
  const cfg = getConfig(accountId);
  if (!cfg) return { accountId, configured: false as const, eligible: !LIABILITY_ACCOUNT_TYPES.includes(acct.type as AccountType) };
  const rates = listRates(accountId);
  const earned = (from: string) =>
    Number(
      getDb()
        .select({ s: sql<number>`coalesce(sum(${transactions.amount}), 0)` })
        .from(transactions)
        .where(and(eq(transactions.accountId, accountId), isNull(transactions.deletedAt), isNotNull(transactions.interestThrough), gte(transactions.date, from)))
        .get()?.s ?? 0,
    );
  // What is building up for the next monthly credit (not yet credited — an estimate until the bank credits it).
  let pending: { from: string; to: string; amount: number; creditDate: string } | null = null;
  if (cfg.enabled && cfg.frequency === 'monthly') {
    const from = cfg.accruedThrough ? addDays(cfg.accruedThrough, 1) : cfg.startDate;
    const to = addDays(today, -1);
    const creditDate = nextCreditDate(from > today ? from : today, cfg.creditDay);
    const amount = from <= to ? periodInterest({ opening: balanceAt(accountId, addDays(from, -1)), deltas: deltas(accountId, from, to), rates, from, to, method: cfg.method as InterestMethod }).amount : 0;
    pending = { from, to, amount, creditDate };
  }
  const rate = rateOn(rates, today);
  const balance = balanceAt(accountId, today);
  return {
    configured: true as const,
    eligible: true,
    ...cfg,
    frequency: cfg.frequency as InterestFrequency,
    method: cfg.method as InterestMethod,
    currency: acct.currency,
    rates,
    currentRate: rate,
    earnedThisMonth: earned(`${today.slice(0, 7)}-01`),
    earnedThisYear: earned(`${today.slice(0, 4)}-01-01`),
    earnedTotal: earned('0000-01-01'),
    pending,
    /** Simple estimate at today's balance and rate, for orientation only. */
    estimatedPerMonth: Math.round((Math.max(balance, 0) * rate) / 100 / 12),
    estimatedPerMonthMajor: fromMinor(Math.round((Math.max(balance, 0) * rate) / 100 / 12), acct.currency),
  };
}

export function setupInterest(ctx: AuditContext, accountId: string, input: InterestSetupInput) {
  const acct = getAccount(accountId);
  if (LIABILITY_ACCOUNT_TYPES.includes(acct.type as AccountType)) throw badRequest('Interest earnings are for savings, bank and investment accounts — not cards or loans.');
  const data = parse(interestSetupSchema, input);
  const existing = getConfig(accountId);
  const categoryId = interestCategory(data.categoryId);
  if (!existing) {
    if (data.annualRate == null) throw new AppError(400, 'validation', 'Enter the yearly rate', [{ path: 'annualRate', message: 'Required' }]);
    tx((db) => {
      db.insert(accountInterest).values({ accountId, enabled: data.enabled, frequency: data.frequency, method: data.method, creditDay: data.creditDay, categoryId, startDate: data.startDate }).run();
      db.insert(interestRates).values({ id: newId(), accountId, effectiveFrom: data.startDate, annualRate: data.annualRate! }).run();
    });
    audit(ctx, 'interest.setup', { type: 'account', id: accountId }, `Interest set up on "${acct.name}": ${data.annualRate}% yearly, credited ${data.frequency}`);
  } else {
    if (data.startDate !== existing.startDate && existing.accruedThrough && data.startDate <= existing.accruedThrough) {
      throw new AppError(400, 'validation', 'Interest was already credited for that period — use “Recalculate” instead', [{ path: 'startDate', message: 'Already credited' }]);
    }
    tx((db) => {
      db.update(accountInterest)
        .set({ enabled: data.enabled, frequency: data.frequency, method: data.method, creditDay: data.creditDay, categoryId, startDate: data.startDate, updatedAt: nowIso() })
        .where(eq(accountInterest.accountId, accountId))
        .run();
      // The first rate always starts with interest itself.
      const first = listRates(accountId)[0];
      if (first && first.effectiveFrom > data.startDate) db.update(interestRates).set({ effectiveFrom: data.startDate }).where(eq(interestRates.id, first.id)).run();
    });
    audit(ctx, 'interest.update', { type: 'account', id: accountId }, `Interest settings of "${acct.name}" ${data.enabled ? 'updated' : 'paused'}`, existing, data);
  }
  runInterest(accountId);
  return getInterest(accountId);
}

export function addRate(ctx: AuditContext, accountId: string, input: unknown) {
  const cfg = getConfig(accountId);
  if (!cfg) throw notFound('Interest settings');
  const r = parse(interestRateSchema, input);
  if (r.effectiveFrom < cfg.startDate) throw new AppError(400, 'validation', 'Before interest started on this account', [{ path: 'effectiveFrom', message: 'Before the start date' }]);
  getDb()
    .insert(interestRates)
    .values({ id: newId(), accountId, effectiveFrom: r.effectiveFrom, annualRate: r.annualRate })
    .onConflictDoUpdate({ target: [interestRates.accountId, interestRates.effectiveFrom], set: { annualRate: r.annualRate } })
    .run();
  audit(ctx, 'interest.rate', { type: 'account', id: accountId }, `Interest rate ${r.annualRate}% from ${r.effectiveFrom}`);
  const alreadyCredited = !!cfg.accruedThrough && r.effectiveFrom <= cfg.accruedThrough;
  return { ...getInterest(accountId), alreadyCredited };
}

export function deleteRate(ctx: AuditContext, accountId: string, rateId: string) {
  const rates = listRates(accountId);
  const r = rates.find((x) => x.id === rateId);
  if (!r) throw notFound('Rate');
  if (rates[0].id === rateId) throw badRequest('The first rate can’t be removed — change it instead, or remove interest from the account.');
  getDb().delete(interestRates).where(eq(interestRates.id, rateId)).run();
  audit(ctx, 'interest.rate_delete', { type: 'account', id: accountId }, `Removed interest rate ${r.annualRate}% from ${r.effectiveFrom}`);
  return getInterest(accountId);
}

/**
 * Remove interest the system credited from `from` on, and credit it again with the current
 * transactions and rates (e.g. after adding an old transaction or a backdated rate change).
 */
export function recalculateInterest(ctx: AuditContext, accountId: string, from: string) {
  const cfg = getConfig(accountId);
  if (!cfg) throw notFound('Interest settings');
  const start = from < cfg.startDate ? cfg.startDate : from;
  const posted = getDb()
    .select({ id: transactions.id, through: transactions.interestThrough })
    .from(transactions)
    .where(and(eq(transactions.accountId, accountId), isNull(transactions.deletedAt), isNotNull(transactions.interestThrough), gte(transactions.interestThrough, start)))
    .all();
  const removed = tx(() => {
    for (const p of posted) deleteTransaction(SYSTEM, p.id);
    // Monthly credits cover a whole period: restart from the beginning of the earliest affected one.
    const prior = getDb()
      .select({ through: sql<string>`max(${transactions.interestThrough})` })
      .from(transactions)
      .where(and(eq(transactions.accountId, accountId), isNull(transactions.deletedAt), isNotNull(transactions.interestThrough), lt(transactions.interestThrough, start)))
      .get()?.through;
    const through = cfg.frequency === 'daily' ? addDays(start, -1) : (prior ?? null);
    getDb()
      .update(accountInterest)
      .set({ accruedThrough: through && through >= cfg.startDate ? through : null, updatedAt: nowIso() })
      .where(eq(accountInterest.accountId, accountId))
      .run();
    return posted.length;
  });
  const result = runInterest(accountId);
  audit(ctx, 'interest.recalculate', { type: 'account', id: accountId }, `Recalculated interest from ${start}: removed ${removed}, credited ${result.credited}`);
  return { removed, ...result, interest: getInterest(accountId) };
}

/** Stop crediting interest. Interest already credited stays as normal income transactions. */
export function removeInterest(ctx: AuditContext, accountId: string) {
  const acct = getAccount(accountId);
  if (!getConfig(accountId)) throw notFound('Interest settings');
  tx((db) => {
    db.delete(interestRates).where(eq(interestRates.accountId, accountId)).run();
    db.delete(accountInterest).where(eq(accountInterest.accountId, accountId)).run();
  });
  audit(ctx, 'interest.remove', { type: 'account', id: accountId }, `Interest removed from "${acct.name}" (credited interest kept)`);
}

/** Current yearly rate per account, for badges in lists. */
export function ratesByAccount(today = todayLocal()) {
  const out = new Map<string, { rate: number; frequency: string }>();
  for (const c of getDb().select().from(accountInterest).where(eq(accountInterest.enabled, true)).all()) {
    out.set(c.accountId, { rate: rateOn(listRates(c.accountId), today), frequency: c.frequency });
  }
  return out;
}
