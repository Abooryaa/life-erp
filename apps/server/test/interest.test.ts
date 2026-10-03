import { accrueDaily, addDays, addMonthsToMonth, creditDatesBetween, daysInMonth, monthStart } from '@life-erp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAllInterest } from '../src/modules/finance/interest';
import { todayLocal } from '../src/modules/finance/jobs';
import { call, json, makeApp, type TestCtx } from './helpers';

let ctx: TestCtx;
let today: string;

const post = async (url: string, body?: unknown, expectStatus = 200) => {
  const r = await call(ctx, 'POST', url, body);
  if (r.statusCode !== expectStatus) throw new Error(`${url} → ${r.statusCode}: ${r.body}`);
  return json(r);
};
const put = async (url: string, body: unknown, expectStatus = 200) => {
  const r = await call(ctx, 'PUT', url, body);
  if (r.statusCode !== expectStatus) throw new Error(`${url} → ${r.statusCode}: ${r.body}`);
  return json(r);
};
const get = async (url: string) => json(await call(ctx, 'GET', url));
const interestTx = async (accountId: string) => (await get(`/api/finance/transactions?accountId=${accountId}&limit=1000`)).items.filter((t: any) => t.interestThrough) as any[];
const balance = async (id: string) => (await get(`/api/finance/accounts/${id}`)).balance as number;

beforeAll(async () => {
  ctx = await makeApp();
  today = todayLocal();
});
afterAll(async () => ctx.close());

describe('daily interest', () => {
  let acct: any;
  const start = () => addDays(today, -10);

  it('credits every finished day, compounding, and catches up missed days', async () => {
    // 36,500.00 at 10% a year = 10.00 a day.
    acct = await post('/api/finance/accounts', { name: 'Daily saver', type: 'savings', openingBalance: '36,500', openingDate: addDays(today, -30) });
    const i = await put(`/api/finance/accounts/${acct.id}/interest`, { frequency: 'daily', startDate: start(), annualRate: 10 });
    expect(i).toMatchObject({ configured: true, frequency: 'daily', currentRate: 10, accruedThrough: addDays(today, -1) });
    const txs = await interestTx(acct.id);
    expect(txs).toHaveLength(10); // today isn't finished yet
    const expected = accrueDaily({ opening: 3_650_000, deltas: [], rates: [{ effectiveFrom: start(), annualRate: 10 }], from: start(), to: addDays(today, -1) });
    expect(txs.map((t) => t.amount).sort((a: number, b: number) => a - b)).toEqual(expected.credits.map((c) => c.amount).sort((a, b) => a - b));
    expect(txs.every((t) => t.type === 'income' && t.categoryName === 'Bank interest')).toBe(true);
    expect(await balance(acct.id)).toBe(expected.closing);
    expect(i.earnedTotal).toBe(expected.closing - 3_650_000);
  });

  it('running again credits nothing twice', async () => {
    runAllInterest();
    runAllInterest();
    expect(await interestTx(acct.id)).toHaveLength(10);
  });

  it('a backdated rate change applies after “recalculate”', async () => {
    const r = await post(`/api/finance/accounts/${acct.id}/interest/rates`, { effectiveFrom: addDays(today, -5), annualRate: 20 });
    expect(r.alreadyCredited).toBe(true);
    expect(r.rates.map((x: any) => x.annualRate)).toEqual([10, 20]);
    const re = await post(`/api/finance/accounts/${acct.id}/interest/recalculate`, { from: addDays(today, -5) });
    expect(re).toMatchObject({ removed: 5, credited: 5 });
    const rates = [
      { effectiveFrom: start(), annualRate: 10 },
      { effectiveFrom: addDays(today, -5), annualRate: 20 },
    ];
    const expected = accrueDaily({ opening: 3_650_000, deltas: [], rates, from: start(), to: addDays(today, -1) });
    expect(await balance(acct.id)).toBe(expected.closing);
    expect(await interestTx(acct.id)).toHaveLength(10);
  });

  it('a withdrawal stops interest on that money from that day', async () => {
    const cats = await get('/api/finance/categories');
    // Take everything out 3 days ago, then recalculate from there.
    const bal = await balance(acct.id);
    await post('/api/finance/transactions', { type: 'expense', date: addDays(today, -3), amount: (bal / 100).toFixed(2), accountId: acct.id, categoryId: cats.find((c: any) => c.kind === 'expense').id, allowDuplicate: true });
    await post(`/api/finance/accounts/${acct.id}/interest/recalculate`, { from: addDays(today, -3) });
    const after = await interestTx(acct.id);
    // Interest from the 3rd-last day on is only earned on the little interest credited after the withdrawal date.
    expect(after.filter((t) => t.date >= addDays(today, -3)).every((t) => t.amount < 10)).toBe(true);
  });
});

