import { addDays, addMonths } from '@life-erp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runJobsNow } from '../src/jobs/scheduler';
import { todayLocal } from '../src/modules/finance/jobs';
import { call, json, makeApp, type TestCtx } from './helpers';

let ctx: TestCtx;
let today: string;
const P = '/api/finance';

const post = async (url: string, body: unknown, expectStatus = 200) => {
  const r = await call(ctx, 'POST', url, body);
  if (r.statusCode !== expectStatus) throw new Error(`${url} → ${r.statusCode}: ${r.body}`);
  return json(r);
};
const get = async (url: string) => json(await call(ctx, 'GET', url));

let cats: any[];
const cat = (name: string) => cats.find((c) => c.name === name).id;

beforeAll(async () => {
  ctx = await makeApp();
  today = todayLocal();
  cats = await get(`${P}/categories`);
});
afterAll(async () => ctx.close());

describe('categories', () => {
  it('seeds default categories with Arabic names, once', async () => {
    expect(cats.find((c) => c.name === 'Food')).toMatchObject({ kind: 'expense', nameAr: 'الطعام' });
    expect(cats.find((c) => c.name === 'Groceries').parentId).toBe(cat('Food'));
    expect(cats.find((c) => c.name === 'Salary').kind).toBe('income');
  });

  it('lets me create my own categories but rejects duplicates and deep nesting', async () => {
    const mine = await post(`${P}/categories`, { name: 'Pets', nameAr: 'الحيوانات الأليفة', kind: 'expense' });
    expect(mine.name).toBe('Pets');
    expect((await call(ctx, 'POST', `${P}/categories`, { name: 'pets', kind: 'expense' })).statusCode).toBe(409);
    const sub = await post(`${P}/categories`, { name: 'Vet', kind: 'expense', parentId: mine.id });
    expect((await call(ctx, 'POST', `${P}/categories`, { name: 'Deep', kind: 'expense', parentId: sub.id })).statusCode).toBe(400);
    expect((await call(ctx, 'DELETE', `${P}/categories/${mine.id}`)).statusCode).toBe(200);
  });
});

