import { describe, expect, it } from 'vitest';
import type { SleepLog } from '../db/schema';
import { averageClockTime, daysLogged, sevenDayAverageWake } from './stats';

function log(date: string, actualWake: string): SleepLog {
  return {
    date,
    actualWake,
    targetWake: '09:00',
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('averageClockTime', () => {
  it('returns null with nothing to average', () => {
    expect(averageClockTime([])).toBeNull();
  });

  it('averages morning times', () => {
    expect(averageClockTime(['09:00', '10:00'])).toBe('09:30');
    expect(averageClockTime(['08:00', '08:30', '09:30'])).toBe('08:40');
  });

  it('does not break across midnight', () => {
    // Naive minute-averaging would answer 12:00 here.
    expect(averageClockTime(['23:50', '00:10'])).toBe('00:00');
  });
});

describe('sevenDayAverageWake', () => {
  const logs = [
    log('2026-03-01', '10:00'), // outside the window
    log('2026-03-02', '09:00'),
    log('2026-03-05', '09:30'),
    log('2026-03-08', '08:30'),
  ];

  it('averages only the trailing 7 days', () => {
    const { average, daysCounted } = sevenDayAverageWake(logs, '2026-03-08');
    expect(daysCounted).toBe(3);
    expect(average).toBe('09:00');
  });

  it('treats a missed day as absent, not as zero', () => {
    // Three of seven days logged; the four gaps must not drag the mean down.
    const { average } = sevenDayAverageWake(logs, '2026-03-08');
    expect(average).toBe('09:00');
  });

  it('reports null rather than a number when nothing is logged', () => {
    const { average, daysCounted } = sevenDayAverageWake([], '2026-03-08');
    expect(average).toBeNull();
    expect(daysCounted).toBe(0);
  });
});

describe('daysLogged', () => {
  it('counts entries and never decreases for a gap', () => {
    // No streak semantics: a missing 2026-03-03 costs nothing.
    expect(daysLogged([log('2026-03-02', '09:00'), log('2026-03-04', '09:00')]))
      .toBe(2);
  });
});
