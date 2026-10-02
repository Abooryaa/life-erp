import {
  addDays,
  AUTOMATION_EVENTS,
  automationSchema,
  fromMinor,
  lastScheduledAt,
  matchAll,
  renderTemplate,
  type AutomationAction,
  type AutomationEvent,
  type AutomationInput,
  type Condition,
  type ScheduleSpec,
} from '@life-erp/shared';
import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { getDb, tx } from '../../db/client';
import {
  applicationStatuses,
  automationRuns,
  automations,
  documents,
  jobApplications,
  opportunities,
  people,
  pipelineStages,
  projects,
  tasks,
  transactions,
} from '../../db/schema';
import { audit, onAudit, type AuditContext } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { newId, nowIso } from '../../lib/ids';
import { resolveRefs } from '../../lib/registry';
import { parse } from '../../lib/validate';
import { registerJob } from '../../jobs/scheduler';
import { hasUsers } from '../auth/service';
import { nowLocal, today } from '../life/common';
import { createTask } from '../life/tasks';
import { createLink } from '../links/service';
import { notify } from '../notifications/service';
import { reindexEntity } from '../search/service';
import { getTagsFor, setTagsFor } from '../tags/service';

/** Changes made by automations carry this context, so they never trigger automations themselves (no loops). */
export const AUTOMATION_CTX: AuditContext = { userId: null, ip: 'automation' };

type Row = typeof automations.$inferSelect;
type Rec = Record<string, unknown> & { id: string; workspaceId?: string | null };

// ---------- loading the triggering record as plain fields ----------

const LOADERS: Record<string, (ids: string[]) => Rec[]> = {
  transaction: (ids) =>
    getDb()
      .select()
      .from(transactions)
      .where(inArray(transactions.id, ids))
      .all()
      .map((t) => ({ ...t, amount: fromMinor(Math.abs(t.amount), t.currency) })),
  task: (ids) =>
    getDb()
      .select()
      .from(tasks)
      .where(inArray(tasks.id, ids))
      .all()
      .map((t) => ({ ...t, priority: String(t.priority) })),
  opportunity: (ids) =>
    getDb()
      .select({ o: opportunities, stageName: pipelineStages.name, stageKind: pipelineStages.kind })
      .from(opportunities)
      .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
      .where(inArray(opportunities.id, ids))
      .all()
      .map((x) => ({ ...x.o, value: fromMinor(x.o.value, x.o.currency), stageName: x.stageName, stageKind: x.stageKind })),
  project: (ids) => getDb().select().from(projects).where(inArray(projects.id, ids)).all(),
  job_application: (ids) =>
    getDb()
      .select({ a: jobApplications, statusName: applicationStatuses.name, statusKind: applicationStatuses.kind })
      .from(jobApplications)
      .innerJoin(applicationStatuses, eq(applicationStatuses.id, jobApplications.statusId))
      .where(inArray(jobApplications.id, ids))
      .all()
      .map((x) => ({ ...x.a, priority: String(x.a.priority), statusName: x.statusName, statusKind: x.statusKind })),
  person: (ids) => getDb().select().from(people).where(inArray(people.id, ids)).all(),
  document: (ids) =>
    getDb()
      .select()
      .from(documents)
      .where(inArray(documents.id, ids))
      .all()
      .map((d) => ({ ...d, type: d.docType })),
};

/** Most recent records of a type — used by "Test rule" to show what would match. */
const RECENT: Record<string, (event: AutomationEvent) => string[]> = {
  transaction: () => getDb().select({ id: transactions.id }).from(transactions).where(and(isNull(transactions.deletedAt), sql`${transactions.type} <> 'transfer'`)).orderBy(desc(transactions.createdAt)).limit(30).all().map((r) => r.id),
  task: (e) =>
    getDb()
      .select({ id: tasks.id })
      .from(tasks)
      .where(e === 'task.complete' ? and(isNull(tasks.deletedAt), eq(tasks.status, 'done')) : isNull(tasks.deletedAt))
      .orderBy(desc(tasks.updatedAt))
      .limit(30)
      .all()
      .map((r) => r.id),
  opportunity: () => getDb().select({ id: opportunities.id }).from(opportunities).where(isNull(opportunities.deletedAt)).orderBy(desc(opportunities.updatedAt)).limit(30).all().map((r) => r.id),
  project: () => getDb().select({ id: projects.id }).from(projects).where(isNull(projects.deletedAt)).orderBy(desc(projects.createdAt)).limit(30).all().map((r) => r.id),
  job_application: () => getDb().select({ id: jobApplications.id }).from(jobApplications).where(isNull(jobApplications.deletedAt)).orderBy(desc(jobApplications.updatedAt)).limit(30).all().map((r) => r.id),
  person: () => getDb().select({ id: people.id }).from(people).where(isNull(people.deletedAt)).orderBy(desc(people.createdAt)).limit(30).all().map((r) => r.id),
  document: () => getDb().select({ id: documents.id }).from(documents).where(isNull(documents.deletedAt)).orderBy(desc(documents.createdAt)).limit(30).all().map((r) => r.id),
};

