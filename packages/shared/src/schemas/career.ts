import { z } from 'zod';
import { nonNegativeAmountSchema } from './finance';
import { currencySchema, idSchema, isoDateSchema, optionalText, requiredText } from './common';

const optionalId = idSchema.nullable().optional();

export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'freelance', 'internship', 'other'] as const;
export const SALARY_PERIODS = ['monthly', 'yearly', 'hourly', 'project'] as const;

export const employmentSchema = z
  .object({
    company: requiredText(200),
    organizationId: optionalId,
    position: requiredText(200),
    department: optionalText(120),
    employmentType: z.enum(EMPLOYMENT_TYPES).default('full_time'),
    startDate: isoDateSchema,
    endDate: isoDateSchema.nullable().optional(),
    salary: nonNegativeAmountSchema.nullable().optional(),
    currency: currencySchema.default('EGP'),
    salaryPeriod: z.enum(SALARY_PERIODS).default('monthly'),
    benefits: optionalText(4000),
    location: optionalText(200),
    workSchedule: optionalText(200),
    managerName: optionalText(160),
    managerPersonId: optionalId,
    responsibilities: optionalText(20000),
    notes: optionalText(20000),
    tags: z.array(z.string()).max(30).optional(),
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, { path: ['endDate'], message: 'End date must be after the start date' });
export type EmploymentInput = z.input<typeof employmentSchema>;

/** Kinds give custom statuses their meaning for analytics. */
export const APPLICATION_STATUS_KINDS = ['saved', 'active', 'interview', 'offer', 'accepted', 'rejected', 'withdrawn'] as const;
export type ApplicationStatusKind = (typeof APPLICATION_STATUS_KINDS)[number];

export const applicationStatusSchema = z.object({
  id: idSchema.optional(),
  name: requiredText(60),
  kind: z.enum(APPLICATION_STATUS_KINDS),
});

export const WORK_MODES = ['onsite', 'hybrid', 'remote'] as const;

export const applicationSchema = z
  .object({
    company: requiredText(200),
    organizationId: optionalId,
    position: requiredText(200),
    statusId: optionalId,
    source: optionalText(120),
    url: optionalText(1000),
    location: optionalText(200),
    workMode: z.enum(WORK_MODES).nullable().optional(),
    appliedDate: isoDateSchema.nullable().optional(),
    salaryMin: nonNegativeAmountSchema.nullable().optional(),
    salaryMax: nonNegativeAmountSchema.nullable().optional(),
    currency: currencySchema.default('EGP'),
    recruiterPersonId: optionalId,
    followUpDate: isoDateSchema.nullable().optional(),
    cvVersion: optionalText(120),
    jobDescription: optionalText(50000),
    outcome: optionalText(4000),
    priority: z.coerce.number().int().min(1).max(3).default(2),
    notes: optionalText(20000),
    tags: z.array(z.string()).max(30).optional(),
  })
  .refine((v) => !v.salaryMin || !v.salaryMax || Number(v.salaryMax) >= Number(v.salaryMin), { path: ['salaryMax'], message: 'Maximum must be at least the minimum' });
export type ApplicationInput = z.input<typeof applicationSchema>;

export const INTERVIEW_MODES = ['onsite', 'video', 'phone'] as const;
export const INTERVIEW_OUTCOMES = ['pending', 'passed', 'failed', 'cancelled'] as const;

export const interviewSchema = z.object({
  applicationId: idSchema,
  stage: requiredText(120),
  date: isoDateSchema,
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm')
    .nullable()
    .optional(),
  mode: z.enum(INTERVIEW_MODES).default('video'),
  location: optionalText(500),
  interviewer: optionalText(200),
  outcome: z.enum(INTERVIEW_OUTCOMES).default('pending'),
  notes: optionalText(20000),
});
export type InterviewInput = z.input<typeof interviewSchema>;

export const achievementSchema = z.object({
  date: isoDateSchema,
  employmentId: optionalId,
  company: optionalText(200),
  role: optionalText(200),
  title: requiredText(300),
  description: optionalText(20000),
  metric: optionalText(300),
  impact: optionalText(2000),
  skillIds: z.array(idSchema).max(30).default([]),
  cvRelevance: z.coerce.number().int().min(1).max(3).default(2),
  cvBullet: optionalText(500),
  tags: z.array(z.string()).max(30).optional(),
});
export type AchievementInput = z.input<typeof achievementSchema>;

export const SKILL_CATEGORIES = ['technical', 'data', 'business', 'management', 'design', 'language', 'soft', 'tool', 'other'] as const;

export const skillSchema = z.object({
  name: requiredText(120),
  category: z.enum(SKILL_CATEGORIES).default('technical'),
  level: z.coerce.number().int().min(0).max(5).default(1),
  targetLevel: z.coerce.number().int().min(0).max(5).nullable().optional(),
  lastUsed: isoDateSchema.nullable().optional(),
  evidence: optionalText(4000),
  goalId: optionalId,
  notes: optionalText(4000),
});
export type SkillInput = z.input<typeof skillSchema>;

export const LEARNING_TYPES = ['course', 'book', 'tutorial', 'certification', 'workshop', 'degree', 'other'] as const;
export const LEARNING_STATUSES = ['planned', 'in_progress', 'paused', 'completed', 'dropped'] as const;

export const learningSchema = z.object({
  title: requiredText(300),
  type: z.enum(LEARNING_TYPES).default('course'),
  provider: optionalText(200),
  url: optionalText(1000),
  skillId: optionalId,
  goalId: optionalId,
  status: z.enum(LEARNING_STATUSES).default('planned'),
  startDate: isoDateSchema.nullable().optional(),
  deadline: isoDateSchema.nullable().optional(),
  progress: z.coerce.number().int().min(0).max(100).default(0),
  cost: nonNegativeAmountSchema.nullable().optional(),
  currency: currencySchema.default('EGP'),
  notes: optionalText(20000),
  tags: z.array(z.string()).max(30).optional(),
});
export type LearningInput = z.input<typeof learningSchema>;
