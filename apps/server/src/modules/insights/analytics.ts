import { addMonthsToMonth, monthEnd, monthStart } from '@life-erp/shared';
import { and, asc, between, eq, gte, isNull, sql } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { goalCheckins, interviews, jobApplications, learningItems, netWorthSnapshots, opportunities, pipelineStages, tasks, achievements } from '../../db/schema';
import { makeConverter } from '../finance/currency';
import { monthlySeries, netPosition } from '../finance/reports';
import { today } from '../life/common';
import { computeGoals } from '../life/goals';
import { getSettings } from '../settings/service';

/** Record today's net worth (one row per day; later runs the same day overwrite it). */
export function snapshotNetWorth(d = today()) {
  const n = netPosition(d);
  const row = {
    base: n.base,
    liquid: n.liquid,
    investments: n.investments,
    otherAssets: n.otherAssets + n.physicalAssets + n.receivables,
    liabilities: n.liabilities,
    netWorth: n.netWorth,
  };
  getDb()
    .insert(netWorthSnapshots)
    .values({ date: d, ...row })
    .onConflictDoUpdate({ target: netWorthSnapshots.date, set: row })
    .run();
  return { date: d, ...row };
}

export function netWorthHistory(days = 730) {
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const base = getSettings().baseCurrency;
  // Snapshots taken in another base currency are not comparable, so they are left out.
  return getDb()
    .select()
    .from(netWorthSnapshots)
    .where(and(gte(netWorthSnapshots.date, from), eq(netWorthSnapshots.base, base)))
    .orderBy(asc(netWorthSnapshots.date))
    .all();
}

type Monthly = Record<string, number>;
function byMonth(rows: { m: string | null; n: number }[]): Monthly {
  return Object.fromEntries(rows.filter((r) => r.m).map((r) => [r.m!, Number(r.n)]));
}

/** Cross-module trends for the last `months` months — all counted from your records. */
export function analytics(months = 12) {
  const d = today();
  const end = d.slice(0, 7);
  const start = addMonthsToMonth(end, -(months - 1));
  const from = monthStart(start);
  const to = monthEnd(end);
  const list = Array.from({ length: months }, (_, i) => addMonthsToMonth(start, i));
  const db = getDb();
  const m = (col: unknown) => sql<string>`substr(${col}, 1, 7)`;
  const fill = (x: Monthly) => list.map((k) => x[k] ?? 0);

  const money = monthlySeries(end, months);

  const tasksDone = byMonth(
    db
      .select({ m: m(tasks.completedAt), n: sql<number>`count(*)` })
      .from(tasks)
      .where(and(isNull(tasks.deletedAt), eq(tasks.status, 'done'), between(sql`substr(${tasks.completedAt}, 1, 10)`, from, to)))
      .groupBy(sql`1`)
      .all(),
  );
  const tasksCreated = byMonth(
    db
      .select({ m: m(tasks.createdAt), n: sql<number>`count(*)` })
      .from(tasks)
      .where(and(isNull(tasks.deletedAt), between(sql`substr(${tasks.createdAt}, 1, 10)`, from, to)))
      .groupBy(sql`1`)
      .all(),
  );
  const checkins = byMonth(db.select({ m: m(goalCheckins.date), n: sql<number>`count(*)` }).from(goalCheckins).where(between(goalCheckins.date, from, to)).groupBy(sql`1`).all());

  const base = getSettings().baseCurrency;
  const conv = makeConverter(base, to);
  const wonRows = db
    .select({ m: m(opportunities.closedAt), value: opportunities.value, currency: opportunities.currency })
    .from(opportunities)
    .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
    .where(and(isNull(opportunities.deletedAt), eq(pipelineStages.kind, 'won'), between(opportunities.closedAt, from, to)))
    .all();
  const won: Monthly = {};
  for (const r of wonRows) won[r.m] = (won[r.m] ?? 0) + conv.convert(r.value, r.currency);

  const apps = byMonth(
    db
      .select({ m: m(jobApplications.appliedDate), n: sql<number>`count(*)` })
      .from(jobApplications)
      .where(and(isNull(jobApplications.deletedAt), between(jobApplications.appliedDate, from, to)))
      .groupBy(sql`1`)
      .all(),
  );
  const ivs = byMonth(
    db
      .select({ m: m(interviews.date), n: sql<number>`count(*)` })
      .from(interviews)
      .innerJoin(jobApplications, eq(jobApplications.id, interviews.applicationId))
      .where(and(isNull(jobApplications.deletedAt), between(interviews.date, from, to)))
      .groupBy(sql`1`)
      .all(),
  );
  const achs = byMonth(db.select({ m: m(achievements.date), n: sql<number>`count(*)` }).from(achievements).where(and(isNull(achievements.deletedAt), between(achievements.date, from, to))).groupBy(sql`1`).all());
  const learned = byMonth(
    db
      .select({ m: m(learningItems.completedAt), n: sql<number>`count(*)` })
      .from(learningItems)
      .where(and(isNull(learningItems.deletedAt), between(learningItems.completedAt, from, to)))
      .groupBy(sql`1`)
      .all(),
  );

  const goals = [...computeGoals().values()].filter((g) => g.status === 'active');
  const goalHealth: Record<string, number> = {};
  for (const g of goals) {
    const k = g.health ?? 'no_target';
    goalHealth[k] = (goalHealth[k] ?? 0) + 1;
  }

  // Last snapshot of each month.
  const nw: Monthly = {};
  for (const s of netWorthHistory(months * 31 + 31)) nw[s.date.slice(0, 7)] = s.netWorth;

  return {
    base,
    months: list,
    money: { income: money.months.map((x) => x.income), expenses: money.months.map((x) => x.expenses), net: money.months.map((x) => x.net), savingsRate: money.months.map((x) => x.savingsRate) },
    netWorth: list.map((k) => (k in nw ? nw[k] : null)),
    tasks: { done: fill(tasksDone), created: fill(tasksCreated) },
    goals: { checkins: fill(checkins), health: goalHealth, active: goals.length },
    business: { wonValue: fill(won) },
    career: { applications: fill(apps), interviews: fill(ivs), achievements: fill(achs), learningCompleted: fill(learned) },
    missingRates: [...new Set([...money.missingRates, ...conv.missing])],
  };
}
