import { addDays } from '@life-erp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runJobsNow } from '../src/jobs/scheduler';
import { today as todayFn } from '../src/modules/life/common';
import { call, json, makeApp, type TestCtx } from './helpers';

let ctx: TestCtx;
let today: string;
let mma: string;
let basira: string;

const post = async (url: string, body: unknown, expectStatus = 200) => {
  const r = await call(ctx, 'POST', url, body);
  if (r.statusCode !== expectStatus) throw new Error(`${url} → ${r.statusCode}: ${r.body}`);
  return json(r);
};
const put = async (url: string, body: unknown) => {
  const r = await call(ctx, 'PUT', url, body);
  if (r.statusCode !== 200) throw new Error(`${url} → ${r.statusCode}: ${r.body}`);
  return json(r);
};
const get = async (url: string) => json(await call(ctx, 'GET', url));

beforeAll(async () => {
  ctx = await makeApp();
  today = todayFn();
  const ws = await get('/api/workspaces');
  mma = ws.find((w: any) => w.name === 'MMA Spaces').id;
  basira = ws.find((w: any) => w.name === 'Basira').id;
});
afterAll(async () => ctx.close());

describe('companies & relations', () => {
  it('creates companies, links people, and gives one contact roles in several businesses', async () => {
    const org = await post('/api/organizations', { name: 'Gypsum Co', type: 'supplier', industry: 'Building materials' });
    expect((await call(ctx, 'POST', '/api/organizations', { name: 'gypsum co' })).statusCode).toBe(409);
    const p = await post('/api/people', { fullName: 'Hany', organizationId: org.id, role: 'Sales' });
    expect(p.organizationId).toBe(org.id);
    expect((await get(`/api/organizations/${org.id}`)).people.map((x: any) => x.fullName)).toEqual(['Hany']);

    await post('/api/relations', { workspaceId: mma, organizationId: org.id, role: 'supplier' });
    await post('/api/relations', { workspaceId: basira, personId: p.id, role: 'prospect' });
    expect((await call(ctx, 'POST', '/api/relations', { workspaceId: mma, organizationId: org.id, role: 'supplier' })).statusCode).toBe(409);
    expect((await call(ctx, 'POST', '/api/relations', { workspaceId: mma, role: 'client' })).statusCode).toBe(400);
    const suppliers = await get(`/api/relations?workspaceId=${mma}&role=supplier`);
    expect(suppliers.map((r: any) => r.name)).toEqual(['Gypsum Co']);
  });
});

