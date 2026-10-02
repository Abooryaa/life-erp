import { CUSTOM_FIELD_ENTITIES, customFieldDefSchema, isIsoDate, normalizeDigits, type CustomFieldDefInput } from '@life-erp/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, tx } from '../../db/client';
import { customFieldDefs, customFieldValues } from '../../db/schema';
import { audit, type AuditContext } from '../../lib/audit';
import { AppError, badRequest, notFound } from '../../lib/errors';
import { newId, nowIso } from '../../lib/ids';
import { entityDef } from '../../lib/registry';
import { parse } from '../../lib/validate';
import { reindexEntity } from '../search/service';

type DefRow = typeof customFieldDefs.$inferSelect;
const shape = (d: DefRow) => ({ ...d, options: JSON.parse(d.options) as string[] });

export function listDefs(entityType?: string) {
  return getDb()
    .select()
    .from(customFieldDefs)
    .where(entityType ? eq(customFieldDefs.entityType, entityType) : undefined)
    .orderBy(asc(customFieldDefs.entityType), asc(customFieldDefs.sortOrder), asc(customFieldDefs.label))
    .all()
    .map(shape);
}

function getDef(id: string) {
  const d = getDb().select().from(customFieldDefs).where(eq(customFieldDefs.id, id)).get();
  if (!d) throw notFound('Field');
  return shape(d);
}

export function createDef(ctx: AuditContext, input: CustomFieldDefInput) {
  const data = parse(customFieldDefSchema, input);
  if (listDefs(data.entityType).some((d) => d.label.toLowerCase() === data.label.toLowerCase())) {
    throw new AppError(409, 'conflict', `A field called “${data.label}” already exists`, [{ path: 'label', message: 'Already exists' }]);
  }
  const id = newId();
  const max = getDb().select({ m: sql<number>`coalesce(max(${customFieldDefs.sortOrder}), 0)` }).from(customFieldDefs).where(eq(customFieldDefs.entityType, data.entityType)).get()?.m ?? 0;
  getDb()
    .insert(customFieldDefs)
    .values({ id, ...data, options: JSON.stringify(data.type === 'select' ? data.options : []), sortOrder: max + 1 })
    .run();
  audit(ctx, 'custom_field.create', null, `Custom field “${data.label}” added to ${data.entityType}`);
  return getDef(id);
}

export function updateDef(ctx: AuditContext, id: string, input: Partial<CustomFieldDefInput>) {
  const before = getDef(id);
  const data = parse(customFieldDefSchema, { ...before, ...input, entityType: before.entityType });
  const used = getDb().select({ n: sql<number>`count(*)` }).from(customFieldValues).where(eq(customFieldValues.fieldId, id)).get()?.n ?? 0;
  if (data.type !== before.type && used) throw badRequest('This field already has values — its type can’t change. Create a new field instead.');
  if (data.type === 'select' && used) {
    const removed = before.options.filter((o) => !data.options.includes(o));
    if (removed.length) {
      const inUse = getDb()
        .select({ v: customFieldValues.value })
        .from(customFieldValues)
        .where(eq(customFieldValues.fieldId, id))
        .all()
        .some((r) => removed.includes(r.v));
      if (inUse) throw badRequest(`Option “${removed.join('”, “')}” is still used by some records`);
    }
  }
  getDb()
    .update(customFieldDefs)
    .set({ label: data.label, type: data.type, options: JSON.stringify(data.type === 'select' ? data.options : []), required: data.required, updatedAt: nowIso() })
    .where(eq(customFieldDefs.id, id))
    .run();
  audit(ctx, 'custom_field.update', null, `Custom field “${data.label}” updated`, before, data);
  return getDef(id);
}

export function deleteDef(ctx: AuditContext, id: string) {
  const d = getDef(id);
  const used = getDb().select({ n: sql<number>`count(*)` }).from(customFieldValues).where(eq(customFieldValues.fieldId, id)).get()?.n ?? 0;
  getDb().delete(customFieldDefs).where(eq(customFieldDefs.id, id)).run();
  audit(ctx, 'custom_field.delete', null, `Custom field “${d.label}” deleted (${used} values removed)`, d);
}