describe('monthly interest', () => {
  it('credits on the credit day for the days since the last credit (daily balances)', async () => {
    const startMonth = addMonthsToMonth(today.slice(0, 7), -3);
    const start = monthStart(startMonth);
    const a = await post('/api/finance/accounts', { name: 'Monthly saver', type: 'bank', openingBalance: '36500', openingDate: start });
    const i = await put(`/api/finance/accounts/${a.id}/interest`, { frequency: 'monthly', creditDay: 1, startDate: start, annualRate: 10 });
    const txs = (await interestTx(a.id)).sort((x, y) => x.date.localeCompare(y.date));
    const credits = creditDatesBetween(start, today, 1);
    expect(txs.map((t) => t.date)).toEqual(credits);
    // First month: balance unchanged all month → exactly 10.00 per day.
    expect(txs[0].amount).toBe(daysInMonth(startMonth) * 1_000);
    expect(txs[0].interestThrough).toBe(addDays(credits[0], -1));
    // Later months also earn on the interest already credited.
    expect(txs[1].amount).toBeGreaterThanOrEqual(daysInMonth(addMonthsToMonth(startMonth, 1)) * 1_000);
    expect(i.pending.creditDate > today || i.pending.creditDate === today).toBe(true);
    const n = (await get('/api/notifications')).items.filter((x: any) => x.title.startsWith('Interest credited'));
    expect(n).toHaveLength(credits.length);
  });

  it('lowest-balance method pays on the lowest balance of the period', async () => {
    const startMonth = addMonthsToMonth(today.slice(0, 7), -2);
    const start = monthStart(startMonth);
    const a = await post('/api/finance/accounts', { name: 'Lowest balance saver', type: 'savings', openingBalance: '36500', openingDate: start });
    const cats = await get('/api/finance/categories');
    await post('/api/finance/transactions', { type: 'expense', date: addDays(start, 10), amount: '18250', accountId: a.id, categoryId: cats.find((c: any) => c.kind === 'expense').id });
    await put(`/api/finance/accounts/${a.id}/interest`, { frequency: 'monthly', method: 'min_balance', creditDay: 31, startDate: start, annualRate: 10 });
    const first = (await interestTx(a.id)).sort((x, y) => x.date.localeCompare(y.date))[0];
    // Credited on the last day of the month, for the days before it, on 18,250.00 (= 5.00 a day).
    const days = daysInMonth(startMonth) - 1;
    expect(first.date).toBe(`${startMonth}-${String(daysInMonth(startMonth)).padStart(2, '0')}`);
    expect(first.amount).toBe(days * 500);
  });
});

describe('rules and safety', () => {
  it('validates setup', async () => {
    const card = await post('/api/finance/accounts', { name: 'Card', type: 'credit_card' });
    expect((await call(ctx, 'PUT', `/api/finance/accounts/${card.id}/interest`, { frequency: 'daily', startDate: today, annualRate: 5 })).statusCode).toBe(400);
    const a = await post('/api/finance/accounts', { name: 'Plain', type: 'bank' });
    expect((await call(ctx, 'PUT', `/api/finance/accounts/${a.id}/interest`, { frequency: 'daily', startDate: today })).statusCode).toBe(400);
    expect((await call(ctx, 'PUT', `/api/finance/accounts/${a.id}/interest`, { frequency: 'daily', startDate: today, annualRate: 150 })).statusCode).toBe(400);
    const expenseCat = (await get('/api/finance/categories')).find((c: any) => c.kind === 'expense');
    expect((await call(ctx, 'PUT', `/api/finance/accounts/${a.id}/interest`, { frequency: 'daily', startDate: today, annualRate: 5, categoryId: expenseCat.id })).statusCode).toBe(400);
    expect((await get(`/api/finance/accounts/${a.id}/interest`)).configured).toBe(false);
  });

  it('pausing stops crediting; removing keeps credited interest', async () => {
    const a = await post('/api/finance/accounts', { name: 'Pause test', type: 'savings', openingBalance: '36500', openingDate: addDays(today, -20) });
    await put(`/api/finance/accounts/${a.id}/interest`, { frequency: 'daily', startDate: addDays(today, -4), annualRate: 10 });
    expect(await interestTx(a.id)).toHaveLength(4);
    await put(`/api/finance/accounts/${a.id}/interest`, { enabled: false, frequency: 'daily', startDate: addDays(today, -4) });
    expect((await get('/api/finance/accounts')).find((x: any) => x.id === a.id).interest).toBeNull();
    await call(ctx, 'DELETE', `/api/finance/accounts/${a.id}/interest`);
    expect(await interestTx(a.id)).toHaveLength(4);
    expect((await get(`/api/finance/accounts/${a.id}/interest`)).configured).toBe(false);
  });

  it('the account list shows the current rate', async () => {
    const list = await get('/api/finance/accounts');
    expect(list.find((x: any) => x.name === 'Daily saver').interest).toEqual({ rate: 20, frequency: 'daily' });
  });
});
