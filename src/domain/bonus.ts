import type { ExerciseDef, ExercisePlans } from '../db/config';
import type { ISODate, Workout } from '../db/schema';
import { addDays } from './time';

/**
 * The bonus session: work that was scheduled in the last week and didn't
 * happen, offered back as a menu.
 *
 * Read the whole of this module as one sentence: AVAILABLE IF YOU WANT IT.
 * Everything here is shaped to keep that true rather than to keep score.
 *
 *   · The window is seven days and there is nothing behind it. An exercise
 *     that falls out is gone — not archived, not carried, not counted. The
 *     date filter IS the forgetting, so there is no store anywhere that a
 *     total could later be summed from.
 *   · Suggestions are suggestions. Nothing arrives selected, nothing is
 *     required, and the list being empty is a perfectly good outcome that
 *     the screen handles by just showing the library instead.
 *   · Nothing here counts. No function returns a tally, and none should be
 *     added — "three exercises available" is a scoreboard, and a scoreboard
 *     is the thing this feature is specifically not.
 *
 * The words owed, missed, behind, outstanding and debt do not appear in
 * this app, and a test enforces that. They describe a relationship with
 * training that this module exists to avoid.
 */

/** Session type for bonus work. Deliberately not a member of any split. */
export const BONUS_SESSION = 'bonus';

export function isBonus(sessionType: string): boolean {
  return sessionType === BONUS_SESSION;
}

/** How far back suggestions look. Past this, work is simply let go. */
export const BONUS_WINDOW_DAYS = 7;

/**
 * Muscle group per seeded exercise, where it differs from the session type
 * the exercise is filed under.
 *
 * Grouping by session type alone would split arm work across two headings —
 * barbell curl under "back" and overhead tricep extension under "chest" —
 * when together they're the obvious session to do. Only the exceptions are
 * listed; everything else takes its session type, which is already its
 * muscle group.
 *
 * Matched by name, so an exercise the user renamed falls back to its
 * session type. That's the honest answer: we no longer know what it is.
 */
export const EXERCISE_GROUPS: Record<string, string> = {
  'Barbell curl': 'arms',
  'Overhead tricep ext': 'arms',
};

export function muscleGroupOf(name: string, sessionType: string): string {
  return EXERCISE_GROUPS[name] ?? sessionType;
}

/** One heading on the bonus screen. */
export interface GroupSuggestion {
  group: string;
  exercises: ExerciseDef[];
}

/**
 * Every exercise defined anywhere, deduped by name, with the session type
 * it came from. The bonus session isn't restricted to leftovers, so this is
 * what the picker offers in full.
 */
export interface LibraryEntry {
  def: ExerciseDef;
  /** The plan it's filed under — its "home" session. */
  sessionType: string;
  group: string;
}

export function exerciseLibrary(plans: ExercisePlans): LibraryEntry[] {
  const seen = new Set<string>();
  const out: LibraryEntry[] = [];
  for (const [sessionType, defs] of Object.entries(plans)) {
    if (isBonus(sessionType)) continue;
    for (const def of defs) {
      if (seen.has(def.name)) continue;
      seen.add(def.name);
      out.push({ def, sessionType, group: muscleGroupOf(def.name, sessionType) });
    }
  }
  return out;
}

/**
 * Turn picked names back into full definitions, in the order picked.
 *
 * A name the library no longer has — renamed or removed since it was
 * picked, or logged under an older plan — still resolves, to a plain
 * definition rather than disappearing from a session that already used it.
 */
export function resolveDefs(names: string[], library: LibraryEntry[]): ExerciseDef[] {
  const byName = new Map(library.map((e) => [e.def.name, e.def]));
  return names.map(
    (name) =>
      byName.get(name) ?? {
        name,
        repRangeTop: 12,
        equipment: 'machine' as const,
        restSec: 90,
      },
  );
}

/** Names that got at least one set in this session. */
function loggedNames(w: Workout): string[] {
  return w.exercises.filter((e) => e.sets.length > 0).map((e) => e.name);
}

/**
 * What a coherent bonus session could be, from the last seven days only.
 *
 * For each completed regular session inside the window, the exercises its
 * plan listed and it logged no sets for. Anything since done — in a later
 * regular session or in a bonus session — drops out, because it has been
 * done and there is nothing to offer. Anything older than the window drops
 * out too, silently and for good.
 *
 * Grouped by muscle group. One ordering rule at both levels: most recent
 * gap first, ties keeping plan order. The top of the list is the most
 * current thing rather than the oldest thing still hanging around, and two
 * gaps from the same session read in the order that session listed them.
 *
 * Returns only groups that have something in them. An empty array is a
 * normal, unremarkable result and callers must treat it as one.
 */
export function recentlySkipped(
  plans: ExercisePlans,
  workouts: Workout[],
  today: ISODate,
): GroupSuggestion[] {
  const from = addDays(today, -(BONUS_WINDOW_DAYS - 1));
  const done = [...workouts]
    .filter((w) => w.status !== 'in_progress')
    .sort((a, b) => a.date.localeCompare(b.date));

  // name → the group it belongs in, and the most recent date it was skipped.
  const open = new Map<string, { def: ExerciseDef; group: string; date: ISODate }>();

  for (const w of done) {
    // Every completed session closes out whatever it logged, whichever type
    // it was and whenever it happened — a bonus session yesterday settles a
    // gap from a regular session last week. Done before the window check so
    // work done today can still clear a skip from six days ago.
    for (const name of loggedNames(w)) open.delete(name);

    if (w.date < from || w.date > today) continue;
    if (isBonus(w.sessionType)) continue;

    const plan = plans[w.sessionType] ?? [];
    const logged = new Set(loggedNames(w));
    for (const def of plan) {
      if (logged.has(def.name)) continue;
      open.set(def.name, {
        def,
        group: muscleGroupOf(def.name, w.sessionType),
        date: w.date,
      });
    }
  }

  // Insertion order here is chronological, then plan order within a
  // session. Sorting by date descending is stable, so the tie-break is that
  // plan order — and grouping afterwards inherits both, which is why the
  // two levels need only this one sort between them.
  const recentFirst = [...open.values()].sort((a, b) => b.date.localeCompare(a.date));

  const byGroup = new Map<string, ExerciseDef[]>();
  for (const { def, group } of recentFirst) {
    const cur = byGroup.get(group);
    if (cur) cur.push(def);
    else byGroup.set(group, [def]);
  }

  return [...byGroup.entries()].map(([group, exercises]) => ({ group, exercises }));
}

/**
 * Exercises given sets in a bonus session on or after `since`.
 *
 * Feeds the skip-promotion: bonus work is real work, so an exercise done
 * here is no longer skipped and must not be hoisted to the top of its next
 * regular session. Dated from the session that skipped it, so bonus work
 * done BEFORE that session — which the session then skipped anyway — still
 * leaves the skip standing.
 */
export function doneInBonusSince(workouts: Workout[], since: ISODate): Set<string> {
  const names = new Set<string>();
  for (const w of workouts) {
    if (!isBonus(w.sessionType) || w.status === 'in_progress') continue;
    if (w.date < since) continue;
    for (const name of loggedNames(w)) names.add(name);
  }
  return names;
}