// ---------- rules ----------

const shape = (r: Row) => ({
  ...r,
  event: r.event as AutomationEvent,
  schedule: r.schedule ? (JSON.parse(r.schedule) as ScheduleSpec) : null,
  conditions: JSON.parse(r.conditions) as Condition[],
  actions: JSON.parse(r.actions) as AutomationAction[],
});
export type Automation = ReturnType<typeof shape>;

export function listAutomations() {
  return getDb().select().from(automations).orderBy(automations.name).all().map(shape);
}

export function getAutomation(id: string) {
  const r = getDb().select().from(automations).where(eq(automations.id, id)).get();
  if (!r) throw notFound('Automation');
  const runs = getDb().select().from(automationRuns).where(eq(automationRuns.automationId, id)).orderBy(desc(automationRuns.at)).limit(50).all();
  return { ...shape(r), runs };
}

function rowOf(data: ReturnType<typeof automationSchema.parse>) {
  const schedule = data.event === 'schedule' ? (data.schedule ?? null) : null;
  return {
    name: data.name,
    enabled: data.enabled,
    event: data.event,
    schedule: schedule ? JSON.stringify(schedule) : null,
    conditions: JSON.stringify(data.conditions),
    actions: JSON.stringify(data.actions),
    // A new or changed schedule starts from the next occurrence — it never fires for one already past.
    lastScheduled: schedule ? lastScheduledAt(schedule, nowLocal()) : null,
  };
}

export function createAutomation(ctx: AuditContext, input: AutomationInput) {
  const data = parse(automationSchema, input);
  const id = newId();
  getDb().insert(automations).values({ id, ...rowOf(data) }).run();
  audit(ctx, 'automation.create', null, `Automation "${data.name}" created`);
  return getAutomation(id);
}

export function updateAutomation(ctx: AuditContext, id: string, input: Partial<AutomationInput>) {
  const before = getAutomation(id);
  const data = parse(automationSchema, { ...before, ...input });
  const row = rowOf(data);
  // Keep the schedule position if the timetable itself didn't change.
  if (before.schedule && JSON.stringify(before.schedule) === row.schedule) row.lastScheduled = before.lastScheduled;
  getDb().update(automations).set({ ...row, updatedAt: nowIso() }).where(eq(automations.id, id)).run();
  audit(ctx, 'automation.update', null, `Automation "${data.name}" ${input.enabled === false ? 'paused' : input.enabled === true && !before.enabled ? 'resumed' : 'updated'}`);
  return getAutomation(id);
}

export function deleteAutomation(ctx: AuditContext, id: string) {
  const a = getAutomation(id);
  getDb().delete(automations).where(eq(automations.id, id)).run();
  audit(ctx, 'automation.delete', null, `Automation "${a.name}" deleted`, a);
}

// ---------- running ----------

function link(rec: Rec | null, type: string | null) {
  if (!rec || !type) return null;
  return resolveRefs([{ type, id: rec.id }]).get(`${type}:${rec.id}`)?.url ?? null;
}

function runActions(rule: Automation, rec: Rec | null, entityType: string | null, key: string) {
  const vars: Record<string, unknown> = { ...(rec ?? {}), today: today(), rule: rule.name };
  const done: string[] = [];
  rule.actions.forEach((a, i) => {
    const source = `auto:${rule.id}:${key}:${i}`;
    if (a.type === 'notify') {
      notify({
        severity: a.severity,
        title: renderTemplate(a.title, vars).slice(0, 200),
        body: a.body ? renderTemplate(a.body, vars).slice(0, 1000) : null,
        link: link(rec, entityType),
        entity: rec && entityType ? { type: entityType, id: rec.id } : undefined,
        dedupeKey: source,
      });
      done.push('notified');
    } else if (a.type === 'create_task') {
      const task = createTask(
        AUTOMATION_CTX,
        {
          title: renderTemplate(a.title, vars).slice(0, 200) || rule.name,
          status: 'planned',
          priority: a.priority,
          dueDate: a.dueInDays == null ? null : addDays(today(), a.dueInDays),
          workspaceId: a.workspace === 'record' ? (rec?.workspaceId ?? null) : null,
        },
        { source },
      );
      if (rec && entityType) createLink(AUTOMATION_CTX, { type: 'task', id: task.id }, { type: entityType as never, id: rec.id }, 'automation');
      done.push('task created');
    } else if (a.type === 'add_tag' && rec && entityType) {
      const current = getTagsFor(entityType, rec.id);
      if (!current.includes(a.tag.toLowerCase())) {
        setTagsFor(entityType, rec.id, [...current, a.tag]);
        reindexEntity(entityType, rec.id);
      }
      done.push(`#${a.tag}`);
    }
  });
  return done.join(', ');
}

