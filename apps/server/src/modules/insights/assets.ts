import { assetSchema, disposeAssetSchema, minorToInput, valuationSchema, type AssetInput } from '@life-erp/shared';
import { and, asc, desc, eq, inArray, isNull, lte } from 'drizzle-orm';
import { getDb, tx } from '../../db/client';
import { assetValuations, assets } from '../../db/schema';
import { audit, type AuditContext } from '../../lib/audit';
import { AppError, badRequest, notFound } from '../../lib/errors';
import { newId, nowIso } from '../../lib/ids';
import { registerEntity } from '../../lib/registry';
import { parse } from '../../lib/validate';
import { assertCurrency, minorOf } from '../finance/currency';
import { today } from '../life/common';
import { reindexEntity } from '../search/service';
import { getTagsFor, setTagsFor } from '../tags/service';
import { assertWorkspace } from '../workspaces/service';

type Asset = typeof assets.$inferSelect;
const live = isNull(assets.deletedAt);

/** Value of an asset on a date: its latest valuation on or before it; 0 before purchase or after disposal. */
function valueOn(a: Asset, vals: (typeof assetValuations.$inferSelect)[], date: string) {
  if (a.disposedAt && a.disposedAt <= date) return 0;
  if (a.purchaseDate && a.purchaseDate > date) return 0;
  const v = vals.filter((x) => x.assetId === a.id && x.date <= date).sort((x, y) => y.date.localeCompare(x.date) || y.createdAt.localeCompare(x.createdAt))[0];
  return v?.value ?? 0;
}

function withValues(rows: Asset[], date = today()) {
  if (!rows.length) return [];
  const vals = getDb().select().from(assetValuations).where(inArray(assetValuations.assetId, rows.map((r) => r.id))).all();
  return rows.map((a) => {
    const value = valueOn(a, vals, date);
    const last = vals.filter((x) => x.assetId === a.id).sort((x, y) => y.date.localeCompare(x.date))[0];
    const gain = a.purchasePrice != null && !a.disposedAt ? value - a.purchasePrice : a.purchasePrice != null && a.disposedValue != null ? a.disposedValue - a.purchasePrice : null;
    return { ...a, value, lastValuedOn: last?.date ?? null, gain, gainRatio: gain != null && a.purchasePrice ? gain / a.purchasePrice : null };
  });
}

export function listAssets(f: { workspaceId?: string; includeDisposed?: boolean } = {}) {
  const conds = [live];
  if (f.workspaceId) conds.push(eq(assets.workspaceId, f.workspaceId));
  if (!f.includeDisposed) conds.push(isNull(assets.disposedAt));
  return withValues(getDb().select().from(assets).where(and(...conds)).orderBy(asc(assets.name)).all());
}

export function getAsset(id: string) {
  const a = getDb().select().from(assets).where(and(eq(assets.id, id), live)).get();
  if (!a) throw notFound('Asset');
  const valuations = getDb().select().from(assetValuations).where(eq(assetValuations.assetId, id)).orderBy(desc(assetValuations.date), desc(assetValuations.createdAt)).all();
  return { ...withValues([a])[0], valuations, tags: getTagsFor('asset', id) };
}

/**
 * Totals per liquidity for net worth, converted with the caller's converter.
 * Only assets marked "include in net worth" count.
 */
export function assetTotals(date: string, convert: (minor: number, currency: string) => number) {
  const rows = getDb().select().from(assets).where(and(live, eq(assets.includeInNetWorth, true))).all();
  let liquid = 0;
  let nonLiquid = 0;
  if (rows.length) {
    const vals = getDb().select().from(assetValuations).where(lte(assetValuations.date, date)).all();
    for (const a of rows) {
      const v = convert(valueOn(a, vals, date), a.currency);
      if (a.liquidity === 'liquid') liquid += v;
      else nonLiquid += v;
    }
  }
  return { liquid, nonLiquid };
}

function rowOf(data: ReturnType<typeof assetSchema.parse>) {
  assertWorkspace(data.workspaceId);
  assertCurrency(data.currency);
  const { currentValue: _v, valuationDate: _d, ...rest } = data;
  return {
    ...rest,
    workspaceId: data.workspaceId ?? null,
    purchaseDate: data.purchaseDate ?? null,
    purchasePrice: data.purchasePrice ? minorOf(data.purchasePrice, data.currency, 'purchasePrice') : null,
    quantity: data.quantity ?? null,
  };
}

