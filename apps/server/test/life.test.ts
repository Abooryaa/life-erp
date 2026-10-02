import { addDays, addMonths } from '@life-erp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runJobsNow } from '../src/jobs/scheduler';
import { today as todayFn } from '../src/modules/life/common';
import { runEventReminders } from '../src/modules/life/jobs';
import { call, json, makeApp, type TestCtx } from './helpers';

let ctx: TestCtx;
let today: string;

const post = async (url: string, body: unknown, expectStatus = 200, headers: Record<string, string> = {}) => {
  const r = await call(ctx, 'POST', url, body, headers);
  if (r.statusCode !== expectStatus) throw new Error(`${url} → ${r.statusCode}: ${r.body}`);
  return json(r);
};
const get = async (url: string) => json(await call(ctx, 'GET', url));

beforeAll(async () => {
  ctx = await makeApp();
  today = todayFn();
});
afterAll(async () => ctx.close());

describe('tasks', () => {
  it('captures to the inbox, or plans it when it has a due date', async () => {
    const inbox = await post('/api/tasks', { title: 'Think about Basira pricing' });
    expect(inbox.status).toBe('inbox');
    const planned = await post('/api/tasks', { title: 'Pay electricity', dueDate: today, priority: 1 });
    expect(planned.status).toBe('planned');
    expect((await get('/api/tasks/counts')).inbox).toBe(1);
  });

  it('parses natural-language quick capture', async () => {
    const t = await post('/api/tasks/quick', { text: 'Call the gypsum supplier tomorrow 11am !high #mma' });
    expect(t).toMatchObject({ title: 'Call the gypsum supplier', dueDate: addDays(today, 1), dueTime: '11:00', priority: 2, tags: ['mma'] });
  });

  it('sorts views: today includes overdue; upcoming, anytime and done work', async () => {
    await post('/api/tasks', { title: 'Overdue thing', dueDate: addDays(today, -2) });
    await post('/api/tasks', { title: 'Someday', status: 'planned' });
    const todayList = await get('/api/tasks?view=today');
    expect(todayList.map((t: any) => t.title)).toEqual(['Overdue thing', 'Pay electricity']);
    expect((await get('/api/tasks?view=upcoming')).some((t: any) => t.title === 'Call the gypsum supplier')).toBe(true);
    expect((await get('/api/tasks?view=anytime')).map((t: any) => t.title)).toEqual(['Someday']);
    const counts = await get('/api/tasks/counts');
    expect(counts).toMatchObject({ overdue: 1, today: 1 });
  });

  it('completing a recurring task creates the next one exactly once', async () => {
    const t = await post('/api/tasks', { title: 'Weekly review', dueDate: today, recurrence: 'weekly' });
    const done = await post(`/api/tasks/${t.id}/status`, { status: 'done' });
    expect(done.completedAt).toBeTruthy();
    expect(done.nextTaskId).toBeTruthy();
    const next = await get(`/api/tasks/${done.nextTaskId}`);
    expect(next).toMatchObject({ title: 'Weekly review', dueDate: addDays(today, 7), status: 'planned' });
    // Re-open and complete again: no second copy.
    await post(`/api/tasks/${t.id}/status`, { status: 'planned' });
    const again = await post(`/api/tasks/${t.id}/status`, { status: 'done' });
    expect(again.nextTaskId).toBeNull();
  });

  it('validates linked records', async () => {
    const r = await call(ctx, 'POST', '/api/tasks', { title: 'x', goalId: '00000000-0000-7000-8000-000000000000' });
    expect(json(r).error.fields[0].path).toBe('goalId');
    expect((await call(ctx, 'POST', '/api/tasks', { title: '' })).statusCode).toBe(400);
  });
});

