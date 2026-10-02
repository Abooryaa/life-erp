import { addDays, daysBetween, minorToInput } from '@life-erp/shared';
import { and, eq, isNotNull, isNull, lte } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { recurringRules } from '../../db/schema';
import { registerJob } from '../../jobs/scheduler';
import { localDateTime } from '../../lib/dates';
import { hasUsers } from '../auth/service';
import { notify } from '../notifications/service';
import { getSettings } from '../settings/service';
import { budgetActiveIn, budgetReport, listBudgets } from './budgets';
import { listDebts } from './debts';
import { unpaidUntil } from './installments';
import { postRecurring } from './recurring';
import { listGoals } from './goals';

/** Automations run as the system (audit entries have no user). */
const SYSTEM = { userId: null, ip: 'automation' };

export function todayLocal() {
  return localDateTime(getSettings().timezone).date;
}

const fmtAmount = (minor: number, currency: string) => `${minorToInput(minor, currency)} ${currency}`;

export function runRecurring(today = todayLocal()) {
  const rules = getDb()
    .select()
    .from(recurringRules)
    .where(and(isNull(recurringRules.deletedAt), eq(recurringRules.active, true), isNotNull(recurringRules.nextDue), lte(recurringRules.nextDue, addDays(today, 60))))
    .all();
  for (const rule of rules) {
    if (rule.autoPost) {
      // Catch up on every occurrence up to today (e.g. after the laptop was off for a few days).
      let current = rule;
      for (let i = 0; i < 36 && current.nextDue && current.nextDue <= today; i++) {
        try {
          const due = current.nextDue;
          postRecurring(SYSTEM, rule.id);
          notify({ severity: 'info', title: `Recorded: ${rule.name}`, body: `${fmtAmount(rule.amount, rule.currency)} on ${due}`, link: '/finance/transactions', dedupeKey: `rec-posted:${rule.id}:${due}` });
        } catch (err) {
          notify({ severity: 'warning', title: `Could not record "${rule.name}"`, body: (err as Error).message, link: '/finance/recurring', dedupeKey: `rec-failed:${rule.id}:${current.nextDue}` });
          break;
        }
        current = getDb().select().from(recurringRules).where(eq(recurringRules.id, rule.id)).get()!;
      }
      continue;
    }
    const due = rule.nextDue!;
    const days = daysBetween(today, due);
    if (days < 0) {
      notify({ severity: 'warning', title: `Overdue: ${rule.name}`, body: `${fmtAmount(rule.amount, rule.currency)} was due ${due}`, link: '/finance/recurring', dedupeKey: `rec:${rule.id}:${due}:overdue` });
    } else if (days <= rule.remindDaysBefore) {
      notify({
        severity: 'reminder',
        title: days === 0 ? `Due today: ${rule.name}` : `${rule.name} due in ${days} day${days === 1 ? '' : 's'}`,
        body: `${fmtAmount(rule.amount, rule.currency)} on ${due}`,
        link: '/finance/recurring',
        dedupeKey: `rec:${rule.id}:${due}:soon`,
      });
    }
  }
}

export function runInstallmentAlerts(today = todayLocal()) {
  for (const { p, i } of unpaidUntil(addDays(today, 60))) {
    const days = daysBetween(today, p.dueDate);
    const label = `${i.name} (${p.seq}/${i.paymentCount})`;
    if (days < 0) {
      notify({ severity: 'critical', title: `Installment overdue: ${label}`, body: `${fmtAmount(p.amount, i.currency)} was due ${p.dueDate}`, link: `/finance/installments/${i.id}`, dedupeKey: `inst:${p.id}:overdue` });
    } else if (days <= i.remindDaysBefore) {
      notify({
        severity: 'reminder',
        title: days === 0 ? `Installment due today: ${label}` : `Installment due in ${days} day${days === 1 ? '' : 's'}: ${label}`,
        body: `${fmtAmount(p.amount, i.currency)} on ${p.dueDate}`,
        link: `/finance/installments/${i.id}`,
        dedupeKey: `inst:${p.id}:soon`,
      });
    }
  }
}

export function runDebtAlerts(today = todayLocal()) {
  for (const d of listDebts({ status: 'open' })) {
    if (!d.dueDate) continue;
    const days = daysBetween(today, d.dueDate);
    const who = d.direction === 'i_owe' ? `You owe ${d.counterparty}` : `${d.counterparty} owes you`;
    if (days < 0) notify({ severity: 'warning', title: `Overdue: ${who}`, body: `${fmtAmount(d.remaining, d.currency)} was due ${d.dueDate}`, link: `/finance/debts?open=${d.id}`, dedupeKey: `debt:${d.id}:${d.dueDate}:overdue` });
    else if (days <= 7) notify({ severity: 'reminder', title: `${who} — due ${d.dueDate}`, body: fmtAmount(d.remaining, d.currency), link: `/finance/debts?open=${d.id}`, dedupeKey: `debt:${d.id}:${d.dueDate}:soon` });
  }
}

export function runBudgetAlerts(today = todayLocal()) {
  const month = today.slice(0, 7);
  for (const b of listBudgets()) {
    if (!budgetActiveIn(b, month)) continue;
    const r = budgetReport(b.id, month, today);
    for (const l of r.lines) {
      const pct = Math.round(l.used * 100);
      if (l.status === 'over') {
        notify({ severity: 'warning', title: `Budget exceeded: ${l.name}`, body: `${pct}% of the ${b.name} budget used this month`, link: `/finance/budgets/${b.id}`, dedupeKey: `budget:${b.id}:${month}:${l.categoryId}:over` });
      } else if (l.used >= 0.8) {
        notify({ severity: 'reminder', title: `Budget at ${pct}%: ${l.name}`, body: `${b.name} — ${month}`, link: `/finance/budgets/${b.id}`, dedupeKey: `budget:${b.id}:${month}:${l.categoryId}:80` });
      }
    }
  }
}

export function runGoalAlerts(today = todayLocal()) {
  const month = today.slice(0, 7);
  for (const g of listGoals(today)) {
    if (g.status !== 'active' || !g.deadline || g.forecast.onTrack !== false) continue;
    const need = g.forecast.requiredMonthly ?? 0;
    notify({
      severity: 'warning',
      title: `Savings goal behind schedule: ${g.name}`,
      body: `Save about ${fmtAmount(need, g.currency)} per month to reach it by ${g.deadline}.`,
      link: `/finance/goals/${g.id}`,
      dedupeKey: `goal:${g.id}:${month}:behind`,
    });
  }
}

registerJob({
  name: 'finance-recurring',
  everyMs: 10 * 60_000,
  run: () => {
    if (hasUsers()) runRecurring();
  },
});
registerJob({
  name: 'finance-alerts',
  everyMs: 60 * 60_000,
  run: () => {
    if (!hasUsers()) return;
    const today = todayLocal();
    runInstallmentAlerts(today);
    runDebtAlerts(today);
    runBudgetAlerts(today);
    runGoalAlerts(today);
  },
});
