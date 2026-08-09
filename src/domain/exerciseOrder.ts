import type { ExerciseDef } from '../db/config';
import type { Workout } from '../db/schema';

/**
 * Skipped exercises rise to the top of the list next time.
 *
 * The ordering is DERIVED, never stored. It is a function of exactly one
 * thing — the most recent completed session of that same type — which is
 * what makes every rule below fall out for free rather than needing to be
 * enforced:
 *
 *   · It applies once. Complete the exercise next time and it stops being
 *     skipped in the session we read, so the list is back to its default
 *     with nothing to reset.
 *   · Skip it again and it simply stays at the top, because the session we
 *     read still reports it skipped. It does not climb further, and there
 *     is no count of how many times it happened.
 *   · Nothing accumulates anywhere. There is no makeup queue and no total,
 *     because there is nowhere for one to live.
 *   · Doing the exercise in a bonus session settles it just as doing it on
 *     the day would — see `doneSince` on orderForSession.
 *
 * A skip is not a failure and this module never treats it as one — it
 * changes what you see first, and that is the whole of it.
 */

/**
 * The session this promotion reads from: the last COMPLETED session of the
 * same type. Never another type — a skipped row is a back exercise and
 * follows back sessions around, it has nothing to say about legs day.
 *
 * A session still in progress is excluded: mid-session you want the order
 * derived from last time, not from what you have logged so far today.
 */
export function lastCompletedOf(
  workouts: Workout[],
  sessionType: string,
): Workout | undefined {
  return workouts
    .filter((w) => w.sessionType === sessionType && w.status !== 'in_progress')
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1);
}

/**
 * Plan exercises that got no sets in that session.
 *
 * Covers both shapes a skip can take: the exercise missing from the row
 * entirely (what the logger writes, since it drops empty exercises), and an
 * exercise present but carrying an empty set list.
 */
export function skippedIn(
  plan: ExerciseDef[],
  session: Workout | undefined,
): string[] {
  if (!session) return [];
  const logged = new Set(
    session.exercises.filter((e) => e.sets.length > 0).map((e) => e.name),
  );
  return plan.map((e) => e.name).filter((name) => !logged.has(name));
}

/**
 * Hoist the skipped exercises to the front, keeping the relative order of
 * both groups. A stable partition, so several skipped exercises arrive at
 * the top in the same order they had in the plan rather than reversed or
 * shuffled.
 *
 * Promoting everything is the same list back — which is exactly right for
 * a session where nothing was logged: there is nothing to bring forward
 * relative to anything else.
 */
export function promote(plan: ExerciseDef[], skipped: Set<string>): ExerciseDef[] {
  if (skipped.size === 0) return plan;
  return [
    ...plan.filter((e) => skipped.has(e.name)),
    ...plan.filter((e) => !skipped.has(e.name)),
  ];
}

export interface OrderedPlan {
  /** What to render, top first. */
  order: ExerciseDef[];
  /** Names carrying the "moved up from last session" label. */
  promoted: Set<string>;
}

/**
 * The list as it should appear for the next session of this type.
 *
 * `overriddenFor` is the session id whose promotion the user has already
 * overruled by reordering by hand. When it matches the session we would
 * read from, the plan is shown exactly as stored — otherwise re-deriving
 * would hoist the exercise straight back and the manual reorder would
 * appear not to have worked. It suppresses one promotion, and the next
 * completed session starts the whole thing over.
 *
 * `doneSince` is work that has happened in the meantime — in practice,
 * exercises logged in a bonus session since that one. Bonus work is real
 * work: an exercise done there is not skipped any more, so it drops out of
 * the promotion and the list reads exactly as if it had been done on the
 * day. See doneInBonusSince in ./bonus.
 */
export function orderForSession(
  plan: ExerciseDef[],
  lastSession: Workout | undefined,
  overriddenFor?: number,
  doneSince?: ReadonlySet<string>,
): OrderedPlan {
  const overridden =
    lastSession?.id !== undefined && lastSession.id === overriddenFor;
  const promoted = new Set(
    overridden
      ? []
      : skippedIn(plan, lastSession).filter((name) => !doneSince?.has(name)),
  );
  return { order: promote(plan, promoted), promoted };
}
