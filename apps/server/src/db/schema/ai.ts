import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { timestamps } from './core';

/**
 * Secrets such as an AI API key, encrypted with AES-256-GCM. The master key lives in
 * <data>/keys (not in the database and not in backups) — a restored backup needs the key re-entered.
 */
export const secrets = sqliteTable('secrets', {
  name: text('name').primaryKey(),
  ciphertext: text('ciphertext').notNull(),
  iv: text('iv').notNull(),
  tag: text('tag').notNull(),
  /** Last 4 characters, to recognise which key is stored. */
  hint: text('hint').notNull(),
  ...timestamps,
});

/** Every AI request: what was asked, which of your data it read, and how it went. */
export const aiCalls = sqliteTable(
  'ai_calls',
  {
    id: text('id').primaryKey(),
    at: text('at').notNull(),
    purpose: text('purpose').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    question: text('question').notNull(),
    /** JSON: [{ name, args }] — the data tools the AI used. */
    tools: text('tools').notNull().default('[]'),
    /** Characters of your data sent to the provider (tool results + context). */
    dataChars: integer('data_chars').notNull().default(0),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    durationMs: integer('duration_ms').notNull().default(0),
    status: text('status').notNull(),
    error: text('error'),
    answer: text('answer'),
  },
  (t) => [index('ai_calls_at_idx').on(t.at)],
);
