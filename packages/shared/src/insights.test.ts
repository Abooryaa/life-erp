import { describe, expect, it } from 'vitest';
import { dayOfWeek, defaultReviewPeriod, previousPeriod, projectScenario, weekStartOf } from './insights';

describe('review periods', () => {
  it('finds the week start for Saturday weeks', () => {
    expect(dayOfWeek('2026-10-03')).toBe(6); // Saturday
    expect(weekStartOf('2026-10-03', 6)).toBe('2026-10-03');
    expect(weekStartOf('2026-10-02', 6)).toBe('2026-09-26');
  });
  it('a Saturday or Sunday review covers last Sat–Fri; a Friday review covers the week ending today', () => {
    expect(defaultReviewPeriod('weekly', '2026-10-03', 6)).toEqual({ start: '2026-09-26', end: '2026-10-02' });
    expect(defaultReviewPeriod('weekly', '2026-10-04', 6)).toEqual({ start: '2026-09-26', end: '2026-10-02' });
    expect(defaultReviewPeriod('weekly', '2026-10-02', 6)).toEqual({ start: '2026-09-26', end: '2026-10-02' });
  });
  it('monthly review covers the last finished month', () => {
    expect(defaultReviewPeriod('monthly', '2026-10-02', 6)).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    expect(defaultReviewPeriod('monthly', '2026-09-30', 6)).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    expect(previousPeriod('monthly', { start: '2026-03-01', end: '2026-03-31' })).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(previousPeriod('weekly', { start: '2026-09-26', end: '2026-10-02' })).toEqual({ start: '2026-09-19', end: '2026-09-25' });
  });
});

describe('scenario projection', () => {
  it('applies baseline, recurring and one-off adjustments', () => {
    const r = projectScenario({
      firstMonth: '2026-11',
      horizon: 4,
      startBalance: 10_000,
      monthlyIncome: 5_000,
      monthlyExpenses: 4_000,
      adjustments: [
        { label: 'Car', amount: -15_000, kind: 'once', startMonth: 2 },
        { label: 'Raise', amount: 1_000, kind: 'monthly', startMonth: 3 },
        { label: 'Course', amount: -500, kind: 'monthly', startMonth: 1, endMonth: 2 },
      ],
    });
    expect(r.months.map((m) => m.balance)).toEqual([10_500, -4_000, -2_000, 0]);
    expect(r.months[1]).toMatchObject({ month: '2026-12', expenses: 19_500, income: 5_000 });
    expect(r.firstNegative).toBe('2026-12');
    expect(r.lowest).toEqual({ month: '2026-12', balance: -4_000 });
    expect(r.endBalance).toBe(0);
  });
});
