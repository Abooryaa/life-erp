import { dayOfWeek, monthEnd } from '@life-erp/shared';
import { registerJob } from '../../jobs/scheduler';
import { hasUsers } from '../auth/service';
import { nowLocal } from '../life/common';
import { notify } from '../notifications/service';
import { getSettings } from '../settings/service';
import { snapshotNetWorth } from './analytics';
import { reviewStatus } from './reviews';

/** Weekly review on your review day (default Saturday); monthly review on the last day and first days of the month. */
export function runReviewReminders(d = nowLocal().date) {
  const s = getSettings();
  const st = reviewStatus(d);
  if (dayOfWeek(d) === s.weeklyReviewDay && !st.weekly.done) {
    notify({
      severity: 'reminder',
      title: 'Time for your weekly review',
      body: `${st.weekly.periodStart} – ${st.weekly.periodEnd}`,
      link: `/reviews/weekly/${st.weekly.periodStart}`,
      dedupeKey: `review-weekly:${st.weekly.periodStart}`,
    });
  }
  const day = Number(d.slice(8, 10));
  if ((monthEnd(d) === d || day <= 3) && !st.monthly.done) {
    notify({
      severity: 'reminder',
      title: 'Time for your monthly review',
      body: `${st.monthly.periodStart.slice(0, 7)}`,
      link: `/reviews/monthly/${st.monthly.periodStart}`,
      dedupeKey: `review-monthly:${st.monthly.periodStart}`,
    });
  }
}

registerJob({
  name: 'insights',
  everyMs: 60 * 60_000,
  run: () => {
    if (!hasUsers()) return;
    snapshotNetWorth();
    runReviewReminders();
  },
});
