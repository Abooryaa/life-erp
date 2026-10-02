import { addDays } from '@life-erp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runScheduled } from '../src/modules/automation/engine';
import { today as todayFn } from '../src/modules/life/common';
import { call, json, makeApp, type TestCtx } from './helpers';

let ctx: TestCtx;
let today: string;
let account: any;
let groceries: any;
let salary: any;

const post = async (url: string, body?: unknown, expectStatus = 200) => {
  const r = await call(ctx, 'POST', url, body);
  if (r.statusCode !== expectStatus) throw new Error(`${url} → ${r.statusCode}: ${r.body}`);
  return json(r);
};
const put = async (url: string, body: unknown, expectStatus = 200) => {
  const r = await call(ctx, 'PUT', url, body);
  if (r.statusCode !== expectStatus) throw new Error(`${url} → ${r.statusCode}: ${r.body}`);
  return json(r);
};
const get = async (url: string) => json(await call(ctx, 'GET', url));
const notes = async () => (await get('/api/notifications')).items as any[];

beforeAll(async () => {
  ctx = await makeApp();
  today = todayFn();
  account = await post('/api/finance/accounts', { name: 'CIB', type: 'bank', openingBalance: '50000' });
  const cats = await get('/api/finance/categories');
  groceries = cats.find((c: any) => c.kind === 'expense');
  salary = cats.find((c: any) => c.kind === 'income');
});
afterAll(async () => ctx.close());

