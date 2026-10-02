import { daysBetween, eventSchema, addDays, occurrences, type EventInput, type Frequency } from '@life-erp/shared';
import { and, asc, eq, inArray, isNotNull, isNull, lte, or, gte } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { events } from '../../db/schema';
import { audit, type AuditContext } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { newId, nowIso } from '../../lib/ids';
import { registerEntity } from '../../lib/registry';
import { parse } from '../../lib/validate';
import { reindexEntity } from '../search/service';
import { getTagsFor, setTagsFor } from '../tags/service';
import { assertWorkspace } from '../workspaces/service';
import { assertPerson } from './common';

export type EventRow = typeof events.$inferSelect;
const live = isNull(events.deletedAt);

function validate(data: ReturnType<typeof eventSchema.parse>) {
  assertWorkspace(data.workspaceId);
  assertPerson(data.personId);
  const { tags: _t, ...row } = data;
  return {
    ...row,
    endDate: data.endDate ?? null,
    startTime: data.allDay ? null : (data.startTime ?? null),
    endTime: data.allDay ? null : (data.endTime ?? null),
    workspaceId: data.workspaceId ?? null,
    personId: data.personId ?? null,
    recurrence: data.recurrence ?? null,
    recurrenceUntil: data.recurrence ? (data.recurrenceUntil ?? null) : null,
    reminderMinutes: data.reminderMinutes ?? null,
  };
}

export function getEvent(id: string) {
  const e = getDb().select().from(events).where(and(eq(events.id, id), live)).get();
  if (!e) throw notFound('Event');
  return { ...e, tags: getTagsFor('event', id) };
}

export function createEvent(ctx: AuditContext, input: EventInput) {
  const data = parse(eventSchema, input);
  const row = validate(data);
  const id = newId();
  getDb().insert(events).values({ id, ...row }).run();
  if (data.tags?.length) setTagsFor('event', id, data.tags);
  audit(ctx, 'event.create', { type: 'event', id }, `Created event "${row.title}" on ${row.date}`);
  reindexEntity('event', id);
  return getEvent(id);
}

export function updateEvent(ctx: AuditContext, id: string, input: Partial<EventInput>) {
  const before = getEvent(id);
  const data = parse(eventSchema, { ...before, ...input });
  getDb()
    .update(events)
    .set({ ...validate(data), updatedAt: nowIso() })
    .where(eq(events.id, id))
    .run();
  if (input.tags) setTagsFor('event', id, input.tags);
  audit(ctx, 'event.update', { type: 'event', id }, `Updated event "${data.title}"`, before, data);
  reindexEntity('event', id);
  return getEvent(id);
}

export function deleteEvent(ctx: AuditContext, id: string) {
  const e = getEvent(id);
  getDb().update(events).set({ deletedAt: nowIso() }).where(eq(events.id, id)).run();
  audit(ctx, 'event.delete', { type: 'event', id }, `Deleted event "${e.title}"`, e);
  reindexEntity('event', id);
}

export interface Occurrence {
  event: EventRow;
  /** Date this occurrence starts. */
  date: string;
  endDate: string;
}

/** Every occurrence (recurring and multi-day events included) overlapping [from, to]. */
export function occurrencesBetween(from: string, to: string): Occurrence[] {
  const rows = getDb()
    .select()
    .from(events)
    .where(and(live, lte(events.date, to), or(isNotNull(events.recurrence), gte(events.date, addDays(from, -60)))))
    .orderBy(asc(events.date), asc(events.startTime))
    .all();
  const out: Occurrence[] = [];
  for (const e of rows) {
    const span = e.endDate ? daysBetween(e.date, e.endDate) : 0;
    const starts = e.recurrence
      ? occurrences(e.date, e.recurrence as Frequency, e.recurrenceInterval, to, e.recurrenceUntil, 1000)
      : [e.date];
    for (const s of starts) {
      const end = addDays(s, span);
      if (end >= from && s <= to) out.push({ event: e, date: s, endDate: end });
    }
  }
  return out.sort((a, b) => (a.date === b.date ? (a.event.startTime ?? '').localeCompare(b.event.startTime ?? '') : a.date.localeCompare(b.date)));
}

registerEntity({
  type: 'event',
  exists: (id) => !!getDb().select({ id: events.id }).from(events).where(and(eq(events.id, id), live)).get(),
  resolve: (ids) =>
    getDb()
      .select()
      .from(events)
      .where(and(inArray(events.id, ids), live))
      .all()
      .map((e) => ({ id: e.id, type: 'event', title: e.title, url: `/calendar?date=${e.date}&open=${e.id}`, subtitle: `${e.date}${e.startTime ? ` ${e.startTime}` : ''}`, workspaceId: e.workspaceId })),
  searchDocs: (ids) =>
    getDb()
      .select()
      .from(events)
      .where(ids ? and(inArray(events.id, ids), live) : live)
      .all()
      .map((e) => ({ id: e.id, workspaceId: e.workspaceId, title: e.title, body: [e.description, e.location, e.kind, e.date].filter(Boolean).join('\n') })),
});