export function reorderDefs(ctx: AuditContext, ids: string[]) {
  tx((db) => ids.forEach((id, i) => db.update(customFieldDefs).set({ sortOrder: i }).where(eq(customFieldDefs.id, id)).run()));
  audit(ctx, 'custom_field.reorder', null, 'Reordered custom fields');
}

export function getValues(entityType: string, entityId: string) {
  const defs = listDefs(entityType);
  const vals = new Map(
    getDb()
      .select()
      .from(customFieldValues)
      .where(and(eq(customFieldValues.entityType, entityType), eq(customFieldValues.entityId, entityId)))
      .all()
      .map((v) => [v.fieldId, v.value]),
  );
  return defs.map((d) => ({ ...d, value: vals.get(d.id) ?? null }));
}

/** Validate and normalise one value for its field; null/'' clears it. */
export function normaliseValue(d: ReturnType<typeof shape>, raw: unknown, path = d.id): string | null {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return null;
  const fail = (message: string): never => {
    throw new AppError(400, 'validation', `${d.label}: ${message}`, [{ path, message }]);
  };
  const s = normalizeDigits(String(raw)).trim();
  switch (d.type) {
    case 'number': {
      const n = s.replace(/,/g, '');
      if (!/^-?\d+(\.\d+)?$/.test(n)) fail('Enter a number');
      return n;
    }
    case 'date':
      if (!isIsoDate(s) || Number.isNaN(Date.parse(s))) fail('Use the format YYYY-MM-DD');
      return s;
    case 'select':
      if (!d.options.includes(s)) fail('Choose one of the options');
      return s;
    case 'checkbox':
      if (!['true', 'false'].includes(s)) fail('Must be yes or no');
      return s === 'true' ? 'true' : null;
    case 'url':
      if (!/^https?:\/\/\S+$/i.test(s)) fail('Use a link starting with http:// or https://');
      return s.slice(0, 1000);
    default:
      if (s.length > 2000) fail('Too long (2000 characters max)');
      return s;
  }
}

/** Save values for a record. Only the fields sent are changed; required fields can't be left empty. */
export function setValues(ctx: AuditContext, entityType: string, entityId: string, input: unknown) {
  if (!(CUSTOM_FIELD_ENTITIES as readonly string[]).includes(entityType)) throw badRequest('This kind of record has no custom fields');
  if (!entityDef(entityType)?.exists(entityId)) throw notFound('Record');
  const values = parse(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])), input);
  const defs = new Map(listDefs(entityType).map((d) => [d.id, d]));
  const changes: { d: ReturnType<typeof shape>; v: string | null }[] = [];
  for (const [fieldId, raw] of Object.entries(values)) {
    const d = defs.get(fieldId);
    if (!d) throw badRequest('Unknown field');
    const v = normaliseValue(d, raw);
    if (d.required && v === null) throw new AppError(400, 'validation', `${d.label} is required`, [{ path: fieldId, message: 'Required' }]);
    changes.push({ d, v });
  }
  tx((db) => {
    for (const { d, v } of changes) {
      if (v === null) db.delete(customFieldValues).where(and(eq(customFieldValues.fieldId, d.id), eq(customFieldValues.entityId, entityId))).run();
      else
        db.insert(customFieldValues)
          .values({ fieldId: d.id, entityType, entityId, value: v })
          .onConflictDoUpdate({ target: [customFieldValues.fieldId, customFieldValues.entityId], set: { value: v, updatedAt: nowIso() } })
          .run();
    }
  });
  if (changes.length) {
    audit(ctx, 'custom_field.values', { type: entityType, id: entityId }, `Updated ${changes.map((c) => c.d.label).join(', ')}`);
    reindexEntity(entityType, entityId);
  }
  return getValues(entityType, entityId);
}
