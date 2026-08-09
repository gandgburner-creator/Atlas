import type { WorkoutExercise, WorkoutSet } from '../db/schema';

/**
 * The in-flight state of the logging screen: what's on screen but not yet
 * necessarily on disk.
 *
 * Sets are written the instant they're logged, so most of the time the
 * draft and the stored row agree. The one moment they don't is the start of
 * a fresh session, and that moment is what the rule below exists for.
 */

/** A set position that hasn't been filled in yet stays as a hole. */
export type Draft = Record<string, (WorkoutSet | null)[]>;

export function draftFromExercises(exercises: WorkoutExercise[]): Draft {
  const d: Draft = {};
  for (const ex of exercises) d[ex.name] = ex.sets.length ? ex.sets : [null];
  return d;
}

/**
 * Whether the stored row should replace what's on screen.
 *
 * Only for a row we are PICKING UP — a session resumed after a reload, or
 * one switched into. A row this screen created must never overwrite the
 * draft: it is written empty, a moment before the first set's write lands,
 * and adopting it in that window throws away the set on its way to it. The
 * next exercise logged then saves the draft over the top, and the first
 * exercise is gone from the session for good.
 *
 * `weStartedIt` is the whole guard. Without it the bug needs only two
 * exercises logged in quick succession at the start of a session, which is
 * not an edge case — it's a warm-up followed by a first working set.
 */
export function shouldAdoptRow(
  rowId: number | undefined,
  loadedFor: number | null,
  weStartedIt: boolean,
): boolean {
  if (rowId === undefined) return false;
  // Already adopted; re-adopting would undo mid-tap edits on every write.
  if (rowId === loadedFor) return false;
  return !weStartedIt;
}
