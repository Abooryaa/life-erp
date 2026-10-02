import { z } from 'zod';
import { ENTITY_TYPES } from '../entities';
import { CURRENCY_CODES } from '../money';

export const idSchema = z.string().min(10).max(64);
export const entityTypeSchema = z.enum(ENTITY_TYPES);

/** Calendar date without time, e.g. "2026-10-02". */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  }, 'Not a real calendar date');

export const currencySchema = z.enum(CURRENCY_CODES as [string, ...string[]]);

export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #3366ff');

export const trimmed = (max: number) => z.string().trim().max(max);
export const requiredText = (max: number) => z.string().trim().min(1, 'Required').max(max);
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const entityRefSchema = z.object({
  type: entityTypeSchema,
  id: idSchema,
});
export type EntityRef = z.infer<typeof entityRefSchema>;

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
