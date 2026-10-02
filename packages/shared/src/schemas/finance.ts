import { z } from 'zod';
import { ACCOUNT_TYPES, FREQUENCIES, TRANSACTION_TYPES } from '../finance';
import { normalizeDigits } from '../money';
import { colorSchema, currencySchema, idSchema, isoDateSchema, optionalText, requiredText } from './common';

/**
 * A money amount as typed by the user ("1,250.50", "١٢٥٠", 99.5). Converted to minor units
 * on the server using the currency of the account/record.
 */
export const amountInputSchema = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? String(v) : normalizeDigits(v).replace(/[\s,]/g, '').replace('٫', '.')))
  .refine((s) => /^-?\d+(\.\d+)?$/.test(s), 'Enter a valid amount');

export const positiveAmountSchema = amountInputSchema.refine((s) => Number(s) > 0, 'Amount must be greater than zero');
export const nonNegativeAmountSchema = amountInputSchema.refine((s) => Number(s) >= 0, 'Amount cannot be negative');

const optionalId = idSchema.nullable().optional();

export const accountSchema = z.object({
  name: requiredText(80),
  type: z.enum(ACCOUNT_TYPES),
  currency: currencySchema.default('EGP'),
  openingBalance: amountInputSchema.default('0'),
  openingDate: isoDateSchema.optional().nullable(),
  institution: optionalText(120),
  reference: optionalText(60),
  creditLimit: nonNegativeAmountSchema.optional().nullable(),
  workspaceId: optionalId,
  color: colorSchema.optional().nullable(),
  includeInNetWorth: z.boolean().default(true),
  notes: optionalText(4000),
});
export type AccountInput = z.input<typeof accountSchema>;

export const categorySchema = z.object({
  name: requiredText(60),
  nameAr: optionalText(60),
  kind: z.enum(['income', 'expense']),
  parentId: optionalId,
  color: colorSchema.optional().nullable(),
  icon: z.string().max(40).optional().nullable(),
});
export type CategoryInput = z.input<typeof categorySchema>;

export const transactionSchema = z
  .object({
    type: z.enum(TRANSACTION_TYPES).exclude(['transfer']),
    date: isoDateSchema,
    amount: positiveAmountSchema,
    /** Only for adjustments: increase or decrease the balance. */
    direction: z.enum(['in', 'out']).default('out'),
    accountId: idSchema,
    categoryId: optionalId,
    payee: optionalText(120),
    description: optionalText(300),
    notes: optionalText(4000),
    workspaceId: optionalId,
    projectId: optionalId,
    tags: z.array(z.string()).max(30).optional(),
    /** Set after the user confirms a possible duplicate. */
    allowDuplicate: z.boolean().optional(),
  })
  .refine((v) => v.type === 'adjustment' || !!v.categoryId, {
    path: ['categoryId'],
    message: 'Choose a category',
  });
export type TransactionInput = z.input<typeof transactionSchema>;

export const transferSchema = z
  .object({
    date: isoDateSchema,
    fromAccountId: idSchema,
    toAccountId: idSchema,
    amount: positiveAmountSchema,
    /** Amount received when the accounts use different currencies. */
    toAmount: positiveAmountSchema.optional().nullable(),
    description: optionalText(300),
    notes: optionalText(4000),
    workspaceId: optionalId,
    tags: z.array(z.string()).max(30).optional(),
  })
  .refine((v) => v.fromAccountId !== v.toAccountId, { path: ['toAccountId'], message: 'Choose a different account' });
export type TransferInput = z.input<typeof transferSchema>;

export const recurringSchema = z
  .object({
    name: requiredText(120),
    type: z.enum(['income', 'expense', 'transfer']),
    amount: positiveAmountSchema,
    accountId: idSchema,
    toAccountId: optionalId,
    categoryId: optionalId,
    payee: optionalText(120),
    workspaceId: optionalId,
    frequency: z.enum(FREQUENCIES).default('monthly'),
    interval: z.coerce.number().int().min(1).max(365).default(1),
    startDate: isoDateSchema,
    endDate: isoDateSchema.nullable().optional(),
    autoPost: z.boolean().default(false),
    remindDaysBefore: z.coerce.number().int().min(0).max(60).default(3),
    notes: optionalText(4000),
  })
  .refine((v) => v.type !== 'transfer' || (!!v.toAccountId && v.toAccountId !== v.accountId), {
    path: ['toAccountId'],
    message: 'Choose the account the money goes to',
  })
  .refine((v) => v.type === 'transfer' || !!v.categoryId, { path: ['categoryId'], message: 'Choose a category' })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, { path: ['endDate'], message: 'End date must be after the start date' });
