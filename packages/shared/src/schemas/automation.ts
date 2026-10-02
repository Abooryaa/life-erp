import { z } from 'zod';
import { AUTOMATION_EVENT_KEYS, CONDITION_OPS, type AutomationEvent } from '../automation';
import { DATE_FORMATS } from '../csv';
import { ENTITY_TYPES } from '../entities';
import { idSchema, optionalText, requiredText } from './common';

export const conditionSchema = z.object({
  field: z.string().min(1).max(60),
  op: z.enum(CONDITION_OPS),
  value: z.string().max(500).nullable().optional(),
});

export const automationActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('notify'),
    severity: z.enum(['info', 'reminder', 'warning']).default('reminder'),
    title: requiredText(200),
    body: optionalText(1000),
  }),
  z.object({
    type: z.literal('create_task'),
    title: requiredText(200),
    priority: z.coerce.number().int().min(1).max(4).default(3),
    /** Null = no due date. */
    dueInDays: z.coerce.number().int().min(0).max(365).nullable().optional(),
    /** 'record' = the triggering record's workspace. */
    workspace: z.enum(['record', 'none']).default('record'),
  }),
  z.object({
    type: z.literal('add_tag'),
    tag: requiredText(40),
  }),
]);
export type AutomationAction = z.infer<typeof automationActionSchema>;

export const scheduleSchema = z
  .object({
    frequency: z.enum(['daily', 'weekly', 'monthly']),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm'),
    weekday: z.coerce.number().int().min(0).max(6).nullable().optional(),
    dayOfMonth: z.coerce.number().int().min(1).max(31).nullable().optional(),
  })
  .refine((s) => s.frequency !== 'weekly' || s.weekday != null, { path: ['weekday'], message: 'Required' })
  .refine((s) => s.frequency !== 'monthly' || s.dayOfMonth != null, { path: ['dayOfMonth'], message: 'Required' });

export const automationSchema = z
  .object({
    name: requiredText(120),
    enabled: z.boolean().default(true),
    event: z.enum(AUTOMATION_EVENT_KEYS as [AutomationEvent, ...AutomationEvent[]]),
    schedule: scheduleSchema.nullable().optional(),
    conditions: z.array(conditionSchema).max(10).default([]),
    actions: z.array(automationActionSchema).min(1, 'Add at least one action').max(5),
  })
  .refine((a) => a.event !== 'schedule' || !!a.schedule, { path: ['schedule'], message: 'Choose when it runs' })
  .refine((a) => a.event !== 'schedule' || a.actions.every((x) => x.type !== 'add_tag'), { path: ['actions'], message: 'A scheduled rule has no record to tag' })
  .refine((a) => a.event !== 'schedule' || a.conditions.length === 0, { path: ['conditions'], message: 'A scheduled rule has no conditions' });
export type AutomationInput = z.input<typeof automationSchema>;

// ---------- custom fields ----------

export const CUSTOM_FIELD_TYPES = ['text', 'number', 'date', 'select', 'checkbox', 'url'] as const;
/** Records that can carry custom fields. */
export const CUSTOM_FIELD_ENTITIES = ['person', 'organization', 'project', 'task', 'opportunity', 'job_application', 'employment', 'asset', 'transaction', 'document'] as const satisfies readonly (typeof ENTITY_TYPES)[number][];

export const customFieldDefSchema = z
  .object({
    entityType: z.enum(CUSTOM_FIELD_ENTITIES),
    label: requiredText(60),
    type: z.enum(CUSTOM_FIELD_TYPES),
    options: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
    required: z.boolean().default(false),
  })
  .refine((f) => f.type !== 'select' || f.options.length > 0, { path: ['options'], message: 'Add at least one option' });
export type CustomFieldDefInput = z.input<typeof customFieldDefSchema>;

// ---------- import ----------

export const IMPORT_TARGETS = ['transactions', 'people', 'organizations', 'tasks', 'assets', 'applications'] as const;
export type ImportTarget = (typeof IMPORT_TARGETS)[number];

export const importOptionsSchema = z.object({
  dateFormat: z.enum(DATE_FORMATS).default('yyyy-MM-dd'),
  decimal: z.enum(['.', ',']).default('.'),
  /** transactions: every row goes into this account. */
  accountId: idSchema.nullable().optional(),
  /** transactions: one signed amount column, or separate money-in / money-out columns. */
  amountMode: z.enum(['signed', 'split']).default('signed'),
  /** transactions: category for rows without a matching category. */
  defaultExpenseCategoryId: idSchema.nullable().optional(),
  defaultIncomeCategoryId: idSchema.nullable().optional(),
  workspaceId: idSchema.nullable().optional(),
  /** Import rows flagged as possible duplicates anyway. */
  includeDuplicates: z.boolean().default(false),
  /** Let automation rules run for imported records (off by default to avoid floods). */
  runAutomations: z.boolean().default(false),
});
export type ImportOptions = z.infer<typeof importOptionsSchema>;

export const importRequestSchema = z.object({
  target: z.enum(IMPORT_TARGETS),
  fileName: optionalText(200),
  /** Raw file contents: CSV text, or a JSON array of objects. */
  content: z.string().min(1, 'The file is empty').max(10_000_000, 'The file is too large (10 MB max)'),
  format: z.enum(['csv', 'json']).default('csv'),
  delimiter: z.enum([',', ';', '\t']).nullable().optional(),
  /** field key → column name in the file. */
  mapping: z.record(z.string(), z.string()).default({}),
  options: importOptionsSchema.prefault({}),
});
export type ImportRequest = z.input<typeof importRequestSchema>;

export const importPresetSchema = z.object({
  name: requiredText(80),
  target: z.enum(IMPORT_TARGETS),
  mapping: z.record(z.string(), z.string()),
  options: importOptionsSchema.partial(),
});
