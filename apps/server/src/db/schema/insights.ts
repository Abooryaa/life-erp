import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { softDelete, timestamps, workspaces } from './core';

export const assets = sqliteTable('assets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  liquidity: text('liquidity').notNull().default('non_liquid'),
  workspaceId: text('workspace_id').references(() => workspaces.id),
  currency: text('currency').notNull().default('EGP'),
  purchaseDate: text('purchase_date'),
  purchasePrice: integer('purchase_price'),
  quantity: real('quantity'),
  unit: text('unit'),
  includeInNetWorth: integer('include_in_net_worth', { mode: 'boolean' }).notNull().default(true),
  /** Set when sold/given away: it then stops counting from that date. */
  disposedAt: text('disposed_at'),
  disposedValue: integer('disposed_value'),
  notes: text('notes'),
  ...timestamps,
  ...softDelete,
});

export const assetValuations = sqliteTable(
  'asset_valuations',
  {
    id: text('id').primaryKey(),
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    value: integer('value').notNull(),
    note: text('note'),
    createdAt: timestamps.createdAt,
  },
  (t) => [index('asset_val_idx').on(t.assetId, t.date)],
);

/** One row per day, written by a job: the history behind the net-worth trend. */
export const netWorthSnapshots = sqliteTable('net_worth_snapshots', {
  date: text('date').primaryKey(),
  base: text('base').notNull(),
  liquid: integer('liquid').notNull(),
  investments: integer('investments').notNull(),
  otherAssets: integer('other_assets').notNull(),
  liabilities: integer('liabilities').notNull(),
  netWorth: integer('net_worth').notNull(),
  createdAt: timestamps.createdAt,
});

export const reviews = sqliteTable(
  'reviews',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    periodStart: text('period_start').notNull(),
    periodEnd: text('period_end').notNull(),
    wins: text('wins'),
    challenges: text('challenges'),
    lessons: text('lessons'),
    priorities: text('priorities'),
    rating: integer('rating'),
    /** JSON: the numbers as they were when the review was saved. */
    metrics: text('metrics'),
    completedAt: text('completed_at'),
    ...timestamps,
  },
  (t) => [uniqueIndex('reviews_period_uq').on(t.type, t.periodStart)],
);

export const scenarios = sqliteTable('scenarios', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  horizonMonths: integer('horizon_months').notNull().default(12),
  monthlyIncome: integer('monthly_income'),
  monthlyExpenses: integer('monthly_expenses'),
  startBalance: integer('start_balance'),
  /** JSON array of adjustments (amounts in minor units of the base currency). */
  adjustments: text('adjustments').notNull().default('[]'),
  notes: text('notes'),
  ...timestamps,
  ...softDelete,
});
