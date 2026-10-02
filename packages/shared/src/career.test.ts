import { describe, expect, it } from 'vitest';
import { applicationFunnel, cvBullet, tenureMonths } from './career';

describe('applicationFunnel', () => {
  it('computes response, interview and offer rates from applications sent', () => {
    const f = applicationFunnel([
      { kind: 'saved', interviewed: false },
      { kind: 'active', interviewed: false },
      { kind: 'active', interviewed: false },
      { kind: 'interview', interviewed: true },
      { kind: 'rejected', interviewed: false },
      { kind: 'rejected', interviewed: true },
      { kind: 'offer', interviewed: true },
      { kind: 'accepted', interviewed: true },
      { kind: 'withdrawn', interviewed: false },
    ]);
    expect(f).toMatchObject({ saved: 1, applied: 8, inProgress: 3, interviews: 4, offers: 2, accepted: 1, rejected: 2, withdrawn: 1 });
    expect(f.responseRate).toBeCloseTo(5 / 8);
    expect(f.interviewRate).toBeCloseTo(4 / 8);
    expect(f.offerRate).toBeCloseTo(2 / 8);
  });

  it('has no rates before anything is sent', () => {
    expect(applicationFunnel([{ kind: 'saved', interviewed: false }]).responseRate).toBeNull();
  });
});

describe('cvBullet', () => {
  it('builds a bullet only from recorded facts', () => {
    expect(cvBullet({ title: 'built the weekly sales dashboard.', metric: 'cutting reporting time by 60%', impact: 'management now reviews sales weekly', skills: ['Power BI', 'SQL'] })).toBe(
      'Built the weekly sales dashboard, cutting reporting time by 60% — management now reviews sales weekly (Power BI, SQL).',
    );
    expect(cvBullet({ title: 'Led a team of 4' })).toBe('Led a team of 4.');
  });
});

describe('tenureMonths', () => {
  it('counts whole months', () => {
    expect(tenureMonths('2023-03-15', '2025-06-14')).toBe(26);
    expect(tenureMonths('2023-03-15', '2025-06-15')).toBe(27);
    expect(tenureMonths('2025-01-01', '2024-01-01')).toBe(0);
  });
});