function logRun(rule: Automation, status: 'ok' | 'error', rec: Rec | null, entityType: string | null, message: string) {
  const db = getDb();
  const at = nowIso();
  db.insert(automationRuns).values({ id: newId(), automationId: rule.id, at, status, entityType: rec ? entityType : null, entityId: rec?.id ?? null, message: message.slice(0, 500) }).run();
  db.update(automations)
    .set({ lastRunAt: at, runCount: sql`${automations.runCount} + 1` })
    .where(eq(automations.id, rule.id))
    .run();
  // Keep the log small: the last 200 runs per rule.
  const cutoff = db.select({ at: automationRuns.at }).from(automationRuns).where(eq(automationRuns.automationId, rule.id)).orderBy(desc(automationRuns.at)).limit(1).offset(200).get();
  if (cutoff) db.delete(automationRuns).where(and(eq(automationRuns.automationId, rule.id), lt(automationRuns.at, cutoff.at))).run();
}

/** Run one rule; a failing action never breaks the change that triggered it (savepoint + rollback). */
function execute(rule: Automation, rec: Rec | null, entityType: string | null, key: string) {
  try {
    const msg = tx(() => runActions(rule, rec, entityType, key));
    logRun(rule, 'ok', rec, entityType, msg);
  } catch (err) {
    // A duplicate task source means this exact run already happened: not an error.
    if (/UNIQUE constraint failed: tasks.source/.test(String(err))) return;
    logRun(rule, 'error', rec, entityType, (err as Error).message ?? String(err));
  }
}

let suppressed = 0;
/** Imports use this unless you choose to run automations for imported rows. */
export function withoutAutomations<T>(fn: () => T): T {
  suppressed++;
  try {
    return fn();
  } finally {
    suppressed--;
  }
}

export function handleEvent(action: string, entity: { type: string; id: string }) {
  if (!(action in AUTOMATION_EVENTS) || action === 'schedule') return;
  const event = action as AutomationEvent;
  const def = AUTOMATION_EVENTS[event];
  const rules = getDb()
    .select()
    .from(automations)
    .where(and(eq(automations.event, event), eq(automations.enabled, true)))
    .all()
    .map(shape);
  if (!rules.length || !def.entity || entity.type !== def.entity) return;
  const rec = LOADERS[def.entity]?.([entity.id])[0];
  if (!rec) return;
  for (const rule of rules) {
    if (matchAll(rec, rule.conditions, def.fields)) execute(rule, rec, def.entity, `${entity.id}:${event}`);
  }
}

onAudit((ctx, action, entity) => {
  if (suppressed || ctx.ip === 'automation' || !entity) return;
  handleEvent(action, entity);
});

/** Scheduled rules whose latest occurrence hasn't been handled yet. */
export function runScheduled(now = nowLocal()) {
  const rules = getDb()
    .select()
    .from(automations)
    .where(and(eq(automations.event, 'schedule'), eq(automations.enabled, true)))
    .all()
    .map(shape);
  for (const rule of rules) {
    if (!rule.schedule) continue;
    const occ = lastScheduledAt(rule.schedule, now);
    if (rule.lastScheduled && rule.lastScheduled >= occ) continue;
    getDb().update(automations).set({ lastScheduled: occ }).where(eq(automations.id, rule.id)).run();
    execute(rule, null, null, occ);
  }
}

registerJob({
  name: 'automations',
  everyMs: 60_000,
  run: () => {
    if (hasUsers()) runScheduled();
  },
});

/**
 * Dry run: check a rule against your most recent records and show what the actions would say.
 * Nothing is created or changed.
 */
export function testAutomation(input: AutomationInput) {
  const data = parse(automationSchema, input);
  const def = AUTOMATION_EVENTS[data.event];
  const preview = (rec: Rec | null) =>
    data.actions.map((a) => {
      const vars = { ...(rec ?? {}), today: today(), rule: data.name };
      if (a.type === 'notify') return { type: a.type, text: renderTemplate(a.title, vars) + (a.body ? ` — ${renderTemplate(a.body, vars)}` : '') };
      if (a.type === 'create_task') return { type: a.type, text: renderTemplate(a.title, vars) || data.name };
      return { type: a.type, text: `#${a.tag}` };
    });
  if (!def.entity) {
    const next = data.schedule ? lastScheduledAt(data.schedule, nowLocal()) : null;
    return { checked: 0, matched: 0, matches: [], schedulePreview: preview(null), lastOccurrence: next };
  }
  const ids = RECENT[def.entity](data.event);
  const recs = LOADERS[def.entity](ids);
  const matched = recs.filter((r) => matchAll(r, data.conditions, def.fields));
  const titles = resolveRefs(matched.slice(0, 5).map((r) => ({ type: def.entity!, id: r.id })));
  return {
    checked: recs.length,
    matched: matched.length,
    matches: matched.slice(0, 5).map((r) => ({ id: r.id, title: titles.get(`${def.entity}:${r.id}`)?.title ?? r.id, actions: preview(r) })),
    schedulePreview: null,
    lastOccurrence: null,
  };
}
