/** Pure logic for the life modules (tasks, goals), shared by server and UI. */
import { addDays, daysBetween } from './dates';
import type { GoalMetric } from './schemas/life';

export interface QuickTask {
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  priority: number | null;
  tags: string[];
}

const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0, 'الأحد': 0, 'الاحد': 0,
  mon: 1, monday: 1, 'الاثنين': 1, 'الإثنين': 1,
  tue: 2, tuesday: 2, 'الثلاثاء': 2,
  wed: 3, wednesday: 3, 'الأربعاء': 3, 'الاربعاء': 3,
  thu: 4, thursday: 4, 'الخميس': 4,
  fri: 5, friday: 5, 'الجمعة': 5,
  sat: 6, saturday: 6, 'السبت': 6,
};
const TODAY = new Set(['today', 'tod', 'اليوم', 'النهارده', 'النهاردة']);
const TOMORROW = new Set(['tomorrow', 'tmr', 'tmrw', 'بكرة', 'بكره', 'غدا', 'غداً']);
const PRIORITY: Record<string, number> = { '!1': 1, '!urgent': 1, '!عاجل': 1, '!2': 2, '!high': 2, '!مهم': 2, '!3': 3, '!normal': 3, '!4': 4, '!low': 4 };

function weekdayOf(date: string) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function to24h(h: number, m: number, ampm?: string) {
  let hour = h;
  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  if (hour > 23 || m > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Understands quick-capture text like "Call Ahmed tomorrow 3pm !high #mma" or
 * "دفع الإيجار بكرة #finance". Anything not recognised stays in the title.
 */
export function parseQuickTask(input: string, today: string): QuickTask {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  const keep: string[] = [];
  let dueDate: string | null = null;
  let dueTime: string | null = null;
  let priority: number | null = null;
  const tags: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i];
    const tok = raw.toLowerCase();
    const next = tokens[i + 1]?.toLowerCase();
    if (tok.startsWith('#') && tok.length > 1) {
      tags.push(tok.slice(1));
      continue;
    }
    if (PRIORITY[tok] !== undefined) {
      priority = PRIORITY[tok];
      continue;
    }
    if (TODAY.has(tok)) {
      dueDate = today;
      continue;
    }
    if (TOMORROW.has(tok)) {
      dueDate = addDays(today, 1);
      continue;
    }
    if (tok === 'next' && next && next === 'week') {
      dueDate = addDays(today, 7);
      i++;
      continue;
    }
    if (tok === 'in' && next && /^\d+$/.test(next) && /^days?$/.test(tokens[i + 2]?.toLowerCase() ?? '')) {
      dueDate = addDays(today, Number(next));
      i += 2;
      continue;
    }
    const wd = WEEKDAYS[tok];
    if (wd !== undefined) {
      const diff = (wd - weekdayOf(today) + 7) % 7 || 7;
      dueDate = addDays(today, diff);
      continue;
    }
    let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tok);
    if (m) {
      dueDate = tok;
      continue;
    }
    m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(tok);
    if (m) {
      const year = m[3] ? Number(m[3]) : Number(today.slice(0, 4));
      const candidate = `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      if (!Number.isNaN(Date.parse(`${candidate}T00:00:00Z`))) {
        dueDate = !m[3] && candidate < today ? `${year + 1}${candidate.slice(4)}` : candidate;
        continue;
      }
    }
    if (tok === 'at' && next && /^\d{1,2}(:\d{2})?(am|pm)?$/.test(next)) {
      // handled by the time rule on the next token
      continue;
    }
    m = /^(\d{1,2}):(\d{2})(am|pm)?$/.exec(tok) ?? /^(\d{1,2})(am|pm)$/.exec(tok);
    if (m) {
      const hasMinutes = m.length === 4 && m[2] !== undefined && /^\d{2}$/.test(m[2]);
      const t = hasMinutes ? to24h(Number(m[1]), Number(m[2]), m[3]) : to24h(Number(m[1]), 0, m[2]);
      if (t) {
        dueTime = t;
        if (!dueDate) dueDate = today;
        continue;
      }
    }
    keep.push(raw);
  }
  // Drop a dangling "at" left by "at 5pm".
  const title = keep.filter((w, i) => !(w.toLowerCase() === 'at' && i === keep.length - 1)).join(' ');
  return { title: title || input.trim(), dueDate, dueTime, priority, tags };
}

/** Progress 0..1 for a numeric goal (handles decreasing targets like weight or debt). */
export function numericProgress(start: number, target: number, current: number): number {
  if (target === start) return current === target ? 1 : 0;
  return Math.max(0, Math.min(1, (current - start) / (target - start)));
}

/**
 * How far along a goal should be by `today` if progress were linear from start to deadline.
 * Null when there is no deadline.
 */
export function expectedProgress(startDate: string | null, deadline: string | null, today: string): number | null {
  if (!deadline || !startDate) return null;
  const total = daysBetween(startDate, deadline);
  if (total <= 0) return 1;
  return Math.max(0, Math.min(1, daysBetween(startDate, today) / total));
}

export type GoalHealth = 'achieved' | 'on_track' | 'at_risk' | 'behind' | 'no_deadline' | 'overdue';

/** Compare actual vs expected progress: >15 points behind = behind, >5 = at risk. */
export function goalHealth(progress: number, startDate: string | null, deadline: string | null, today: string): GoalHealth {
  if (progress >= 1) return 'achieved';
  if (!deadline) return 'no_deadline';
  if (deadline < today) return 'overdue';
  const expected = expectedProgress(startDate, deadline, today) ?? 0;
  const gap = expected - progress;
  if (gap > 0.15) return 'behind';
  if (gap > 0.05) return 'at_risk';
  return 'on_track';
}

export function isMeasurable(metric: GoalMetric) {
  return metric !== 'none';
}
