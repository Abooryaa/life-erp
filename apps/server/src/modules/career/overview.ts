import { addDays } from '@life-erp/shared';
import { today } from '../life/common';
import { followUpsDue, funnel, listApplications, upcomingInterviews } from './applications';
import { listAchievements, listEmployments, listLearning, listSkills } from './profile';

/** Everything for the Career overview in one request. */
export function careerOverview() {
  const d = today();
  const jobs = listEmployments();
  const current = jobs.filter((j) => j.current);
  const skills = listSkills();
  const learning = listLearning();
  const open = listApplications({ open: true });
  return {
    current,
    totalMonths: jobs.reduce((s, j) => s + j.months, 0),
    funnel: funnel(),
    openApplications: open.length,
    highPriority: open.filter((a) => a.priority === 1).slice(0, 5),
    interviews: upcomingInterviews(d, addDays(d, 14)).map((x) => ({ ...x.i, company: x.company, position: x.position })),
    followUps: followUpsDue(d),
    skillGaps: skills
      .filter((s) => s.gap > 0)
      .sort((a, b) => b.gap - a.gap)
      .slice(0, 6),
    skillCount: skills.length,
    learning: learning.filter((l) => l.status === 'in_progress'),
    learningOverdue: learning.filter((l) => l.deadline && l.deadline < d && (l.status === 'in_progress' || l.status === 'planned')).length,
    recentAchievements: listAchievements().slice(0, 5),
  };
}
