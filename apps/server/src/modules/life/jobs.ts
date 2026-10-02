import { addDays, daysBetween } from '@life-erp/shared';
import { registerJob } from '../../jobs/scheduler';
import { hasUsers } from '../auth/service';
import { notify } from '../notifications/service';
import { nowLocal } from './common';
import { occurrencesBetween } from './events';
import { computeGoals } from './goals';
import { birthdaysBetween, followUpsDue } from './people';
import { createTask, listTasks } from './tasks';

const SYSTEM = { userId: null, ip: 'automation' };

/** One summary per day for overdue / due-today tasks (no per-task spam). */
export function runTaskAlerts(d = nowLocal().date) {
  const due = listTasks({ view: 'today' });
  const overdue = due.filter((t) => t.dueDate! < d);
  const todayCount = due.length - overdue.length;
  if (overdue.length) {
    notify({
      severity: 'warning',
      title: overdue.length === 1 ? `Overdue task: ${overdue[0].title}` : `${overdue.length} overdue tasks`,
      body: overdue.slice(0, 5).map((t) => `• ${t.title} (${t.dueDate})`).join('\n'),
      link: '/tasks?view=overdue',
      dedupeKey: `tasks-overdue:${d}`,
    });
  }
  if (todayCount) {
    notify({ severity: 'reminder', title: todayCount === 1 ? '1 task due today' : `${todayCount} tasks due today`, link: '/today', dedupeKey: `tasks-today:${d}` });
  }
}

/** Event reminders: fires once when "now" passes start − reminder. */
export function runEventReminders(now = nowLocal()) {
  const tomorrow = addDays(now.date, 1);
  for (const o of occurrencesBetween(now.date, tomorrow)) {
    const e = o.event;
    if (e.reminderMinutes == null) continue;
    const startTime = e.allDay ? '09:00' : e.startTime;
    if (!startTime) continue;
    const startMin = daysBetween(now.date, o.date) * 1440 + Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3, 5));
    const nowMin = Number(now.time.slice(0, 2)) * 60 + Number(now.time.slice(3, 5));
    const until = startMin - nowMin;
    if (until <= e.reminderMinutes && until >= -5) {
      notify({
        severity: 'reminder',
        title: until <= 0 ? `Starting now: ${e.title}` : `${e.title} in ${until >= 60 ? `${Math.round(until / 60)} h` : `${until} min`}`,
        body: [o.date, e.allDay ? null : e.startTime, e.location].filter(Boolean).join(' · '),
        link: `/calendar?date=${o.date}&open=${e.id}`,
        entity: { type: 'event', id: e.id },
        dedupeKey: `event:${e.id}:${o.date}`,
      });
    }
  }
}

/** When a follow-up date arrives, a task is created (once) and you get a reminder. */
export function runFollowUps(d = nowLocal().date) {
  for (const p of followUpsDue(d)) {
    const source = `followup:${p.id}:${p.nextFollowUp}`;
    try {
      createTask(SYSTEM, { title: `Follow up with ${p.fullName}`, description: p.followUpNote, status: 'planned', priority: 2, dueDate: p.nextFollowUp, personId: p.id, workspaceId: p.workspaceId }, { source });
      notify({ severity: 'reminder', title: `Follow up with ${p.fullName}`, body: p.followUpNote, link: `/people/${p.id}`, entity: { type: 'person', id: p.id }, dedupeKey: source });
    } catch {
      // The unique source means it was already created — nothing to do.
    }
  }
}

export function runBirthdays(d = nowLocal().date) {
  for (const b of birthdaysBetween(d, addDays(d, 3))) {
    const when = b.date === d ? 'today' : `on ${b.date}`;
    notify({ severity: 'reminder', title: `${b.person.fullName}'s birthday ${when}`, body: b.age > 0 && b.age < 130 ? `Turning ${b.age}` : null, link: `/people/${b.person.id}`, dedupeKey: `bday:${b.person.id}:${b.date}` });
  }
}

export function runGoalHealth(d = nowLocal().date) {
  const month = d.slice(0, 7);
  for (const g of computeGoals().values()) {
    if (g.status !== 'active') continue;
    if (g.health === 'behind') {
      notify({ severity: 'warning', title: `Goal behind schedule: ${g.title}`, body: `${Math.round((g.progress ?? 0) * 100)}% done${g.deadline ? `, deadline ${g.deadline}` : ''}`, link: `/goals/${g.id}`, dedupeKey: `goal-health:${g.id}:${month}:behind` });
    } else if (g.health === 'overdue') {
      notify({ severity: 'warning', title: `Goal deadline passed: ${g.title}`, link: `/goals/${g.id}`, dedupeKey: `goal-health:${g.id}:${g.deadline}:overdue` });
    }
  }
}

registerJob({
  name: 'life-reminders',
  everyMs: 60_000,
  run: () => {
    if (hasUsers()) runEventReminders();
  },
});
registerJob({
  name: 'life-daily',
  everyMs: 30 * 60_000,
  run: () => {
    if (!hasUsers()) return;
    const d = nowLocal().date;
    runTaskAlerts(d);
    runFollowUps(d);
    runBirthdays(d);
    runGoalHealth(d);
  },
});