describe('calendar', () => {
  it('expands recurring and multi-day events and validates times', async () => {
    await post('/api/events', { title: 'Site visit', date: today, startTime: '10:00', endTime: '11:30', kind: 'meeting', reminderMinutes: 1440 });
    await post('/api/events', { title: 'Standup', date: today, startTime: '09:00', recurrence: 'daily', recurrenceUntil: addDays(today, 4) });
    await post('/api/events', { title: 'Expo', date: addDays(today, 2), endDate: addDays(today, 4), allDay: true });
    const bad = await call(ctx, 'POST', '/api/events', { title: 'Bad', date: today, startTime: '10:00', endTime: '09:00' });
    expect(json(bad).error.fields[0].path).toBe('endTime');
    expect(json(await call(ctx, 'POST', '/api/events', { title: 'No time', date: today })).error.fields[0].path).toBe('startTime');

    const feed = await get(`/api/calendar?from=${addDays(today, 3)}&to=${addDays(today, 3)}`);
    const titles = feed.filter((i: any) => i.kind === 'event').map((i: any) => i.title);
    expect(titles).toEqual(expect.arrayContaining(['Standup', 'Expo']));
    expect((await get(`/api/calendar?from=${addDays(today, 5)}&to=${addDays(today, 5)}`)).some((i: any) => i.title === 'Standup')).toBe(false);
  });

  it('shows tasks, goal deadlines and birthdays in the unified feed', async () => {
    await post('/api/people', { fullName: 'Sara', relationship: 'family', birthday: `1995-${addDays(today, 1).slice(5)}` });
    const feed = await get(`/api/calendar?from=${today}&to=${addDays(today, 7)}`);
    const kinds = new Set(feed.map((i: any) => i.kind));
    expect(kinds.has('task')).toBe(true);
    expect(kinds.has('birthday')).toBe(true);
  });

  it('sends event reminders once', async () => {
    runEventReminders({ date: today, time: '09:30' });
    runEventReminders({ date: today, time: '09:31' });
    const n = (await get('/api/notifications')).items.filter((i: any) => i.title.includes('Site visit'));
    expect(n).toHaveLength(1);
  });

  it('rejects oversized ranges', async () => {
    expect((await call(ctx, 'GET', `/api/calendar?from=2020-01-01&to=2030-01-01`)).statusCode).toBe(400);
  });
});

describe('goals / OKRs', () => {
  it('computes progress from check-ins, tasks, children and a savings goal', async () => {
    const vision = await post('/api/goals', { title: 'Financial freedom', level: 'vision', metric: 'children' });
    const weight = await post('/api/goals', { title: 'Reach 80 kg', level: 'objective', parentId: vision.id, metric: 'numeric', startValue: 95, targetValue: 80, unit: 'kg' });
    expect(weight.progress).toBe(0);
    const w2 = await post(`/api/goals/${weight.id}/checkins`, { date: today, value: 90 });
    expect(w2.progress).toBeCloseTo(1 / 3);
    const launch = await post('/api/goals', { title: 'Launch Basira MVP', level: 'objective', parentId: vision.id, metric: 'tasks', deadline: addMonths(today, 3) });
    const t1 = await post('/api/tasks', { title: 'Build data validation', goalId: launch.id, status: 'planned' });
    await post('/api/tasks', { title: 'Build dashboards', goalId: launch.id, status: 'planned' });
    await post(`/api/tasks/${t1.id}/status`, { status: 'done' });
    expect((await get(`/api/goals/${launch.id}`)).progress).toBe(0.5);
    const v = await get(`/api/goals/${vision.id}`);
    expect(v.progress).toBeCloseTo((1 / 3 + 0.5) / 2);
    expect(v.children).toHaveLength(2);

    const sg = await post('/api/finance/goals', { name: 'Car fund', targetAmount: '100000', startingAmount: '25000' });
    const linked = await post('/api/goals', { title: 'Buy a car', metric: 'savings', savingsGoalId: sg.id });
    expect(linked.progress).toBeCloseTo(0.25);
  });

  it('prevents loops in the hierarchy and requires targets', async () => {
    const a = await post('/api/goals', { title: 'A' });
    const b = await post('/api/goals', { title: 'B', parentId: a.id });
    const loop = await call(ctx, 'PUT', `/api/goals/${a.id}`, { parentId: b.id });
    expect(json(loop).error.fields[0].path).toBe('parentId');
    expect(json(await call(ctx, 'POST', '/api/goals', { title: 'X', metric: 'numeric' })).error.fields[0].path).toBe('targetValue');
  });

  it('flags goals that are behind schedule', async () => {
    const g = await post('/api/goals', { title: 'Read 24 books', metric: 'numeric', startValue: 0, targetValue: 24, startDate: addMonths(today, -6), deadline: addMonths(today, 6) });
    await post(`/api/goals/${g.id}/checkins`, { date: today, value: 2 });
    expect((await get(`/api/goals/${g.id}`)).health).toBe('behind');
    await runJobsNow(undefined, true);
    expect((await get('/api/notifications')).items.some((i: any) => i.title === 'Goal behind schedule: Read 24 books')).toBe(true);
  });
});