export function createAsset(ctx: AuditContext, input: AssetInput & { tags?: string[] }) {
  const data = parse(assetSchema, input);
  if (data.currentValue == null) throw new AppError(400, 'validation', 'Enter what it is worth today', [{ path: 'currentValue', message: 'Required' }]);
  const row = rowOf(data);
  const valDate = data.valuationDate ?? today();
  if (row.purchaseDate && row.purchaseDate > valDate) throw new AppError(400, 'validation', 'Purchase date is after the valuation date', [{ path: 'purchaseDate', message: 'Must be on or before the valuation date' }]);
  const id = newId();
  tx((db) => {
    db.insert(assets).values({ id, ...row }).run();
    // Purchase price is the first known value, then the current valuation.
    if (row.purchasePrice != null && row.purchaseDate && row.purchaseDate < valDate) {
      db.insert(assetValuations).values({ id: newId(), assetId: id, date: row.purchaseDate, value: row.purchasePrice, note: 'Purchase price' }).run();
    }
    db.insert(assetValuations).values({ id: newId(), assetId: id, date: valDate, value: minorOf(data.currentValue!, data.currency, 'currentValue') }).run();
  });
  if (input.tags?.length) setTagsFor('asset', id, input.tags);
  audit(ctx, 'asset.create', { type: 'asset', id }, `Added asset ${row.name}`);
  reindexEntity('asset', id);
  return getAsset(id);
}

export function updateAsset(ctx: AuditContext, id: string, input: Partial<AssetInput> & { tags?: string[] }) {
  const before = getAsset(id);
  if (input.currency && input.currency !== before.currency && before.valuations.length) throw badRequest('The currency of an asset with valuations cannot change');
  const data = parse(assetSchema, { ...before, purchasePrice: before.purchasePrice == null ? null : minorToInput(before.purchasePrice, before.currency), ...input, currentValue: undefined, valuationDate: undefined });
  getDb().update(assets).set({ ...rowOf(data), updatedAt: nowIso() }).where(eq(assets.id, id)).run();
  if (input.tags) setTagsFor('asset', id, input.tags);
  audit(ctx, 'asset.update', { type: 'asset', id }, `Updated asset ${data.name}`, before, data);
  reindexEntity('asset', id);
  return getAsset(id);
}

export function addValuation(ctx: AuditContext, id: string, input: unknown) {
  const a = getAsset(id);
  const v = parse(valuationSchema, input);
  if (a.disposedAt && v.date > a.disposedAt) throw new AppError(400, 'validation', 'The asset was disposed before this date', [{ path: 'date', message: 'After disposal' }]);
  const value = minorOf(v.value, a.currency, 'value');
  getDb().insert(assetValuations).values({ id: newId(), assetId: id, date: v.date, value, note: v.note ?? null }).run();
  audit(ctx, 'asset.valuation', { type: 'asset', id }, `${a.name}: valued ${minorToInput(value, a.currency)} ${a.currency} on ${v.date}`);
  return getAsset(id);
}

export function deleteValuation(ctx: AuditContext, id: string, valuationId: string) {
  const a = getAsset(id);
  if (a.valuations.length <= 1) throw badRequest('An asset needs at least one valuation');
  const v = a.valuations.find((x) => x.id === valuationId);
  if (!v) throw notFound('Valuation');
  getDb().delete(assetValuations).where(eq(assetValuations.id, valuationId)).run();
  audit(ctx, 'asset.valuation.delete', { type: 'asset', id }, `${a.name}: removed valuation of ${v.date}`, v);
  return getAsset(id);
}

/** Sold / given away: keeps its history, stops counting from that date. Pass null to undo. */
export function disposeAsset(ctx: AuditContext, id: string, input: unknown | null) {
  const a = getAsset(id);
  if (input === null) {
    getDb().update(assets).set({ disposedAt: null, disposedValue: null, updatedAt: nowIso() }).where(eq(assets.id, id)).run();
    audit(ctx, 'asset.undispose', { type: 'asset', id }, `${a.name} is owned again`);
    return getAsset(id);
  }
  const d = parse(disposeAssetSchema, input);
  getDb()
    .update(assets)
    .set({ disposedAt: d.date, disposedValue: minorOf(d.value, a.currency, 'value'), updatedAt: nowIso() })
    .where(eq(assets.id, id))
    .run();
  audit(ctx, 'asset.dispose', { type: 'asset', id }, `${a.name} sold/disposed on ${d.date} for ${d.value} ${a.currency}`);
  return getAsset(id);
}

export function deleteAsset(ctx: AuditContext, id: string) {
  const a = getAsset(id);
  getDb().update(assets).set({ deletedAt: nowIso() }).where(eq(assets.id, id)).run();
  audit(ctx, 'asset.delete', { type: 'asset', id }, `Deleted asset ${a.name}`, a);
  reindexEntity('asset', id);
}

registerEntity({
  type: 'asset',
  exists: (id) => !!getDb().select({ id: assets.id }).from(assets).where(and(eq(assets.id, id), live)).get(),
  resolve: (ids) =>
    getDb()
      .select()
      .from(assets)
      .where(and(inArray(assets.id, ids), live))
      .all()
      .map((a) => ({ id: a.id, type: 'asset', title: a.name, url: `/finance/net-worth?open=${a.id}`, subtitle: a.type, workspaceId: a.workspaceId })),
  searchDocs: (ids) =>
    getDb()
      .select()
      .from(assets)
      .where(ids ? and(inArray(assets.id, ids), live) : live)
      .all()
      .map((a) => ({ id: a.id, title: a.name, body: [a.type, a.notes].filter(Boolean).join('\n'), workspaceId: a.workspaceId })),
});
