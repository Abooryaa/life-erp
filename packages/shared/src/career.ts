/** Pure career calculations: application funnel and CV bullets. */
import type { ApplicationStatusKind } from './schemas/career';

export interface FunnelApp {
  kind: ApplicationStatusKind;
  /** Had at least one interview logged. */
  interviewed: boolean;
}

export interface Funnel {
  saved: number;
  applied: number;
  inProgress: number;
  interviews: number;
  offers: number;
  accepted: number;
  rejected: number;
  withdrawn: number;
  /** Any reply (interview, offer or rejection) / applied. */
  responseRate: number | null;
  interviewRate: number | null;
  offerRate: number | null;
}

export function applicationFunnel(apps: FunnelApp[]): Funnel {
  const sent = apps.filter((a) => a.kind !== 'saved');
  const count = (k: ApplicationStatusKind) => apps.filter((a) => a.kind === k).length;
  const interviewed = sent.filter((a) => a.interviewed || ['interview', 'offer', 'accepted'].includes(a.kind)).length;
  const offers = sent.filter((a) => a.kind === 'offer' || a.kind === 'accepted').length;
  const responded = sent.filter((a) => a.interviewed || ['interview', 'offer', 'accepted', 'rejected'].includes(a.kind)).length;
  const rate = (n: number) => (sent.length ? n / sent.length : null);
  return {
    saved: count('saved'),
    applied: sent.length,
    inProgress: sent.filter((a) => a.kind === 'active' || a.kind === 'interview').length,
    interviews: interviewed,
    offers,
    accepted: count('accepted'),
    rejected: count('rejected'),
    withdrawn: count('withdrawn'),
    responseRate: rate(responded),
    interviewRate: rate(interviewed),
    offerRate: rate(offers),
  };
}

export interface BulletInput {
  title: string;
  metric?: string | null;
  impact?: string | null;
  skills?: string[];
}

/**
 * A CV bullet built only from what you recorded (no invented numbers):
 * "Built the sales dashboard, cutting reporting time by 60% — leadership decides weekly instead of monthly (Power BI, SQL)."
 */
export function cvBullet(a: BulletInput): string {
  let s = a.title.trim().replace(/[.\s]+$/, '');
  if (a.metric?.trim()) s += `, ${a.metric.trim().replace(/[.\s]+$/, '')}`;
  if (a.impact?.trim()) s += ` — ${a.impact.trim().replace(/[.\s]+$/, '')}`;
  if (a.skills?.length) s += ` (${a.skills.join(', ')})`;
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return `${s}.`;
}

export const DEFAULT_APPLICATION_STATUSES: { name: string; kind: ApplicationStatusKind }[] = [
  { name: 'Saved', kind: 'saved' },
  { name: 'Applied', kind: 'active' },
  { name: 'HR screening', kind: 'interview' },
  { name: 'Technical interview', kind: 'interview' },
  { name: 'Final interview', kind: 'interview' },
  { name: 'Offer', kind: 'offer' },
  { name: 'Accepted', kind: 'accepted' },
  { name: 'Rejected', kind: 'rejected' },
  { name: 'Withdrawn', kind: 'withdrawn' },
];

/** Total months between two dates, for "2 yrs 3 mos" style tenure. */
export function tenureMonths(start: string, end: string): number {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  let m = (ey - sy) * 12 + (em - sm);
  if (ed < sd) m--;
  return Math.max(0, m);
}
