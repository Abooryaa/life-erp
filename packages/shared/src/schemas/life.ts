import { z } from 'zod';
import { FREQUENCIES } from '../finance';
import { colorSchema, idSchema, isoDateSchema, optionalText, requiredText } from './common';

const optionalId = idSchema.nullable().optional();

export const TASK_STATUSES = ['inbox', 'planned', 'in_progress', 'waiting', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const OPEN_TASK_STATUSES: TaskStatus[] = ['inbox', 'planned', 'in_progress', 'waiting'];

/** 1 = urgent, 2 = high, 3 = normal, 4 = low */
export const TASK_PRIORITIES = [1, 2, 3, 4] as const;

export const LIFE_AREAS = ['personal', 'business', 'career', 'finance', 'learning', 'health', 'family', 'other'] as const;
export type LifeArea = (typeof LIFE_AREAS)[number];

export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');

export const taskSchema = z.object({
  title: requiredText(300),
  description: optionalText(20000),
  status: z.enum(TASK_STATUSES).default('inbox'),
  priority: z.coerce.number().int().min(1).max(4).default(3),
  area: z.enum(LIFE_AREAS).nullable().optional(),
  dueDate: isoDateSchema.nullable().optional(),
  dueTime: timeSchema.nullable().optional(),
  startDate: isoDateSchema.nullable().optional(),
  workspaceId: optionalId,
  projectId: optionalId,
  goalId: optionalId,
  personId: optionalId,
  assignee: optionalText(120),
  recurrence: z.enum(FREQUENCIES).nullable().optional(),
  recurrenceInterval: z.coerce.number().int().min(1).max(365).default(1),
  tags: z.array(z.string()).max(30).optional(),
});
export type TaskInput = z.input<typeof taskSchema>;

export const EVENT_KINDS = ['meeting', 'appointment', 'deadline', 'reminder', 'personal', 'other'] as const;

export const eventSchema = z
  .object({
    title: requiredText(300),
    description: optionalText(20000),
    location: optionalText(300),
    kind: z.enum(EVENT_KINDS).default('other'),
    date: isoDateSchema,
    endDate: isoDateSchema.nullable().optional(),
    allDay: z.boolean().default(false),
    startTime: timeSchema.nullable().optional(),
    endTime: timeSchema.nullable().optional(),
    workspaceId: optionalId,
    personId: optionalId,
    recurrence: z.enum(FREQUENCIES).nullable().optional(),
    recurrenceInterval: z.coerce.number().int().min(1).max(365).default(1),
    recurrenceUntil: isoDateSchema.nullable().optional(),
    reminderMinutes: z.coerce.number().int().min(0).max(43200).nullable().optional(),
    tags: z.array(z.string()).max(30).optional(),
  })
  .refine((v) => v.allDay || !!v.startTime, { path: ['startTime'], message: 'Set a start time or make it all-day' })
  .refine((v) => !v.endDate || v.endDate >= v.date, { path: ['endDate'], message: 'End must be after the start' })
  .refine((v) => v.allDay || !v.endTime || !v.startTime || (v.endDate && v.endDate > v.date) || v.endTime > v.startTime, {
    path: ['endTime'],
    message: 'End must be after the start',
  });
export type EventInput = z.input<typeof eventSchema>;

export const GOAL_LEVELS = ['vision', 'long_term', 'objective', 'milestone'] as const;
export type GoalLevel = (typeof GOAL_LEVELS)[number];
export const GOAL_METRICS = ['none', 'numeric', 'tasks', 'children', 'savings'] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];

export const goalSchema = z.object({
  title: requiredText(200),
  description: optionalText(20000),
  level: z.enum(GOAL_LEVELS).default('objective'),
  parentId: optionalId,
  area: z.enum(LIFE_AREAS).nullable().optional(),
  metric: z.enum(GOAL_METRICS).default('none'),
  startValue: z.coerce.number().default(0),
  targetValue: z.coerce.number().nullable().optional(),
  currentValue: z.coerce.number().nullable().optional(),
  unit: optionalText(30),
  savingsGoalId: optionalId,
  startDate: isoDateSchema.nullable().optional(),
  deadline: isoDateSchema.nullable().optional(),
  priority: z.coerce.number().int().min(1).max(3).default(2),
  status: z.enum(['active', 'achieved', 'paused', 'dropped']).default('active'),
  workspaceId: optionalId,
  color: colorSchema.nullable().optional(),
  tags: z.array(z.string()).max(30).optional(),
});
export type GoalInput = z.input<typeof goalSchema>;

export const checkinSchema = z.object({
  date: isoDateSchema,
  value: z.coerce.number(),
  note: optionalText(500),
});

export const noteSchema = z.object({
  title: requiredText(300),
  body: z.string().max(500_000).default(''),
  workspaceId: optionalId,
  pinned: z.boolean().default(false),
  tags: z.array(z.string()).max(30).optional(),
});
export type NoteInput = z.input<typeof noteSchema>;

export const RELATIONSHIPS = ['family', 'friend', 'professional', 'client', 'recruiter', 'contractor', 'supplier', 'partner', 'colleague', 'other'] as const;

export const personSchema = z.object({
  fullName: requiredText(160),
  nickname: optionalText(80),
  relationship: z.enum(RELATIONSHIPS).default('other'),
  company: optionalText(160),
  organizationId: optionalId,
  role: optionalText(160),
  phone: optionalText(40),
  phone2: optionalText(40),
  email: z
    .string()
    .trim()
    .max(200)
    .email('Not a valid email')
    .or(z.literal(''))
    .nullable()
    .optional()
    .transform((v) => v || null),
  city: optionalText(120),
  birthday: isoDateSchema.nullable().optional(),
  linkedin: optionalText(300),
  instagram: optionalText(300),
  website: optionalText(300),
  source: optionalText(120),
  workspaceId: optionalId,
  nextFollowUp: isoDateSchema.nullable().optional(),
  followUpNote: optionalText(300),
  notes: optionalText(20000),
  tags: z.array(z.string()).max(30).optional(),
});
export type PersonInput = z.input<typeof personSchema>;

export const INTERACTION_KINDS = ['call', 'whatsapp', 'email', 'meeting', 'message', 'note'] as const;

export const interactionSchema = z.object({
  personId: idSchema,
  kind: z.enum(INTERACTION_KINDS).default('call'),
  date: isoDateSchema,
  summary: requiredText(4000),
  workspaceId: optionalId,
  /** Set the person's next follow-up date at the same time. */
  nextFollowUp: isoDateSchema.nullable().optional(),
});
