import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { softDelete, timestamps, workspaces } from './core';

/** Currencies available in addition to the built-in list (code + minor-unit digits). */
export const currencies = sqliteTable('currencies', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  digits: integer('digits').notNull().default(2),
  createdAt: timestamps.createdAt,
});

/** Exchange rates: 1 unit of `currency` = `rate` units of `base`, valid from `date`. */
export const fxRates = sqliteTable(
  'fx_rates',
  {
    id: text('id').primaryKey(),
    currency: text('currency').notNull(),
    base: text('base').notNull(),
    rate: real('rate').notNull(),
    date: text('date').notNull(),
    createdAt: timestamps.createdAt,
  },
  (t) => [uniqueIndex('fx_unique').on(t.currency, t.base, t.date)],
);

export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').references(() => workspaces.id),
    name: text('name').notNull(),
    type: text('type').notNull(),
    currency: text('currency').notNull(),
    /** Minor units. */
    openingBalance: integer('opening_balance').notNull().default(0),
    openingDate: text('opening_date'),
    institution: text('institution'),
    reference: text('reference'),
    creditLimit: integer('credit_limit'),
    color: text('color'),
    includeInNetWorth: integer('include_in_net_worth', { mode: 'boolean' }).notNull().default(true),
    notes: text('notes'),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: text('archived_at'),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index('accounts_ws_idx').on(t.workspaceId)],
);

export const categories = sqliteTable(
  'categories',
  {
    id: text('id').primaryKey(),
    parentId: text('parent_id'),
    kind: text('kind', { enum: ['income', 'expense'] }).notNull(),
    name: text('name').notNull(),
    nameAr: text('name_ar'),
    color: text('color'),
    icon: text('icon'),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: text('archived_at'),
    ...timestamps,
  },
  (t) => [index('categories_parent_idx').on(t.parentId)],
);

export const transactions = sqliteTable(
  'transactions',
  {
    id: text('id').primaryKey(),
    date: text('date').notNull(),
    type: text('type', { enum: ['income', 'expense', 'transfer', 'refund', 'adjustment'] }).notNull(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    /** Signed effect on the account balance, in the account's minor units. */
    amount: integer('amount').notNull(),
    currency: text('currency').notNull(),
    categoryId: text('category_id').references(() => categories.id),
    payee: text('payee'),
    description: text('description'),
    notes: text('notes'),
    workspaceId: text('workspace_id').references(() => workspaces.id),
    projectId: text('project_id'),
    /** Both legs of a transfer share this id. */
    transferGroup: text('transfer_group'),
    recurringId: text('recurring_id'),
    installmentPaymentId: text('installment_payment_id'),
    debtPaymentId: text('debt_payment_id'),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index('tx_date_idx').on(t.date),
    index('tx_account_idx').on(t.accountId, t.date),
    index('tx_category_idx').on(t.categoryId),
    index('tx_ws_idx').on(t.workspaceId, t.date),
    index('tx_transfer_idx').on(t.transferGroup),
  ],
);

export const recurringRules = sqliteTable('recurring_rules', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type', { enum: ['income', 'expense', 'transfer'] }).notNull(),
  amount: integer('amount').notNull(),
  currency: text('currency').notNull(),
  accountId: text('account_id')
    .notNull()
    .references(() => accounts.id),
  toAccountId: text('to_account_id').references(() => accounts.id),
  categoryId: text('category_id').references(() => categories.id),
  payee: text('payee'),
  workspaceId: text('workspace_id').references(() => workspaces.id),
  frequency: text('frequency').notNull(),
  interval: integer('interval').notNull().default(1),
  startDate: text('start_date').notNull(),
  endDate: text('end_date'),
  /** Next date that has not been recorded or skipped yet. */
  nextDue: text('next_due'),
  autoPost: integer('auto_post', { mode: 'boolean' }).notNull().default(false),
  remindDaysBefore: integer('remind_days_before').notNull().default(3),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  notes: text('notes'),
  ...timestamps,
  ...softDelete,
});

