import { addDays } from '@life-erp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runJobsNow } from '../src/jobs/scheduler';
import { today as todayFn } from '../src/modules/life/common';
import { call, json, makeApp, type TestCtx } from './helpers';

let ctx: TestCtx;
let today: string;

const post = async (url: string, body: unknown, expectStatus = 200) => {
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

beforeAll(async () => {
  ctx = await makeApp();
  today = todayFn();
});
afterAll(async () => ctx.close());

describe('applications', () => {
  let app: any;
  it('seeds default statuses once and starts an applied application as Applied', async () => {
    const statuses = await get('/api/career/statuses');
    expect(statuses.map((s: any) => s.name)).toEqual(['Saved', 'Applied', 'HR screening', 'Technical interview', 'Final interview', 'Offer', 'Accepted', 'Rejected', 'Withdrawn']);
    app = await post('/api/career/applications', { company: 'Acme', position: 'Data Analyst', appliedDate: addDays(today, -10), salaryMin: '30,000', salaryMax: '40000', followUpDate: today, priority: 1 });
    expect(app).toMatchObject({ statusName: 'Applied', statusKind: 'active', salaryMin: 3_000_000, salaryMax: 4_000_000, closedAt: null });
    const saved = await post('/api/career/applications', { company: 'Beta', position: 'BI Developer' });
    expect(saved).toMatchObject({ statusName: 'Saved', appliedDate: null });
  });

  it('validates salary range and references', async () => {
    expect((await call(ctx, 'POST', '/api/career/applications', { company: 'X', position: 'Y', salaryMin: '50', salaryMax: '10' })).statusCode).toBe(400);
    expect((await call(ctx, 'POST', '/api/career/applications', { company: 'X', position: 'Y', recruiterPersonId: '0190f0f0-0000-7000-8000-000000000000' })).statusCode).toBe(400);
  });

  it('logging an interview moves the application into the interview stage', async () => {
    const after = await post('/api/career/interviews', { applicationId: app.id, stage: 'HR call', date: addDays(today, 1), time: '11:00', mode: 'phone' });
    expect(after).toMatchObject({ statusName: 'HR screening', interviewCount: 1 });
    expect(after.nextInterview.stage).toBe('HR call');
    expect((await call(ctx, 'POST', '/api/career/interviews', { applicationId: app.id, stage: 'x', date: today, time: '25:00' })).statusCode).toBe(400);
    const cal = await get(`/api/calendar?from=${today}&to=${addDays(today, 3)}`);
    expect(cal.some((i: any) => i.kind === 'career' && i.title === 'Interview: Acme')).toBe(true);
  });

  it('closing sets closedAt, and the funnel counts it', async () => {
    const statuses = await get('/api/career/statuses');
    const rejected = statuses.find((s: any) => s.kind === 'rejected');
    const closed = await put(`/api/career/applications/${app.id}`, { statusId: rejected.id, outcome: 'Went with an internal candidate' });
    expect(closed.closedAt).toBe(today);
    expect(closed.salaryMin).toBe(3_000_000); // untouched fields survive a partial update
    const f = await get('/api/career/funnel');
    expect(f).toMatchObject({ saved: 1, applied: 1, rejected: 1, interviews: 1 });
    expect((await get('/api/career/applications?open=1')).map((a: any) => a.company)).toEqual(['Beta']);
  });

  it("won't remove a status that applications still use", async () => {
    const statuses = await get('/api/career/statuses');
    const withoutSaved = statuses.filter((s: any) => s.name !== 'Saved');
    expect((await call(ctx, 'PUT', '/api/career/statuses', withoutSaved)).statusCode).toBe(400);
    const renamed = statuses.map((s: any) => (s.name === 'HR screening' ? { ...s, name: 'Recruiter call' } : s));
    expect((await put('/api/career/statuses', renamed)).some((s: any) => s.name === 'Recruiter call')).toBe(true);
  });
});

describe('follow-up automation', () => {
  it('creates exactly one task and reminder for a due follow-up', async () => {
    const a = await post('/api/career/applications', { company: 'Gamma', position: 'Analyst', appliedDate: addDays(today, -7), followUpDate: today });
    await runJobsNow(undefined, true);
    await runJobsNow(undefined, true);
    const tasks = await get('/api/tasks?view=open');
    expect(tasks.filter((t: any) => t.title === 'Follow up: Analyst at Gamma')).toHaveLength(1);
    const notes = await get('/api/notifications');
    expect(notes.items.filter((n: any) => n.title === 'Follow up on your application: Gamma')).toHaveLength(1);
    expect(a.statusKind).toBe('active');
  });
});

describe('employment, skills, achievements', () => {
  it('tracks jobs with tenure and a current flag', async () => {
    expect((await call(ctx, 'POST', '/api/career/jobs', { company: 'Old', position: 'Junior', startDate: '2022-01-01', endDate: '2021-01-01' })).statusCode).toBe(400);
    await post('/api/career/jobs', { company: 'Old Co', position: 'Junior Analyst', startDate: '2020-01-01', endDate: '2022-01-01' });
    const cur = await post('/api/career/jobs', { company: 'Now Co', position: 'Senior Analyst', startDate: '2022-02-01', salary: '45,000' });
    expect(cur).toMatchObject({ current: true, salary: 4_500_000 });
    const jobs = await get('/api/career/jobs');
    expect(jobs[0].company).toBe('Now Co');
    expect(jobs[1]).toMatchObject({ current: false, months: 24 });
  });

  it('builds CV bullets from your own facts and updates skill last-used', async () => {
    expect((await call(ctx, 'POST', '/api/career/skills', { name: 'SQL', level: 9 })).statusCode).toBe(400);
    const sql = await post('/api/career/skills', { name: 'SQL', category: 'data', level: 3, targetLevel: 5 });
    expect((await call(ctx, 'POST', '/api/career/skills', { name: 'sql' })).statusCode).toBe(409);
    const job = (await get('/api/career/jobs'))[0];
    const ach = await post('/api/career/achievements', { date: today, employmentId: job.id, title: 'Automated the monthly sales report', metric: 'cut prep time from 2 days to 2 hours', impact: 'freed the team for analysis', skillIds: [sql.id], cvRelevance: 3 });
    expect(ach).toMatchObject({ company: 'Now Co', role: 'Senior Analyst' });
    expect(ach.bullet).toContain('Automated the monthly sales report');
    expect(ach.bullet).toContain('cut prep time from 2 days to 2 hours');
    const skills = await get('/api/career/skills');
    expect(skills[0]).toMatchObject({ name: 'SQL', lastUsed: today, achievementCount: 1, gap: 2 });
    const own = await put(`/api/career/achievements/${ach.id}`, { cvBullet: 'My own wording.' });
    expect(own.bullet).toBe('My own wording.');
    const cv = await get('/api/career/achievements/cv');
    expect(cv.text).toContain('## Senior Analyst — Now Co');
    expect(cv.text).toContain('- My own wording.');
  });
});

describe('learning', () => {
  it('reaching 100% completes it, and overdue deadlines raise a warning', async () => {
    const l = await post('/api/career/learning', { title: 'Power BI course', status: 'in_progress', progress: 40, deadline: addDays(today, -1), cost: '1,500' });
    expect(l).toMatchObject({ startDate: null, cost: 150_000 });
    const fresh = await post('/api/career/learning', { title: 'SQL book', type: 'book', status: 'in_progress' });
    expect(fresh.startDate).toBe(today);
    await runJobsNow(undefined, true);
    const notes = await get('/api/notifications');
    expect(notes.items.some((n: any) => n.title === 'Learning deadline passed: Power BI course')).toBe(true);
    const done = await put(`/api/career/learning/${l.id}`, { progress: 100 });
    expect(done).toMatchObject({ status: 'completed', completedAt: today });
    const ov = await get('/api/career/overview');
    expect(ov.learningOverdue).toBe(0);
    expect(ov.skillGaps[0].name).toBe('SQL');
    expect(ov.current.map((j: any) => j.company)).toEqual(['Now Co']);
  });

  it('career records are searchable', async () => {
    const r = await get('/api/search?q=Power');
    expect(r.some((x: any) => x.type === 'learning')).toBe(true);
  });
});
