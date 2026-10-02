import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { softDelete, timestamps, workspaces } from './core';
import { savingsGoals } from './finance';

export const people = sqliteTable(
  'people',
  {
    id: text('id').primaryKey(),
    fullName: text('full_name').notNull(),
    nickname: text('nickname'),
    relationship: text('relationship').notNull().default('other'),
    company: text('company'),
    /** The company record this person works for (Phase 3); `company` stays as free text. */
    organizationId: text('organization_id'),
    role: text('role'),
    phone: text('phone'),
    phone2: text('phone2'),
    email: text('email'),
    city: text('city'),
    birthday: text('birthday'),
    linkedin: text('linkedin'),
    instagram: text('instagram'),
    website: text('website'),
    source: text('source'),
    workspaceId: text('workspace_id').references(() => workspaces.id),
    nextFollowUp: text('next_follow_up'),
    followUpNote: text('follow_up_note'),
    notes: text('notes'),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index('people_followup_idx').on(t.nextFollowUp)],
);

export const interactions = sqliteTable(
  'interactions',
  {
    id: text('id').primaryKey(),
    personId: text('person_id')
      .notNull()
      .references(() => people.id),
    kind: text('kind').notNull(),
    date: text('date').notNull(),
    summary: text('summary').notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index('interactions_person_idx').on(t.personId, t.date)],
);

export const goals = sqliteTable(
  'goals',
  {
    id: text('id').primaryKey(),
    parentId: text('parent_id'),
    level: text('level').notNull().default('objective'),
    title: text('title').notNull(),
    description: text('description'),
    area: text('area'),
    metric: text('metric').notNull().default('none'),
    startValue: real('start_value').notNull().default(0),
    targetValue: real('target_value'),
    currentValue: real('current_value'),
    unit: text('unit'),
    savingsGoalId: text('savings_goal_id').references(() => savingsGoals.id),
    startDate: text('start_date'),
    deadline: text('deadline'),
    priority: integer('priority').notNull().default(2),
    status: text('status').notNull().default('active'),
    workspaceId: text('workspace_id').references(() => workspaces.id),
    color: text('color'),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index('goals_parent_idx').on(t.parentId)],
);

export const goalCheckins = sqliteTable('goal_checkins', {
  id: text('id').primaryKey(),
  goalId: text('goal_id')
    .notNull()
    .references(() => goals.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  value: real('value').notNull(),
  note: text('note'),
  createdAt: timestamps.createdAt,
});

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status').notNull().default('inbox'),
    priority: integer('priority').notNull().default(3),
    area: text('area'),
    dueDate: text('due_date'),
    dueTime: text('due_time'),
    startDate: text('start_date'),
    completedAt: text('completed_at'),
    workspaceId: text('workspace_id').references(() => workspaces.id),
    projectId: text('project_id'),
    goalId: text('goal_id').references(() => goals.id),
    personId: text('person_id').references(() => people.id),
    assignee: text('assignee'),
    recurrence: text('recurrence'),
    recurrenceInterval: integer('recurrence_interval').notNull().default(1),
    /** What created it automatically (e.g. "followup:<personId>:<date>") — prevents duplicates. */
    source: text('source'),
    sortOrder: real('sort_order').notNull().default(0),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index('tasks_status_idx').on(t.status, t.dueDate),
    index('tasks_ws_idx').on(t.workspaceId),
    index('tasks_goal_idx').on(t.goalId),
    uniqueIndex('tasks_source_unique').on(t.source),
  ],
);

export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description'),
    location: text('location'),
    kind: text('kind').notNull().default('other'),
    /** Local calendar date and wall-clock times in the user's time zone. */
    date: text('date').notNull(),
    endDate: text('end_date'),
    allDay: integer('all_day', { mode: 'boolean' }).notNull().default(false),
    startTime: text('start_time'),
    endTime: text('end_time'),
    workspaceId: text('workspace_id').references(() => workspaces.id),
    personId: text('person_id').references(() => people.id),
    recurrence: text('recurrence'),
    recurrenceInterval: integer('recurrence_interval').notNull().default(1),
    recurrenceUntil: text('recurrence_until'),
    reminderMinutes: integer('reminder_minutes'),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index('events_date_idx').on(t.date)],
);

export const notes = sqliteTable('notes', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  workspaceId: text('workspace_id').references(() => workspaces.id),
  pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
  archivedAt: text('archived_at'),
  ...timestamps,
  ...softDelete,
});

/** Remembers responses to retried POSTs (phone outbox) so a replay never creates duplicates. */
export const idempotencyKeys = sqliteTable('idempotency_keys', {
  key: text('key').primaryKey(),
  status: integer('status').notNull(),
  body: text('body').notNull(),
  createdAt: timestamps.createdAt,
});
