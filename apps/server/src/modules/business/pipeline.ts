import { DEFAULT_STAGES, minorToInput, opportunitySchema, pipelineSchema, pipelineStats, type OpportunityInput, type PipelineInput } from '@life-erp/shared';
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte } from 'drizzle-orm';
import { getDb, tx } from '../../db/client';
import { opportunities, organizations, people, pipelines, pipelineStages } from '../../db/schema';
import { audit, type AuditContext } from '../../lib/audit';
import { AppError, badRequest, notFound } from '../../lib/errors';
import { newId, nowIso } from '../../lib/ids';
import { registerEntity } from '../../lib/registry';
import { parse } from '../../lib/validate';
import { assertCurrency, makeConverter, minorOf } from '../finance/currency';
import { assertPerson, today } from '../life/common';
import { reindexEntity } from '../search/service';
import { getSettings } from '../settings/service';
import { getTagsFor, getTagsForMany, setTagsFor } from '../tags/service';
import { getWorkspace } from '../workspaces/service';
import { assertOrganization, ensureRelation } from './organizations';

export type Stage = typeof pipelineStages.$inferSelect;
export type Opportunity = typeof opportunities.$inferSelect;
const liveOpp = isNull(opportunities.deletedAt);

function stagesOf(pipelineId: string) {
  return getDb().select().from(pipelineStages).where(eq(pipelineStages.pipelineId, pipelineId)).orderBy(asc(pipelineStages.sortOrder)).all();
}

/** Every business gets a ready-to-use pipeline the first time it's needed. */
export function ensurePipeline(workspaceId: string) {
  const ws = getWorkspace(workspaceId);
  const existing = getDb().select().from(pipelines).where(and(eq(pipelines.workspaceId, ws.id), isNull(pipelines.deletedAt))).orderBy(asc(pipelines.createdAt)).get();
  if (existing) return existing;
  const id = newId();
  tx((db) => {
    db.insert(pipelines).values({ id, workspaceId: ws.id, name: 'Sales' }).run();
    DEFAULT_STAGES.forEach((s, i) => db.insert(pipelineStages).values({ id: newId(), pipelineId: id, ...s, sortOrder: i }).run());
  });
  return getDb().select().from(pipelines).where(eq(pipelines.id, id)).get()!;
}

export function listPipelines(workspaceId: string) {
  ensurePipeline(workspaceId);
  return getDb()
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.workspaceId, workspaceId), isNull(pipelines.deletedAt)))
    .orderBy(asc(pipelines.createdAt))
    .all()
    .map((p) => ({ ...p, stages: stagesOf(p.id) }));
}

export function getPipeline(id: string) {
  const p = getDb().select().from(pipelines).where(and(eq(pipelines.id, id), isNull(pipelines.deletedAt))).get();
  if (!p) throw notFound('Pipeline');
  return { ...p, stages: stagesOf(p.id) };
}

export function createPipeline(ctx: AuditContext, input: PipelineInput) {
  const data = parse(pipelineSchema, input);
  getWorkspace(data.workspaceId);
  const id = newId();
  tx((db) => {
    db.insert(pipelines).values({ id, workspaceId: data.workspaceId, name: data.name }).run();
    data.stages.forEach((s, i) => db.insert(pipelineStages).values({ id: newId(), pipelineId: id, name: s.name, probability: s.probability, kind: s.kind, color: s.color ?? null, sortOrder: i }).run());
  });
  audit(ctx, 'pipeline.create', { type: 'workspace', id: data.workspaceId }, `Created pipeline "${data.name}"`);
  return getPipeline(id);
}

/** Rename/reorder/add stages. A stage that still has deals can't be removed. */
export function updatePipeline(ctx: AuditContext, id: string, input: Partial<PipelineInput>) {
  const before = getPipeline(id);
  const data = parse(pipelineSchema, { workspaceId: before.workspaceId, name: before.name, stages: before.stages, ...input });
  const keep = new Set(data.stages.filter((s) => s.id).map((s) => s.id!));
  const removed = before.stages.filter((s) => !keep.has(s.id));
  if (removed.length) {
    const used = getDb()
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(and(liveOpp, inArray(opportunities.stageId, removed.map((s) => s.id))))
      .get();
    if (used) throw badRequest(`Move the deals out of "${removed.map((s) => s.name).join('", "')}" before removing it`);
  }
  tx((db) => {
    db.update(pipelines).set({ name: data.name, updatedAt: nowIso() }).where(eq(pipelines.id, id)).run();
    for (const s of removed) db.delete(pipelineStages).where(eq(pipelineStages.id, s.id)).run();
    data.stages.forEach((s, i) => {
      if (s.id && before.stages.some((b) => b.id === s.id)) {
        db.update(pipelineStages).set({ name: s.name, probability: s.probability, kind: s.kind, color: s.color ?? null, sortOrder: i }).where(eq(pipelineStages.id, s.id)).run();
      } else {
        db.insert(pipelineStages).values({ id: newId(), pipelineId: id, name: s.name, probability: s.probability, kind: s.kind, color: s.color ?? null, sortOrder: i }).run();
      }
    });
  });
  audit(ctx, 'pipeline.update', { type: 'workspace', id: before.workspaceId }, `Updated pipeline "${data.name}"`, before, data);
  return getPipeline(id);
}