describe('accounts, transactions and transfers', () => {
  let bank: any;
  let cash: any;
  let usd: any;

  it('creates accounts with opening balances', async () => {
    bank = await post(`${P}/accounts`, { name: 'CIB Current', type: 'bank', currency: 'EGP', openingBalance: '10,000.00', institution: 'CIB' });
    cash = await post(`${P}/accounts`, { name: 'Wallet', type: 'cash', currency: 'EGP', openingBalance: '500' });
    usd = await post(`${P}/accounts`, { name: 'USD savings', type: 'savings', currency: 'USD', openingBalance: '0' });
    expect(bank.balance).toBe(1_000_000);
    expect(cash.balance).toBe(50_000);
    expect((await call(ctx, 'POST', `${P}/accounts`, { name: 'cib current', type: 'bank' })).statusCode).toBe(409);
  });

  it('applies the right sign per transaction type', async () => {
    await post(`${P}/transactions`, { type: 'income', date: today, amount: '30000', accountId: bank.id, categoryId: cat('Salary'), payee: 'Employer' });
    await post(`${P}/transactions`, { type: 'expense', date: today, amount: '1250.50', accountId: bank.id, categoryId: cat('Groceries'), payee: 'Carrefour' });
    await post(`${P}/transactions`, { type: 'refund', date: today, amount: '250.50', accountId: bank.id, categoryId: cat('Groceries'), payee: 'Carrefour refund' });
    const a = await get(`${P}/accounts/${bank.id}`);
    expect(a.balance).toBe(1_000_000 + 3_000_000 - 125_050 + 25_050); // 39,000.00
  });

  it('rejects invalid amounts, wrong category kinds and unknown accounts with field errors', async () => {
    const tooPrecise = await call(ctx, 'POST', `${P}/transactions`, { type: 'expense', date: today, amount: '10.123', accountId: bank.id, categoryId: cat('Food') });
    expect(tooPrecise.statusCode).toBe(400);
    expect(json(tooPrecise).error.fields[0].path).toBe('amount');
    const negative = await call(ctx, 'POST', `${P}/transactions`, { type: 'expense', date: today, amount: '-5', accountId: bank.id, categoryId: cat('Food') });
    expect(negative.statusCode).toBe(400);
    const wrongKind = await call(ctx, 'POST', `${P}/transactions`, { type: 'expense', date: today, amount: '5', accountId: bank.id, categoryId: cat('Salary') });
    expect(json(wrongKind).error.fields[0].path).toBe('categoryId');
    const noCat = await call(ctx, 'POST', `${P}/transactions`, { type: 'expense', date: today, amount: '5', accountId: bank.id });
    expect(json(noCat).error.fields[0].path).toBe('categoryId');
    const badDate = await call(ctx, 'POST', `${P}/transactions`, { type: 'expense', date: '2026-02-30', amount: '5', accountId: bank.id, categoryId: cat('Food') });
    expect(badDate.statusCode).toBe(400);
  });

  it('warns about a probable duplicate and saves it only when confirmed', async () => {
    const body = { type: 'expense', date: today, amount: '1250.50', accountId: bank.id, categoryId: cat('Groceries'), payee: 'Carrefour' };
    const dupe = await call(ctx, 'POST', `${P}/transactions`, body);
    expect(dupe.statusCode).toBe(409);
    expect(json(dupe).error.code).toBe('possible_duplicate');
    const ok = await post(`${P}/transactions`, { ...body, allowDuplicate: true });
    await call(ctx, 'DELETE', `${P}/transactions/${ok.id}`);
  });

  it('moves money with transfers that never count as income or expense', async () => {
    const before = await get(`${P}/reports/series?months=1`);
    await post(`${P}/transfers`, { date: today, fromAccountId: bank.id, toAccountId: cash.id, amount: '2000' });
    expect((await get(`${P}/accounts/${bank.id}`)).balance).toBe(3_900_000 - 200_000);
    expect((await get(`${P}/accounts/${cash.id}`)).balance).toBe(50_000 + 200_000);
    const after = await get(`${P}/reports/series?months=1`);
    expect(after.months[0].income).toBe(before.months[0].income);
    expect(after.months[0].expenses).toBe(before.months[0].expenses);
  });

  it('requires the received amount for cross-currency transfers', async () => {
    const r = await call(ctx, 'POST', `${P}/transfers`, { date: today, fromAccountId: bank.id, toAccountId: usd.id, amount: '4850' });
    expect(json(r).error.fields[0].path).toBe('toAmount');
    await post(`${P}/transfers`, { date: today, fromAccountId: bank.id, toAccountId: usd.id, amount: '4850', toAmount: '100' });
    expect((await get(`${P}/accounts/${usd.id}`)).balance).toBe(10_000);
    expect((await call(ctx, 'POST', `${P}/transfers`, { date: today, fromAccountId: bank.id, toAccountId: bank.id, amount: '1' })).statusCode).toBe(400);
  });

  it('edits and deletes keep balances exact (both legs of a transfer)', async () => {
    const t = await post(`${P}/transfers`, { date: today, fromAccountId: bank.id, toAccountId: cash.id, amount: '100' });
    const bankBefore = (await get(`${P}/accounts/${bank.id}`)).balance;
    await call(ctx, 'PUT', `${P}/transactions/${t.id}`, { amount: '300' });
    expect((await get(`${P}/accounts/${bank.id}`)).balance).toBe(bankBefore - 20_000);
    await call(ctx, 'DELETE', `${P}/transactions/${t.id}`);
    expect((await get(`${P}/accounts/${bank.id}`)).balance).toBe(bankBefore + 10_000);
    expect((await get(`${P}/accounts/${cash.id}`)).balance).toBe(250_000);
  });

  it('lists with filters, category roll-up, search and totals', async () => {
    const food = await get(`${P}/transactions?categoryId=${cat('Food')}`);
    expect(food.items.every((t: any) => ['Groceries', 'Food'].includes(t.categoryName))).toBe(true);
    expect(food.items.length).toBe(2);
    expect(food.totals[0]).toMatchObject({ currency: 'EGP', expenses: 100_000 });
    expect((await get(`${P}/transactions?q=carrefour`)).total).toBe(2);
    expect((await get(`${P}/transactions?type=transfer`)).total).toBe(4);
    expect(json(await call(ctx, 'GET', `/api/search?q=carrefour`)).some((h: any) => h.type === 'transaction')).toBe(true);
  });

  it('reconciles a balance with an adjustment that is not income or expense', async () => {
    const r = await post(`${P}/accounts/${cash.id}/reconcile`, { balance: '2,480', date: today });
    expect(r.adjusted).toBe(true);
    expect(r.account.balance).toBe(248_000);
    const s = await get(`${P}/reports/series?months=1`);
    expect(s.months[0].income).toBe(3_000_000);
  });

  it('protects history: accounts and categories in use can only be archived', async () => {
    expect((await call(ctx, 'DELETE', `${P}/accounts/${bank.id}`)).statusCode).toBe(400);
    expect((await call(ctx, 'DELETE', `${P}/categories/${cat('Groceries')}`)).statusCode).toBe(400);
    await post(`${P}/accounts/${cash.id}/archive`, { archived: true });
    const r = await call(ctx, 'POST', `${P}/transactions`, { type: 'expense', date: today, amount: '5', accountId: cash.id, categoryId: cat('Food') });
    expect(r.statusCode).toBe(400);
    await post(`${P}/accounts/${cash.id}/archive`, { archived: false });
  });
});

