import { addDays, daysBetween, OPEN_TASK_STATUSES } from '@life-erp/shared';
import { and, gte, inArray, isNotNull, isNull, lte } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { goals, tasks } from '../../db/schema';
import { upcoming } from '../finance/reports';
import { listNotifications } from '../notifications/service';
import { today } from './common';
import { occurrencesBetween } from './events';
import { computeGoals } from './goals';
import { birthdaysBetween, followUpsDue } from './people';
import { listTasks, taskCounts } from './tasks';

/** Everything for the Today screen in one request. */
export function todayView(workspaceId?: string | null) {
  const d = today();
  const ws = workspaceId || undefined;
  const all = listTasks({ view: 'today', workspaceId: ws });
  const overdue = all.filter((t) => t.dueDate! < d);
  const dueToday = all.filter((t) => t.dueDate === d);
  const inProgress = listTasks({ view: 'open', workspaceId: ws }).filter((t) => t.status === 'in_progress' && (!t.dueDate || t.dueDate > d));
  const events = occurrencesBetween(d, d).filter((o) => !ws || o.event.workspaceId === ws);
  const money = upcoming(d, 0, { workspaceId: ws }).filter((u) => u.date <= d);
  const followUps = followUpsDue(d).filter((p) => !ws || p.workspaceId === ws);
  const birthdays = birthdaysBetween(d, addDays(d, 7));
  const goalViews = [...computeGoals().values()].filter((g) => g.status === 'active' && (!ws || g.workspaceId === ws));
  const focusGoals = goalViews
    .filter((g) => g.health === 'behind' || g.health === 'at_risk' || g.health === 'overdue' || (g.deadline && g.deadline <= addDays(d, 30)))
    .sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999'))
    .slice(0, 5);
  const alerts = listNotifications({ unreadOnly: true, limit: 20 }).filter((n) => n.severity === 'critical' || n.severity === 'warning');
  return {
    date: d,
    counts: taskCounts(ws),
    overdue,
    dueToday,
    inProgress,
    events: events.map((o) => ({ ...o.event, occurrenceDate: o.date })),
    money,
    followUps,
    birthdays: birthdays.map((b) => ({ id: b.person.id, name: b.person.fullName, date: b.date, age: b.age })),
    focusGoals,
    alerts,
  };
}

export interface CalendarItem {
  kind: 'event' | 'task' | 'payment' | 'goal' | 'birthday' | 'followup';
  id: string;
  title: string;
  date: string;
  endDate?: string;
  time?: string | null;
  endTime?: string | null;
  allDay: boolean;
  done?: boolean;
  workspaceId?: string | null;
  link: string;
  meta?: Record<string, unknown>;
}

/** Unified calendar: events, task due dates, payments, goal deadlines, birthdays, follow-ups. */
export function calendarFeed(from: string, to: string, workspaceId?: string | null): CalendarItem[] {
  const ws = workspaceId || undefined;
  const items: CalendarItem[] = [];
  for (const o of occurrencesBetween(from, to)) {
    if (ws && o.event.workspaceId !== ws) continue;
    items.push({
      kind: 'event',
      id: `${o.event.id}:${o.date}`,
      title: o.event.title,
      date: o.date,
      endDate: o.endDate,
      time: o.event.startTime,
      endTime: o.event.endTime,
      allDay: o.event.allDay,
      workspaceId: o.event.workspaceId,
      link: `/calendar?date=${o.date}&open=${o.event.id}`,
      meta: { eventId: o.event.id, kind: o.event.kind, location: o.event.location, recurring: !!o.event.recurrence },
    });
  }
  const taskRows = getDb()
    .select()
    .from(tasks)
    .where(and(isNull(tasks.deletedAt), isNotNull(tasks.dueDate), gte(tasks.dueDate, from), lte(tasks.dueDate, to), inArray(tasks.status, [...OPEN_TASK_STATUSES, 'done'])))
    .all();
  for (const t of taskRows) {
    if (ws && t.workspaceId !== ws) continue;
    items.push({ kind: 'task', id: t.id, title: t.title, date: t.dueDate!, time: t.dueTime, allDay: !t.dueTime, done: t.status === 'done', workspaceId: t.workspaceId, link: `/tasks?open=${t.id}`, meta: { priority: t.priority } });
  }
  // Payments are forward-looking (plus anything overdue), so only fetched when the range reaches today or later.
  const d = today();
  if (to >= d) {
    for (const u of upcoming(d, daysBetween(d, to), { workspaceId: ws })) {
      if (u.date < from || u.date > to) continue;
      items.push({ kind: 'payment', id: `${u.kind}:${u.id}`, title: u.name, date: u.date, allDay: true, link: u.link, meta: { amount: u.amount, currency: u.currency, direction: u.direction, overdue: u.overdue } });
    }
  }
  const goalRows = getDb().select().from(goals).where(and(isNull(goals.deletedAt), isNotNull(goals.deadline), gte(goals.deadline, from), lte(goals.deadline, to))).all();
  for (const g of goalRows) {
    if (ws && g.workspaceId !== ws) continue;
    items.push({ kind: 'goal', id: g.id, title: g.title, date: g.deadline!, allDay: true, workspaceId: g.workspaceId, link: `/goals/${g.id}` });
  }
  for (const b of birthdaysBetween(from, to)) {
    items.push({ kind: 'birthday', id: `${b.person.id}:${b.date}`, title: b.person.fullName, date: b.date, allDay: true, link: `/people/${b.person.id}`, meta: { age: b.age } });
  }
  return items.sort((a, b) => (a.date === b.date ? (a.time ?? '').localeCompare(b.time ?? '') : a.date.localeCompare(b.date)));
}
