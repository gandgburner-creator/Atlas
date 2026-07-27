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

  it('backfills stages passed through unseen', () => {
    const dates = updateStageDates({}, 20.5, '2026-08-01');
    expect(dates[25]).toBe('2026-08-01');
    expect(dates[21]).toBe('2026-08-01');
    expect(dates[20]).toBeUndefined();
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
