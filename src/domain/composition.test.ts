import { describe, expect, it } from 'vitest';
import {
  bfPercent,
  stageFor,
  stageProgress,
  timelineToTarget,
  updateStageDates,
  weightAtBf,
} from './composition';
import { averageClockTime } from './stats';
import { observedRate, rollingAverageSeries } from './weight';
import type { WeightLog } from '../db/schema';

describe('bf estimate', () => {
  it('derives from weight and lean mass', () => {
    // 100kg at 78 lean → 22%
    expect(bfPercent(100, 78)).toBeCloseTo(22, 5);
  });

  it('inverts cleanly', () => {
    const w = weightAtBf(22, 78);
    expect(bfPercent(w, 78)).toBeCloseTo(22, 5);
  });

  it('shows the nearest stage AT OR ABOVE, clamped to the drawn range', () => {
    expect(stageFor(19.3)).toBe(20);
    expect(stageFor(20)).toBe(20);
    expect(stageFor(30)).toBe(25); // no assets above 25
    expect(stageFor(11)).toBe(14); // none below 14
  });

  it('reports progress toward the next stage for the between animation', () => {
    expect(stageProgress(20)).toBe(0);
    expect(stageProgress(19.25)).toBeCloseTo(0.75, 5);
  });
});

describe('stage timeline', () => {
  it('records a stage once and never un-records it', () => {
    let dates: Record<number, string> = {};
    dates = updateStageDates(dates, 21.8, '2026-08-01');
    expect(dates[22]).toBe('2026-08-01');
    // Estimate rises back over 22 — nothing changes, nothing is said.
    const after = updateStageDates(dates, 22.6, '2026-09-01');
    expect(after[22]).toBe('2026-08-01');
  });

  it('records only where you are on the very first reading', () => {
    // Stages coarser than the current one were passed before the app
    // existed. Stamping them all with the install date claimed five
    // milestones were reached on the day of install, and the timeline drew
    // it that way.
    const dates = updateStageDates({}, 20.5, '2026-08-01');
    expect(dates[21]).toBe('2026-08-01');
    expect(dates[25]).toBeUndefined();
    expect(dates[22]).toBeUndefined();
    expect(dates[20]).toBeUndefined();
  });

  it('backfills stages passed through unseen once the history is its own', () => {
    // Seen at 23, next reading is 20.5 — 22 and 21 really were crossed in
    // between, so dating them to the reading that found them is honest.
    let dates = updateStageDates({}, 22.4, '2026-08-01');
    expect(dates[23]).toBe('2026-08-01');

    dates = updateStageDates(dates, 20.5, '2026-09-01');
    expect(dates[22]).toBe('2026-09-01');
    expect(dates[21]).toBe('2026-09-01');
    expect(dates[20]).toBeUndefined();
    // The first reading's own stamp is untouched.
    expect(dates[23]).toBe('2026-08-01');
  });
});

describe('timeline to target', () => {
  it('uses the observed rate when it carries signal', () => {
    const t = timelineToTarget(97, 95, '2026-08-01', { ratePerWeek: 0.5 }, 0.45);
    expect(t?.kind).toBe('observed');
    expect(t?.weeks).toBeCloseTo(4, 5);
  });

  it('falls back to the plan rate rather than compute a date from noise', () => {
    const t = timelineToTarget(97, 95, '2026-08-01', null, 0.45);
    expect(t?.kind).toBe('plan');
    expect(t?.note).toContain('more data');
    // A zero/negative observed rate is noise too.
    const t2 = timelineToTarget(97, 95, '2026-08-01', { ratePerWeek: -0.2 }, 0.45);
    expect(t2?.kind).toBe('plan');
  });

  it('says nothing at all when the target is above current weight', () => {
    expect(timelineToTarget(95, 97, '2026-08-01', { ratePerWeek: 0.5 }, 0.45)).toBeNull();
  });
});