// ---------- opportunities ----------

/** A relation holds either a person or a company, so a deal with both creates two. */
function relate(ctx: AuditContext, workspaceId: string, personId: string | null, organizationId: string | null, role: 'lead' | 'client') {
  if (personId) ensureRelation(ctx, { workspaceId, personId, role });
  if (organizationId) ensureRelation(ctx, { workspaceId, organizationId, role });
}

function validate(data: ReturnType<typeof opportunitySchema.parse>, current?: Opportunity) {
  getWorkspace(data.workspaceId);
  assertPerson(data.personId);
  assertOrganization(data.organizationId);
  assertCurrency(data.currency);
  const pipeline = data.pipelineId ? getPipeline(data.pipelineId) : current ? getPipeline(current.pipelineId) : { ...ensurePipeline(data.workspaceId), stages: [] as Stage[] };
  const stages = pipeline.stages.length ? pipeline.stages : stagesOf(pipeline.id);
  if (pipeline.workspaceId !== data.workspaceId) throw new AppError(400, 'validation', 'That pipeline belongs to another business', [{ path: 'pipelineId', message: 'Wrong business' }]);
  const stage = data.stageId ? stages.find((s) => s.id === data.stageId) : current ? stages.find((s) => s.id === current.stageId) : stages[0];
  if (!stage) throw new AppError(400, 'validation', 'Stage not found in this pipeline', [{ path: 'stageId', message: 'Stage not found' }]);
  const { tags: _t, ...row } = data;
  return {
    row: {
      ...row,
      pipelineId: pipeline.id,
      stageId: stage.id,
      personId: data.personId ?? null,
      organizationId: data.organizationId ?? null,
      value: minorOf(data.value, data.currency, 'value'),
      probability: data.probability ?? null,
      expectedClose: data.expectedClose ?? null,
      nextActionDate: data.nextActionDate ?? null,
    },
    stage,
  };
}

function enrich(rows: Opportunity[]) {
  if (!rows.length) return [];
  const stageRows = getDb().select().from(pipelineStages).where(inArray(pipelineStages.id, [...new Set(rows.map((r) => r.stageId))])).all();
  const stages = new Map(stageRows.map((s) => [s.id, s]));
  const pIds = rows.map((r) => r.personId).filter(Boolean) as string[];
  const oIds = rows.map((r) => r.organizationId).filter(Boolean) as string[];
  const pNames = new Map(pIds.length ? getDb().select({ id: people.id, n: people.fullName }).from(people).where(inArray(people.id, pIds)).all().map((x) => [x.id, x.n]) : []);
  const oNames = new Map(oIds.length ? getDb().select({ id: organizations.id, n: organizations.name }).from(organizations).where(inArray(organizations.id, oIds)).all().map((x) => [x.id, x.n]) : []);
  const tags = getTagsForMany('opportunity', rows.map((r) => r.id));
  return rows.map((o) => {
    const s = stages.get(o.stageId)!;
    return {
      ...o,
      stageName: s?.name,
      kind: (s?.kind ?? 'open') as 'open' | 'won' | 'lost',
      effectiveProbability: s?.kind === 'won' ? 100 : s?.kind === 'lost' ? 0 : (o.probability ?? s?.probability ?? 0),
      personName: o.personId ? (pNames.get(o.personId) ?? null) : null,
      organizationName: o.organizationId ? (oNames.get(o.organizationId) ?? null) : null,
      tags: tags.get(o.id) ?? [],
    };
  });
}

export function listOpportunities(f: { workspaceId?: string; pipelineId?: string; status?: 'open' | 'won' | 'lost'; personId?: string; organizationId?: string } = {}) {
  const conds = [liveOpp];
  if (f.workspaceId) conds.push(eq(opportunities.workspaceId, f.workspaceId));
  if (f.pipelineId) conds.push(eq(opportunities.pipelineId, f.pipelineId));
  if (f.personId) conds.push(eq(opportunities.personId, f.personId));
  if (f.organizationId) conds.push(eq(opportunities.organizationId, f.organizationId));
  const rows = enrich(getDb().select().from(opportunities).where(and(...conds)).orderBy(asc(opportunities.sortOrder), desc(opportunities.updatedAt)).all());
  return f.status ? rows.filter((r) => r.kind === f.status) : rows;
}

export function getOpportunity(id: string) {
  const o = getDb().select().from(opportunities).where(and(eq(opportunities.id, id), liveOpp)).get();
  if (!o) throw notFound('Opportunity');
  return { ...enrich([o])[0], tags: getTagsFor('opportunity', id) };
}

