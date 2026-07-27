import type { ISODate, Workout, WorkoutSet } from '../db/schema';
import type { ExerciseDef, TrainingState } from '../db/config';
import { addDays, daysBetween, fromISODate } from './time';

/**
 * The split is a QUEUE with a pointer, never a calendar.
 *
 * The pointer advances on exactly two events: a completed session, or a rest
 * day that has passed. A skipped training day advances nothing — the same
 * session is simply next tomorrow. There is no makeup logic, no debt, and no
 * missed-day state anywhere in this file, because nothing is ever missed,
 * only delayed. That is the module's most important behaviour; guard it.
 */

export function currentSlot(state: TrainingState): string {
  return state.split[state.pointer % state.split.length] ?? 'rest';
}

/**
 * Let elapsed rest days pass. Called on load with today's date: while the
 * current slot is 'rest' and at least one calendar day has gone by since the
 * last pass (or session), the pointer moves on — one day per rest slot.
 * Paused state freezes everything; those days are excluded, not missed.
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
 * A completed session advances the pointer. Partial sessions are normal —
 * two of four exercises IS a completed session. The caller decides nothing;
 * saving a session with any logged set is completion.
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

// ── Last time ─────────────────────────────────────────────────────────────

export interface LastExercise {
  name: string;
  sets: WorkoutSet[];
  date: ISODate;
}

/**
 * The previous session of a given type, unpacked per exercise. At the rack
 * this is the only thing that matters, so it renders first and largest.
 */
export function lastTimeFor(
  workouts: Workout[],
  sessionType: string,
): Map<string, LastExercise> {
  const map = new Map<string, LastExercise>();
  const sorted = [...workouts]
    .filter((w) => w.sessionType === sessionType)
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

/**
 * If every set of the previous session hit the top of the rep range, quietly
 * suggest the next increment. Returns null otherwise — no hint is the
 * default, and the hint is a suggestion, never a demand.
 */
export function overloadHint(
  last: LastExercise | undefined,
  def: ExerciseDef,
): { weight: number; text: string } | null {
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
  // Bodyweight: more reps, not more load.
  return {
    weight: w,
    text: `all sets hit ${def.repRangeTop} — try ${def.repRangeTop + 1} reps`,
  };
}
