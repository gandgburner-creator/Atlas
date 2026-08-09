import type { ISODate, Workout, WorkoutSet } from '../db/schema';
import type { ExerciseDef, TrainingState } from '../db/config';
import { BONUS_SESSION } from './bonus';
import { addDays, daysBetween, fromISODate } from './time';

/**
 * The split is a QUEUE with a pointer, never a calendar.
 *
 * The pointer advances on exactly two events: a completed session, or a rest
 * day that has passed. A skipped training day advances nothing — the same
 * session is simply next tomorrow. There is no makeup logic, no debt, and no
 * missed-day state anywhere in this file, because nothing is ever missed,
 * only delayed. That is the module's most important behaviour; guard it.
 *
 * Every mutation here is a pure function over a TrainingState value — it does
 * not read or write storage. src/db/config.ts is the only place a
 * TrainingState is persisted, and it serializes every write through one
 * queue so two of these functions can never be applied to the same stale
 * snapshot and compound into more than one step. If the pointer ever jumps
 * by more than one position for a single completed session, that is a
 * storage-layer race, not a bug in this arithmetic — look there first.
 */

export function currentSlot(state: TrainingState): string {
  return state.split[state.pointer % state.split.length] ?? 'rest';
}

/**
 * Let elapsed rest days pass. Called with today's date: while the current
 * slot is 'rest' and at least one calendar day has gone by since the last
 * pass (or session), the pointer moves on — one day per rest slot, and it
 * stops the instant it reaches a non-rest slot, so at most one slot advances
 * per real calendar day. Paused state freezes everything; those days are
 * excluded, not missed.
 */
export function passRestDays(state: TrainingState, today: ISODate): TrainingState {
  if (state.pause) return state;
  if (state.mode !== 'queue') return state;

  let { pointer } = state;
  let mark = state.lastRestPass ?? today;
  // Never let a stale mark replay more days than actually elapsed.
  let budget = Math.max(0, daysBetween(mark, today));

  while (budget > 0 && (state.split[pointer % state.split.length] ?? 'rest') === 'rest') {
    pointer += 1;
    mark = addDays(mark, 1);
    budget -= 1;
  }
  if (pointer === state.pointer && mark === (state.lastRestPass ?? today)) {
    // Nothing moved; still record today so the next diff is sane.
    return state.lastRestPass ? state : { ...state, lastRestPass: today };
  }
  return { ...state, pointer, lastRestPass: mark };
}

/**
 * A completed session advances the pointer by EXACTLY one position in the
 * split, wrapping at the end. Partial sessions are normal — two of four
 * exercises, or even zero, IS a completed session. The caller decides
 * nothing; finishing is completion regardless of what was logged.
 */
export function advanceAfterSession(
  state: TrainingState,
  today: ISODate,
): TrainingState {
  return { ...state, pointer: state.pointer + 1, lastRestPass: today };
}

/** In fixed-weekly mode the day of week picks the session directly. */
export function fixedSlotFor(state: TrainingState, date: ISODate): string {
  const dow = (fromISODate(date).getDay() + 6) % 7; // Monday = 0
  return state.split[dow % state.split.length] ?? 'rest';
}

/** What's next today, honouring mode and pause. */
export function sessionFor(state: TrainingState, date: ISODate): string {
  if (state.mode === 'fixed') return fixedSlotFor(state, date);
  return currentSlot(state);
}

/**
 * A session with no logged sets is not a session. It never counts as
 * complete, never advances the pointer, and is never stored — see
 * finishTrainingSession, which discards one silently rather than recording
 * an empty row. Guard with this everywhere rather than checking
 * `exercises.length` directly: an exercise can exist in the row with an
 * empty `sets` array, and that is still nothing logged.
 */
export function hasLoggedSets(workout: Pick<Workout, 'exercises'>): boolean {
  return workout.exercises.some((e) => e.sets.length > 0);
}

/**
 * Where the pointer belongs given the sessions that actually happened.
 *
 * Used when history changes underneath the pointer — a session deleted, or
 * an empty phantom row cleaned up. The queue's rule is that a completed
 * session moves the pointer one past its own slot, so the position implied
 * by history is simply "one after the most recent session's slot". Rest
 * slots in between are handled by passRestDays as days elapse, exactly as
 * they would have been the first time through.
 *
 * Returns null when history can't determine a position — no sessions left
 * (caller should reset to 0), or a session type no longer in the split
 * (caller should leave the pointer alone rather than guess).
 */
export function pointerFromHistory(
  split: string[],
  completed: Pick<Workout, 'date' | 'sessionType'>[],
): number | null {
  if (completed.length === 0) return 0;
  const latest = [...completed].sort((a, b) => a.date.localeCompare(b.date)).at(-1)!;
  const idx = split.indexOf(latest.sessionType);
  if (idx === -1) return null;
  return idx + 1;
}

