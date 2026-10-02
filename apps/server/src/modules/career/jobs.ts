import { addDays, daysBetween } from '@life-erp/shared';
import { registerJob } from '../../jobs/scheduler';
import { hasUsers } from '../auth/service';
import { nowLocal } from '../life/common';
import { createTask } from '../life/tasks';
import { notify } from '../notifications/service';
import { followUpsDue, upcomingInterviews } from './applications';
import { listLearning } from './profile';

const SYSTEM = { userId: null, ip: 'automation' };

/** Application follow-ups become a task (once) plus a reminder; interviews and learning deadlines get reminders. */
export function runCareerAlerts(d = nowLocal().date) {
  for (const a of followUpsDue(d)) {
    const source = `app-followup:${a.id}:${a.followUpDate}`;
    try {
      createTask(SYSTEM, { title: `Follow up: ${a.position} at ${a.company}`, status: 'planned', priority: a.priority, dueDate: a.followUpDate, personId: a.recruiterPersonId }, { source });
      notify({
        severity: 'reminder',
        title: `Follow up on your application: ${a.company}`,
        body: `${a.position} · ${a.statusName}`,
        link: `/career/applications?open=${a.id}`,
        entity: { type: 'job_application', id: a.id },
        dedupeKey: source,
      });
    } catch {
      // Unique task source: already created for this follow-up date.
    }
  }
  for (const { i, company, position } of upcomingInterviews(d, addDays(d, 1))) {
    notify({
      severity: 'reminder',
      title: `Interview ${i.date === d ? 'today' : 'tomorrow'}: ${company}`,
      body: [position, i.stage, i.time, i.location].filter(Boolean).join(' · '),
      link: `/career/applications?open=${i.applicationId}`,
      entity: { type: 'job_application', id: i.applicationId },
      dedupeKey: `interview:${i.id}:${i.date}:${i.date === d ? 'today' : 'soon'}`,
    });
  }
  for (const l of listLearning()) {
    if (!l.deadline || (l.status !== 'in_progress' && l.status !== 'planned')) continue;
    const days = daysBetween(d, l.deadline);
    if (days < 0) {
      notify({ severity: 'warning', title: `Learning deadline passed: ${l.title}`, body: `${l.progress}% done · deadline ${l.deadline}`, link: `/career/learning?open=${l.id}`, entity: { type: 'learning', id: l.id }, dedupeKey: `learning-late:${l.id}:${l.deadline}` });
    } else if (days <= 7) {
      notify({ severity: 'reminder', title: `Learning deadline in ${days} day${days === 1 ? '' : 's'}: ${l.title}`, body: `${l.progress}% done`, link: `/career/learning?open=${l.id}`, entity: { type: 'learning', id: l.id }, dedupeKey: `learning-soon:${l.id}:${l.deadline}` });
    }
  }
}

registerJob({
  name: 'career-alerts',
  everyMs: 30 * 60_000,
  run: () => {
    if (hasUsers()) runCareerAlerts();
  },
});
