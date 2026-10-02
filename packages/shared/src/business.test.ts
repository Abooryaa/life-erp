import { describe, expect, it } from 'vitest';
import { pipelineStats, projectHealth } from './business';

describe('pipelineStats', () => {
  it('computes open, weighted, won and win rate', () => {
    const s = pipelineStats([
      { value: 100_000, probability: 50, kind: 'open' },
      { value: 200_000, probability: 10, kind: 'open' },
      { value: 300_000, probability: 100, kind: 'won' },
      { value: 100_000, probability: 100, kind: 'won' },
      { value: 50_000, probability: 0, kind: 'lost' },
    ]);
    expect(s).toEqual({
      openCount: 2,
      openValue: 300_000,
      weightedValue: 70_000,
      wonCount: 2,
      wonValue: 400_000,
      lostCount: 1,
      winRate: 2 / 3,
      avgWonDeal: 200_000,
    });
  });

  it('has no win rate before anything closes', () => {
    expect(pipelineStats([{ value: 1, probability: 10, kind: 'open' }]).winRate).toBeNull();
    expect(pipelineStats([]).avgWonDeal).toBeNull();
  });
});

describe('projectHealth', () => {
  const base = { status: 'active', startDate: '2026-01-01', deadline: '2026-12-31', progress: 0.5, budget: 100_000, spent: 50_000, today: '2026-07-02' };
  it('is on track when progress, time and money are aligned', () => {
    expect(projectHealth(base).health).toBe('on_track');
  });
  it('detects delays, overspend and risk', () => {
    expect(projectHealth({ ...base, today: '2027-01-05' }).health).toBe('delayed');
    expect(projectHealth({ ...base, spent: 120_000 }).health).toBe('over_budget');
    expect(projectHealth({ ...base, progress: 0.2 }).health).toBe('at_risk');
    expect(projectHealth({ ...base, spent: 85_000 }).health).toBe('at_risk');
  });
  it('handles finished and not-started projects', () => {
    expect(projectHealth({ ...base, status: 'completed', today: '2027-05-01' }).health).toBe('done');
    expect(projectHealth({ ...base, status: 'planning', startDate: '2026-08-01' }).health).toBe('not_started');
    expect(projectHealth({ ...base, budget: null }).budgetUsed).toBeNull();
  });
});
