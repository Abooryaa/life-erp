import { addDays, addMonthsToMonth, fromMinor, monthEnd, monthStart, type AiScope, type ReviewType } from '@life-erp/shared';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { listOpportunities, pipelineAnalytics } from '../business/pipeline';
import { listProjects } from '../business/projects';
import { careerOverview } from '../career/overview';
import { categoryBreakdown, netPosition, periodTotals, upcoming } from '../finance/reports';
import { listTransactions } from '../finance/transactions';
import { periodMetrics } from '../insights/reviews';
import { today } from '../life/common';
import { computeGoals } from '../life/goals';
import { listPeople } from '../life/people';
import { listTasks, type TaskView } from '../life/tasks';
import { calendarFeed } from '../life/today';
import { search } from '../search/service';
import { getSettings } from '../settings/service';
import { listWorkspaces } from '../workspaces/service';
import { defaultReviewPeriod, reviewPeriod, weekStartOf } from '@life-erp/shared';

/**
 * Read-only tools the assistant can call. Each returns only the fields needed to answer
 * (no phone numbers, emails, notes or IDs), with money already in major units + currency.
 */
export interface AiTool {
  name: string;
  scope: AiScope;
  description: string;
  /** JSON Schema of the arguments (sent to the model). */
  parameters: Record<string, unknown>;
  args: z.ZodType;
  run(args: never): unknown;
}

const money = (minor: number, currency: string) => ({ amount: fromMinor(minor, currency), currency });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const month = z.string().regex(/^\d{4}-\d{2}$/);
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });

function tool<S extends z.ZodType>(t: { name: string; scope: AiScope; description: string; parameters: Record<string, unknown>; args: S; run: (a: z.infer<S>) => unknown }): AiTool {
  return t as unknown as AiTool;
}

