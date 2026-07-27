import type { ISODate } from '../db/schema';
import { daysBetween, fromISODate, toISODate } from './time';

/**
 * Body composition estimates.
 *
 * Everything here derives from the ROLLING AVERAGE weight, never the daily
 * number, and from one shared leanMassKg (maintained by InBody readings,
 * default 78 until any exist). The figure assets span whole percentages
 * 25 → 14; nothing extrapolates past them — inventing physiques beyond the
 * drawn range would be worse than the limit.
 */

export const STAGE_MAX = 25;
export const STAGE_MIN = 14;

/** est. body fat % from a weight and lean mass. */
export function bfPercent(weightKg: number, leanMassKg: number): number {
  if (weightKg <= 0) return STAGE_MAX;
  return ((weightKg - leanMassKg) / weightKg) * 100;
}

/** Weight at a given bf%, same lean mass. Inverse of bfPercent. */
export function weightAtBf(bfPct: number, leanMassKg: number): number {
  const f = Math.min(99, Math.max(0, bfPct)) / 100;
  return leanMassKg / (1 - f);
}

/**
 * Which drawn stage to show: the nearest whole percentage AT OR ABOVE the
 * estimate, clamped to the asset range. 19.3% shows the 20% figure.
 */
export function stageFor(bfPct: number): number {
  return Math.min(STAGE_MAX, Math.max(STAGE_MIN, Math.ceil(bfPct)));
}

/**
 * Progress toward the next stage down, 0..1, for the between-stages
 * animation: 0 just under the current stage, →1 approaching the next.
 */
export function stageProgress(bfPct: number): number {
  const clamped = Math.min(STAGE_MAX, Math.max(STAGE_MIN, bfPct));
  const stage = stageFor(clamped);
  return Math.min(1, Math.max(0, stage - clamped));
}

export interface TimelineEstimate {
  kind: 'observed' | 'plan';
  date: ISODate;
  weeks: number;
  /** kg/week used for the estimate. */
  rate: number;
  /** Set when the observed rate was unusable and the plan rate stood in. */
  note?: string;
}

/**
 * When would the rolling average reach targetKg?
 *
 * Uses the observed rate when there's enough signal; otherwise falls back to
 * the plan rate, labelled as such — a date computed from noise is not shown.
 * Returns null when the target is at or above current weight: the figure
 * still renders, the timeline simply says nothing.
 */
export function timelineToTarget(
  currentAvgKg: number,
  targetKg: number,
  today: ISODate,
  observed: { ratePerWeek: number } | null,
  planRateKgPerWeek: number,
): TimelineEstimate | null {
  const gap = currentAvgKg - targetKg;
  if (gap <= 0) return null;

  if (observed && observed.ratePerWeek > 0.05) {
    const weeks = gap / observed.ratePerWeek;
    return {
      kind: 'observed',
      weeks,
      rate: observed.ratePerWeek,
      date: addWeeks(today, weeks),
    };
  }
  const weeks = gap / planRateKgPerWeek;
  return {
    kind: 'plan',
    weeks,
    rate: planRateKgPerWeek,
    date: addWeeks(today, weeks),
    note: 'observed rate needs more data',
  };
}

function addWeeks(date: ISODate, weeks: number): ISODate {
  const d = fromISODate(date);
  d.setDate(d.getDate() + Math.round(weeks * 7));
  return toISODate(d);
}

/** '≈ 14 Nov 2026 · 16 weeks away' */
export function formatTimeline(t: TimelineEstimate): string {
  const d = fromISODate(t.date).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const w = Math.max(1, Math.round(t.weeks));
  return `≈ ${d} · ${w} ${w === 1 ? 'week' : 'weeks'} away`;
}

/**
 * Record first-reached dates for stages. Only ever adds — reaching a stage
 * is permanent history; drifting back up neither erases nor comments.
 */
export function updateStageDates(
  dates: Record<number, string>,
  bfPct: number,
  today: ISODate,
): Record<number, string> {
  const stage = stageFor(bfPct);
  if (stage > STAGE_MAX || dates[stage]) return dates;
  // Also backfill any coarser stage passed through without being seen.
  const next = { ...dates };
  for (let s = STAGE_MAX; s >= stage; s--) {
    if (!next[s]) next[s] = today;
  }
  return next;
}

/** Guard: cap absurd inputs so a typo'd weight can't draw a fantasy. */
export function clampBf(bfPct: number): number {
  return Math.min(STAGE_MAX, Math.max(STAGE_MIN, bfPct));
}

export function weeksBetween(a: ISODate, b: ISODate): number {
  return daysBetween(a, b) / 7;
}