describe('reports and multi-currency', () => {
  it('reports income, expenses, savings and savings rate for the month', async () => {
    const o = await get(`${P}/overview`);
    expect(o.current.income).toBe(3_000_000);
    expect(o.current.expenses).toBe(100_000); // 1,250.50 − 250.50 refund
    expect(o.current.net).toBe(2_900_000);
    expect(o.current.savingsRate).toBeCloseTo(29 / 30);
    expect(o.categories.items[0]).toMatchObject({ name: 'Food', total: 100_000 });
  });

  it('never guesses exchange rates: unconverted currencies are reported', async () => {
    const usd = (await get(`${P}/accounts`)).find((a: any) => a.currency === 'USD');
    await post(`${P}/transactions`, { type: 'expense', date: today, amount: '10', accountId: usd.id, categoryId: cat('Subscriptions'), payee: 'Netflix' });
    let s = await get(`${P}/reports/series?months=1`);
    expect(s.missingRates).toEqual(['USD']);
    expect(s.months[0].expenses).toBe(100_000);
    await post(`${P}/rates`, { currency: 'USD', rate: 48.5, date: addDays(today, -1) });
    s = await get(`${P}/reports/series?months=1`);
    expect(s.missingRates).toEqual([]);
    expect(s.months[0].expenses).toBe(100_000 + 48_500);
  });

  it('computes net position across accounts, installments and debts', async () => {
    const n = await get(`${P}/net-worth`);
    expect(n.missingRates).toEqual([]);
    expect(n.netWorth).toBe(n.assets - n.liabilities);
    expect(n.liquid).toBeGreaterThan(0);
  });
});

describe('recurring transactions', () => {
  it('reminds, records and skips occurrences of a manual rule', async () => {
    const bank = (await get(`${P}/accounts`)).find((a: any) => a.name === 'CIB Current');
    const r = await post(`${P}/recurring`, { name: 'Internet', type: 'expense', amount: '450', accountId: bank.id, categoryId: cat('Mobile & internet'), startDate: addDays(today, 2), remindDaysBefore: 3 });
    expect(r.nextDue).toBe(addDays(today, 2));
    await runJobsNow(undefined, true);
    const n = await get('/api/notifications');
    expect(n.items.some((i: any) => i.title.includes('Internet due in 2 days'))).toBe(true);
    const posted = await post(`${P}/recurring/${r.id}/post`, {});
    expect(posted.nextDue).toBe(addMonths(addDays(today, 2), 1));
    const skipped = await post(`${P}/recurring/${r.id}/skip`, {});
    expect(skipped.nextDue).toBe(addMonths(addDays(today, 2), 2));
    const up = await get(`${P}/upcoming?days=90`);
    expect(up.some((u: any) => u.kind === 'recurring' && u.name === 'Internet')).toBe(true);
  });

  it('auto-posts due occurrences exactly once', async () => {
    const bank = (await get(`${P}/accounts`)).find((a: any) => a.name === 'CIB Current');
    const r = await post(`${P}/recurring`, { name: 'Gym', type: 'expense', amount: '800', accountId: bank.id, categoryId: cat('Fitness'), startDate: today, autoPost: true });
    await runJobsNow(undefined, true);
    await runJobsNow(undefined, true);
    const txs = await get(`${P}/transactions?q=Gym`);
    expect(txs.total).toBe(1);
    expect((await get(`${P}/recurring/${r.id}`)).nextDue).toBe(addMonths(today, 1));
  });
});

