import { describe, expect, it } from 'vitest';
import { addMonths, monthEnd } from './dates';
import { budgetStatus, goalForecast, installmentSchedule, nextOccurrence, occurrences, savingsRate, signedAmount, wholeMonthsBetween } from './finance';

describe('signedAmount', () => {
  it('derives the balance effect from the type', () => {
    expect(signedAmount('income', 500)).toBe(500);
    expect(signedAmount('expense', 500)).toBe(-500);
    expect(signedAmount('refund', 500)).toBe(500);
    expect(signedAmount('adjustment', 500, 'in')).toBe(500);
    expect(signedAmount('adjustment', 500, 'out')).toBe(-500);
    expect(signedAmount('transfer', -500, 'in')).toBe(500);
  });
});

describe('dates & recurrence', () => {
  it('clamps month-ends and keeps the anchor day', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(nextOccurrence('2026-02-28', 'monthly', 1, 31)).toBe('2026-03-31');
    expect(monthEnd('2026-02')).toBe('2026-02-28');
  });

  it('lists occurrences up to a date and respects an end date', () => {
    expect(occurrences('2026-01-31', 'monthly', 1, '2026-05-01')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(occurrences('2026-01-01', 'weekly', 2, '2026-02-01')).toEqual(['2026-01-01', '2026-01-15', '2026-01-29']);
    expect(occurrences('2026-01-01', 'monthly', 1, '2026-12-31', '2026-03-15')).toHaveLength(3);
    expect(occurrences('2026-01-01', 'yearly', 1, '2028-06-01')).toEqual(['2026-01-01', '2027-01-01', '2028-01-01']);
  });

  it('counts whole months', () => {
    expect(wholeMonthsBetween('2026-01-15', '2026-03-14')).toBe(1);
    expect(wholeMonthsBetween('2026-01-15', '2026-03-15')).toBe(2);
    expect(wholeMonthsBetween('2026-03-01', '2026-01-01')).toBe(0);
  });
});

describe('installmentSchedule', () => {
  it('splits evenly and puts rounding on the last payment so the total is exact', () => {
    const s = installmentSchedule(100_000, 3, '2026-01-31');
    expect(s.map((r) => r.amount)).toEqual([33_333, 33_333, 33_334]);
    expect(s.reduce((a, r) => a + r.amount, 0)).toBe(100_000);
    expect(s.map((r) => r.dueDate)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });

  it('handles a 24-month car installment', () => {
    const s = installmentSchedule(48_000_000, 24, '2026-11-05');
    expect(s).toHaveLength(24);
    expect(s.every((r) => r.amount === 2_000_000)).toBe(true);
    expect(s[23].dueDate).toBe('2028-10-05');
  });

  it('returns nothing for invalid input', () => {
    expect(installmentSchedule(0, 3, '2026-01-01')).toEqual([]);
    expect(installmentSchedule(100, 0, '2026-01-01')).toEqual([]);
  });
});

describe('goalForecast', () => {
  it('answers "when will I reach it at my current rate?"', () => {
    // 100,000 EGP target, 40,000 saved, saving 5,000/month → 12 months.
    const f = goalForecast({ target: 10_000_000, current: 4_000_000, monthlyRate: 500_000, today: '2026-10-02' });
    expect(f.remaining).toBe(6_000_000);
    expect(f.progress).toBeCloseTo(0.4);
    expect(f.monthsToTarget).toBe(12);
    expect(f.eta).toBe('2027-10-02');
  });

  it('answers "what if I save 5,000 more per month?" without touching real data', () => {
    const f = goalForecast({ target: 10_000_000, current: 4_000_000, monthlyRate: 500_000, extraMonthly: 500_000, today: '2026-10-02' });
    expect(f.monthsToTarget).toBe(6);
    expect(f.eta).toBe('2027-04-02');
  });

  it('computes the monthly amount needed for a deadline and whether it is on track', () => {
    const f = goalForecast({ target: 1_200_000, current: 0, monthlyRate: 50_000, today: '2026-01-01', deadline: '2027-01-01' });
    expect(f.monthsToDeadline).toBe(12);
    expect(f.requiredMonthly).toBe(100_000);
    expect(f.onTrack).toBe(false);
    const ok = goalForecast({ target: 1_200_000, current: 0, monthlyRate: 100_000, today: '2026-01-01', deadline: '2027-01-01' });
    expect(ok.onTrack).toBe(true);
  });

  it('never reaches the target with no saving, and handles achieved goals', () => {
    expect(goalForecast({ target: 100, current: 0, monthlyRate: 0, today: '2026-01-01' }).eta).toBeNull();
    const done = goalForecast({ target: 100, current: 150, monthlyRate: 0, today: '2026-01-01', deadline: '2025-01-01' });
    expect(done).toMatchObject({ achieved: true, remaining: 0, progress: 1, onTrack: true, requiredMonthly: 0 });
  });

  it('asks for everything remaining when the deadline has passed', () => {
    const f = goalForecast({ target: 1000, current: 400, monthlyRate: 10, today: '2026-06-01', deadline: '2026-05-01' });
    expect(f.requiredMonthly).toBe(600);
    expect(f.onTrack).toBe(false);
  });
});

describe('budgetStatus', () => {
  it('projects the current month at the daily pace', () => {
    // 10 days into a 30-day month, spent 3,000 of 6,000 → projected 9,000 → warning.
    const s = budgetStatus(600_000, 300_000, '2026-09', '2026-09-10');
    expect(s.projected).toBe(900_000);
    expect(s.remaining).toBe(300_000);
    expect(s.used).toBeCloseTo(0.5);
    expect(s.status).toBe('warning');
  });

  it('is final for past months and flags overspending', () => {
    const s = budgetStatus(100_000, 120_000, '2026-08', '2026-09-10');
    expect(s.projected).toBe(120_000);
    expect(s.status).toBe('over');
    expect(budgetStatus(100_000, 50_000, '2026-08', '2026-09-10').status).toBe('ok');
  });
});

describe('savingsRate', () => {
  it('is (income − expenses) / income', () => {
    expect(savingsRate(1000, 750)).toBeCloseTo(0.25);
    expect(savingsRate(1000, 1200)).toBeCloseTo(-0.2);
    expect(savingsRate(0, 100)).toBeNull();
  });
});