describe('automation rules', () => {
  let rule: any;
  it('validates rules', async () => {
    expect((await call(ctx, 'POST', '/api/automations', { name: 'x', event: 'transaction.create', actions: [] })).statusCode).toBe(400);
    expect((await call(ctx, 'POST', '/api/automations', { name: 'x', event: 'schedule', actions: [{ type: 'notify', title: 'Hi' }] })).statusCode).toBe(400);
    expect((await call(ctx, 'POST', '/api/automations', { name: 'x', event: 'schedule', schedule: { frequency: 'weekly', time: '09:00' }, actions: [{ type: 'notify', title: 'Hi' }] })).statusCode).toBe(400);
  });

  it('big expenses → notification + task linked to the transaction + tag; small ones are ignored', async () => {
    rule = await post('/api/automations', {
      name: 'Big spend',
      event: 'transaction.create',
      conditions: [
        { field: 'type', op: 'eq', value: 'expense' },
        { field: 'amount', op: 'gte', value: '5000' },
      ],
      actions: [
        { type: 'notify', severity: 'warning', title: 'Big expense: {{amount}} {{currency}}', body: '{{description}}' },
        { type: 'create_task', title: 'Check receipt for {{description}}', priority: 2, dueInDays: 1 },
        { type: 'add_tag', tag: 'review' },
      ],
    });
    await post('/api/finance/transactions', { type: 'expense', date: today, amount: '120', accountId: account.id, categoryId: groceries.id, description: 'Coffee' });
    const big = await post('/api/finance/transactions', { type: 'expense', date: today, amount: '7,500', accountId: account.id, categoryId: groceries.id, description: 'New fridge' });
    const n = (await notes()).filter((x) => x.title.startsWith('Big expense'));
    expect(n.map((x) => x.title)).toEqual(['Big expense: 7500 EGP']);
    expect(n[0].body).toBe('New fridge');
    const tasks = (await get('/api/tasks?view=open')).filter((t: any) => t.title === 'Check receipt for New fridge');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ priority: 2, dueDate: addDays(today, 1) });
    const links = await get(`/api/links?type=transaction&id=${big.id}`);
    expect(JSON.stringify(links)).toContain(tasks[0].id);
    expect((await get(`/api/finance/transactions/${big.id}`)).tags).toContain('review');
    const detail = await get(`/api/automations/${rule.id}`);
    expect(detail.runCount).toBe(1);
    expect(detail.runs[0]).toMatchObject({ status: 'ok', entityId: big.id });
  });

  it('tasks created by automations never trigger automations (no loops)', async () => {
    await post('/api/automations', { name: 'Echo', event: 'task.create', actions: [{ type: 'create_task', title: 'Echo of {{title}}' }] });
    await post('/api/tasks', { title: 'Hello', status: 'planned' });
    const titles = (await get('/api/tasks?view=open')).map((t: any) => t.title);
    expect(titles.filter((t: string) => t.startsWith('Echo of'))).toEqual(['Echo of Hello']);
  });

  it('paused rules do nothing; test runs show matches without side effects', async () => {
    await put(`/api/automations/${rule.id}`, { enabled: false });
    await post('/api/finance/transactions', { type: 'expense', date: today, amount: '9000', accountId: account.id, categoryId: groceries.id, description: 'Sofa' });
    expect((await notes()).filter((x) => x.title.startsWith('Big expense'))).toHaveLength(1);
    const before = (await get('/api/tasks?view=all')).length;
    const test = await post('/api/automations/test', { name: 't', event: 'transaction.create', conditions: [{ field: 'amount', op: 'gte', value: '5000' }], actions: [{ type: 'create_task', title: 'Look at {{description}}' }] });
    expect(test.matched).toBe(2);
    expect(test.matches.map((m: any) => m.actions[0].text).sort()).toEqual(['Look at New fridge', 'Look at Sofa']);
    expect((await get('/api/tasks?view=all')).length).toBe(before);
  });

  it('stage changes: notify when a deal is won', async () => {
    const ws = (await get('/api/workspaces')).find((w: any) => w.kind === 'business');
    await post('/api/automations', { name: 'Won', event: 'opportunity.stage', conditions: [{ field: 'stageKind', op: 'eq', value: 'won' }], actions: [{ type: 'notify', title: 'Won {{title}} ({{value}} {{currency}})' }] });
    const opp = await post('/api/opportunities', { title: 'Office fit-out', workspaceId: ws.id, value: '650000' });
    const won = (await get(`/api/pipelines?workspaceId=${ws.id}`))[0].stages.find((s: any) => s.kind === 'won');
    await post(`/api/opportunities/${opp.id}/move`, { stageId: won.id });
    expect((await notes()).some((x) => x.title === 'Won Office fit-out (650000 EGP)')).toBe(true);
  });

  it('a failing action is logged as an error and does not block the change', async () => {
    const r = await post('/api/automations', { name: 'Bad tag', event: 'person.create', actions: [{ type: 'add_tag', tag: 'not a valid tag!!' }] });
    const p = await post('/api/people', { fullName: 'Mona' });
    expect(p.fullName).toBe('Mona');
    const d = await get(`/api/automations/${r.id}`);
    expect(d.runs[0].status).toBe('error');
  });

  it('scheduled rules fire once per occurrence and never for one already past at creation', async () => {
    const r = await post('/api/automations', { name: 'Weekly money check', event: 'schedule', schedule: { frequency: 'daily', time: '00:00' }, actions: [{ type: 'create_task', title: 'Money check {{today}}' }] });
    runScheduled();
    expect((await get(`/api/automations/${r.id}`)).runCount).toBe(0); // today's 00:00 had passed when it was created
    runScheduled({ date: addDays(today, 1), time: '00:01' });
    runScheduled({ date: addDays(today, 1), time: '08:00' });
    expect((await get(`/api/automations/${r.id}`)).runCount).toBe(1);
  });
});