describe('weight rolling average and trend', () => {
  function logs(days: number, start: number, perDay: number): WeightLog[] {
    return Array.from({ length: days }, (_, i) => {
      const d = new Date(2026, 6, 1 + i); // from 1 Jul 2026
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return { date: iso, kg: start - perDay * i };
    });
  }

  it('rolling average smooths within a 7-day window', () => {
    const series = rollingAverageSeries(logs(10, 100, 0.1));
    const last = series[series.length - 1]!;
    // avg of the last 7 of a 0.1/day descent from 100 (days 4..10)
    expect(last.avg).toBeCloseTo((99.7 + 99.6 + 99.5 + 99.4 + 99.3 + 99.2 + 99.1) / 7, 3);
  });

  it('a gap is absent from the window, never a zero', () => {
    const ls = logs(10, 100, 0.1).filter((l) => !l.date.endsWith('05'));
    const series = rollingAverageSeries(ls);
    expect(series.every((p) => p.avg > 90)).toBe(true);
  });

  it('needs 14 days of history before reporting a rate', () => {
    expect(observedRate(logs(10, 100, 0.06), '2026-07-10')).toBeNull();
  });

  it('recovers a steady loss rate from the fitted trend', () => {
    const r = observedRate(logs(30, 100, 0.065), '2026-07-30');
    expect(r).not.toBeNull();
    expect(r!.ratePerWeek).toBeGreaterThan(0.35);
    expect(r!.ratePerWeek).toBeLessThan(0.55);
  });
});

// Regression guard: slice-1 sleep math still behaves.
describe('sleep module untouched', () => {
  it('averageClockTime still wraps midnight', () => {
    expect(averageClockTime(['23:50', '00:10'])).toBe('00:00');
  });
});

describe('gaps in the weight log', () => {
  it('windows the rolling average by date, not by count', () => {
    // Reported concern: with missing days, "last 7 entries" would span 9+
    // calendar days and quietly average across a fortnight.
    const logs = [
      { date: '2026-07-27', kg: 98.2 },
      { date: '2026-07-28', kg: 98.0 },
      { date: '2026-07-29', kg: 97.9 },
      { date: '2026-07-30', kg: 97.8 },
      { date: '2026-07-31', kg: 97.7 },
      { date: '2026-08-01', kg: 97.6 },
      { date: '2026-08-02', kg: 97.5 },
      // 08-03 missing.
      { date: '2026-08-04', kg: 97.3 },
      { date: '2026-08-05', kg: 97.2 },
      { date: '2026-08-06', kg: 97.1 },
      // 08-07 and 08-08 missing.
      { date: '2026-08-09', kg: 96.8 },
    ];
    const series = rollingAverageSeries(logs);
    const last = series[series.length - 1]!;
    expect(last.date).toBe('2026-08-09');
    // 08-03 onwards is four logged days, not seven entries reaching back
    // into July.
    const expected = (97.3 + 97.2 + 97.1 + 96.8) / 4;
    expect(last.avg).toBeCloseTo(expected, 10);
  });

  it('computes a rate once the logs span the shortest window', () => {
    // The backup's own range: 11 entries, 2026-07-27 to 2026-08-09.
    const logs = [
      { date: '2026-07-27', kg: 98.2 }, { date: '2026-07-28', kg: 98.0 },
      { date: '2026-07-29', kg: 97.9 }, { date: '2026-07-30', kg: 97.8 },
      { date: '2026-07-31', kg: 97.7 }, { date: '2026-08-01', kg: 97.6 },
      { date: '2026-08-02', kg: 97.5 }, { date: '2026-08-04', kg: 97.3 },
      { date: '2026-08-05', kg: 97.2 }, { date: '2026-08-06', kg: 97.1 },
      { date: '2026-08-09', kg: 96.8 },
    ];
    const r = observedRate(logs, '2026-08-09');
    expect(r).not.toBeNull();
    expect(r?.windowDays).toBe(14);
    expect(r?.ratePerWeek).toBeGreaterThan(0);

    // Four days earlier the same logs span only nine days, which is short
    // of every window — so it returns null rather than a number built on
    // too little. That, not a broken calculation, is what the backup's
    // cached `ratePerWeek: null` recorded.
    expect(observedRate(logs.filter((l) => l.date <= '2026-08-05'), '2026-08-05')).toBeNull();
  });
});
