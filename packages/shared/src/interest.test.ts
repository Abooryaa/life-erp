import { describe, expect, it } from 'vitest';
import { accrueDaily, creditDateIn, creditDatesBetween, nextCreditDate, periodInterest, rateOn } from './interest';

const rates = [
  { effectiveFrom: '2026-01-01', annualRate: 18.25 },
  { effectiveFrom: '2026-03-01', annualRate: 36.5 },
];

describe('interest maths', () => {
  it('uses the rate valid on each day', () => {
    expect(rateOn(rates, '2025-12-31')).toBe(0);
    expect(rateOn(rates, '2026-02-28')).toBe(18.25);
    expect(rateOn(rates, '2026-03-01')).toBe(36.5);
  });

  it('daily crediting compounds: each day earns on the previous days’ interest', () => {
    // 1,000,000.00 at 36.5% = 1,000.00 per day on the first day.
    const r = accrueDaily({ opening: 100_000_000, deltas: [], rates: [{ effectiveFrom: '2026-01-01', annualRate: 36.5 }], from: '2026-01-01', to: '2026-01-03' });
    expect(r.credits.map((c) => c.amount)).toEqual([100_000, 100_100, 100_200]);
    expect(r.closing).toBe(100_000_000 + 300_300);
  });

  it('daily: deposits count from their day, negative balances earn nothing, tiny amounts round to zero', () => {
    const r = accrueDaily({
      opening: -5_000,
      deltas: [{ date: '2026-01-02', amount: 3_650_000 + 5_000 }],
      rates: [{ effectiveFrom: '2026-01-01', annualRate: 10 }],
      from: '2026-01-01',
      to: '2026-01-02',
    });
    expect(r.credits).toEqual([{ date: '2026-01-02', amount: 1_000, balance: 3_650_000, rate: 10 }]);
    expect(accrueDaily({ opening: 100, deltas: [], rates, from: '2026-01-01', to: '2026-01-01' }).credits).toEqual([]);
  });

  it('monthly on daily balances vs on the lowest balance', () => {
    const input = {
      opening: 3_650_000, // 36,500.00
      deltas: [{ date: '2026-01-11', amount: -1_825_000 }], // half withdrawn on day 11
      rates: [{ effectiveFrom: '2026-01-01', annualRate: 10 }],
      from: '2026-01-01',
      to: '2026-01-31',
    };
    // 10 days earn 10.00/day, 21 days earn 5.00/day.
    expect(periodInterest({ ...input, method: 'daily_balance' })).toMatchObject({ amount: 10 * 1_000 + 21 * 500, days: 31 });
    expect(periodInterest({ ...input, method: 'min_balance' })).toMatchObject({ amount: 31 * 500, lowestBalance: 1_825_000 });
  });

  it('a rate change inside the month is applied day by day', () => {
    const r = periodInterest({ opening: 3_650_000, deltas: [], rates: [{ effectiveFrom: '2026-01-01', annualRate: 10 }, { effectiveFrom: '2026-01-16', annualRate: 20 }], from: '2026-01-01', to: '2026-01-31', method: 'daily_balance' });
    expect(r.amount).toBe(15 * 1_000 + 16 * 2_000);
  });

  it('credit dates, including day 31 in short months', () => {
    expect(creditDateIn('2026-02', 31)).toBe('2026-02-28');
    expect(creditDateIn('2026-04', 15)).toBe('2026-04-15');
    expect(creditDatesBetween('2026-01-31', '2026-04-30', 31)).toEqual(['2026-02-28', '2026-03-31', '2026-04-30']);
    expect(creditDatesBetween('2026-01-01', '2026-02-01', 1)).toEqual(['2026-02-01']);
    expect(nextCreditDate('2026-10-03', 1)).toBe('2026-11-01');
    expect(nextCreditDate('2026-10-01', 1)).toBe('2026-10-01');
  });
});
