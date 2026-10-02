import { z } from 'zod';
import { positiveAmountSchema, nonNegativeAmountSchema } from './finance';
import { colorSchema, currencySchema, idSchema, isoDateSchema, optionalText, requiredText } from './common';

const optionalId = idSchema.nullable().optional();

export const ORG_TYPES = ['company', 'client', 'supplier', 'partner', 'employer', 'government', 'other'] as const;

export const organizationSchema = z.object({
  name: requiredText(200),
  type: z.enum(ORG_TYPES).default('company'),
  industry: optionalText(120),
  website: optionalText(300),
  phone: optionalText(40),
  email: z
    .string()
    .trim()
    .max(200)
    .email('Not a valid email')
    .or(z.literal(''))
    .nullable()
    .optional()
    .transform((v) => v || null),
  address: optionalText(500),
  city: optionalText(120),
  instagram: optionalText(300),
  notes: optionalText(20000),
  tags: z.array(z.string()).max(30).optional(),
});
export type OrganizationInput = z.input<typeof organizationSchema>;

/** The role a person or company plays for one of your businesses. */
export const BUSINESS_ROLES = ['lead', 'prospect', 'client', 'supplier', 'partner', 'contractor', 'designer', 'employee', 'investor', 'other'] as const;
export type BusinessRole = (typeof BUSINESS_ROLES)[number];

export const relationSchema = z
  .object({
    workspaceId: idSchema,
    personId: optionalId,
    organizationId: optionalId,
    role: z.enum(BUSINESS_ROLES),
    status: z.enum(['active', 'inactive']).default('active'),
    since: isoDateSchema.nullable().optional(),
    notes: optionalText(4000),
  })
  .refine((v) => !!v.personId !== !!v.organizationId, { path: ['personId'], message: 'Choose a person or a company' });
export type RelationInput = z.input<typeof relationSchema>;

export const STAGE_KINDS = ['open', 'won', 'lost'] as const;

export const stageSchema = z.object({
  id: idSchema.optional(),
  name: requiredText(60),
  probability: z.coerce.number().int().min(0).max(100).default(0),
  kind: z.enum(STAGE_KINDS).default('open'),
  color: colorSchema.nullable().optional(),
});

export const pipelineSchema = z
  .object({
    workspaceId: idSchema,
    name: requiredText(80),
    stages: z.array(stageSchema).min(2, 'Add at least two stages').max(30),
  })
  .refine((v) => v.stages.some((s) => s.kind === 'won') && v.stages.some((s) => s.kind === 'lost'), {
    path: ['stages'],
    message: 'A pipeline needs one “won” and one “lost” stage',
  });
export type PipelineInput = z.input<typeof pipelineSchema>;

export const opportunitySchema = z.object({
  title: requiredText(200),
  workspaceId: idSchema,
  pipelineId: optionalId,
  stageId: optionalId,
  personId: optionalId,
  organizationId: optionalId,
  value: nonNegativeAmountSchema.default('0'),
  currency: currencySchema.default('EGP'),
  /** Overrides the stage's default probability when set. */
  probability: z.coerce.number().int().min(0).max(100).nullable().optional(),
  expectedClose: isoDateSchema.nullable().optional(),
  owner: optionalText(120),
  source: optionalText(120),
  nextAction: optionalText(300),
  nextActionDate: isoDateSchema.nullable().optional(),
  lostReason: optionalText(500),
  notes: optionalText(20000),
  tags: z.array(z.string()).max(30).optional(),
});
export type OpportunityInput = z.input<typeof opportunitySchema>;

export const PROJECT_STATUSES = ['planning', 'active', 'on_hold', 'completed', 'cancelled'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const projectSchema = z
  .object({
    name: requiredText(200),
    description: optionalText(20000),
    workspaceId: optionalId,
    personId: optionalId,
    organizationId: optionalId,
    opportunityId: optionalId,
    goalId: optionalId,
    status: z.enum(PROJECT_STATUSES).default('planning'),
    priority: z.coerce.number().int().min(1).max(4).default(3),
    owner: optionalText(120),
    startDate: isoDateSchema.nullable().optional(),
    deadline: isoDateSchema.nullable().optional(),
    currency: currencySchema.default('EGP'),
    budget: nonNegativeAmountSchema.nullable().optional(),
    contractValue: nonNegativeAmountSchema.nullable().optional(),
    color: colorSchema.nullable().optional(),
    tags: z.array(z.string()).max(30).optional(),
  })
  .refine((v) => !v.startDate || !v.deadline || v.deadline >= v.startDate, { path: ['deadline'], message: 'Deadline must be after the start date' });
export type ProjectInput = z.input<typeof projectSchema>;

export const milestoneSchema = z.object({
  title: requiredText(200),
  dueDate: isoDateSchema.nullable().optional(),
  done: z.boolean().default(false),
  /** Optional amount billed to the client when this milestone is reached (payment stage). */
  amount: positiveAmountSchema.nullable().optional(),
});
