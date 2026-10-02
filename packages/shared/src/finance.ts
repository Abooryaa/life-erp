/**
 * Pure finance calculations shared by the server (source of truth) and the UI (what-if previews).
 * All amounts are integer minor units.
 */
import { addDays, addMonths, daysInMonth, monthsBetween } from './dates';

export const ACCOUNT_TYPES = ['bank', 'cash', 'savings', 'credit_card', 'ewallet', 'investment', 'loan', 'gameya', 'other'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
/** Account types that count as cash you can spend now. */
export const LIQUID_ACCOUNT_TYPES: AccountType[] = ['bank', 'cash', 'savings', 'ewallet'];
/** Account types whose balance is normally negative (money owed). */
export const LIABILITY_ACCOUNT_TYPES: AccountType[] = ['credit_card', 'loan'];

export const TRANSACTION_TYPES = ['income', 'expense', 'transfer', 'refund', 'adjustment'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

/**
 * Effect of a transaction on its account balance. The UI always sends a positive amount;
 * the type decides the sign. Adjustments carry their own sign.
 */
export function signedAmount(type: TransactionType, amount: number, direction: 'in' | 'out' = 'out'): number {
  const abs = Math.abs(amount);
  switch (type) {
    case 'income':
    case 'refund':
      return abs;
    case 'expense':
      return -abs;
    case 'transfer':
    case 'adjustment':
      return direction === 'in' ? abs : -abs;
  }
}

/** Next date after `date` for a recurrence, keeping the original day-of-month for monthly rules. */
export function nextOccurrence(date: string, frequency: Frequency, interval = 1, anchorDay?: number): string {
  switch (frequency) {
    case 'daily':
      return addDays(date, interval);
    case 'weekly':
      return addDays(date, 7 * interval);
    case 'monthly':
      return addMonths(date, interval, anchorDay);
    case 'quarterly':
      return addMonths(date, 3 * interval, anchorDay);
    case 'yearly':
      return addMonths(date, 12 * interval, anchorDay);
  }
}

/** All occurrence dates from `start` (inclusive) up to `until` (inclusive), optionally stopping at `end`. */
export function occurrences(
  start: string,
  frequency: Frequency,
  interval: number,
  until: string,
  end?: string | null,
  limit = 500,
  anchorDay?: number,
): string[] {
  const out: string[] = [];
  const anchor = anchorDay ?? Number(start.slice(8, 10));
  let d = start;
  while (d <= until && (!end || d <= end) && out.length < limit) {
    out.push(d);
    d = nextOccurrence(d, frequency, interval, anchor);
  }
  return out;
}

export interface ScheduleRow {
  seq: number;
  dueDate: string;
  amount: number;
}

/**
 * Installment schedule: `count` payments of equal size starting at `firstDue`.
 * Rounding differences go to the last payment so the schedule sums exactly to `total`.
 */
export function installmentSchedule(total: number, count: number, firstDue: string, frequency: Frequency = 'monthly'): ScheduleRow[] {
  if (count < 1 || total <= 0) return [];
  const base = Math.floor(total / count);
  const anchor = Number(firstDue.slice(8, 10));
  const rows: ScheduleRow[] = [];
  let due = firstDue;
  for (let i = 1; i <= count; i++) {
    rows.push({ seq: i, dueDate: due, amount: i === count ? total - base * (count - 1) : base });
    due = nextOccurrence(due, frequency, 1, anchor);
  }
  return rows;
}

/** Complete calendar months from a to b (Jan 15 → Mar 14 = 1, Jan 15 → Mar 15 = 2). Never negative. */
export function wholeMonthsBetween(a: string, b: string): number {
  if (b <= a) return 0;
  let m = monthsBetween(a.slice(0, 7), b.slice(0, 7));
  if (addMonths(a, m) > b) m--;
  return Math.max(0, m);
}

export interface GoalForecastInput {
  target: number;
  current: number;
  /** Observed or planned saving per month for this goal. */
  monthlyRate: number;
  /** Extra monthly amount for what-if scenarios. */
  extraMonthly?: number;
  today: string;
  deadline?: string | null;
}

export interface GoalForecast {
  remaining: number;
  progress: number;
  /** Months needed at the given rate (null = never at this rate). */
  monthsToTarget: number | null;
  /** Estimated completion date (null = never). */
  eta: string | null;
  /** Required saving per month to hit the deadline (null when no deadline). */
  requiredMonthly: number | null;
  monthsToDeadline: number | null;
  onTrack: boolean | null;
  achieved: boolean;
}

export function goalForecast(i: GoalForecastInput): GoalForecast {
  const remaining = Math.max(0, i.target - i.current);
  const progress = i.target > 0 ? Math.min(1, Math.max(0, i.current / i.target)) : 0;
  const rate = i.monthlyRate + (i.extraMonthly ?? 0);
  const achieved = remaining === 0;
  const monthsToTarget = achieved ? 0 : rate > 0 ? Math.ceil(remaining / rate) : null;
  const eta = monthsToTarget === null ? null : addMonths(i.today, monthsToTarget);
  let monthsToDeadline: number | null = null;
  let requiredMonthly: number | null = null;
  if (i.deadline) {
    monthsToDeadline = wholeMonthsBetween(i.today, i.deadline);
    // Less than a month left (or overdue): everything remaining is needed now.
    requiredMonthly = achieved ? 0 : Math.ceil(remaining / Math.max(1, monthsToDeadline));
  }
  const onTrack = achieved ? true : i.deadline ? (eta !== null && eta <= i.deadline) : null;
  return { remaining, progress, monthsToTarget, eta, requiredMonthly, monthsToDeadline, onTrack, achieved };
}

export interface BudgetLineStatus {
  budget: number;
  actual: number;
  remaining: number;
  /** actual / budget (can exceed 1). */
  used: number;
  /** End-of-month projection at the current daily pace (equals actual for past months). */
  projected: number;
  status: 'ok' | 'warning' | 'over';
}

/**
 * Budget vs actual for a month. `today` decides how much of the month has elapsed:
 * past months are final, future months have no actuals.
 */
export function budgetStatus(budget: number, actual: number, month: string, today: string): BudgetLineStatus {
  const totalDays = daysInMonth(month);
  const curMonth = today.slice(0, 7);
  let projected = actual;
  if (month === curMonth) {
    const elapsed = Number(today.slice(8, 10));
    projected = Math.round((actual / elapsed) * totalDays);
  }
  const used = budget > 0 ? actual / budget : actual > 0 ? Infinity : 0;
  const status = used > 1 ? 'over' : used >= 0.8 || (month === curMonth && projected > budget && budget > 0) ? 'warning' : 'ok';
  return { budget, actual, remaining: budget - actual, used, projected, status };
}

/** Savings rate = (income − expenses) / income, null when there is no income. */
export function savingsRate(income: number, expenses: number): number | null {
  return income > 0 ? (income - expenses) / income : null;
}
