import type { ISODate, Workout } from '../db/schema';
import { daysBetween, fromISODate } from './time';

/**
 * The four-day ramp phase.
 *
 * A deliberate re-entry, not a program: two sets an exercise at 60 / 70 /
 * 80% of what you were lifting, three weeks, never to failure. Everything
 * here exists to make the submaximal weeks feel like progress rather than
 * like holding back — the percentage is shown as the plan, the expected
 * weight is calculated for you, and nothing in the app treats a light week
 * as a worse week.
 *
 * The rotation is Monday to Thursday with the rest of the week off. That
 * maps straight onto the split the app already has: seven slots in
 * 'fixed' mode, indexed Monday-first, so no new scheduling machinery is
 * needed and pause, history and the session log all keep working.
 */

export type DayType = 'mon' | 'tue' | 'wed' | 'thu';

export const DAY_TYPES: DayType[] = ['mon', 'tue', 'wed', 'thu'];

/** What each day is organised around — shown on the card, not stored. */
export const DAY_FOCUS: Record<DayType, string> = {
  mon: 'vertical',
  tue: 'horizontal',
  wed: 'incline / neutral',
  thu: 'decline / compound',
};

/** Monday first, then three rest days. Indexed exactly as `fixedSlotFor`. */
export const RAMP_SPLIT: string[] = [...DAY_TYPES, 'rest', 'rest', 'rest'];

export const RAMP_WEEKS = 3;
/** Week 1, 2, 3 as a fraction of the previous working weight. */
export const RAMP_PERCENTS = [0.6, 0.7, 0.8];
/** Two sets an exercise, every exercise, all three weeks. */
export const RAMP_SETS = 2;
export const RAMP_REP_LOW = 8;
export const RAMP_REP_HIGH = 12;
/** Default rest between sets, seconds. Adjustable in the bar as always. */
export const RAMP_REST_SEC = 120;
/** Days planned per week — the denominator of the consistency indicator. */
export const RAMP_DAYS_PER_WEEK = DAY_TYPES.length;

/** Which rotation day a date is, or null for Friday to Sunday. */
export function dayTypeFor(date: ISODate): DayType | null {
  const dow = (fromISODate(date).getDay() + 6) % 7; // Monday = 0
  return DAY_TYPES[dow] ?? null;
}

