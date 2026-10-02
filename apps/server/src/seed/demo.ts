import { addDays, addMonths } from '@life-erp/shared';
import { getDb } from '../db/client';
import { appMeta, users } from '../db/schema';
import { newId } from '../lib/ids';
import { hashPassword } from '../modules/auth/service';
import { createAccount } from '../modules/finance/accounts';
import { createBudget } from '../modules/finance/budgets';
import { listCategories } from '../modules/finance/categories';
import { setRate } from '../modules/finance/currency';
import { addDebtPayment, createDebt } from '../modules/finance/debts';
import { addContribution, createGoal } from '../modules/finance/goals';
import { createInstallment, payInstallment } from '../modules/finance/installments';
import { todayLocal } from '../modules/finance/jobs';
import { createRecurring } from '../modules/finance/recurring';
import { createTransaction, createTransfer } from '../modules/finance/transactions';
import { saveSettings } from '../modules/settings/service';
import { createTag } from '../modules/tags/service';
import { createWorkspace } from '../modules/workspaces/service';
import { getConfig } from '../runtime';

/**
 * Demo data lives ONLY in the separate demo data folder (LifeERP-Demo), so it can
 * never mix with real records. Every module adds its sample records here.
 */
export async function seedDemo() {
  if (!getConfig().demo) throw new Error('Refusing to seed demo data into the real data folder');
  const db = getDb();
  const userId = newId();
  db.insert(users)
    .values({ id: userId, username: 'demo', email: 'demo@example.com', fullName: 'Demo User', passwordHash: await hashPassword('demo-password') })
    .run();
  db.insert(appMeta).values({ key: 'demo', value: 'true' }).onConflictDoNothing().run();
  const ctx = { userId };
  saveSettings(ctx, { locale: 'en', baseCurrency: 'EGP' });
  const personal = createWorkspace(ctx, { name: 'Personal', kind: 'personal', color: '#0f766e' });
  const mma = createWorkspace(ctx, {
    name: 'MMA Spaces',
    kind: 'business',
    industry: 'Interior finishing & design',
    description: 'Residential and commercial interior finishing: design, BOQs, procurement and execution.',
    color: '#b45309',
  });
  const basira = createWorkspace(ctx, {
    name: 'Basira',
    kind: 'business',
    industry: 'Data analytics SaaS',
    description: 'Analytics and forecasting for clothing manufacturers.',
    color: '#4f46e5',
  });
  for (const name of ['urgent', 'followup', 'finance', 'career', 'mma', 'basira', '2026']) createTag(ctx, { name });
  seedFinance(ctx, { personal: personal.id, mma: mma.id, basira: basira.id });
  return { userId, personal, mma, basira };
}

