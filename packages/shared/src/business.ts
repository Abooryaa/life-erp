/** Pure business calculations: pipeline analytics and project health. Amounts in minor units. */
import { daysBetween } from './dates';

export interface PipelineDeal {
  value: number;
  probability: number;
  kind: 'open' | 'won' | 'lost';
}

export interface PipelineStats {
  openCount: number;
  openValue: number;
  /** Σ value × probability of open deals — the expected revenue. */
  weightedValue: number;
  wonCount: number;
  wonValue: number;
  lostCount: number;
  /** won / (won + lost); null before any deal is closed. */
  winRate: number | null;
  avgWonDeal: number | null;
}

export function pipelineStats(deals: PipelineDeal[]): PipelineStats {
  let openCount = 0, openValue = 0, weighted = 0, wonCount = 0, wonValue = 0, lostCount = 0;
  for (const d of deals) {
    if (d.kind === 'open') {
      openCount++;
      openValue += d.value;
      weighted += (d.value * Math.max(0, Math.min(100, d.probability))) / 100;
    } else if (d.kind === 'won') {
      wonCount++;
      wonValue += d.value;
    } else lostCount++;
  }
  const closed = wonCount + lostCount;
  return {
    openCount,
    openValue,
    weightedValue: Math.round(weighted),
    wonCount,
    wonValue,
    lostCount,
    winRate: closed ? wonCount / closed : null,
    avgWonDeal: wonCount ? Math.round(wonValue / wonCount) : null,
  };
}

export type ProjectHealth = 'on_track' | 'at_risk' | 'delayed' | 'over_budget' | 'done' | 'not_started';

export interface ProjectHealthInput {
  status: string;
  startDate: string | null;
  deadline: string | null;
  /** 0..1 share of milestones/tasks done (null = unknown). */
  progress: number | null;
  budget: number | null;
  spent: number;
  today: string;
}

/**
 * Project health: delayed when past the deadline and not finished; over budget when spending
 * exceeds the budget; at risk when progress trails elapsed time by >20 points or spending is
 * ahead of progress by >25 points.
 */
export function projectHealth(p: ProjectHealthInput): { health: ProjectHealth; timeElapsed: number | null; budgetUsed: number | null } {
  const budgetUsed = p.budget && p.budget > 0 ? p.spent / p.budget : null;
  let timeElapsed: number | null = null;
  if (p.startDate && p.deadline) {
    const total = daysBetween(p.startDate, p.deadline);
    timeElapsed = total > 0 ? Math.max(0, Math.min(1, daysBetween(p.startDate, p.today) / total)) : 1;
  }
  if (p.status === 'completed' || p.status === 'cancelled') return { health: 'done', timeElapsed, budgetUsed };
  if (p.status === 'planning' && (!p.startDate || p.startDate > p.today)) return { health: 'not_started', timeElapsed, budgetUsed };
  if (p.deadline && p.deadline < p.today) return { health: 'delayed', timeElapsed, budgetUsed };
  if (budgetUsed !== null && budgetUsed > 1) return { health: 'over_budget', timeElapsed, budgetUsed };
  const progress = p.progress ?? null;
  if (progress !== null && timeElapsed !== null && timeElapsed - progress > 0.2) return { health: 'at_risk', timeElapsed, budgetUsed };
  if (progress !== null && budgetUsed !== null && budgetUsed - progress > 0.25) return { health: 'at_risk', timeElapsed, budgetUsed };
  return { health: 'on_track', timeElapsed, budgetUsed };
}

/** Default sales pipeline (customisable per business). */
export const DEFAULT_STAGES: { name: string; probability: number; kind: 'open' | 'won' | 'lost' }[] = [
  { name: 'Lead', probability: 10, kind: 'open' },
  { name: 'Contacted', probability: 20, kind: 'open' },
  { name: 'Qualified', probability: 35, kind: 'open' },
  { name: 'Meeting', probability: 50, kind: 'open' },
  { name: 'Proposal', probability: 65, kind: 'open' },
  { name: 'Negotiation', probability: 80, kind: 'open' },
  { name: 'Won', probability: 100, kind: 'won' },
  { name: 'Lost', probability: 0, kind: 'lost' },
];