export const installments = sqliteTable('installments', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  payee: text('payee'),
  /** Total payable over the schedule (excluding the down payment). */
  totalAmount: integer('total_amount').notNull(),
  downPayment: integer('down_payment').notNull().default(0),
  interestFees: integer('interest_fees').notNull().default(0),
  currency: text('currency').notNull(),
  paymentCount: integer('payment_count').notNull(),
  firstDueDate: text('first_due_date').notNull(),
  frequency: text('frequency').notNull().default('monthly'),
  accountId: text('account_id').references(() => accounts.id),
  categoryId: text('category_id').references(() => categories.id),
  workspaceId: text('workspace_id').references(() => workspaces.id),
  remindDaysBefore: integer('remind_days_before').notNull().default(3),
  status: text('status', { enum: ['active', 'completed', 'cancelled'] }).notNull().default('active'),
  notes: text('notes'),
  ...timestamps,
  ...softDelete,
});

export const installmentPayments = sqliteTable(
  'installment_payments',
  {
    id: text('id').primaryKey(),
    installmentId: text('installment_id')
      .notNull()
      .references(() => installments.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    dueDate: text('due_date').notNull(),
    amount: integer('amount').notNull(),
    paidDate: text('paid_date'),
    paidAmount: integer('paid_amount'),
    transactionId: text('transaction_id'),
  },
  (t) => [index('inst_pay_idx').on(t.installmentId, t.seq), index('inst_due_idx').on(t.dueDate)],
);

export const debts = sqliteTable('debts', {
  id: text('id').primaryKey(),
  direction: text('direction', { enum: ['i_owe', 'owed_to_me'] }).notNull(),
  counterparty: text('counterparty').notNull(),
  principal: integer('principal').notNull(),
  currency: text('currency').notNull(),
  startDate: text('start_date').notNull(),
  dueDate: text('due_date'),
  workspaceId: text('workspace_id').references(() => workspaces.id),
  status: text('status', { enum: ['open', 'settled'] }).notNull().default('open'),
  notes: text('notes'),
  ...timestamps,
  ...softDelete,
});

export const debtPayments = sqliteTable('debt_payments', {
  id: text('id').primaryKey(),
  debtId: text('debt_id')
    .notNull()
    .references(() => debts.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  amount: integer('amount').notNull(),
  note: text('note'),
  transactionId: text('transaction_id'),
  createdAt: timestamps.createdAt,
});

export const budgets = sqliteTable('budgets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  workspaceId: text('workspace_id').references(() => workspaces.id),
  startMonth: text('start_month').notNull(),
  endMonth: text('end_month'),
  notes: text('notes'),
  ...timestamps,
  ...softDelete,
});

export const budgetLines = sqliteTable(
  'budget_lines',
  {
    id: text('id').primaryKey(),
    budgetId: text('budget_id')
      .notNull()
      .references(() => budgets.id, { onDelete: 'cascade' }),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id),
    /** Monthly amount in the base currency, minor units. */
    amount: integer('amount').notNull(),
  },
  (t) => [uniqueIndex('budget_line_unique').on(t.budgetId, t.categoryId)],
);

export const savingsGoals = sqliteTable('savings_goals', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  targetAmount: integer('target_amount').notNull(),
  currency: text('currency').notNull(),
  deadline: text('deadline'),
  priority: integer('priority').notNull().default(2),
  mode: text('mode', { enum: ['accounts', 'manual'] }).notNull().default('manual'),
  monthlyTarget: integer('monthly_target'),
  startingAmount: integer('starting_amount').notNull().default(0),
  workspaceId: text('workspace_id').references(() => workspaces.id),
  color: text('color'),
  status: text('status', { enum: ['active', 'achieved', 'paused'] }).notNull().default('active'),
  notes: text('notes'),
  ...timestamps,
  ...softDelete,
});

export const savingsGoalAccounts = sqliteTable(
  'savings_goal_accounts',
  {
    goalId: text('goal_id')
      .notNull()
      .references(() => savingsGoals.id, { onDelete: 'cascade' }),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
  },
  (t) => [primaryKey({ columns: [t.goalId, t.accountId] })],
);

export const savingsContributions = sqliteTable('savings_contributions', {
  id: text('id').primaryKey(),
  goalId: text('goal_id')
    .notNull()
    .references(() => savingsGoals.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  amount: integer('amount').notNull(),
  note: text('note'),
  createdAt: timestamps.createdAt,
});
