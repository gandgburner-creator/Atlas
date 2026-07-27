import type { ClockTime, ISODate } from '../db/schema';
import { daysBetween, toMinutes } from './time';

/**
 * The wake-time ramp.
 *
 * Wake time is the anchor; bedtime follows it. The ramp is stored as a
 * definition, not as a table of dated targets, so editing `steps` re-derives
 * every past and future target — including the ones already drawn on the
 * chart. That's deliberate: the ramp is expected to change.
 */
export interface RampConfig {
  /** Day 1 of week 1. */
  startDate: ISODate;
  /** Where you were before the ramp began. Targets before startDate use this. */
  baselineWake: ClockTime;
  /** Target wake time for week 1, 2, 3… Length defines the ramp's length. */
  steps: ClockTime[];
  /**
   * Days on which "repeat this week" was pressed — raw events, not a computed
   * offset. Each distinct calendar week containing a marker holds its target
   * for one extra week, pushing everything after it back by 7 days.
   */
  repeats: ISODate[];
}

export const DEFAULT_RAMP: Omit<RampConfig, 'startDate'> = {
  baselineWake: '10:00',
  steps: ['09:30', '09:00', '08:30', '08:00', '07:30', '07:00'],
  repeats: [],
};

/**
 * 0-based week containing `date`, ignoring repeats. Negative before the ramp
 * starts.
 */
export function rawWeekIndex(ramp: RampConfig, date: ISODate): number {
  return Math.floor(daysBetween(ramp.startDate, date) / 7);
}

/** Distinct raw weeks that carry at least one repeat marker. */
function repeatWeeks(ramp: RampConfig): Set<number> {
  const weeks = new Set<number>();
  for (const marker of ramp.repeats) {
    const w = rawWeekIndex(ramp, marker);
    // A marker before the ramp started can't hold anything.
    if (w >= 0) weeks.add(w);
  }
  return weeks;
}

/**
 * 0-based position in `steps` for `date`, after repeats push it back.
 * Negative before the ramp starts; may exceed the last step once the ramp
 * has run its course.
 */
export function effectiveStepIndex(ramp: RampConfig, date: ISODate): number {
  const raw = rawWeekIndex(ramp, date);
  if (raw < 0) return raw;
  let held = 0;
  for (const w of repeatWeeks(ramp)) {
    // A repeat in week w holds w itself, and shifts everything strictly after.
    if (w < raw) held += 1;
  }
  return raw - held;
}

/** Target wake time in force on `date`. */
export function targetFor(ramp: RampConfig, date: ISODate): ClockTime {
  const idx = effectiveStepIndex(ramp, date);
  if (idx < 0) return ramp.baselineWake;
  if (ramp.steps.length === 0) return ramp.baselineWake;
  // Past the end of the ramp the last target holds indefinitely.
  const clamped = Math.min(idx, ramp.steps.length - 1);
  return ramp.steps[clamped] as ClockTime;
}

/**
 * Human week number for `date`: 1-based, clamped to the ramp's length so it
 * reads "week 6 of 6" rather than "week 9 of 6" after the ramp completes.
 * `null` before the ramp starts.
 */
export function weekNumberFor(
  ramp: RampConfig,
  date: ISODate,
): number | null {
  const idx = effectiveStepIndex(ramp, date);
  if (idx < 0) return null;
  return Math.min(idx, Math.max(ramp.steps.length - 1, 0)) + 1;
}

/** True once `date` is past the final step — the ramp is holding at the end. */
export function isRampComplete(ramp: RampConfig, date: ISODate): boolean {
  return effectiveStepIndex(ramp, date) >= ramp.steps.length;
}

/** Whether the week containing `date` is currently being held. */
export function isWeekRepeated(ramp: RampConfig, date: ISODate): boolean {
  return repeatWeeks(ramp).has(rawWeekIndex(ramp, date));
}

/**
 * Toggle the hold on the week containing `date`. Pressing once holds the
 * target for another week; pressing again releases it. Repeating a week is a
 * normal choice, so it has to be as easy to undo as to do.
 */
export function toggleRepeat(ramp: RampConfig, date: ISODate): RampConfig {
  const week = rawWeekIndex(ramp, date);
  if (week < 0) return ramp;
  const held = ramp.repeats.filter((m) => rawWeekIndex(ramp, m) === week);
  if (held.length > 0) {
    return {
      ...ramp,
      repeats: ramp.repeats.filter((m) => rawWeekIndex(ramp, m) !== week),
    };
  }
  return { ...ramp, repeats: [...ramp.repeats, date] };
}

/**
 * Total days the ramp spans including held weeks — the natural width of the
 * progress chart.
 */
export function rampLengthDays(ramp: RampConfig): number {
  return (ramp.steps.length + repeatWeeks(ramp).size) * 7;
}

/** Target in minutes past midnight, for plotting. */
export function targetMinutesFor(ramp: RampConfig, date: ISODate): number {
  return toMinutes(targetFor(ramp, date));
}