export const AI_TOOLS: AiTool[] = [
  tool({
    name: 'money_summary',
    scope: 'finance',
    description: 'Income, spending, savings and savings rate for a calendar month (default: current month), compared with the previous month, plus the top spending categories. All in the main currency.',
    parameters: obj({ month: { type: 'string', description: 'YYYY-MM' } }),
    args: z.object({ month: month.optional() }),
    run: ({ month: m }) => {
      const mm = m ?? today().slice(0, 7);
      const prev = addMonthsToMonth(mm, -1);
      const cur = periodTotals(monthStart(mm), monthEnd(mm));
      const before = periodTotals(monthStart(prev), monthEnd(prev));
      const cats = categoryBreakdown(monthStart(mm), monthEnd(mm), 'expense');
      return {
        month: mm,
        currency: cur.base,
        income: fromMinor(cur.income, cur.base),
        spending: fromMinor(cur.expenses, cur.base),
        saved: fromMinor(cur.net, cur.base),
        savingsRate: cur.savingsRate,
        previousMonth: { month: prev, income: fromMinor(before.income, cur.base), spending: fromMinor(before.expenses, cur.base), saved: fromMinor(before.net, cur.base) },
        topSpending: cats.items.slice(0, 6).map((c) => ({ category: c.name, amount: fromMinor(c.total, cur.base) })),
        missingExchangeRates: cur.missingRates,
        monthIsIncomplete: mm === today().slice(0, 7),
      };
    },
  }),
  tool({
    name: 'net_worth',
    scope: 'finance',
    description: 'Current net worth with its parts: cash, investments, property and other assets, money owed to you, and liabilities (cards/loans, remaining installments, debts).',
    parameters: obj({}),
    args: z.object({}),
    run: () => {
      const n = netPosition(today());
      const m = (v: number) => fromMinor(v, n.base);
      return {
        currency: n.base,
        netWorth: m(n.netWorth),
        cash: m(n.liquid),
        investments: m(n.investments),
        propertyAndOtherAssets: m(n.physicalAssets + n.otherAssets),
        owedToYou: m(n.receivables),
        cardsAndLoans: m(n.accountLiabilities),
        installmentsLeft: m(n.installmentsRemaining),
        debtsYouOwe: m(n.debtsOwed),
        missingExchangeRates: n.missingRates,
      };
    },
  }),
  tool({
    name: 'find_transactions',
    scope: 'finance',
    description: 'List individual transactions in a date range (default: last 30 days), optionally matching text in payee/description, a type, or a minimum amount. Returns at most 40, newest first, plus the total count and sums.',
    parameters: obj({
      from: { type: 'string', description: 'YYYY-MM-DD' },
      to: { type: 'string', description: 'YYYY-MM-DD' },
      text: { type: 'string', description: 'Words in payee or description' },
      type: { type: 'string', enum: ['income', 'expense', 'refund', 'transfer', 'adjustment'] },
      minAmount: { type: 'number' },
    }),
    args: z.object({ from: isoDate.optional(), to: isoDate.optional(), text: z.string().max(80).optional(), type: z.enum(['income', 'expense', 'refund', 'transfer', 'adjustment']).optional(), minAmount: z.number().nonnegative().optional() }),
    run: (a) => {
      const to = a.to ?? today();
      const from = a.from ?? addDays(to, -30);
      const r = listTransactions({ from, to, q: a.text, type: a.type, limit: 500 });
      const rows = r.items
        .filter((t) => a.minAmount == null || fromMinor(Math.abs(t.amount), t.currency) >= a.minAmount)
        .slice(0, 40)
        .map((t) => ({ date: t.date, type: t.type, ...money(Math.abs(t.amount), t.currency), category: t.categoryName, payee: t.payee, description: t.description, account: t.accountName }));
      return { from, to, matching: a.minAmount == null ? r.total : rows.length, shown: rows.length, totals: r.totals.map((x) => ({ currency: x.currency, income: fromMinor(x.income, x.currency), spending: fromMinor(x.expenses, x.currency) })), transactions: rows };
    },
  }),
  tool({
    name: 'upcoming_payments',
    scope: 'finance',
    description: 'Recurring bills/income, installments and debts due in the next N days (max 90), including anything overdue.',
    parameters: obj({ days: { type: 'number', description: '1–90, default 30' } }),
    args: z.object({ days: z.number().int().min(1).max(90).optional() }),
    run: ({ days }) =>
      upcoming(today(), days ?? 30)
        .slice(0, 50)
        .map((u) => ({ date: u.date, name: u.name, kind: u.kind, direction: u.direction, overdue: u.overdue, ...money(u.amount, u.currency) })),
  }),
  tool({
    name: 'tasks',
    scope: 'planning',
    description: 'Tasks by view: today (due today + overdue), overdue, upcoming (next 7 days), open (all unfinished), done (recently completed).',
    parameters: obj({ view: { type: 'string', enum: ['today', 'overdue', 'upcoming', 'open', 'done'] } }, ['view']),
    args: z.object({ view: z.enum(['today', 'overdue', 'upcoming', 'open', 'done']) }),
    run: ({ view }) => {
      const list = listTasks({ view: view as TaskView });
      return { view, count: list.length, tasks: list.slice(0, 40).map((t) => ({ title: t.title, status: t.status, priority: t.priority, due: t.dueDate, completedAt: t.completedAt?.slice(0, 10) ?? null })) };
    },
  }),
  tool({
    name: 'calendar',
    scope: 'planning',
    description: 'Calendar items (events, task due dates, payments, deadlines, birthdays, interviews) between two dates (max 62 days).',
    parameters: obj({ from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' } }, ['from', 'to']),
    args: z.object({ from: isoDate, to: isoDate }),
    run: ({ from, to }) => {
      const end = to > addDays(from, 62) ? addDays(from, 62) : to;
      return calendarFeed(from, end)
        .slice(0, 80)
        .map((i) => ({ date: i.date, time: i.time ?? null, kind: i.kind, title: i.title, done: i.done ?? false }));
    },
  }),
  tool({
    name: 'goals',
    scope: 'planning',
    description: 'Active goals with progress (0–1), health (on_track / at_risk / behind / overdue) and deadline.',
    parameters: obj({}),
    args: z.object({}),
    run: () =>
      [...computeGoals().values()]
        .filter((g) => g.status === 'active')
        .slice(0, 40)
        .map((g) => ({ title: g.title, level: g.level, progress: g.progress, health: g.health, deadline: g.deadline })),
  }),
  tool({
    name: 'contacts',
    scope: 'people',
    description: 'Contacts by name/company search, or those whose follow-up is due. Returns name, relationship, company, last contact and next follow-up only (no phone numbers or emails).',
    parameters: obj({ query: { type: 'string' }, followUpDue: { type: 'boolean' } }),
    args: z.object({ query: z.string().max(80).optional(), followUpDue: z.boolean().optional() }),
    run: ({ query, followUpDue }) =>
      listPeople({ q: query, followUpDue })
        .slice(0, 30)
        .map((p) => ({ name: p.fullName, relationship: p.relationship, company: p.company, lastContact: p.lastContact, nextFollowUp: p.nextFollowUp, followUpNote: p.followUpNote })),
  }),
  tool({
    name: 'business_overview',
    scope: 'business',
    description: 'For each business: pipeline (open deals, weighted value, win rate), deals whose next action is due, and open projects with health, progress and profit so far.',
    parameters: obj({}),
    args: z.object({}),
    run: () => {
      const d = today();
      return listWorkspaces()
        .filter((w) => w.kind === 'business')
        .map((w) => {
          const a = pipelineAnalytics(w.id);
          const deals = listOpportunities({ workspaceId: w.id, status: 'open' });
          return {
            business: w.name,
            currency: a.base,
            pipeline: { openDeals: a.stats.openCount, openValue: fromMinor(a.stats.openValue, a.base), weightedValue: fromMinor(a.stats.weightedValue, a.base), winRate: a.stats.winRate },
            nextActionsDue: deals.filter((o) => o.nextActionDate && o.nextActionDate <= d).map((o) => ({ deal: o.title, action: o.nextAction, date: o.nextActionDate })),
            openProjects: listProjects({ workspaceId: w.id, status: 'open' }).map((p) => ({ name: p.name, health: p.health, progress: p.progress, deadline: p.deadline, profit: fromMinor(p.profit, p.currency), currency: p.currency })),
          };
        });
    },
  }),
  tool({
    name: 'career_overview',
    scope: 'career',
    description: 'Current job and tenure, job application funnel, upcoming interviews and follow-ups, skill gaps and learning in progress.',
    parameters: obj({}),
    args: z.object({}),
    run: () => {
      const o = careerOverview();
      return {
        currentJobs: o.current.map((j) => ({ position: j.position, company: j.company, since: j.startDate, months: j.months })),
        funnel: o.funnel,
        openApplications: o.openApplications,
        interviews: o.interviews.map((i) => ({ company: i.company, position: i.position, stage: i.stage, date: i.date, time: i.time })),
        followUpsDue: o.followUps.map((a) => ({ company: a.company, position: a.position, status: a.statusName })),
        skillGaps: o.skillGaps.map((s) => ({ skill: s.name, level: s.level, target: s.targetLevel })),
        learning: o.learning.map((l) => ({ title: l.title, progress: l.progress, deadline: l.deadline })),
      };
    },
  }),
  tool({
    name: 'search_records',
    scope: 'search',
    description: 'Full-text search across all records (notes, documents, contacts, projects, tasks, transactions…). Returns type, title and a short matching snippet.',
    parameters: obj({ query: { type: 'string' } }, ['query']),
    args: z.object({ query: z.string().min(1).max(100) }),
    run: ({ query }) => search(query, { limit: 15 }).map((h) => ({ type: h.type, title: h.title, subtitle: h.subtitle, snippet: h.snippet.replace(/\[\[|\]\]/g, '') })),
  }),
  tool({
    name: 'period_numbers',
    scope: 'planning',
    description: 'The numbers for a weekly or monthly review period (default: the latest finished one): money vs previous period, tasks done/added/slipped, goal check-ins, events, deals won, applications, interviews, achievements, learning.',
    parameters: obj({ type: { type: 'string', enum: ['weekly', 'monthly'] }, start: { type: 'string', description: 'YYYY-MM-DD within the period' } }, ['type']),
    args: z.object({ type: z.enum(['weekly', 'monthly']), start: isoDate.optional() }),
    run: ({ type, start }) => reviewFacts(type, start),
  }),
];

/** Review numbers in a compact, model-friendly shape (shared by the tool and review suggestions). */
export function reviewFacts(type: ReviewType, start?: string) {
  const s = getSettings();
  const p = start ? reviewPeriod(type, type === 'weekly' ? weekStartOf(start, s.weekStart) : start) : defaultReviewPeriod(type, today(), s.weekStart);
  const m = periodMetrics(type, p);
  const c = m.money.base;
  const f = (v: number) => fromMinor(v, c);
  return {
    period: m.period,
    currency: c,
    money: { income: f(m.money.income), spending: f(m.money.expenses), saved: f(m.money.net), savingsRate: m.money.savingsRate, previous: { income: f(m.money.previous.income), spending: f(m.money.previous.expenses), saved: f(m.money.previous.net) }, topSpending: m.money.topSpending.map((x) => ({ category: x.name, amount: f(x.total) })) },
    tasks: m.tasks,
    tasksPreviousPeriod: m.tasksPrevious,
    goals: { active: m.goals.active, health: m.goals.health, checkins: m.goals.checkins, needAttention: m.goals.needAttention.map((g) => ({ title: g.title, health: g.health })) },
    life: m.life,
    business: { ...m.business, wonValue: f(m.business.wonValue) },
    career: m.career,
  };
}

export function allowedTools(allow: Record<AiScope, boolean>) {
  return AI_TOOLS.filter((t) => allow[t.scope]);
}

/** Validate arguments and run a tool; errors come back as data so the model can correct itself. */
export function runTool(tools: AiTool[], name: string, raw: unknown): { ok: boolean; result: unknown } {
  const t = tools.find((x) => x.name === name);
  if (!t) return { ok: false, result: { error: `Tool "${name}" is not available (it may be switched off in AI settings).` } };
  const parsed = t.args.safeParse(raw ?? {});
  if (!parsed.success) return { ok: false, result: { error: 'Invalid arguments', details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) } };
  try {
    return { ok: true, result: t.run(parsed.data as never) };
  } catch (err) {
    return { ok: false, result: { error: err instanceof AppError ? err.message : 'The tool failed' } };
  }
}