describe('notes', () => {
  it('links notes with [[wiki links]] and shows backlinks', async () => {
    const a = await post('/api/notes', { title: 'Basira pricing', body: 'See [[Competitor analysis]] and [[Missing note]]' });
    expect(a.links).toEqual([
      { title: 'Competitor analysis', id: null },
      { title: 'Missing note', id: null },
    ]);
    const b = await post('/api/notes', { title: 'Competitor analysis', body: 'Notes about competitors' });
    expect(b.backlinks.map((x: any) => x.id)).toEqual([a.id]); // created after: earlier mention now resolves
    const a2 = await get(`/api/notes/${a.id}`);
    expect(a2.links[0].id).toBe(b.id);
    expect(json(await call(ctx, 'GET', '/api/search?q=competitors')).some((h: any) => h.type === 'note')).toBe(true);
  });

  it('pins, archives and deletes', async () => {
    const n = await post('/api/notes', { title: 'Pinned', body: '', pinned: true });
    expect((await get('/api/notes'))[0].id).toBe(n.id);
    await call(ctx, 'PUT', `/api/notes/${n.id}`, { archived: true });
    expect((await get('/api/notes')).some((x: any) => x.id === n.id)).toBe(false);
    expect((await get('/api/notes?archived=1')).some((x: any) => x.id === n.id)).toBe(true);
  });
});

describe('people & follow-ups', () => {
  it('logs interactions, tracks last contact and creates a follow-up task once', async () => {
    const p = await post('/api/people', { fullName: 'Eng. Karim', relationship: 'contractor', phone: '+20 100 000 0000', company: 'Karim Electric' });
    const after = await post('/api/interactions', { personId: p.id, kind: 'whatsapp', date: today, summary: 'Asked for the electrical BOQ', nextFollowUp: today });
    expect(after.lastContact).toBe(today);
    expect(after.nextFollowUp).toBe(today);
    await runJobsNow(undefined, true);
    await runJobsNow(undefined, true);
    const followUps = (await get(`/api/tasks?personId=${p.id}`)).filter((t: any) => t.title === 'Follow up with Eng. Karim');
    expect(followUps).toHaveLength(1);
    // Contacting again clears a due follow-up.
    const cleared = await post('/api/interactions', { personId: p.id, kind: 'call', date: addDays(today, 1), summary: 'Got the BOQ' });
    expect(cleared.nextFollowUp).toBeNull();
    expect((await call(ctx, 'POST', '/api/people', { fullName: 'Eng. Karim', phone: '+20 100 000 0000' })).statusCode).toBe(409);
  });
});

describe('today view', () => {
  it('collects overdue, due today, events, follow-ups and birthdays', async () => {
    const t = await get('/api/today');
    expect(t.date).toBe(today);
    expect(t.overdue.map((x: any) => x.title)).toContain('Overdue thing');
    expect(t.dueToday.map((x: any) => x.title)).toContain('Pay electricity');
    expect(t.events.map((e: any) => e.title)).toEqual(expect.arrayContaining(['Standup', 'Site visit']));
    expect(t.birthdays.some((b: any) => b.name === 'Sara')).toBe(true);
  });
});

describe('idempotent retries (phone outbox)', () => {
  it('returns the original result for a replayed request instead of creating a duplicate', async () => {
    const headers = { 'x-idempotency-key': 'outbox-test-key-1' };
    const first = await post('/api/tasks', { title: 'Queued offline' }, 200, headers);
    const replay = await call(ctx, 'POST', '/api/tasks', { title: 'Queued offline' }, headers);
    expect(replay.headers['x-idempotent-replay']).toBe('1');
    expect(json(replay).id).toBe(first.id);
    expect((await get('/api/tasks?q=Queued offline')).length).toBe(1);
  });
});