/**
 * Manual override: jump the pointer to the NEAREST occurrence of
 * `sessionType` in the split, searching forward from the current pointer
 * (wrapping once) so picking "rest" from a split with two rest slots lands
 * on whichever is closer, not always the first. Returns the state unchanged
 * if the split doesn't contain that session type at all.
 */
export function overrideToSession(
  state: TrainingState,
  sessionType: string,
  today: ISODate,
): TrainingState {
  const len = state.split.length;
  for (let offset = 0; offset < len; offset++) {
    const idx = (state.pointer + offset) % len;
    if (state.split[idx] === sessionType) {
      // Only the modulo of pointer is ever read elsewhere, so the absolute
      // value can just become the target index itself.
      return { ...state, pointer: idx, lastRestPass: today };
    }
  }
  return state;
}

// ── Last time ─────────────────────────────────────────────────────────────

export interface LastExercise {
  name: string;
  sets: WorkoutSet[];
  date: ISODate;
}

/**
 * The previous session of a given type, unpacked per exercise. At the rack
 * this is the only thing that matters, so it renders first and largest.
 * `excludeDate` skips the session currently being edited, so re-opening
 * today's own (already-saved) session doesn't show itself as "last time".
 *
 * Bonus sessions always count, whatever type is asked for, and passing
 * `null` widens it to every session. A lift is the same lift wherever it
 * was done — a curl done as bonus work is the number you want to beat on
 * back day, and hiding it behind the session type would show "first time"
 * for a lift with months of history.
 */
export function lastTimeFor(
  workouts: Workout[],
  sessionType: string | null,
  excludeDate?: ISODate,
): Map<string, LastExercise> {
  const map = new Map<string, LastExercise>();
  const sorted = [...workouts]
    .filter(
      (w) =>
        (sessionType === null ||
          w.sessionType === sessionType ||
          w.sessionType === BONUS_SESSION) &&
        w.date !== excludeDate,
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  for (const w of sorted) {
    for (const ex of w.exercises) {
      if (!map.has(ex.name) && ex.sets.length > 0) {
        map.set(ex.name, { name: ex.name, sets: ex.sets, date: w.date });
      }
    }
  }
  return map;
}

// ── Progressive overload ──────────────────────────────────────────────────

/** Fixed dumbbell ladder: the "next dumbbell up" for the hint. */
const DUMBBELL_LADDER = [
  4, 6, 8, 10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30, 32.5, 35, 37.5, 40,
];

export interface OverloadHint {
  /** Suggested next weight, or null when there's no honest number to give
   * (cable/machine pin spacing varies too much by gym to invent a figure). */
  weight: number | null;
  text: string;
}

/**
 * If every set of the previous session hit the top of the rep range, quietly
 * suggest the next increment. Returns null otherwise — no hint is the
 * default, and the hint is a suggestion, never a demand. A stalled, dropped,
 * or reduced number from last time is never flagged here or anywhere else —
 * a deficit makes that normal, and this function only ever has something to
 * say when things went UP.
 */
export function overloadHint(
  last: LastExercise | undefined,
  def: ExerciseDef,
): OverloadHint | null {
  if (!last || last.sets.length === 0) return null;
  const allTop = last.sets.every((s) => s.reps >= def.repRangeTop);
  if (!allTop) return null;
  const w = Math.max(...last.sets.map((s) => s.weight));

  if (def.equipment === 'barbell') {
    const next = w + 2.5;
    return { weight: next, text: `all sets hit ${def.repRangeTop} — try ${next} kg` };
  }
  if (def.equipment === 'dumbbell') {
    const next = DUMBBELL_LADDER.find((d) => d > w);
    if (!next) return null;
    return { weight: next, text: `all sets hit ${def.repRangeTop} — try ${next} kg` };
  }
  if (def.equipment === 'machine') {
    // Pin spacing varies by machine and gym — a specific kg figure would
    // often just be wrong, so the suggestion names the pin, not a number.
    return { weight: null, text: `all sets hit ${def.repRangeTop} — try the next pin up` };
  }
  // Bodyweight. Pull-ups (and anything else marked progressToWeighted) are
  // "max reps" work: once the rep ceiling is cleared on every set, the next
  // step is load, not more reps.
  if (def.progressToWeighted) {
    return {
      weight: null,
      text: `all sets cleared ${def.repRangeTop} — try adding weight`,
    };
  }
  return {
    weight: w,
    text: `all sets hit ${def.repRangeTop} — try ${def.repRangeTop + 1} reps`,
  };
}