describe('pipeline & opportunities', () => {
  let opp: any;
  it('creates a default pipeline per business and makes the contact a lead', async () => {
    const pipes = await get(`/api/pipelines?workspaceId=${mma}`);
    expect(pipes).toHaveLength(1);
    expect(pipes[0].stages.map((s: any) => s.name)).toEqual(['Lead', 'Contacted', 'Qualified', 'Meeting', 'Proposal', 'Negotiation', 'Won', 'Lost']);
    const client = await post('/api/people', { fullName: 'Nour', relationship: 'client' });
    opp = await post('/api/opportunities', { title: 'Villa New Cairo', workspaceId: mma, personId: client.id, value: '1,200,000', expectedClose: addDays(today, 30), nextAction: 'Send proposal', nextActionDate: today });
    expect(opp).toMatchObject({ stageName: 'Lead', kind: 'open', value: 120_000_000, effectiveProbability: 10 });
    expect((await get(`/api/relations?workspaceId=${mma}&role=lead`)).some((r: any) => r.name === 'Nour')).toBe(true);
  });

  it('moves through stages; winning makes a client and records the close date', async () => {
    const pipes = await get(`/api/pipelines?workspaceId=${mma}`);
    const stage = (n: string) => pipes[0].stages.find((s: any) => s.name === n).id;
    const moved = await post(`/api/opportunities/${opp.id}/move`, { stageId: stage('Proposal') });
    expect(moved.effectiveProbability).toBe(65);
    const won = await post(`/api/opportunities/${opp.id}/move`, { stageId: stage('Won') });
    expect(won).toMatchObject({ kind: 'won', closedAt: today, effectiveProbability: 100 });
    expect((await get(`/api/relations?workspaceId=${mma}&role=client`)).some((r: any) => r.name === 'Nour')).toBe(true);
    // A stage from another business is rejected.
    const otherStage = (await get(`/api/pipelines?workspaceId=${basira}`))[0].stages[0].id;
    expect((await call(ctx, 'POST', `/api/opportunities/${opp.id}/move`, { stageId: otherStage })).statusCode).toBe(400);
  });

  it('reports weighted pipeline, win rate and per-stage values', async () => {
    const pipes = await get(`/api/pipelines?workspaceId=${mma}`);
    const stage = (n: string) => pipes[0].stages.find((s: any) => s.name === n).id;
    await post('/api/opportunities', { title: 'Office fit-out', workspaceId: mma, value: '400000', stageId: stage('Meeting'), nextAction: 'Call back', nextActionDate: addDays(today, -1) });
    const lost = await post('/api/opportunities', { title: 'Small kitchen', workspaceId: mma, value: '50000' });
    await post(`/api/opportunities/${lost.id}/move`, { stageId: stage('Lost'), lostReason: 'Budget' });
    const a = await get(`/api/pipelines/analytics?workspaceId=${mma}`);
    expect(a.stats).toMatchObject({ openCount: 1, openValue: 40_000_000, weightedValue: 20_000_000, wonCount: 1, wonValue: 120_000_000, lostCount: 1, winRate: 0.5 });
    expect(a.byStage.find((s: any) => s.name === 'Meeting').count).toBe(1);
  });

  it('protects stages that still hold deals when editing the pipeline', async () => {
    const p = (await get(`/api/pipelines?workspaceId=${mma}`))[0];
    const withoutMeeting = p.stages.filter((s: any) => s.name !== 'Meeting');
    expect((await call(ctx, 'PUT', `/api/pipelines/${p.id}`, { stages: withoutMeeting })).statusCode).toBe(400);
    const renamed = p.stages.map((s: any) => (s.name === 'Lead' ? { ...s, name: 'Inquiry' } : s));
    expect((await put(`/api/pipelines/${p.id}`, { stages: renamed })).stages[0].name).toBe('Inquiry');
    expect(json(await call(ctx, 'PUT', `/api/pipelines/${p.id}`, { stages: p.stages.filter((s: any) => s.kind !== 'won') })).error.fields[0].path).toBe('stages');
  });

  it('links both the contact and their company when a deal has both', async () => {
    const org = await post('/api/organizations', { name: 'Delta Garments' });
    const p = await post('/api/people', { fullName: 'Omar', organizationId: org.id });
    await post('/api/opportunities', { title: 'Pilot', workspaceId: basira, personId: p.id, organizationId: org.id, value: '60000' });
    const leads = (await get(`/api/relations?workspaceId=${basira}&role=lead`)).map((r: any) => r.name);
    expect(leads).toEqual(expect.arrayContaining(['Omar', 'Delta Garments']));
  });

  it('turns a won deal into a project once', async () => {
    const p1 = await post(`/api/opportunities/${opp.id}/project`, {});
    const p2 = await post(`/api/opportunities/${opp.id}/project`, {});
    expect(p1.id).toBe(p2.id);
    expect(p1).toMatchObject({ name: 'Villa New Cairo', workspaceId: mma, contractValue: 120_000_000, clientName: 'Nour' });
  });
});

