import { addDays, addMonthsToMonth, monthEnd, monthStart } from './dates';

/** Day of week, 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** First day of the week that contains `date`. */
export function weekStartOf(date: string, weekStart: number): string {
  return addDays(date, -((dayOfWeek(date) - weekStart + 7) % 7));
}

export interface Period {
  start: string;
  end: string;
}

export function reviewPeriod(type: 'weekly' | 'monthly', start: string): Period {
  return type === 'weekly' ? { start, end: addDays(start, 6) } : { start: monthStart(start), end: monthEnd(start) };
}

/**
 * The period a review done on `today` should cover: the latest week/month that has already
 * ended — or ends today. A Saturday review with Saturday weeks covers last Sat–Fri.
 */
export function defaultReviewPeriod(type: 'weekly' | 'monthly', today: string, weekStart: number): Period {
  if (type === 'weekly') {
    const current = weekStartOf(today, weekStart);
    const start = addDays(current, 6) <= today ? current : addDays(current, -7);
    return reviewPeriod('weekly', start);
  }
  const month = monthEnd(today) === today ? today.slice(0, 7) : addMonthsToMonth(today.slice(0, 7), -1);
  return reviewPeriod('monthly', monthStart(month));
}

export function previousPeriod(type: 'weekly' | 'monthly', p: Period): Period {
  return type === 'weekly' ? reviewPeriod('weekly', addDays(p.start, -7)) : reviewPeriod('monthly', monthStart(addMonthsToMonth(p.start.slice(0, 7), -1)));
}

export interface ScenarioAdjustment {
  label: string;
  /** Minor units, signed. */
  amount: number;
  kind: 'monthly' | 'once';
  startMonth: number;
  endMonth?: number | null;
}

export interface ScenarioMonth {
  index: number;
  month: string;
  income: number;
  expenses: number;
  net: number;
  balance: number;
  items: { label: string; amount: number }[];
}

/**
 * Month-by-month cash projection: a baseline income/expense plus your adjustments.
 * Pure arithmetic on the numbers given — nothing is estimated beyond them.
 */
export function projectScenario(input: { firstMonth: string; horizon: number; startBalance: number; monthlyIncome: number; monthlyExpenses: number; adjustments: ScenarioAdjustment[] }) {
  const months: ScenarioMonth[] = [];
  let balance = input.startBalance;
  let lowest = { month: input.firstMonth, balance: input.startBalance };
  let firstNegative: string | null = null;
  for (let i = 1; i <= input.horizon; i++) {
    const month = addMonthsToMonth(input.firstMonth, i - 1);
    let income = input.monthlyIncome;
    let expenses = input.monthlyExpenses;
    const items: { label: string; amount: number }[] = [];
    for (const a of input.adjustments) {
      const active = a.kind === 'once' ? i === a.startMonth : i >= a.startMonth && (a.endMonth == null || i <= a.endMonth);
      if (!active) continue;
      if (a.amount >= 0) income += a.amount;
      else expenses += -a.amount;
      items.push({ label: a.label, amount: a.amount });
    }
    const net = income - expenses;
    balance += net;
    months.push({ index: i, month, income, expenses, net, balance, items });
    if (balance < lowest.balance) lowest = { month, balance };
    if (balance < 0 && !firstNegative) firstNegative = month;
  }
  return { months, endBalance: balance, lowest, firstNegative };
}
