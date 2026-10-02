import { addDays, dayOfWeek, defaultReviewPeriod } from '@life-erp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runReviewReminders } from '../src/modules/insights/jobs';
import { today as todayFn } from '../src/modules/life/common';
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

beforeAll(async () => {
  ctx = await makeApp();
  today = todayFn();
  await post('/api/finance/accounts', { name: 'Wallet', type: 'cash', openingBalance: '10,000' });
});
afterAll(async () => ctx.close());

describe('assets & net worth', () => {
  let flat: any;
  it('needs a current value and records purchase price + today as valuations', async () => {
    expect((await call(ctx, 'POST', '/api/assets', { name: 'Flat', type: 'real_estate' })).statusCode).toBe(400);
    expect((await call(ctx, 'POST', '/api/assets', { name: 'Flat', type: 'real_estate', currentValue: '1', purchaseDate: addDays(today, 5) })).statusCode).toBe(400);
    flat = await post('/api/assets', { name: 'Flat', type: 'real_estate', purchaseDate: '2020-01-01', purchasePrice: '1,000,000', currentValue: '2,500,000' });
    expect(flat).toMatchObject({ value: 250_000_000, gain: 150_000_000, gainRatio: 1.5, liquidity: 'non_liquid' });
    expect(flat.valuations).toHaveLength(2);
    await post('/api/assets', { name: 'Gold', type: 'gold', liquidity: 'liquid', quantity: 50, unit: 'g', currentValue: '200000' });
  });

  it('counts assets in net worth and keeps a daily snapshot', async () => {
    const nw = await get('/api/net-worth');
    expect(nw.now).toMatchObject({ liquid: 1_000_000, investments: 20_000_000, physicalAssets: 250_000_000, netWorth: 271_000_000 });
    expect(nw.history.at(-1)).toMatchObject({ date: today, netWorth: 271_000_000 });
  });

  it('valuations change the value; a future-dated valuation does not count yet', async () => {
    await post(`/api/assets/${flat.id}/valuations`, { date: addDays(today, 30), value: '9,000,000' });
    expect((await get(`/api/assets/${flat.id}`)).value).toBe(250_000_000);
    const v = await post(`/api/assets/${flat.id}/valuations`, { date: today, value: '2,600,000' });
    expect(v.value).toBe(260_000_000);
    expect((await call(ctx, 'PUT', `/api/assets/${flat.id}`, { currency: 'USD' })).statusCode).toBe(400);
  });

  it('a sold asset stops counting but keeps its history; it can be undone', async () => {
    await post(`/api/assets/${flat.id}/dispose`, { date: today, value: '2,700,000' });
    expect((await get('/api/assets')).map((a: any) => a.name)).toEqual(['Gold']);
    expect((await get('/api/net-worth')).now.physicalAssets).toBe(0);
    const sold = (await get('/api/assets?disposed=1')).find((a: any) => a.name === 'Flat');
    expect(sold).toMatchObject({ value: 0, disposedValue: 270_000_000, gain: 170_000_000 });
    expect((await json(await call(ctx, 'DELETE', `/api/assets/${flat.id}/dispose`))).disposedAt).toBeNull();
    expect((await get('/api/net-worth')).now.physicalAssets).toBe(260_000_000);
  });
});