export function createOpportunity(ctx: AuditContext, input: OpportunityInput) {
  const data = parse(opportunitySchema, input);
  const { row, stage } = validate(data);
  const id = newId();
  getDb()
    .insert(opportunities)
    .values({ id, ...row, closedAt: stage.kind === 'open' ? null : today(), sortOrder: Date.now() })
    .run();
  if (data.tags?.length) setTagsFor('opportunity', id, data.tags);
  // A new deal makes the contact (and their company) a lead of that business.
  relate(ctx, row.workspaceId, row.personId, row.organizationId, 'lead');
  audit(ctx, 'opportunity.create', { type: 'opportunity', id }, `New opportunity "${row.title}" (${stage.name})`);
  reindexEntity('opportunity', id);
  return getOpportunity(id);
}

export function updateOpportunity(ctx: AuditContext, id: string, input: Partial<OpportunityInput>) {
  const before = getOpportunity(id);
  const data = parse(opportunitySchema, { ...before, value: minorToInput(before.value, before.currency), ...input });
  const { row, stage } = validate(data, before);
  const wasOpen = before.kind === 'open';
  const closedAt = stage.kind === 'open' ? null : wasOpen || !before.closedAt ? today() : before.closedAt;
  getDb().update(opportunities).set({ ...row, closedAt, updatedAt: nowIso() }).where(eq(opportunities.id, id)).run();
  if (input.tags) setTagsFor('opportunity', id, input.tags);
  if (stage.kind === 'won' && before.kind !== 'won') relate(ctx, row.workspaceId, row.personId, row.organizationId, 'client');
  const moved = stage.id !== before.stageId;
  audit(ctx, moved ? 'opportunity.stage' : 'opportunity.update', { type: 'opportunity', id }, moved ? `"${row.title}": ${before.stageName} → ${stage.name}` : `Updated opportunity "${row.title}"`, before, row);
  reindexEntity('opportunity', id);
  return getOpportunity(id);
}

export function moveOpportunity(ctx: AuditContext, id: string, stageId: string, extra: { lostReason?: string | null } = {}) {
  return updateOpportunity(ctx, id, { stageId, ...(extra.lostReason !== undefined ? { lostReason: extra.lostReason } : {}) });
}

export function deleteOpportunity(ctx: AuditContext, id: string) {
  const o = getOpportunity(id);
  getDb().update(opportunities).set({ deletedAt: nowIso() }).where(eq(opportunities.id, id)).run();
  audit(ctx, 'opportunity.delete', { type: 'opportunity', id }, `Deleted opportunity "${o.title}"`, o);
  reindexEntity('opportunity', id);
}

/** Pipeline analytics in the base currency: totals, weighted forecast, win rate, per-stage breakdown. */
export function pipelineAnalytics(workspaceId: string, pipelineId?: string) {
  const base = getSettings().baseCurrency;
  const conv = makeConverter(base, today());
  const pipeline = pipelineId ? getPipeline(pipelineId) : listPipelines(workspaceId)[0];
  const opps = listOpportunities({ workspaceId, pipelineId: pipeline.id });
  const deals = opps.map((o) => ({ value: conv.convert(o.value, o.currency), probability: o.effectiveProbability, kind: o.kind }));
  const byStage = pipeline.stages.map((s) => {
    const inStage = opps.filter((o) => o.stageId === s.id);
    return { stageId: s.id, name: s.name, kind: s.kind, count: inStage.length, value: inStage.reduce((sum, o) => sum + conv.convert(o.value, o.currency), 0) };
  });
  return { base, pipeline, stats: pipelineStats(deals), byStage, missingRates: [...conv.missing] };
}

export function opportunitiesNeedingAction(until: string) {
  return enrich(
    getDb()
      .select()
      .from(opportunities)
      .where(and(liveOpp, isNotNull(opportunities.nextActionDate), lte(opportunities.nextActionDate, until)))
      .all(),
  ).filter((o) => o.kind === 'open');
}

registerEntity({
  type: 'opportunity',
  exists: (id) => !!getDb().select({ id: opportunities.id }).from(opportunities).where(and(eq(opportunities.id, id), liveOpp)).get(),
  resolve: (ids) =>
    getDb()
      .select()
      .from(opportunities)
      .where(and(inArray(opportunities.id, ids), liveOpp))
      .all()
      .map((o) => ({ id: o.id, type: 'opportunity', title: o.title, url: `/pipeline?open=${o.id}`, subtitle: `${minorToInput(o.value, o.currency)} ${o.currency}`, workspaceId: o.workspaceId })),
  searchDocs: (ids) =>
    getDb()
      .select()
      .from(opportunities)
      .where(ids ? and(inArray(opportunities.id, ids), liveOpp) : liveOpp)
      .all()
      .map((o) => ({ id: o.id, workspaceId: o.workspaceId, title: o.title, body: [o.notes, o.nextAction, o.source, o.owner].filter(Boolean).join('\n') })),
});
