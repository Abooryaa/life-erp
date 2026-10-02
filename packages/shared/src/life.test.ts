import { describe, expect, it } from 'vitest';
import { expectedProgress, goalHealth, numericProgress, parseQuickTask } from './life';

// 2026-10-02 is a Friday.
const TODAY = '2026-10-02';

describe('parseQuickTask', () => {
  it('extracts date, time, priority and tags', () => {
    expect(parseQuickTask('Call Ahmed tomorrow 3pm !high #mma #followup', TODAY)).toEqual({
      title: 'Call Ahmed',
      dueDate: '2026-10-03',
      dueTime: '15:00',
      priority: 2,
      tags: ['mma', 'followup'],
    });
  });

  it('understands weekdays (next occurrence), explicit dates and "in N days"', () => {
    expect(parseQuickTask('Send BOQ sunday', TODAY).dueDate).toBe('2026-10-04');
    expect(parseQuickTask('Weekly review fri', TODAY).dueDate).toBe('2026-10-09'); // not today
    expect(parseQuickTask('Pay rent 5/11', TODAY).dueDate).toBe('2026-11-05');
    expect(parseQuickTask('Renew ID 15/1', TODAY).dueDate).toBe('2027-01-15'); // past → next year
    expect(parseQuickTask('Gym 2026-12-01', TODAY).dueDate).toBe('2026-12-01');
    expect(parseQuickTask('Follow up in 3 days', TODAY)).toMatchObject({ title: 'Follow up', dueDate: '2026-10-05' });
    expect(parseQuickTask('Plan next week', TODAY).dueDate).toBe('2026-10-09');
  });

  it('handles 24h times and "at"', () => {
    expect(parseQuickTask('Meeting at 14:30', TODAY)).toMatchObject({ title: 'Meeting', dueDate: TODAY, dueTime: '14:30' });
    expect(parseQuickTask('Dinner 9pm', TODAY).dueTime).toBe('21:00');
    expect(parseQuickTask('Call 12am', TODAY).dueTime).toBe('00:00');
  });

  it('understands Arabic words', () => {
    expect(parseQuickTask('دفع الإيجار بكرة !عاجل #مالية', TODAY)).toEqual({ title: 'دفع الإيجار', dueDate: '2026-10-03', dueTime: null, priority: 1, tags: ['مالية'] });
    expect(parseQuickTask('اجتماع الأحد', TODAY).dueDate).toBe('2026-10-04');
  });

  it('leaves plain text untouched', () => {
    expect(parseQuickTask('Buy 2 bags of cement', TODAY)).toEqual({ title: 'Buy 2 bags of cement', dueDate: null, dueTime: null, priority: null, tags: [] });
  });
});

describe('goal progress', () => {
  it('computes numeric progress, including decreasing targets', () => {
    expect(numericProgress(0, 100, 25)).toBe(0.25);
    expect(numericProgress(95, 80, 90)).toBeCloseTo(1 / 3); // weight 95 → 80
    expect(numericProgress(0, 10, 15)).toBe(1);
    expect(numericProgress(0, 10, -3)).toBe(0);
  });

  it('judges health against linear expected progress', () => {
    expect(expectedProgress('2026-01-01', '2026-12-31', '2026-07-02')).toBeCloseTo(0.5, 1);
    expect(goalHealth(0.5, '2026-01-01', '2026-12-31', '2026-07-02')).toBe('on_track');
    expect(goalHealth(0.42, '2026-01-01', '2026-12-31', '2026-07-02')).toBe('at_risk');
    expect(goalHealth(0.2, '2026-01-01', '2026-12-31', '2026-07-02')).toBe('behind');
    expect(goalHealth(0.2, '2026-01-01', '2026-06-01', '2026-07-02')).toBe('overdue');
    expect(goalHealth(1, '2026-01-01', '2026-06-01', '2026-07-02')).toBe('achieved');
    expect(goalHealth(0.1, null, null, '2026-07-02')).toBe('no_deadline');
  });
});
