import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { softDelete, timestamps, workspaces } from './core';
import { goals, people } from './life';

export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull().default('company'),
  industry: text('industry'),
  website: text('website'),
  phone: text('phone'),
  email: text('email'),
  address: text('address'),
  city: text('city'),
  instagram: text('instagram'),
  notes: text('notes'),
  ...timestamps,
  ...softDelete,
});

/** A person or company's role for one business (lead, client, supplier…). The same contact can have several. */
export const businessRelations = sqliteTable(
  'business_relations',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    personId: text('person_id').references(() => people.id),
    organizationId: text('organization_id').references(() => organizations.id),
    role: text('role').notNull(),
    status: text('status').notNull().default('active'),
    since: text('since'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [
    index('relations_ws_idx').on(t.workspaceId, t.role),
    uniqueIndex('relations_unique').on(t.workspaceId, t.personId, t.organizationId, t.role),
  ],
);

export const pipelines = sqliteTable('pipelines', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id),
  name: text('name').notNull(),
  ...timestamps,
  ...softDelete,
});

export const pipelineStages = sqliteTable(
  'pipeline_stages',
  {
    id: text('id').primaryKey(),
    pipelineId: text('pipeline_id')
      .notNull()
      .references(() => pipelines.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    probability: integer('probability').notNull().default(0),
    kind: text('kind', { enum: ['open', 'won', 'lost'] }).notNull().default('open'),
    color: text('color'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('stages_pipeline_idx').on(t.pipelineId, t.sortOrder)],
);

export const opportunities = sqliteTable(
  'opportunities',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    pipelineId: text('pipeline_id')
      .notNull()
      .references(() => pipelines.id),
    stageId: text('stage_id')
      .notNull()
      .references(() => pipelineStages.id),
    personId: text('person_id').references(() => people.id),
    organizationId: text('organization_id').references(() => organizations.id),
    /** Minor units. */
    value: integer('value').notNull().default(0),
    currency: text('currency').notNull().default('EGP'),
    probability: integer('probability'),
    expectedClose: text('expected_close'),
    owner: text('owner'),
    source: text('source'),
    nextAction: text('next_action'),
    nextActionDate: text('next_action_date'),
    closedAt: text('closed_at'),
    lostReason: text('lost_reason'),
    notes: text('notes'),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index('opps_ws_idx').on(t.workspaceId, t.stageId)],
);

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    workspaceId: text('workspace_id').references(() => workspaces.id),
    personId: text('person_id').references(() => people.id),
    organizationId: text('organization_id').references(() => organizations.id),
    opportunityId: text('opportunity_id').references(() => opportunities.id),
    goalId: text('goal_id').references(() => goals.id),
    status: text('status').notNull().default('planning'),
    priority: integer('priority').notNull().default(3),
    owner: text('owner'),
    startDate: text('start_date'),
    deadline: text('deadline'),
    completedAt: text('completed_at'),
    currency: text('currency').notNull().default('EGP'),
    budget: integer('budget'),
    contractValue: integer('contract_value'),
    color: text('color'),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index('projects_ws_idx').on(t.workspaceId, t.status)],
);

export const milestones = sqliteTable(
  'milestones',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    dueDate: text('due_date'),
    done: integer('done', { mode: 'boolean' }).notNull().default(false),
    doneAt: text('done_at'),
    amount: integer('amount'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamps.createdAt,
  },
  (t) => [index('milestones_project_idx').on(t.projectId)],
);