describe('custom fields', () => {
  let person: any;
  let fields: any[];
  it('defines fields per record type with validation', async () => {
    expect((await call(ctx, 'POST', '/api/custom-fields', { entityType: 'person', label: 'Size', type: 'select' })).statusCode).toBe(400);
    const a = await post('/api/custom-fields', { entityType: 'person', label: 'National ID', type: 'text', required: true });
    const b = await post('/api/custom-fields', { entityType: 'person', label: 'Shirt size', type: 'select', options: ['S', 'M', 'L'] });
    const c = await post('/api/custom-fields', { entityType: 'person', label: 'Credit limit', type: 'number' });
    expect((await call(ctx, 'POST', '/api/custom-fields', { entityType: 'person', label: 'national id', type: 'text' })).statusCode).toBe(409);
    fields = [a, b, c];
    person = await post('/api/people', { fullName: 'Karim Hassan' });
  });

  it('stores, validates and searches values', async () => {
    const [id, size, limit] = fields;
    expect((await call(ctx, 'PUT', `/api/custom-fields/values/person/${person.id}`, { [size.id]: 'XL' })).statusCode).toBe(400);
    expect((await call(ctx, 'PUT', `/api/custom-fields/values/person/${person.id}`, { [limit.id]: 'lots' })).statusCode).toBe(400);
    expect((await call(ctx, 'PUT', `/api/custom-fields/values/person/${person.id}`, { [id.id]: '' })).statusCode).toBe(400);
    const v = await put(`/api/custom-fields/values/person/${person.id}`, { [id.id]: '29001011234567', [size.id]: 'M', [limit.id]: '15,000' });
    expect(Object.fromEntries(v.map((x: any) => [x.label, x.value]))).toEqual({ 'National ID': '29001011234567', 'Shirt size': 'M', 'Credit limit': '15000' });
    const hits = await get('/api/search?q=29001011234567');
    expect(hits.some((h: any) => h.id === person.id)).toBe(true);
  });

  it('protects options and types that are in use', async () => {
    const [, size] = fields;
    expect((await call(ctx, 'PUT', `/api/custom-fields/${size.id}`, { options: ['S', 'L'] })).statusCode).toBe(400);
    expect((await call(ctx, 'PUT', `/api/custom-fields/${size.id}`, { type: 'text' })).statusCode).toBe(400);
    expect((await put(`/api/custom-fields/${size.id}`, { options: ['S', 'M', 'L', 'XL'] })).options).toContain('XL');
  });
});

