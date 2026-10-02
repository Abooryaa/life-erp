import { z } from 'zod';
import { amountInputSchema, nonNegativeAmountSchema } from './finance';
import { currencySchema, idSchema, isoDateSchema, optionalText, requiredText } from './common';

export const ASSET_TYPES = ['real_estate', 'vehicle', 'gold', 'stocks', 'fund', 'crypto', 'business_equity', 'equipment', 'collectible', 'other'] as const;
export const ASSET_LIQUIDITY = ['liquid', 'non_liquid'] as const;

export const assetSchema = z.object({
  name: requiredText(120),
  type: z.enum(ASSET_TYPES),
  liquidity: z.enum(ASSET_LIQUIDITY).default('non_liquid'),
  workspaceId: idSchema.nullable().optional(),
  currency: currencySchema.default('EGP'),
  purchaseDate: isoDateSchema.nullable().optional(),
  purchasePrice: nonNegativeAmountSchema.nullable().optional(),
  /** e.g. 50 (grams), 120 (shares) — informational. */
  quantity: z.coerce.number().nonnegative().max(1e12).nullable().optional(),
  unit: optionalText(20),
  includeInNetWorth: z.boolean().default(true),
  notes: optionalText(4000),
  /** Required when creating: what it is worth now (becomes the first valuation). */
  currentValue: nonNegativeAmountSchema.optional(),
  valuationDate: isoDateSchema.optional(),
});
export type AssetInput = z.input<typeof assetSchema>;

export const valuationSchema = z.object({
  date: isoDateSchema,
  value: nonNegativeAmountSchema,
  note: optionalText(300),
});

export const disposeAssetSchema = z.object({
  date: isoDateSchema,
  value: nonNegativeAmountSchema,
});

export const REVIEW_TYPES = ['weekly', 'monthly'] as const;
export type ReviewType = (typeof REVIEW_TYPES)[number];

export const reviewSchema = z.object({
  type: z.enum(REVIEW_TYPES),
  periodStart: isoDateSchema,
  wins: optionalText(8000),
  challenges: optionalText(8000),
  lessons: optionalText(8000),
  priorities: optionalText(8000),
  rating: z.coerce.number().int().min(1).max(5).nullable().optional(),
  completed: z.boolean().default(false),
});
export type ReviewInput = z.input<typeof reviewSchema>;

export const scenarioAdjustmentSchema = z
  .object({
    label: requiredText(120),
    /** Positive = money in, negative = money out, in the base currency. */
    amount: amountInputSchema,
    kind: z.enum(['monthly', 'once']),
    /** 1 = the first projected month. */
    startMonth: z.coerce.number().int().min(1).max(120),
    endMonth: z.coerce.number().int().min(1).max(120).nullable().optional(),
  })
  .refine((a) => a.endMonth == null || a.endMonth >= a.startMonth, { path: ['endMonth'], message: 'Must be after the start month' });

export const scenarioSchema = z.object({
  name: requiredText(120),
  horizonMonths: z.coerce.number().int().min(1).max(120).default(12),
  /** Null = use the average of the last 3 complete months. */
  monthlyIncome: nonNegativeAmountSchema.nullable().optional(),
  monthlyExpenses: nonNegativeAmountSchema.nullable().optional(),
  /** Null = current cash (liquid accounts). */
  startBalance: amountInputSchema.nullable().optional(),
  adjustments: z.array(scenarioAdjustmentSchema).max(50).default([]),
  notes: optionalText(4000),
});
export type ScenarioInput = z.input<typeof scenarioSchema>;

export const DASHBOARD_WIDGETS = ['attention', 'backup', 'today', 'money', 'networth', 'review', 'business', 'career', 'goals', 'documents', 'workspaces', 'activity'] as const;
export type DashboardWidget = (typeof DASHBOARD_WIDGETS)[number];
