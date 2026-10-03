import { z } from 'zod';
import { addDays, monthEnd } from './dates';
import { idSchema, isoDateSchema } from './schemas/common';

export const INTEREST_FREQUENCIES = ['daily', 'monthly'] as const;
export type InterestFrequency = (typeof INTEREST_FREQUENCIES)[number];
/** Monthly interest: on each day's closing balance (most banks), or on the lowest balance of the period. */
export const INTEREST_METHODS = ['daily_balance', 'min_balance'] as const;
export type InterestMethod = (typeof INTEREST_METHODS)[number];

/** Interest is counted per day on a 365-day year. */
export const DAYS_IN_YEAR = 365;

const rateInput = z.coerce
  .number({ message: 'Enter a rate' })
  .min(0, 'Rate cannot be negative')
  .max(100, 'Rate must be a yearly percentage, e.g. 22.5');

export const interestSetupSchema = z.object({
  enabled: z.boolean().default(true),
  frequency: z.enum(INTEREST_FREQUENCIES),
  method: z.enum(INTEREST_METHODS).default('daily_balance'),
  /** Monthly only: day of the month interest is credited (31 = last day of the month). */
  creditDay: z.coerce.number().int().min(1).max(31).default(31),
  categoryId: idSchema.nullable().optional(),
  /** First day interest is counted. */
  startDate: isoDateSchema,
  /** Yearly rate in percent; required when interest is first set up. */
  annualRate: rateInput.optional(),
});
export type InterestSetupInput = z.input<typeof interestSetupSchema>;

export const interestRateSchema = z.object({
  effectiveFrom: isoDateSchema,
  annualRate: rateInput,
});

export interface RatePoint {
  effectiveFrom: string;
  annualRate: number;
}

/** The yearly rate valid on a date (0 before the first rate). `rates` sorted by effectiveFrom. */
export function rateOn(rates: RatePoint[], date: string): number {
  let r = 0;
  for (const p of rates) {
    if (p.effectiveFrom <= date) r = p.annualRate;
    else break;
  }
  return r;
}

/** One day's interest (not rounded) on a closing balance. Negative balances earn nothing. */
export function dayInterest(balanceMinor: number, annualRate: number): number {
  return balanceMinor > 0 ? (balanceMinor * annualRate) / 100 / DAYS_IN_YEAR : 0;
}

export interface DayDelta {
  date: string;
  /** Net change of the balance on that day (minor units). */
  amount: number;
}

/**
 * Daily crediting: each day's interest is rounded and added to the balance, so the next
 * day earns interest on it (daily compounding). `opening` = closing balance of the day before `from`.
 */
export function accrueDaily(input: { opening: number; deltas: DayDelta[]; rates: RatePoint[]; from: string; to: string }) {
  const byDay = new Map<string, number>();
  for (const d of input.deltas) byDay.set(d.date, (byDay.get(d.date) ?? 0) + d.amount);
  const credits: { date: string; amount: number; balance: number; rate: number }[] = [];
  let bal = input.opening;
  for (let d = input.from; d <= input.to; d = addDays(d, 1)) {
    bal += byDay.get(d) ?? 0;
    const rate = rateOn(input.rates, d);
    const amount = Math.round(dayInterest(bal, rate));
    if (amount > 0) credits.push({ date: d, amount, balance: bal, rate });
    bal += amount;
  }
  return { credits, closing: bal };
}

/** Interest for a whole period credited at once (monthly), rounded once at the end. */
export function periodInterest(input: { opening: number; deltas: DayDelta[]; rates: RatePoint[]; from: string; to: string; method: InterestMethod }) {
  const byDay = new Map<string, number>();
  for (const d of input.deltas) byDay.set(d.date, (byDay.get(d.date) ?? 0) + d.amount);
  let bal = input.opening;
  let total = 0;
  let minBal = Number.POSITIVE_INFINITY;
  let rateDays = 0;
  let days = 0;
  for (let d = input.from; d <= input.to; d = addDays(d, 1)) {
    bal += byDay.get(d) ?? 0;
    const rate = rateOn(input.rates, d);
    total += dayInterest(bal, rate);
    minBal = Math.min(minBal, bal);
    rateDays += rate;
    days++;
  }
  if (!days) return { amount: 0, days: 0, lowestBalance: null as number | null };
  const amount = input.method === 'min_balance' ? Math.round(minBal > 0 ? (minBal * rateDays) / 100 / DAYS_IN_YEAR : 0) : Math.round(total);
  return { amount, days, lowestBalance: minBal };
}

/** The crediting date in a month: the credit day, or the month's last day if shorter. */
export function creditDateIn(month: string, creditDay: number): string {
  const last = monthEnd(month);
  const day = Math.min(creditDay, Number(last.slice(8, 10)));
  return `${month}-${String(day).padStart(2, '0')}`;
}

/** Crediting dates strictly after `after`, up to and including `until`. */
export function creditDatesBetween(after: string, until: string, creditDay: number): string[] {
  const out: string[] = [];
  let m = after.slice(0, 7);
  for (let i = 0; i < 1200; i++) {
    const c = creditDateIn(m, creditDay);
    if (c > until) break;
    if (c > after) out.push(c);
    const [y, mm] = m.split('-').map(Number);
    m = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, '0')}`;
  }
  return out;
}

/** The next crediting date on or after `from`. */
export function nextCreditDate(from: string, creditDay: number): string {
  return creditDatesBetween(addDays(from, -1), addDays(from, 40), creditDay)[0];
}