describe('reviews', () => {
  it('drafts the default period with live numbers', async () => {
    const t = await post('/api/tasks', { title: 'Done this week', status: 'planned', dueDate: today });
    await put(`/api/tasks/${t.id}`, { status: 'done' });
    const cat = (await get('/api/finance/categories')).find((c: any) => c.kind === 'expense');
    await post('/api/finance/transactions', { type: 'expense', date: today, amount: '250', accountId: (await get('/api/finance/accounts'))[0].id, categoryId: cat.id });
    const r = await get(`/api/reviews/weekly?start=${today}`);
    expect(r.id).toBeNull();
    expect(dayOfWeek(r.periodStart)).toBe(6); // weeks start on Saturday by default
    expect(r.periodEnd).toBe(addDays(r.periodStart, 6));
    expect(r.metrics.tasks.completed).toBe(1);
    expect(r.metrics.money.expenses).toBe(25_000);
    const def = await get('/api/reviews/monthly');
    expect(def.periodStart).toBe(defaultReviewPeriod('monthly', today, 6).start);
  });

  it('saves a draft, then completes it with frozen numbers — one review per period', async () => {
    const draft = await put('/api/reviews', { type: 'weekly', periodStart: today, wins: 'Shipped career', priorities: 'Insights phase' });
    expect(draft).toMatchObject({ completedAt: null, savedMetrics: null, wins: 'Shipped career' });
    const done = await put('/api/reviews', { type: 'weekly', periodStart: addDays(today, -1) >= draft.periodStart ? addDays(today, -1) : today, wins: 'Shipped career', rating: 4, completed: true });
    expect(done.id).toBe(draft.id);
    expect(done.completedAt).not.toBeNull();
    expect(done.savedMetrics.tasks.completed).toBe(1);
    // More work after completing doesn't change the frozen numbers…
    const t2 = await post('/api/tasks', { title: 'Late extra', status: 'planned' });
    await put(`/api/tasks/${t2.id}`, { status: 'done' });
    const edited = await put('/api/reviews', { type: 'weekly', periodStart: today, wins: 'Edited', completed: true });
    expect(edited.savedMetrics.tasks.completed).toBe(1);
    expect(edited.metrics.tasks.completed).toBe(2);
    // …reopening returns to live numbers, and completing again re-freezes them.
    expect((await put('/api/reviews', { type: 'weekly', periodStart: today, completed: false })).savedMetrics).toBeNull();
    expect((await put('/api/reviews', { type: 'weekly', periodStart: today, wins: 'Shipped career', completed: true })).savedMetrics.tasks.completed).toBe(2);
    expect((await get('/api/reviews?type=weekly'))).toHaveLength(1);
    expect((await call(ctx, 'PUT', '/api/reviews', { type: 'weekly', periodStart: addDays(today, 14) })).statusCode).toBe(400);
    expect((await call(ctx, 'PUT', '/api/reviews', { type: 'weekly', periodStart: today, rating: 9 })).statusCode).toBe(400);
  });

  it('next week sees last week’s priorities', async () => {
    const draft = await get(`/api/reviews/weekly?start=${today}`);
    await put('/api/reviews', { type: 'weekly', periodStart: addDays(draft.periodStart, -7), priorities: 'Finish phase 4' });
    expect((await get(`/api/reviews/weekly?start=${today}`)).previousPriorities).toBe('Finish phase 4');
  });

  it('reminds on the review day only until the review is done', async () => {
    // The current week's review is done (above), so look two Saturdays ahead: that week has no review yet.
    let sat = addDays(today, 1);
    while (dayOfWeek(sat) !== 6) sat = addDays(sat, 1);
    runReviewReminders(sat);
    expect((await get('/api/notifications')).items.filter((x: any) => x.title === 'Time for your weekly review')).toHaveLength(0);
    sat = addDays(sat, 7);
    runReviewReminders(sat);
    runReviewReminders(sat);
    runReviewReminders(addDays(sat, 1)); // Sunday: not the review day
    const n = await get('/api/notifications');
    expect(n.items.filter((x: any) => x.title === 'Time for your weekly review')).toHaveLength(1);
  });
});

describe('scenarios', () => {
  it('projects from explicit numbers and adjustments', async () => {
    expect((await call(ctx, 'POST', '/api/scenarios', { name: 'Bad', adjustments: [{ label: 'x', amount: '1', kind: 'monthly', startMonth: 3, endMonth: 2 }] })).statusCode).toBe(400);
    const s = await post('/api/scenarios', {
      name: 'Buy a car',
      horizonMonths: 6,
      startBalance: '100,000',
      monthlyIncome: '40000',
      monthlyExpenses: '30000',
      adjustments: [
        { label: 'Car down payment', amount: '-150,000', kind: 'once', startMonth: 2 },
        { label: 'Car instalment', amount: '-8000', kind: 'monthly', startMonth: 2 },
      ],
    });
    expect(s.result.months).toHaveLength(6);
    expect(s.result.months[0].balance).toBe(11_000_000);
    expect(s.result.firstNegative).toBe(s.result.months[1].month);
    expect(s.result.endBalance).toBe(10_000_000 + 6 * 1_000_000 - 15_000_000 - 5 * 800_000);
    const upd = await put(`/api/scenarios/${s.id}`, { horizonMonths: 3 });
    expect(upd.adjustments).toHaveLength(2);
    expect(upd.result.months).toHaveLength(3);
  });

  it('falls back to your real numbers when no override is given', async () => {
    const s = await post('/api/scenarios', { name: 'Baseline' });
    expect(s.inputs.startBalance).toBe(s.baseline.startBalance);
    expect(s.baseline.startBalance).toBe(1_000_000 - 25_000);
  });
});

describe('analytics & dashboard', () => {
  it('returns aligned monthly series', async () => {
    const a = await get('/api/analytics?months=6');
    expect(a.months).toHaveLength(6);
    expect(a.months.at(-1)).toBe(today.slice(0, 7));
    expect(a.tasks.done.at(-1)).toBe(2);
    expect(a.money.expenses.at(-1)).toBe(25_000);
    expect(a.netWorth.at(-1)).not.toBeNull();
  });

  it('stores the dashboard layout and rejects unknown widgets', async () => {
    const r = await call(ctx, 'PATCH', '/api/settings', { dashboard: ['networth', 'today'] });
    expect(r.statusCode).toBe(200);
    expect((await get('/api/settings')).dashboard).toEqual(['networth', 'today']);
    expect((await call(ctx, 'PATCH', '/api/settings', { dashboard: ['nope'] })).statusCode).toBe(400);
  });
});
