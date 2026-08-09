import type { ClockTime } from '../db/schema';
import { toMinutes } from './time';

/**
 * Typo catchers.
 *
 * Every function here returns a sentence or null, and NOTHING here blocks a
 * save. That distinction is the whole design. A 13:00 bedtime and an 8 kg
 * fourth set are almost always a slipped digit — but "almost always" is not
 * "always", and an app that refuses the entry is an app that loses the real
 * night shift or the genuine deload. The entry always goes in; the warning
 * sits next to it and can be ignored forever.
 *
 * The wording is the other half. These describe what the number implies and
 * stop — "that would be 19h in bed", not "invalid time". A typo is a
 * slipped finger, not a failure, and nothing here is entitled to a tone.
 */

/** Beyond this a night is far more likely mistyped than slept. */
export const MAX_PLAUSIBLE_SLEEP_H = 12;
/** Below this, likewise — a nap logged as a night, or a wrong AM/PM. */
export const MIN_PLAUSIBLE_SLEEP_H = 2;

/** Hours from onset to wake, wrapping over midnight. */
export function hoursAsleep(onset: ClockTime, wake: ClockTime): number {
  const mins = (toMinutes(wake) - toMinutes(onset) + 1440) % 1440;
  return mins / 60;
}

function roundHours(h: number): string {
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return mins === 0 ? `${whole}h` : `${whole}h${String(mins).padStart(2, '0')}`;
}

/**
 * A bedtime that doesn't fit the wake time.
 *
 * The common failure is an AM/PM slip putting a 01:00 onset at 13:00, which
 * reads as most of a day in bed. Checked against the wake time rather than
 * against a fixed "plausible bedtime" band, because a night shift is real
 * and a band would cry wolf every single day for someone who works one.
 */
export function sleepOnsetWarning(
  onset: ClockTime | undefined,
  wake: ClockTime | undefined,
): string | null {
  if (!onset || !wake) return null;
  const h = hoursAsleep(onset, wake);
  if (h > MAX_PLAUSIBLE_SLEEP_H) {
    return `${onset} to ${wake} is ${roundHours(h)} in bed — did you mean ${flipMeridiem(onset)}?`;
  }
  if (h < MIN_PLAUSIBLE_SLEEP_H) {
    return `${onset} to ${wake} is only ${roundHours(h)} — worth a second look.`;
  }
  return null;
}

/** The same clock time twelve hours away, which is what the slip produces. */
function flipMeridiem(t: ClockTime): ClockTime {
  const m = (toMinutes(t) + 720) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** A set this far off the session's own median reads as a slipped digit. */
export const LOAD_DEVIATION = 0.5;

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[mid] as number);
}

/**
 * A set whose load is wildly out of line with the others already logged for
 * that exercise today.
 *
 * Compared against the session's own median rather than history, because
 * the number that matters is "80, 80, 80, 8" — three sets establish what
 * today's load is, and the fourth disagreeing by an order of magnitude is
 * the tell. A deload week moves every set together and says nothing here.
 *
 * Bodyweight sets sit at zero by design and are never flagged. Two sets are
 * not enough of a pattern to call a third one wrong, so it waits for two
 * priors before it says anything.
 */
export function setLoadWarning(weight: number, priorWeights: number[]): string | null {
  const loaded = priorWeights.filter((w) => w > 0);
  if (weight <= 0 || loaded.length < 2) return null;
  const mid = median(loaded);
  if (mid <= 0) return null;
  if (Math.abs(weight - mid) / mid <= LOAD_DEVIATION) return null;
  return `Earlier sets were around ${mid} kg. Did you mean that?`;
}

/** Calories may drift this far from the macro sum before it's worth saying. */
export const KCAL_TOLERANCE = 0.1;

export function kcalFromMacros(protein: number, carbs: number, fat: number): number {
  return protein * 4 + carbs * 4 + fat * 9;
}

/**
 * Entered calories that don't reconcile with the entered macros.
 *
 * A gap is not automatically wrong: a label's stated calories and its
 * stated macros often disagree by a few percent through rounding and fibre,
 * and this app treats the LABEL as authoritative on purpose. So the
 * tolerance is loose, and the message says the two disagree rather than
 * claiming either one is the mistake.
 */
export function caloriesWarning(
  kcal: number,
  protein: number,
  carbs: number,
  fat: number,
): string | null {
  const fromMacros = kcalFromMacros(protein, carbs, fat);
  if (kcal <= 0 || fromMacros <= 0) return null;
  if (Math.abs(kcal - fromMacros) / fromMacros <= KCAL_TOLERANCE) return null;
  return `The macros add up to about ${Math.round(fromMacros)} kcal, not ${Math.round(kcal)}.`;
}