export type RecurringInput = z.input<typeof recurringSchema>;

export const installmentSchema = z.object({
  name: requiredText(120),
  payee: optionalText(120),
  totalAmount: positiveAmountSchema,
  downPayment: nonNegativeAmountSchema.default('0'),
  interestFees: nonNegativeAmountSchema.default('0'),
  paymentCount: z.coerce.number().int().min(1).max(600),
  firstDueDate: isoDateSchema,
  frequency: z.enum(['monthly', 'quarterly', 'weekly', 'yearly']).default('monthly'),
  currency: currencySchema.default('EGP'),
  accountId: optionalId,
  categoryId: optionalId,
  workspaceId: optionalId,
  remindDaysBefore: z.coerce.number().int().min(0).max(60).default(3),
  notes: optionalText(4000),
});
export type InstallmentInput = z.input<typeof installmentSchema>;

export const payInstallmentSchema = z.object({
  date: isoDateSchema,
  accountId: idSchema.nullable().optional(),
  /** Record a transaction in the account (default) or just mark as paid. */
  recordTransaction: z.boolean().default(true),
  amount: positiveAmountSchema.optional(),
});

export const debtSchema = z.object({
  direction: z.enum(['i_owe', 'owed_to_me']),
  counterparty: requiredText(120),
  principal: positiveAmountSchema,
  currency: currencySchema.default('EGP'),
  startDate: isoDateSchema,
  dueDate: isoDateSchema.nullable().optional(),
  workspaceId: optionalId,
  notes: optionalText(4000),
});
export type DebtInput = z.input<typeof debtSchema>;

export const debtPaymentSchema = z.object({
  date: isoDateSchema,
  amount: positiveAmountSchema,
  accountId: idSchema.nullable().optional(),
  note: optionalText(300),
});

export const budgetSchema = z.object({
  name: requiredText(80),
  workspaceId: optionalId,
  startMonth: z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM'),
  endMonth: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM')
    .nullable()
    .optional(),
  notes: optionalText(2000),
  lines: z
    .array(z.object({ categoryId: idSchema, amount: positiveAmountSchema }))
    .max(200)
    .default([]),
});
export type BudgetInput = z.input<typeof budgetSchema>;

export const savingsGoalSchema = z.object({
  name: requiredText(120),
  targetAmount: positiveAmountSchema,
  currency: currencySchema.default('EGP'),
  deadline: isoDateSchema.nullable().optional(),
  priority: z.coerce.number().int().min(1).max(3).default(2),
  /** 'accounts' = progress is the balance of linked accounts; 'manual' = contributions you record. */
  mode: z.enum(['accounts', 'manual']).default('manual'),
  accountIds: z.array(idSchema).max(20).default([]),
  monthlyTarget: nonNegativeAmountSchema.nullable().optional(),
  startingAmount: nonNegativeAmountSchema.default('0'),
  workspaceId: optionalId,
  color: colorSchema.optional().nullable(),
  notes: optionalText(4000),
});
export type SavingsGoalInput = z.input<typeof savingsGoalSchema>;

export const contributionSchema = z.object({
  date: isoDateSchema,
  amount: amountInputSchema.refine((s) => Number(s) !== 0, 'Amount cannot be zero'),
  note: optionalText(300),
});

export const fxRateSchema = z.object({
  currency: currencySchema,
  /** 1 unit of `currency` = `rate` units of the base currency. */
  rate: z.coerce.number().positive('Rate must be positive').max(1e9),
  date: isoDateSchema,
});

export const currencyDefSchema = z.object({
  code: currencySchema,
  name: requiredText(60),
  digits: z.coerce.number().int().min(0).max(3).default(2),
});