/** The Monday on or before `date`. Ramp weeks run Monday to Sunday. */
export function mondayOf(date: ISODate): ISODate {
  const d = fromISODate(date);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Which ramp week `date` falls in: 1, 2, 3, or null once the phase is done.
 *
 * Counted in whole calendar weeks from the Monday of the week the ramp
 * started, so starting on a Wednesday gives that same week as week 1 rather
 * than pushing a short week into its own slot. Before the start date it is
 * null too — there is no week zero.
 */
export function rampWeekFor(startDate: ISODate, date: ISODate): number | null {
  if (date < startDate) return null;
  const weeks = Math.floor(daysBetween(mondayOf(startDate), mondayOf(date)) / 7);
  if (weeks < 0 || weeks >= RAMP_WEEKS) return null;
  return weeks + 1;
}

/** Past the end of week 3 — time to move on to the real split. */
export function isRampComplete(startDate: ISODate, date: ISODate): boolean {
  return date >= startDate && rampWeekFor(startDate, date) === null;
}

export function percentForWeek(week: number): number {
  return RAMP_PERCENTS[week - 1] ?? RAMP_PERCENTS[RAMP_PERCENTS.length - 1] ?? 0.8;
}

/**
 * Lifts that changed name between the old split and this rotation.
 *
 * "Preserve any existing lift history" is the whole point of this table: a
 * ramp weight is a percentage of what you were already lifting, so a lift
 * the app can't recognise has no percentage to take and starts from
 * nothing. Only unambiguous renames are listed — the same movement under a
 * different label. Where a new name could plausibly mean more than one old
 * lift (Low Row, High Row) it is deliberately absent: inheriting the wrong
 * history would put a confidently wrong number on the bar, which is worse
 * than asking once.
 */
export const LIFT_ALIASES: Record<string, string[]> = {
  'Pull Down': ['Lat pulldown'],
  'Shoulder Press': ['DB shoulder press'],
  Squat: ['Back squat'],
  RDL: ['Romanian deadlift'],
  'Lateral Raise': ['Lateral raise', 'Cable lateral raise'],
  'Bicep Curl': ['Barbell curl'],
  'Bench Press': ['Barbell bench press'],
  'Leg Press': ['Leg press'],
  'Leg Curl': ['Seated leg curl'],
  'Face Pull': ['Face pull'],
  'Incline Press': ['Incline DB press'],
  'Pull Ups': ['Pull-ups'],
  Shrugs: ['Shrugs'],
  'Overhead Tricep Extension': ['Overhead tricep ext'],
};

/** Every name this exercise's history could be filed under, itself first. */
export function historyNamesFor(name: string): string[] {
  return [name, ...(LIFT_ALIASES[name] ?? [])];
}

/**
 * Heaviest set ever recorded for a lift, across its old names too.
 *
 * The reference the ramp percentages are taken from. Heaviest rather than
 * most recent on purpose: the ramp is a fraction of what you were capable
 * of before the break, and the last session before a break is often
 * already a reduced one.
 *
 * Returns null for a lift with no loaded history — bodyweight work included,
 * since a percentage of zero says nothing.
 */
export function bestWeightFor(workouts: Workout[], name: string): number | null {
  const names = new Set(historyNamesFor(name));
  let best = 0;
  for (const w of workouts) {
    if (w.status === 'in_progress') continue;
    for (const ex of w.exercises) {
      if (!names.has(ex.name)) continue;
      for (const s of ex.sets) if (s.weight > best) best = s.weight;
    }
  }
  return best > 0 ? best : null;
}

/** Round to something you can actually load: 2.5 kg steps. */
export function roundToPlate(kg: number): number {
  return Math.round(kg / 2.5) * 2.5;
}

/**
 * What to put on the bar this week, or null when there's no history to take
 * a percentage of.
 *
 * Null is a normal answer, not a failure: a lift new to the program has no
 * previous working weight, and the honest move is to let the first session
 * set one rather than invent a number.
 */
export function expectedWeight(
  workouts: Workout[],
  name: string,
  week: number,
): number | null {
  const best = bestWeightFor(workouts, name);
  if (best === null) return null;
  return roundToPlate(best * percentForWeek(week));
}

/**
 * Rotation days trained in the week containing `date`, out of four.
 *
 * Counts distinct day types with at least one logged set, so two sessions
 * on one Monday is still one of four — the indicator is about showing up on
 * the days the program asks for, not about volume.
 */
export function weekConsistency(workouts: Workout[], date: ISODate): number {
  const start = mondayOf(date);
  const days = new Set<string>();
  for (const w of workouts) {
    if (w.status === 'in_progress') continue;
    if (mondayOf(w.date) !== start) continue;
    if (!DAY_TYPES.includes(w.sessionType as DayType)) continue;
    if (!w.exercises.some((e) => e.sets.length > 0)) continue;
    days.add(w.sessionType);
  }
  return days.size;
}

/** Weight over time for one lift, oldest first — the per-exercise chart. */
export interface LiftPoint {
  date: ISODate;
  /** Heaviest set that session. */
  topWeight: number;
  reps: number;
}

export function liftHistory(workouts: Workout[], name: string): LiftPoint[] {
  const names = new Set(historyNamesFor(name));
  const points: LiftPoint[] = [];
  for (const w of workouts) {
    if (w.status === 'in_progress') continue;
    for (const ex of w.exercises) {
      if (!names.has(ex.name) || ex.sets.length === 0) continue;
      const top = ex.sets.reduce((a, b) => (b.weight > a.weight ? b : a));
      points.push({ date: w.date, topWeight: top.weight, reps: top.reps });
    }
  }
  return points.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Whether a set beats every loaded set previously recorded for the lift.
 *
 * During the ramp this should never fire — that's the point of training at
 * 60%. It exists for the program that follows, and because a PR that
 * happens and isn't noticed is worse than one that can't happen yet.
 */
export function isPersonalRecord(
  workouts: Workout[],
  name: string,
  weight: number,
  excludeWorkoutId?: number,
): boolean {
  if (weight <= 0) return false;
  const names = new Set(historyNamesFor(name));
  let hasPrior = false;
  for (const w of workouts) {
    if (w.id !== undefined && w.id === excludeWorkoutId) continue;
    if (w.status === 'in_progress') continue;
    for (const ex of w.exercises) {
      if (!names.has(ex.name)) continue;
      for (const s of ex.sets) {
        if (s.weight <= 0) continue;
        hasPrior = true;
        if (s.weight >= weight) return false;
      }
    }
  }
  // A lift with no loaded history has no previous best to beat. The first
  // time you do it is a baseline, not a record — and during week 1 that is
  // most of the program, so calling each one a PR would make the flash
  // meaningless before it ever meant anything.
  return hasPrior;
}

// ── Session summary ───────────────────────────────────────────────────────

export interface SessionSummary {
  exercises: number;
  sets: number;
  volume: number;
}

export function summarise(workout: Pick<Workout, 'exercises'>): SessionSummary {
  let sets = 0;
  let volume = 0;
  let exercises = 0;
  for (const ex of workout.exercises) {
    if (ex.sets.length === 0) continue;
    exercises += 1;
    for (const s of ex.sets) {
      sets += 1;
      volume += s.reps * s.weight;
    }
  }
  return { exercises, sets, volume };
}
