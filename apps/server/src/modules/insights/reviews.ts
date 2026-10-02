import { defaultReviewPeriod, previousPeriod, reviewPeriod, reviewSchema, weekStartOf, type Period, type ReviewType } from '@life-erp/shared';
import { and, between, desc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { getDb } from '../../db/client';
import {
  achievements,
  events,
  goalCheckins,
  interactions,
  interviews,
  jobApplications,
  learningItems,
  notes,
  opportunities,
  pipelineStages,
  projects,
  reviews,
  tasks,
} from '../../db/schema';
import { audit, type AuditContext } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { newId, nowIso } from '../../lib/ids';
import { registerEntity } from '../../lib/registry';
import { parse } from '../../lib/validate';
import { makeConverter } from '../finance/currency';
import { categoryBreakdown, netPosition, periodTotals } from '../finance/reports';
import { today } from '../life/common';
import { computeGoals } from '../life/goals';
import { reindexEntity } from '../search/service';
import { getSettings } from '../settings/service';

const count = (q: { n: number } | undefined) => Number(q?.n ?? 0);
/** Timestamps are stored in UTC; the date part is close enough for weekly/monthly counts. */
const day = (col: unknown) => sql`substr(${col}, 1, 10)`;

function periodFor(type: ReviewType, start?: string): Period {
  const s = getSettings();
  if (!start) return defaultReviewPeriod(type, today(), s.weekStart);
  // Snap any date to the start of its week/month so one review exists per period.
  return reviewPeriod(type, type === 'weekly' ? weekStartOf(start, s.weekStart) : start);
}

function taskNumbers(p: Period) {
  const db = getDb();
  const live = isNull(tasks.deletedAt);
  return {
    completed: count(db.select({ n: sql<number>`count(*)` }).from(tasks).where(and(live, eq(tasks.status, 'done'), between(day(tasks.completedAt), p.start, p.end))).get()),
    created: count(db.select({ n: sql<number>`count(*)` }).from(tasks).where(and(live, between(day(tasks.createdAt), p.start, p.end))).get()),
    /** Due in the period and still not finished. */
    slipped: count(
      db
        .select({ n: sql<number>`count(*)` })
        .from(tasks)
        .where(and(live, between(tasks.dueDate, p.start, p.end), inArray(tasks.status, ['inbox', 'planned', 'in_progress', 'waiting'])))
        .get(),
    ),
  };
}

/** The numbers for one period. Facts only — counted from your records. */
export function periodMetrics(type: ReviewType, p: Period) {
  const db = getDb();
  const prev = previousPeriod(type, p);
  const money = periodTotals(p.start, p.end);
  const prevMoney = periodTotals(prev.start, prev.end);
  const spending = categoryBreakdown(p.start, p.end, 'expense').items.slice(0, 5).map((c) => ({ name: c.name, nameAr: c.nameAr, total: c.total }));

  const base = getSettings().baseCurrency;
  const conv = makeConverter(base, p.end);
  const won = db
    .select({ value: opportunities.value, currency: opportunities.currency })
    .from(opportunities)
    .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
    .where(and(isNull(opportunities.deletedAt), eq(pipelineStages.kind, 'won'), between(opportunities.closedAt, p.start, p.end)))
    .all();

  const goalViews = [...computeGoals().values()].filter((g) => g.status === 'active');
  const health = { on_track: 0, at_risk: 0, behind: 0, overdue: 0 } as Record<string, number>;
  for (const g of goalViews) if (g.health && g.health in health) health[g.health]++;

  return {
    period: p,
    previous: prev,
    tasks: taskNumbers(p),
    tasksPrevious: taskNumbers(prev),
    money: { ...money, previous: { income: prevMoney.income, expenses: prevMoney.expenses, net: prevMoney.net, savingsRate: prevMoney.savingsRate }, topSpending: spending },
    netWorth: netPosition(today()).netWorth,
    goals: {
      active: goalViews.length,
      health,
      checkins: count(db.select({ n: sql<number>`count(*)` }).from(goalCheckins).where(between(goalCheckins.date, p.start, p.end)).get()),
      needAttention: goalViews
        .filter((g) => g.health === 'behind' || g.health === 'at_risk' || g.health === 'overdue')
        .slice(0, 5)
        .map((g) => ({ id: g.id, title: g.title, health: g.health, progress: g.progress })),
    },
    life: {
      events: count(db.select({ n: sql<number>`count(*)` }).from(events).where(and(isNull(events.deletedAt), between(events.date, p.start, p.end))).get()),
      interactions: count(db.select({ n: sql<number>`count(*)` }).from(interactions).where(and(isNull(interactions.deletedAt), between(interactions.date, p.start, p.end))).get()),
      notes: count(db.select({ n: sql<number>`count(*)` }).from(notes).where(and(isNull(notes.deletedAt), between(day(notes.createdAt), p.start, p.end))).get()),
    },
    business: {
      dealsWon: won.length,
      wonValue: won.reduce((s, o) => s + conv.convert(o.value, o.currency), 0),
      newDeals: count(db.select({ n: sql<number>`count(*)` }).from(opportunities).where(and(isNull(opportunities.deletedAt), between(day(opportunities.createdAt), p.start, p.end))).get()),
      projectsCompleted: count(
        db
          .select({ n: sql<number>`count(*)` })
          .from(projects)
          .where(and(isNull(projects.deletedAt), eq(projects.status, 'completed'), between(day(projects.completedAt), p.start, p.end)))
          .get(),
      ),
    },
    career: {
      applications: count(db.select({ n: sql<number>`count(*)` }).from(jobApplications).where(and(isNull(jobApplications.deletedAt), between(jobApplications.appliedDate, p.start, p.end))).get()),
      interviews: count(
        db
          .select({ n: sql<number>`count(*)` })
          .from(interviews)
          .innerJoin(jobApplications, eq(jobApplications.id, interviews.applicationId))
          .where(and(isNull(jobApplications.deletedAt), between(interviews.date, p.start, p.end), ne(interviews.outcome, 'cancelled')))
          .get(),
      ),
      achievements: count(db.select({ n: sql<number>`count(*)` }).from(achievements).where(and(isNull(achievements.deletedAt), between(achievements.date, p.start, p.end))).get()),
      learningCompleted: count(
        db
          .select({ n: sql<number>`count(*)` })
          .from(learningItems)
          .where(and(isNull(learningItems.deletedAt), isNotNull(learningItems.completedAt), between(learningItems.completedAt, p.start, p.end)))
          .get(),
      ),
    },
    missingRates: [...new Set([...money.missingRates, ...prevMoney.missingRates, ...conv.missing])],
  };
}

type ReviewRow = typeof reviews.$inferSelect;
const shape = (r: ReviewRow) => ({ ...r, metrics: r.metrics ? JSON.parse(r.metrics) : null });

export function listReviews(type?: ReviewType) {
  return getDb()
    .select()
    .from(reviews)
    .where(type ? eq(reviews.type, type) : undefined)
    .orderBy(desc(reviews.periodStart))
    .limit(200)
    .all()
    .map((r) => ({ ...r, metrics: undefined }));
}

/** A review for a period: the saved one (with its saved numbers) or a fresh draft with live numbers. */
export function getReview(type: ReviewType, start?: string) {
  const p = periodFor(type, start);
  if (p.start > today()) throw new AppError(400, 'validation', 'That period has not started yet', [{ path: 'periodStart', message: 'In the future' }]);
  const saved = getDb().select().from(reviews).where(and(eq(reviews.type, type), eq(reviews.periodStart, p.start))).get();
  const live = periodMetrics(type, p);
  return {
    id: saved?.id ?? null,
    type,
    periodStart: p.start,
    periodEnd: p.end,
    inProgress: p.end >= today(),
    wins: saved?.wins ?? null,
    challenges: saved?.challenges ?? null,
    lessons: saved?.lessons ?? null,
    priorities: saved?.priorities ?? null,
    rating: saved?.rating ?? null,
    completedAt: saved?.completedAt ?? null,
    savedMetrics: saved?.metrics ? JSON.parse(saved.metrics) : null,
    metrics: live,
    /** What you planned last time, to compare against. */
    previousPriorities:
      getDb()
        .select({ priorities: reviews.priorities })
        .from(reviews)
        .where(and(eq(reviews.type, type), eq(reviews.periodStart, live.previous.start)))
        .get()?.priorities ?? null,
  };
}

export function saveReview(ctx: AuditContext, input: unknown) {
  const data = parse(reviewSchema, input);
  const p = periodFor(data.type, data.periodStart);
  if (p.start > today()) throw new AppError(400, 'validation', 'That period has not started yet', [{ path: 'periodStart', message: 'In the future' }]);
  const existing = getDb().select().from(reviews).where(and(eq(reviews.type, data.type), eq(reviews.periodStart, p.start))).get();
  const row = {
    type: data.type,
    periodStart: p.start,
    periodEnd: p.end,
    wins: data.wins ?? null,
    challenges: data.challenges ?? null,
    lessons: data.lessons ?? null,
    priorities: data.priorities ?? null,
    rating: data.rating ?? null,
    // The numbers are frozen when you complete the review (editing the text later keeps them);
    // reopening it as a draft goes back to live numbers.
    metrics: data.completed ? (existing?.completedAt && existing.metrics ? existing.metrics : JSON.stringify(periodMetrics(data.type, p))) : null,
    completedAt: data.completed ? (existing?.completedAt ?? nowIso()) : null,
  };
  const id = existing?.id ?? newId();
  if (existing) getDb().update(reviews).set({ ...row, updatedAt: nowIso() }).where(eq(reviews.id, id)).run();
  else getDb().insert(reviews).values({ id, ...row }).run();
  audit(ctx, data.completed ? 'review.complete' : 'review.save', { type: 'review', id }, `${data.type === 'weekly' ? 'Weekly' : 'Monthly'} review ${p.start} – ${p.end}${data.completed ? ' completed' : ' saved'}`);
  reindexEntity('review', id);
  return getReview(data.type, p.start);
}

export function deleteReview(ctx: AuditContext, id: string) {
  const r = getDb().select().from(reviews).where(eq(reviews.id, id)).get();
  if (!r) throw notFound('Review');
  getDb().delete(reviews).where(eq(reviews.id, id)).run();
  reindexEntity('review', id);
  audit(ctx, 'review.delete', { type: 'review', id }, `Deleted ${r.type} review ${r.periodStart}`, shape(r));
}

/** Is the default period's review done? Used by the reminder job and the dashboard. */
export function reviewStatus(d = today()) {
  const s = getSettings();
  const out = {} as Record<ReviewType, { periodStart: string; periodEnd: string; done: boolean }>;
  for (const type of ['weekly', 'monthly'] as const) {
    const p = defaultReviewPeriod(type, d, s.weekStart);
    const r = getDb().select().from(reviews).where(and(eq(reviews.type, type), eq(reviews.periodStart, p.start))).get();
    out[type] = { periodStart: p.start, periodEnd: p.end, done: !!r?.completedAt };
  }
  return out;
}

registerEntity({
  type: 'review',
  exists: (id) => !!getDb().select({ id: reviews.id }).from(reviews).where(eq(reviews.id, id)).get(),
  resolve: (ids) =>
    getDb()
      .select()
      .from(reviews)
      .where(inArray(reviews.id, ids))
      .all()
      .map((r) => ({ id: r.id, type: 'review', title: `${r.type === 'weekly' ? 'Weekly' : 'Monthly'} review ${r.periodStart}`, url: `/reviews/${r.type}/${r.periodStart}` })),
  searchDocs: (ids) =>
    getDb()
      .select()
      .from(reviews)
      .where(ids ? inArray(reviews.id, ids) : undefined)
      .all()
      .map((r) => ({ id: r.id, title: `${r.type === 'weekly' ? 'Weekly' : 'Monthly'} review ${r.periodStart}`, body: [r.wins, r.challenges, r.lessons, r.priorities].filter(Boolean).join('\n') })),
});