describe('import', () => {
  const bank = [
    'Booking Date;Details;Debit;Credit;Balance',
    '01/09/2026;"Salary September";;45.000,00;95.000,00',
    '03/09/2026;Carrefour Maadi;1.250,50;;93.749,50',
    '04/09/2026;Rent;12.000,00;;81.749,50',
    'bad date;Mystery;10,00;;0',
    '03/09/2026;Carrefour Maadi;1.250,50;;80.499,00',
  ].join('\n');
  const base = () => ({ target: 'transactions', fileName: 'cib.csv', content: bank, format: 'csv' });

  it('analyzes a bank CSV: columns, delimiter, mapping, date format and decimal comma', async () => {
    const a = await post('/api/import/analyze', base());
    expect(a.delimiter).toBe(';');
    expect(a.rowCount).toBe(5);
    expect(a.suggested.mapping).toMatchObject({ date: 'Booking Date', description: 'Details', moneyOut: 'Debit', moneyIn: 'Credit' });
    expect(a.suggested).toMatchObject({ dateFormat: null, decimal: ',', amountMode: 'split' }); // "bad date" makes the format ambiguous
  });

  it('preview validates every row, flags duplicates within the file, and saves nothing', async () => {
    const before = (await get('/api/finance/transactions')).items?.length ?? (await get('/api/finance/transactions')).length;
    const req = {
      ...base(),
      mapping: { date: 'Booking Date', description: 'Details', moneyOut: 'Debit', moneyIn: 'Credit' },
      options: { dateFormat: 'dd/MM/yyyy', decimal: ',', amountMode: 'split', accountId: account.id, defaultExpenseCategoryId: groceries.id, defaultIncomeCategoryId: salary.id },
    };
    expect((await call(ctx, 'POST', '/api/import/preview', { ...req, options: { ...req.options, accountId: null } })).statusCode).toBe(400);
    const p = await post('/api/import/preview', req);
    expect(p).toMatchObject({ committed: false, total: 5, ok: 3, errors: 1, duplicates: 1 });
    expect(p.results[0].summary).toContain('+45000.00 EGP');
    expect(p.results[3]).toMatchObject({ row: 5, status: 'error', field: 'date' });
    const after = (await get('/api/finance/transactions')).items?.length ?? (await get('/api/finance/transactions')).length;
    expect(after).toBe(before);

    const c = await post('/api/import/commit', req);
    expect(c).toMatchObject({ committed: true, ok: 3 });
    const acct = (await get('/api/finance/accounts')).find((x: any) => x.id === account.id);
    const balanceAfterImport = acct.balance;
    // Importing the same file again: everything already there is flagged, nothing is doubled.
    const again = await post('/api/import/preview', req);
    expect(again).toMatchObject({ ok: 0, duplicates: 4 });

    const list = await get('/api/imports');
    expect(list[0]).toMatchObject({ target: 'transactions', createdCount: 3, skippedCount: 2, fileName: 'cib.csv' });
    const undo = await post(`/api/imports/${c.importId}/undo`);
    expect(undo).toEqual({ removed: 3, skipped: 0 });
    const acct2 = (await get('/api/finance/accounts')).find((x: any) => x.id === account.id);
    expect(acct2.balance).toBe(balanceAfterImport - 4_500_000 + 125_050 + 1_200_000);
    expect((await call(ctx, 'POST', `/api/imports/${c.importId}/undo`)).statusCode).toBe(400);
  });

  it('imports contacts from JSON with loose values and warnings', async () => {
    const content = JSON.stringify([
      { name: 'Sara Adel', phone: '01001234567', relationship: 'Friend', tags: 'gym, family' },
      { name: 'Omar', relationship: 'neighbour' },
      { name: '' },
    ]);
    const a = await post('/api/import/analyze', { target: 'people', content, format: 'json' });
    expect(a.suggested.mapping).toMatchObject({ fullName: 'name', phone: 'phone', relationship: 'relationship', tags: 'tags' });
    const c = await post('/api/import/commit', { target: 'people', content, format: 'json', mapping: a.suggested.mapping });
    expect(c).toMatchObject({ ok: 2, errors: 1 });
    expect(c.results[1].warnings[0]).toContain('neighbour');
    const sara = (await get('/api/people')).find((p: any) => p.fullName === 'Sara Adel');
    expect(sara.relationship).toBe('friend');
    expect(sara.tags.sort()).toEqual(['family', 'gym']);
  });

  it('runs automations for imported rows only when asked', async () => {
    await post('/api/automations', { name: 'Imported task', event: 'task.create', actions: [{ type: 'notify', title: 'New task {{title}}' }] });
    const content = 'Title,Due\nPay electricity,2026-10-05\n';
    await post('/api/import/commit', { target: 'tasks', content, mapping: { title: 'Title', dueDate: 'Due' } });
    expect((await notes()).some((n) => n.title === 'New task Pay electricity')).toBe(false);
    await post('/api/import/commit', { target: 'tasks', content: 'Title\nRenew passport\n', mapping: { title: 'Title' }, options: { runAutomations: true } });
    expect((await notes()).some((n) => n.title === 'New task Renew passport')).toBe(true);
  });

  it('saves a column mapping per bank', async () => {
    const p = await post('/api/import/presets', { name: 'CIB statement', target: 'transactions', mapping: { date: 'Booking Date' }, options: { decimal: ',', dateFormat: 'dd/MM/yyyy' } });
    expect(p[0]).toMatchObject({ name: 'CIB statement', options: { decimal: ',' } });
    expect((await post('/api/import/presets', { name: 'CIB statement', target: 'transactions', mapping: { date: 'Date' }, options: {} }))).toHaveLength(1);
  });
});