describe('installments', () => {
  let inst: any;
  it('builds the schedule automatically and exposes future obligations', async () => {
    const bank = (await get(`${P}/accounts`)).find((a: any) => a.name === 'CIB Current');
    inst = await post(`${P}/installments`, {
      name: 'iPhone',
      payee: 'Valu',
      totalAmount: '60,000',
      downPayment: '6,000',
      interestFees: '4,000',
      paymentCount: 12,
      firstDueDate: addDays(today, -1),
      accountId: bank.id,
      categoryId: cat('Electronics'),
    });
    expect(inst.payments).toHaveLength(12);
    expect(inst.payments.reduce((s: number, p: any) => s + p.amount, 0)).toBe(5_400_000);
    expect(inst.monthlyPayment).toBe(450_000);
    expect(inst.remainingAmount).toBe(5_400_000);
    expect(inst.overdueCount).toBe(1);
    expect(inst.endDate).toBe(addMonths(addDays(today, -1), 11));
    await runJobsNow(undefined, true);
    const n = await get('/api/notifications');
    expect(n.items.some((i: any) => i.severity === 'critical' && i.title.includes('iPhone (1/12)'))).toBe(true);
  });

  it('paying records the expense; undoing restores the balance', async () => {
    const bank = (await get(`${P}/accounts`)).find((a: any) => a.name === 'CIB Current');
    const p1 = inst.payments[0];
    const after = await post(`${P}/installments/${inst.id}/payments/${p1.id}/pay`, { date: today });
    expect(after.paidCount).toBe(1);
    expect(after.remainingAmount).toBe(4_950_000);
    expect((await get(`${P}/accounts/${bank.id}`)).balance).toBe(bank.balance - 450_000);
    expect((await call(ctx, 'POST', `${P}/installments/${inst.id}/payments/${p1.id}/pay`, { date: today })).statusCode).toBe(400);
    // The schedule is locked once payments exist.
    expect((await call(ctx, 'PUT', `${P}/installments/${inst.id}`, { paymentCount: 6 })).statusCode).toBe(400);
    expect((await call(ctx, 'PUT', `${P}/installments/${inst.id}`, { notes: 'Fine to edit' })).statusCode).toBe(200);
    const undone = await post(`${P}/installments/${inst.id}/payments/${p1.id}/unpay`, {});
    expect(undone.paidCount).toBe(0);
    expect((await get(`${P}/accounts/${bank.id}`)).balance).toBe(bank.balance);
  });

  it('deleting the payment transaction re-opens the payment', async () => {
    const p1 = inst.payments[0];
    const paid = await post(`${P}/installments/${inst.id}/payments/${p1.id}/pay`, { date: today });
    const txId = paid.payments[0].transactionId;
    await call(ctx, 'DELETE', `${P}/transactions/${txId}`);
    expect((await get(`${P}/installments/${inst.id}`)).paidCount).toBe(0);
  });

  it('completes when every payment is made', async () => {
    const small = await post(`${P}/installments`, { name: 'Course', totalAmount: '300', paymentCount: 2, firstDueDate: today, categoryId: cat('Courses') });
    for (const p of small.payments) await post(`${P}/installments/${small.id}/payments/${p.id}/pay`, { date: today, recordTransaction: false });
    expect((await get(`${P}/installments/${small.id}`)).status).toBe('completed');
  });

  it('validates down payment and currency/account match', async () => {
    expect((await call(ctx, 'POST', `${P}/installments`, { name: 'x', totalAmount: '100', downPayment: '100', paymentCount: 2, firstDueDate: today })).statusCode).toBe(400);
    const usd = (await get(`${P}/accounts`)).find((a: any) => a.currency === 'USD');
    const r = await call(ctx, 'POST', `${P}/installments`, { name: 'x', totalAmount: '100', paymentCount: 2, firstDueDate: today, accountId: usd.id, currency: 'EGP' });
    expect(json(r).error.fields[0].path).toBe('accountId');
  });
});

