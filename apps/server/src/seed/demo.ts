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
import { createEvent } from '../modules/life/events';
import { addCheckin, createGoal as createLifeGoal } from '../modules/life/goals';
import { createNote } from '../modules/life/notes';
import { addInteraction, createPerson } from '../modules/life/people';
import { createTask, updateTask } from '../modules/life/tasks';

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
  seedLife(ctx, { personal: personal.id, mma: mma.id, basira: basira.id });
  return { userId, personal, mma, basira };
}

function seedLife(ctx: { userId: string }, ws: { personal: string; mma: string; basira: string }) {
  const today = todayLocal();
  // People
  const karim = createPerson(ctx, { fullName: 'Eng. Karim Hassan', relationship: 'contractor', company: 'Hassan Electric', role: 'Electrical contractor', phone: '01001234567', workspaceId: ws.mma, nextFollowUp: today, followUpNote: 'Confirm electrical BOQ for the villa' });
  addInteraction(ctx, { personId: karim.id, kind: 'whatsapp', date: addDays(today, -3), summary: 'Sent villa drawings; he will price the electrical work.' });
  const nour = createPerson(ctx, { fullName: 'Nour El-Sayed', relationship: 'client', company: 'Villa – New Cairo', phone: '01112223334', email: 'nour@example.com', workspaceId: ws.mma, source: 'Instagram' });
  addInteraction(ctx, { personId: nour.id, kind: 'meeting', date: addDays(today, -6), summary: 'Site visit. Wants modern style, budget around 1.2M EGP.', nextFollowUp: addDays(today, 2) });
  createPerson(ctx, { fullName: 'Omar Fathy', relationship: 'professional', company: 'Garment factory – 10th of Ramadan', role: 'Operations manager', workspaceId: ws.basira, nextFollowUp: addDays(today, 5), followUpNote: 'Demo of Basira data health check' });
  createPerson(ctx, { fullName: 'Mona (sister)', relationship: 'family', birthday: `1996-${addDays(today, 4).slice(5)}` });
  createPerson(ctx, { fullName: 'Sara Ibrahim', relationship: 'recruiter', company: 'Talent Partners', email: 'sara@example.com' });

  // Goals hierarchy
  const vision = createLifeGoal(ctx, { title: 'Build two profitable businesses by 2028', level: 'vision', metric: 'children', area: 'business' });
  const mmaGoal = createLifeGoal(ctx, { title: 'MMA Spaces: 12 completed projects this year', level: 'long_term', parentId: vision.id, metric: 'numeric', startValue: 0, targetValue: 12, unit: 'projects', startDate: `${today.slice(0, 4)}-01-01`, deadline: `${today.slice(0, 4)}-12-31`, workspaceId: ws.mma });
  addCheckin(ctx, mmaGoal.id, { date: addDays(today, -20), value: 6 });
  const basiraGoal = createLifeGoal(ctx, { title: 'Launch Basira MVP with 3 pilot factories', level: 'objective', parentId: vision.id, metric: 'tasks', deadline: addMonths(today, 3), workspaceId: ws.basira });
  const fitness = createLifeGoal(ctx, { title: 'Reach 80 kg', level: 'objective', metric: 'numeric', startValue: 92, targetValue: 80, unit: 'kg', startDate: addMonths(today, -2), deadline: addMonths(today, 4), area: 'health' });
  addCheckin(ctx, fitness.id, { date: addDays(today, -30), value: 90 });
  addCheckin(ctx, fitness.id, { date: addDays(today, -2), value: 88.5 });

  // Tasks
  const task = (title: string, extra: Record<string, unknown> = {}) => createTask(ctx, { title, ...extra } as never);
  task('Pay electricity bill', { dueDate: today, priority: 2, area: 'finance', tags: ['finance'] });
  task('Send revised proposal to Nour', { dueDate: addDays(today, -1), priority: 1, personId: nour.id, workspaceId: ws.mma, tags: ['mma', 'followup'] });
  task('Order gypsum boards for villa', { dueDate: addDays(today, 1), workspaceId: ws.mma });
  task('Build data validation step', { status: 'in_progress', goalId: basiraGoal.id, workspaceId: ws.basira, tags: ['basira'] });
  task('Design health-check report', { status: 'planned', goalId: basiraGoal.id, workspaceId: ws.basira });
  const done = task('Interview 3 pilot factories', { status: 'planned', goalId: basiraGoal.id, workspaceId: ws.basira });
  updateTask(ctx, done.id, { status: 'done' });
  task('Weekly review', { dueDate: nextWeekday(today, 6), recurrence: 'weekly', area: 'personal' });
  task('Renew car license', { dueDate: addDays(today, 12), area: 'personal' });
  task('Read “Data-Driven Business”', { status: 'planned', area: 'learning' });
  task('Idea: Instagram reels of finished projects', { tags: ['mma'] });
  task('Waiting for Karim’s BOQ', { status: 'waiting', personId: karim.id, workspaceId: ws.mma });

  // Events
  createEvent(ctx, { title: 'Site visit – Villa New Cairo', kind: 'meeting', date: today, startTime: '11:00', endTime: '12:30', location: 'New Cairo, 5th Settlement', personId: nour.id, workspaceId: ws.mma, reminderMinutes: 60 });
  createEvent(ctx, { title: 'Gym', kind: 'personal', date: today, startTime: '19:00', endTime: '20:00', recurrence: 'weekly', reminderMinutes: 30 });
  createEvent(ctx, { title: 'Basira demo with Omar', kind: 'meeting', date: addDays(today, 5), startTime: '13:00', endTime: '14:00', workspaceId: ws.basira, reminderMinutes: 120 });
  createEvent(ctx, { title: 'Family dinner', kind: 'personal', date: addDays(today, 1), startTime: '20:00' });
  createEvent(ctx, { title: 'Furniture & design expo', kind: 'other', date: addDays(today, 9), endDate: addDays(today, 11), allDay: true, workspaceId: ws.mma });

  // Notes
  createNote(ctx, { title: 'Basira workflow', body: '## Pipeline\n1. Data input\n2. Validation\n3. Health check → approval\n4. Data cleaning → approval\n5. Dashboard\n6. Forecasting / analysis\n\nPricing ideas: see [[Basira pricing]].', workspaceId: ws.basira, pinned: true, tags: ['basira'] });
  createNote(ctx, { title: 'Basira pricing', body: '- Pilot: free for 3 months\n- Per-factory monthly subscription\n- Setup fee for data onboarding\n\nRelated: [[Basira workflow]]', workspaceId: ws.basira });
  createNote(ctx, { title: 'MMA – standard BOQ checklist', body: '- [ ] Demolition\n- [ ] Electrical\n- [ ] Plumbing\n- [ ] Gypsum & ceilings\n- [ ] Paint\n- [ ] Flooring\n- [ ] Carpentry\n\n> Always confirm quantities on site.', workspaceId: ws.mma, tags: ['mma'] });
}

function nextWeekday(from: string, weekday: number) {
  const dow = new Date(`${from}T12:00:00Z`).getUTCDay();
  return addDays(from, ((weekday - dow + 7) % 7) || 7);
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