describe('projects', () => {
  it('tracks milestones, tasks, revenue, costs, profit and budget health', async () => {
    const prj = await post('/api/projects', { name: 'Apartment Zayed', workspaceId: mma, status: 'active', startDate: addDays(today, -30), deadline: addDays(today, 30), budget: '100000', contractValue: '180000' });
    await post(`/api/projects/${prj.id}/milestones`, { title: 'Demolition', done: true });
    const withMs = await post(`/api/projects/${prj.id}/milestones`, { title: 'Finishing', dueDate: addDays(today, 2) });
    expect(withMs).toMatchObject({ milestonesTotal: 2, milestonesDone: 1, progress: 0.5 });

    const acct = await post('/api/finance/accounts', { name: 'MMA bank', type: 'bank', openingBalance: '0', workspaceId: mma });
    const cats = await get('/api/finance/categories');
    const cat = (n: string) => cats.find((c: any) => c.name === n).id;
    await post('/api/finance/transactions', { type: 'income', date: today, amount: '90000', accountId: acct.id, categoryId: cat('Business income'), projectId: prj.id });
    await post('/api/finance/transactions', { type: 'expense', date: today, amount: '60000', accountId: acct.id, categoryId: cat('Materials'), projectId: prj.id });
    await post('/api/finance/transactions', { type: 'refund', date: today, amount: '5000', accountId: acct.id, categoryId: cat('Materials'), projectId: prj.id });
    const p = await get(`/api/projects/${prj.id}`);
    expect(p).toMatchObject({ revenue: 9_000_000, spent: 5_500_000, profit: 3_500_000, budgetRemaining: 4_500_000, health: 'on_track' });
    expect((await get(`/api/finance/transactions?projectId=${prj.id}`)).total).toBe(3);

    await post('/api/finance/transactions', { type: 'expense', date: today, amount: '50000', accountId: acct.id, categoryId: cat('Contractors'), projectId: prj.id });
    expect((await get(`/api/projects/${prj.id}`)).health).toBe('over_budget');

    const bad = await call(ctx, 'POST', '/api/finance/transactions', { type: 'expense', date: today, amount: '1', accountId: acct.id, categoryId: cat('Materials'), projectId: '00000000-0000-7000-8000-000000000000' });
    expect(json(bad).error.fields[0].path).toBe('projectId');

    await runJobsNow(undefined, true);
    const n = (await get('/api/notifications')).items.map((i: any) => i.title);
    expect(n).toContain('Project over budget: Apartment Zayed');
    expect(n).toContain('Milestone due: Finishing');
    expect(n).toContain('Call back: Office fit-out');
    // The villa deal is won, so its next action no longer nags.
    expect(n.some((t: string) => t.startsWith('Send proposal: Villa New Cairo'))).toBe(false);
  });

  it('appears in the calendar and keeps history when deleted', async () => {
    const prj = (await get(`/api/projects?workspaceId=${mma}`)).find((p: any) => p.name === 'Apartment Zayed');
    const feed = await get(`/api/calendar?from=${today}&to=${addDays(today, 40)}`);
    expect(feed.some((i: any) => i.kind === 'project' && i.title === 'Apartment Zayed')).toBe(true);
    const t = await post('/api/tasks', { title: 'Order tiles', projectId: prj.id });
    await call(ctx, 'DELETE', `/api/projects/${prj.id}`);
    expect((await get(`/api/tasks/${t.id}`)).projectId).toBeNull();
    expect((await get('/api/finance/transactions?q=')).total).toBeGreaterThan(0);
  });
});

describe('business overview', () => {
  it('summarises P&L, pipeline, projects and relations for one business', async () => {
    const o = await get(`/api/business/${mma}/overview`);
    expect(o.workspace.name).toBe('MMA Spaces');
    expect(o.pnl.month.income).toBe(9_000_000);
    expect(o.pnl.month.expenses).toBe(10_500_000);
    expect(o.pnl.ytd.profit).toBe(-1_500_000);
    expect(o.pipeline.stats.wonCount).toBe(1);
    expect(o.roles.client).toBe(1);
    expect(o.roles.supplier).toBe(1);
  });
});