describe('debts and receivables', () => {
  it('tracks repayments without counting them as income or expense', async () => {
    const bank = (await get(`${P}/accounts`)).find((a: any) => a.name === 'CIB Current');
    const seriesBefore = await get(`${P}/reports/series?months=1`);
    const d = await post(`${P}/debts`, { direction: 'owed_to_me', counterparty: 'Ahmed', principal: '5000', startDate: today, dueDate: addDays(today, 5) });
    expect(d.remaining).toBe(500_000);
    const after = await post(`${P}/debts/${d.id}/payments`, { date: today, amount: '2000', accountId: bank.id });
    expect(after.remaining).toBe(300_000);
    expect((await get(`${P}/accounts/${bank.id}`)).balance).toBe(bank.balance + 200_000);
    const s = await get(`${P}/reports/series?months=1`);
    expect(s.months[0]).toMatchObject({ income: seriesBefore.months[0].income, expenses: seriesBefore.months[0].expenses });
    expect((await call(ctx, 'POST', `${P}/debts/${d.id}/payments`, { date: today, amount: '3000.01' })).statusCode).toBe(400);
    const settled = await post(`${P}/debts/${d.id}/payments`, { date: today, amount: '3000' });
    expect(settled.status).toBe('settled');
    const reopened = json(await call(ctx, 'DELETE', `${P}/debts/${d.id}/payments/${settled.payments[1].id}`));
    expect(reopened.status).toBe('open');
  });
});

describe('budgets', () => {
  it('compares budget vs actual with subcategory roll-up and projection', async () => {
    const b = await post(`${P}/budgets`, {
      name: 'Monthly',
      startMonth: today.slice(0, 7),
      lines: [
        { categoryId: cat('Food'), amount: '800' },
        { categoryId: cat('Transportation'), amount: '1500' },
      ],
    });
    const r = await get(`${P}/budgets/${b.id}/report`);
    const food = r.lines.find((l: any) => l.name === 'Food');
    expect(food.actual).toBe(100_000);
    expect(food.budget).toBe(80_000);
    expect(food.remaining).toBe(-20_000);
    expect(food.status).toBe('over');
    expect(r.total.budget).toBe(230_000);
    await runJobsNow(undefined, true);
    const n = await get('/api/notifications');
    expect(n.items.some((i: any) => i.title === 'Budget exceeded: Food')).toBe(true);
  });

  it('rejects a category budgeted together with its own subcategory', async () => {
    const r = await call(ctx, 'POST', `${P}/budgets`, {
      name: 'Bad',
      startMonth: today.slice(0, 7),
      lines: [
        { categoryId: cat('Food'), amount: '100' },
        { categoryId: cat('Groceries'), amount: '100' },
      ],
    });
    expect(r.statusCode).toBe(400);
  });
});

describe('savings goals', () => {
  it('forecasts when a goal is reached and runs what-if scenarios without saving anything', async () => {
    const g = await post(`${P}/goals`, { name: 'Emergency fund', targetAmount: '100,000', startingAmount: '40,000', deadline: addMonths(today, 12) });
    expect(g.current).toBe(4_000_000);
    expect(g.forecast.eta).toBeNull(); // no saving yet
    const withC = await post(`${P}/goals/${g.id}/contributions`, { date: today, amount: '15000' });
    expect(withC.current).toBe(5_500_000);
    expect(withC.monthlyRate).toBe(500_000); // 15,000 over the last 3 months
    expect(withC.forecast.monthsToTarget).toBe(9);
    const sc = await get(`${P}/goals/${g.id}/scenario?extra=5000`);
    expect(sc.withExtra.monthsToTarget).toBe(5);
    expect(sc.current.monthsToTarget).toBe(9);
    expect((await get(`${P}/goals/${g.id}`)).current).toBe(5_500_000); // scenario changed nothing
  });

  it('can track the balance of linked accounts', async () => {
    const usd = (await get(`${P}/accounts`)).find((a: any) => a.currency === 'USD');
    const g = await post(`${P}/goals`, { name: 'Car', targetAmount: '500000', mode: 'accounts', accountIds: [usd.id] });
    // 90 USD × 48.5 = 4,365 EGP
    expect(g.current).toBe(436_500);
  });
});