function seedFinance(ctx: { userId: string }, ws: { personal: string; mma: string; basira: string }) {
  const today = todayLocal();
  const cats = listCategories();
  const cat = (name: string) => cats.find((c) => c.name === name)!.id;
  const start = addMonths(today, -3);

  setRate(ctx, { currency: 'USD', rate: 48.6, date: addDays(today, -90) });
  setRate(ctx, { currency: 'USD', rate: 48.3, date: addDays(today, -10) });

  const bank = createAccount(ctx, { name: 'CIB Current', type: 'bank', currency: 'EGP', openingBalance: '85000', openingDate: start, institution: 'CIB', reference: '•••• 4821', workspaceId: ws.personal });
  const cash = createAccount(ctx, { name: 'Wallet cash', type: 'cash', currency: 'EGP', openingBalance: '3000', openingDate: start, workspaceId: ws.personal });
  const vf = createAccount(ctx, { name: 'Vodafone Cash', type: 'ewallet', currency: 'EGP', openingBalance: '1200', openingDate: start, workspaceId: ws.personal });
  const card = createAccount(ctx, { name: 'Visa credit card', type: 'credit_card', currency: 'EGP', openingBalance: '-4500', openingDate: start, institution: 'NBE', creditLimit: '60000', workspaceId: ws.personal });
  const usd = createAccount(ctx, { name: 'USD savings', type: 'savings', currency: 'USD', openingBalance: '1500', openingDate: start, institution: 'CIB', workspaceId: ws.personal });
  const mmaBank = createAccount(ctx, { name: 'MMA Spaces – QNB', type: 'bank', currency: 'EGP', openingBalance: '120000', openingDate: start, institution: 'QNB', workspaceId: ws.mma });

  const tx = (type: 'income' | 'expense', date: string, amount: string, accountId: string, category: string, payee: string, workspaceId = ws.personal) =>
    createTransaction(ctx, { type, date, amount, accountId, categoryId: cat(category), payee, workspaceId, allowDuplicate: true });

  // Three months of realistic personal activity.
  for (let m = 3; m >= 0; m--) {
    const base = addMonths(today, -m);
    const d = (day: number) => {
      const s = `${base.slice(0, 7)}-${String(day).padStart(2, '0')}`;
      return s <= today ? s : null;
    };
    const at = (day: number, fn: (date: string) => void) => {
      const date = d(day);
      if (date && date >= start) fn(date);
    };
    at(1, (date) => tx('income', date, '45000', bank.id, 'Salary', 'Employer'));
    at(5, (date) => tx('expense', date, '12000', bank.id, 'Rent', 'Landlord'));
    at(10, (date) => tx('expense', date, '450', vf.id, 'Mobile & internet', 'WE Internet'));
    at(3, (date) => tx('expense', date, String(1850 + m * 120), card.id, 'Groceries', 'Carrefour'));
    at(11, (date) => tx('expense', date, String(1420 + m * 75), card.id, 'Groceries', 'Seoudi Market'));
    at(19, (date) => tx('expense', date, String(1630 - m * 40), cash.id, 'Groceries', 'Kazyon'));
    at(7, (date) => tx('expense', date, '640', card.id, 'Restaurants', 'Zooba'));
    at(16, (date) => tx('expense', date, '980', card.id, 'Restaurants', 'Sachi'));
    at(8, (date) => tx('expense', date, '900', bank.id, 'Fuel', 'Total Energies'));
    at(22, (date) => tx('expense', date, '850', bank.id, 'Fuel', 'Mobil'));
    at(13, (date) => tx('expense', date, String(310 + m * 30), vf.id, 'Ride-hailing', 'Uber'));
    at(15, (date) => tx('expense', date, '800', bank.id, 'Fitness', 'Gold’s Gym'));
    at(20, (date) => tx('expense', date, '2000', bank.id, 'Family support', 'Family'));
    at(24, (date) => tx('expense', date, String(1200 + m * 400), card.id, 'Clothes', 'Zara'));
    at(26, (date) => createTransfer(ctx, { date, fromAccountId: bank.id, toAccountId: card.id, amount: '5000', description: 'Card payment' }));
    at(2, (date) => createTransfer(ctx, { date, fromAccountId: bank.id, toAccountId: cash.id, amount: '2000', description: 'ATM withdrawal' }));
    // MMA Spaces business activity.
    at(6, (date) => tx('income', date, String(85000 + m * 5000), mmaBank.id, 'Business income', 'Villa client – New Cairo', ws.mma));
    at(9, (date) => tx('expense', date, String(28000 + m * 2000), mmaBank.id, 'Materials', 'Gypsum & paint supplier', ws.mma));
    at(17, (date) => tx('expense', date, '22000', mmaBank.id, 'Contractors', 'Electrical contractor', ws.mma));
    at(21, (date) => tx('expense', date, '3500', mmaBank.id, 'Marketing', 'Instagram ads', ws.mma));
    // Basira.
    at(12, (date) => tx('expense', date, '1450', bank.id, 'Software', 'Cloud & tools', ws.basira));
  }
  createTransaction(ctx, { type: 'expense', date: addDays(today, -4), amount: '15.99', accountId: usd.id, categoryId: cat('Subscriptions'), payee: 'Netflix', workspaceId: ws.personal, allowDuplicate: true });

  // Recurring items (salary is recorded automatically; the rest remind you).
  createRecurring(ctx, { name: 'Salary', type: 'income', amount: '45000', accountId: bank.id, categoryId: cat('Salary'), payee: 'Employer', startDate: addMonths(`${today.slice(0, 7)}-01`, 1), autoPost: true, workspaceId: ws.personal }, today);
  createRecurring(ctx, { name: 'Rent', type: 'expense', amount: '12000', accountId: bank.id, categoryId: cat('Rent'), payee: 'Landlord', startDate: `${today.slice(0, 7)}-05` < today ? addMonths(`${today.slice(0, 7)}-05`, 1) : `${today.slice(0, 7)}-05`, remindDaysBefore: 5, workspaceId: ws.personal }, today);
  createRecurring(ctx, { name: 'WE Internet', type: 'expense', amount: '450', accountId: vf.id, categoryId: cat('Mobile & internet'), startDate: addDays(today, 3), workspaceId: ws.personal }, today);
  createRecurring(ctx, { name: 'Emergency fund transfer', type: 'transfer', amount: '5000', accountId: bank.id, toAccountId: cash.id, startDate: addDays(today, 12), workspaceId: ws.personal }, today);

  // Car installment: 6 of 24 paid.
  const car = createInstallment(
    ctx,
    { name: 'Car installment', payee: 'Toyota Finance', totalAmount: '480000', downPayment: '120000', interestFees: '60000', paymentCount: 24, firstDueDate: addMonths(today, -6), accountId: bank.id, categoryId: cat('Car maintenance'), workspaceId: ws.personal },
    today,
  );
  for (const p of car.payments.slice(0, 6)) payInstallment(ctx, car.id, p.id, { date: p.dueDate, recordTransaction: false }, today);
  createInstallment(ctx, { name: 'iPhone 16', payee: 'valU', totalAmount: '54000', paymentCount: 12, firstDueDate: addDays(today, 6), accountId: card.id, categoryId: cat('Electronics'), workspaceId: ws.personal }, today);

  // Debts & receivables.
  const ahmed = createDebt(ctx, { direction: 'owed_to_me', counterparty: 'Ahmed (friend)', principal: '5000', startDate: addDays(today, -40), dueDate: addDays(today, 5) });
  addDebtPayment(ctx, ahmed.id, { date: addDays(today, -10), amount: '2000', accountId: cash.id });
  createDebt(ctx, { direction: 'i_owe', counterparty: 'Uncle Hassan', principal: '20000', startDate: addDays(today, -120), dueDate: addMonths(today, 4), notes: 'Interest-free loan for the car down payment' });

  // Budget and savings goals.
  createBudget(ctx, {
    name: 'Monthly personal',
    workspaceId: ws.personal,
    startMonth: start.slice(0, 7),
    lines: [
      { categoryId: cat('Food'), amount: '6500' },
      { categoryId: cat('Transportation'), amount: '2500' },
      { categoryId: cat('Shopping'), amount: '2500' },
      { categoryId: cat('Health'), amount: '1000' },
    ],
  });
  createBudget(ctx, { name: 'MMA project costs', workspaceId: ws.mma, startMonth: start.slice(0, 7), lines: [{ categoryId: cat('Business'), amount: '55000' }] });
  const ef = createGoal(ctx, { name: 'Emergency fund', targetAmount: '150000', startingAmount: '60000', deadline: addMonths(today, 12), priority: 1 }, today);
  for (const back of [75, 45, 15]) addContribution(ctx, ef.id, { date: addDays(today, -back), amount: '5000' }, today);
  createGoal(ctx, { name: 'Marriage', targetAmount: '400000', startingAmount: '100000', deadline: addMonths(today, 24), priority: 1, monthlyTarget: '12000' }, today);
  createGoal(ctx, { name: 'Basira capital', targetAmount: '200000', mode: 'accounts', accountIds: [usd.id], priority: 2 }, today);
}
