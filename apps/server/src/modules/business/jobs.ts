import { addDays, daysBetween } from '@life-erp/shared';
import { registerJob } from '../../jobs/scheduler';
import { hasUsers } from '../auth/service';
import { nowLocal } from '../life/common';
import { notify } from '../notifications/service';
import { opportunitiesNeedingAction } from './pipeline';
import { listProjects, upcomingMilestones } from './projects';

/** Deal next-actions due, project deadlines approaching/passed, milestones due. */
export function runBusinessAlerts(d = nowLocal().date) {
  for (const o of opportunitiesNeedingAction(d)) {
    notify({
      severity: o.nextActionDate! < d ? 'warning' : 'reminder',
      title: `${o.nextAction ? o.nextAction : 'Follow up'}: ${o.title}`,
      body: [o.personName ?? o.organizationName, o.nextActionDate].filter(Boolean).join(' · '),
      link: `/pipeline?open=${o.id}`,
      entity: { type: 'opportunity', id: o.id },
      dedupeKey: `opp-action:${o.id}:${o.nextActionDate}`,
    });
  }
  for (const p of listProjects({ status: 'open' })) {
    if (!p.deadline) continue;
    const days = daysBetween(d, p.deadline);
    if (days < 0) {
      notify({ severity: 'warning', title: `Project delayed: ${p.name}`, body: `Deadline was ${p.deadline}`, link: `/projects/${p.id}`, entity: { type: 'project', id: p.id }, dedupeKey: `project-late:${p.id}:${p.deadline}` });
    } else if (days <= 5) {
      notify({ severity: 'reminder', title: `Project deadline in ${days} day${days === 1 ? '' : 's'}: ${p.name}`, link: `/projects/${p.id}`, entity: { type: 'project', id: p.id }, dedupeKey: `project-soon:${p.id}:${p.deadline}` });
    }
    if (p.health === 'over_budget') {
      notify({ severity: 'warning', title: `Project over budget: ${p.name}`, link: `/projects/${p.id}`, entity: { type: 'project', id: p.id }, dedupeKey: `project-budget:${p.id}:${d.slice(0, 7)}` });
    }
  }
  for (const { m, projectName } of upcomingMilestones(addDays(d, 3))) {
    notify({
      severity: m.dueDate! < d ? 'warning' : 'reminder',
      title: `Milestone ${m.dueDate! < d ? 'overdue' : 'due'}: ${m.title}`,
      body: `${projectName} · ${m.dueDate}`,
      link: `/projects/${m.projectId}`,
      dedupeKey: `milestone:${m.id}:${m.dueDate}:${m.dueDate! < d ? 'late' : 'soon'}`,
    });
  }
}

registerJob({
  name: 'business-alerts',
  everyMs: 30 * 60_000,
  run: () => {
    if (hasUsers()) runBusinessAlerts();
  },
});
