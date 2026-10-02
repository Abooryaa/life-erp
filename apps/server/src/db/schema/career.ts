import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { organizations } from './business';
import { softDelete, timestamps } from './core';
import { goals, people } from './life';

export const employments = sqliteTable('employments', {
  id: text('id').primaryKey(),
  company: text('company').notNull(),
  organizationId: text('organization_id').references(() => organizations.id),
  position: text('position').notNull(),
  department: text('department'),
  employmentType: text('employment_type').notNull().default('full_time'),
  startDate: text('start_date').notNull(),
  /** Null = current job. */
  endDate: text('end_date'),
  salary: integer('salary'),
  currency: text('currency').notNull().default('EGP'),
  salaryPeriod: text('salary_period').notNull().default('monthly'),
  benefits: text('benefits'),
  location: text('location'),
  workSchedule: text('work_schedule'),
  managerName: text('manager_name'),
  managerPersonId: text('manager_person_id').references(() => people.id),
  responsibilities: text('responsibilities'),
  notes: text('notes'),
  ...timestamps,
  ...softDelete,
});

export const applicationStatuses = sqliteTable('application_statuses', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const jobApplications = sqliteTable(
  'job_applications',
  {
    id: text('id').primaryKey(),
    company: text('company').notNull(),
    organizationId: text('organization_id').references(() => organizations.id),
    position: text('position').notNull(),
    statusId: text('status_id')
      .notNull()
      .references(() => applicationStatuses.id),
    source: text('source'),
    url: text('url'),
    location: text('location'),
    workMode: text('work_mode'),
    appliedDate: text('applied_date'),
    salaryMin: integer('salary_min'),
    salaryMax: integer('salary_max'),
    currency: text('currency').notNull().default('EGP'),
    recruiterPersonId: text('recruiter_person_id').references(() => people.id),
    followUpDate: text('follow_up_date'),
    cvVersion: text('cv_version'),
    jobDescription: text('job_description'),
    outcome: text('outcome'),
    priority: integer('priority').notNull().default(2),
    closedAt: text('closed_at'),
    notes: text('notes'),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index('apps_status_idx').on(t.statusId)],
);

export const interviews = sqliteTable(
  'interviews',
  {
    id: text('id').primaryKey(),
    applicationId: text('application_id')
      .notNull()
      .references(() => jobApplications.id, { onDelete: 'cascade' }),
    stage: text('stage').notNull(),
    date: text('date').notNull(),
    time: text('time'),
    mode: text('mode').notNull().default('video'),
    location: text('location'),
    interviewer: text('interviewer'),
    outcome: text('outcome').notNull().default('pending'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [index('interviews_app_idx').on(t.applicationId), index('interviews_date_idx').on(t.date)],
);

export const skills = sqliteTable('skills', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  category: text('category').notNull().default('technical'),
  level: integer('level').notNull().default(1),
  targetLevel: integer('target_level'),
  lastUsed: text('last_used'),
  evidence: text('evidence'),
  goalId: text('goal_id').references(() => goals.id),
  notes: text('notes'),
  ...timestamps,
  ...softDelete,
});

export const achievements = sqliteTable(
  'achievements',
  {
    id: text('id').primaryKey(),
    date: text('date').notNull(),
    employmentId: text('employment_id').references(() => employments.id),
    company: text('company'),
    role: text('role'),
    title: text('title').notNull(),
    description: text('description'),
    metric: text('metric'),
    impact: text('impact'),
    cvRelevance: integer('cv_relevance').notNull().default(2),
    cvBullet: text('cv_bullet'),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index('achievements_emp_idx').on(t.employmentId)],
);

export const achievementSkills = sqliteTable(
  'achievement_skills',
  {
    achievementId: text('achievement_id')
      .notNull()
      .references(() => achievements.id, { onDelete: 'cascade' }),
    skillId: text('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.achievementId, t.skillId] })],
);

export const learningItems = sqliteTable('learning_items', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  type: text('type').notNull().default('course'),
  provider: text('provider'),
  url: text('url'),
  skillId: text('skill_id').references(() => skills.id),
  goalId: text('goal_id').references(() => goals.id),
  status: text('status').notNull().default('planned'),
  startDate: text('start_date'),
  deadline: text('deadline'),
  progress: integer('progress').notNull().default(0),
  completedAt: text('completed_at'),
  cost: integer('cost'),
  currency: text('currency').notNull().default('EGP'),
  notes: text('notes'),
  ...timestamps,
  ...softDelete,
});
