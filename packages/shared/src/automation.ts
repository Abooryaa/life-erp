import { DOCUMENT_TYPES } from './entities';

export type AutoFieldType = 'text' | 'number' | 'enum' | 'ref';

export interface AutoField {
  key: string;
  type: AutoFieldType;
  /** enum: allowed values; ref: which list to pick from in the UI. */
  values?: readonly string[];
  ref?: 'category' | 'account' | 'workspace' | 'project';
}

const ws: AutoField = { key: 'workspaceId', type: 'ref', ref: 'workspace' };
const taskFields: AutoField[] = [
  { key: 'title', type: 'text' },
  { key: 'priority', type: 'enum', values: ['1', '2', '3', '4'] },
  { key: 'area', type: 'text' },
  { key: 'projectId', type: 'ref', ref: 'project' },
  ws,
];
const oppFields: AutoField[] = [
  { key: 'title', type: 'text' },
  { key: 'value', type: 'number' },
  { key: 'currency', type: 'text' },
  { key: 'stageName', type: 'text' },
  { key: 'stageKind', type: 'enum', values: ['open', 'won', 'lost'] },
  { key: 'source', type: 'text' },
  ws,
];
const appFields: AutoField[] = [
  { key: 'company', type: 'text' },
  { key: 'position', type: 'text' },
  { key: 'statusName', type: 'text' },
  { key: 'statusKind', type: 'enum', values: ['saved', 'active', 'interview', 'offer', 'accepted', 'rejected', 'withdrawn'] },
  { key: 'priority', type: 'enum', values: ['1', '2', '3'] },
  { key: 'source', type: 'text' },
];

/**
 * What can start an automation, which record it carries, and the fields conditions can test.
 * Events come from real changes (the audit trail); `schedule` runs on a timetable.
 */
export const AUTOMATION_EVENTS = {
  'transaction.create': {
    entity: 'transaction',
    fields: [
      { key: 'type', type: 'enum', values: ['income', 'expense', 'refund', 'adjustment'] },
      { key: 'amount', type: 'number' },
      { key: 'currency', type: 'text' },
      { key: 'categoryId', type: 'ref', ref: 'category' },
      { key: 'accountId', type: 'ref', ref: 'account' },
      { key: 'payee', type: 'text' },
      { key: 'description', type: 'text' },
      ws,
    ] as AutoField[],
  },
  'task.create': { entity: 'task', fields: taskFields },
  'task.complete': { entity: 'task', fields: taskFields },
  'opportunity.create': { entity: 'opportunity', fields: oppFields },
  'opportunity.stage': { entity: 'opportunity', fields: oppFields },
  'project.create': {
    entity: 'project',
    fields: [{ key: 'name', type: 'text' }, { key: 'status', type: 'enum', values: ['planning', 'active', 'on_hold', 'completed', 'cancelled'] }, ws] as AutoField[],
  },
  'application.create': { entity: 'job_application', fields: appFields },
  'application.status': { entity: 'job_application', fields: appFields },
  'person.create': { entity: 'person', fields: [{ key: 'fullName', type: 'text' }, { key: 'relationship', type: 'text' }, { key: 'company', type: 'text' }, ws] as AutoField[] },
  'document.create': { entity: 'document', fields: [{ key: 'title', type: 'text' }, { key: 'type', type: 'enum', values: DOCUMENT_TYPES }, ws] as AutoField[] },
  schedule: { entity: null, fields: [] as AutoField[] },
} as const;

export type AutomationEvent = keyof typeof AUTOMATION_EVENTS;
export const AUTOMATION_EVENT_KEYS = Object.keys(AUTOMATION_EVENTS) as AutomationEvent[];

export const CONDITION_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'not_contains', 'empty', 'not_empty'] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

/** Which operators make sense for a field type. */
export function opsFor(type: AutoFieldType): ConditionOp[] {
  if (type === 'number') return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'empty', 'not_empty'];
  if (type === 'text') return ['eq', 'neq', 'contains', 'not_contains', 'empty', 'not_empty'];
  return ['eq', 'neq', 'empty', 'not_empty'];
}

export interface Condition {
  field: string;
  op: ConditionOp;
  value?: string | null;
}

const isEmpty = (v: unknown) => v === null || v === undefined || String(v).trim() === '';

export function matchCondition(record: Record<string, unknown>, c: Condition, type: AutoFieldType = 'text'): boolean {
  const v = record[c.field];
  if (c.op === 'empty') return isEmpty(v);
  if (c.op === 'not_empty') return !isEmpty(v);
  if (type === 'number') {
    if (isEmpty(v) || isEmpty(c.value)) return false;
    const a = Number(v);
    const b = Number(c.value);
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    return c.op === 'eq' ? a === b : c.op === 'neq' ? a !== b : c.op === 'gt' ? a > b : c.op === 'gte' ? a >= b : c.op === 'lt' ? a < b : c.op === 'lte' ? a <= b : false;
  }
  const a = String(v ?? '').toLowerCase();
  const b = String(c.value ?? '').toLowerCase();
  if (c.op === 'eq') return a === b;
  if (c.op === 'neq') return a !== b;
  if (c.op === 'contains') return b !== '' && a.includes(b);
  if (c.op === 'not_contains') return b === '' || !a.includes(b);
  return false;
}

/** Every condition must hold (AND). No conditions = always. */
export function matchAll(record: Record<string, unknown>, conditions: Condition[], fields: readonly AutoField[]): boolean {
  return conditions.every((c) => matchCondition(record, c, fields.find((f) => f.key === c.field)?.type ?? 'text'));
}

/** Replace {{field}} with the record's value; unknown fields become empty. */
export function renderTemplate(template: string, record: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k: string) => {
    const v = record[k];
    return v === null || v === undefined ? '' : String(v);
  });
}

export interface ScheduleSpec {
  frequency: 'daily' | 'weekly' | 'monthly';
  time: string;
  weekday?: number | null;
  dayOfMonth?: number | null;
}

/**
 * The most recent moment ('YYYY-MM-DD HH:mm', local) the schedule should have fired at or before `now`.
 * Monthly on day 31 fires on the last day of shorter months.
 */
export function lastScheduledAt(s: ScheduleSpec, now: { date: string; time: string }): string {
  const addDays = (d: string, n: number) => {
    const x = new Date(`${d}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  };
  const stamp = (d: string) => `${d} ${s.time}`;
  const nowStamp = `${now.date} ${now.time}`;
  if (s.frequency === 'daily') return stamp(now.date) <= nowStamp ? stamp(now.date) : stamp(addDays(now.date, -1));
  if (s.frequency === 'weekly') {
    const wd = s.weekday ?? 6;
    for (let i = 0; i < 8; i++) {
      const d = addDays(now.date, -i);
      if (new Date(`${d}T00:00:00Z`).getUTCDay() === wd && stamp(d) <= nowStamp) return stamp(d);
    }
  }
  const dom = s.dayOfMonth ?? 1;
  const inMonth = (ym: string) => {
    const [y, m] = ym.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${ym}-${String(Math.min(dom, last)).padStart(2, '0')}`;
  };
  const thisMonth = inMonth(now.date.slice(0, 7));
  if (stamp(thisMonth) <= nowStamp) return stamp(thisMonth);
  const [y, m] = now.date.slice(0, 7).split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  return stamp(inMonth(prev));
}
