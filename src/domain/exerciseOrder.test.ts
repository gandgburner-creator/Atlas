import { describe, expect, it } from 'vitest';
import type { ExerciseDef } from '../db/config';
import type { Workout } from '../db/schema';
import { lastCompletedOf, orderForSession, promote, skippedIn } from './exerciseOrder';

const ex = (name: string): ExerciseDef => ({
  name,
  repRangeTop: 8,
  equipment: 'barbell',
  restSec: 120,
});

/** Back day: five exercises, in their default order. */
const PLAN = [ex('Pull-ups'), ex('Barbell row'), ex('Lat pulldown'), ex('Chest row'), ex('Curl')];

const names = (list: ExerciseDef[]) => list.map((e) => e.name);

/** A completed session that logged everything named, and nothing else. */
function session(
  sessionType: string,
  date: string,
  logged: string[],
  extra: Partial<Workout> = {},
): Workout {
  return {
    id: Number(date.replaceAll('-', '')),
    date,
    sessionType,
    status: 'complete',
    exercises: logged.map((name) => ({ name, sets: [{ reps: 8, weight: 60 }] })),
    ...extra,
  };
}

describe('what counts as skipped', () => {
  it('is an exercise the session logged no sets for', () => {
    const last = session('back', '2026-08-01', ['Pull-ups', 'Lat pulldown', 'Chest row', 'Curl']);
    expect(skippedIn(PLAN, last)).toEqual(['Barbell row']);
  });

  it('counts an exercise present in the row but carrying no sets', () => {
    // The logger drops empty exercises, but a hand-edited session can leave
    // one behind — an exercise with no sets is still an exercise not done.
    const last: Workout = {
      date: '2026-08-01',
      sessionType: 'back',
      status: 'complete',
      exercises: [
        { name: 'Pull-ups', sets: [{ reps: 8, weight: 0 }] },
        { name: 'Barbell row', sets: [] },
      ],
    };
    expect(skippedIn(PLAN, last)).toContain('Barbell row');
  });

  it('says nothing at all when there is no previous session', () => {
    expect(skippedIn(PLAN, undefined)).toEqual([]);
  });
});

describe('promotion', () => {
  it('brings a skipped exercise to the top', () => {
    expect(names(promote(PLAN, new Set(['Barbell row'])))).toEqual([
      'Barbell row', 'Pull-ups', 'Lat pulldown', 'Chest row', 'Curl',
    ]);
  });

  it('keeps several promoted exercises in their relative order', () => {
    // Curl sits after Lat pulldown in the plan, and still does at the top.
    expect(names(promote(PLAN, new Set(['Curl', 'Lat pulldown'])))).toEqual([
      'Lat pulldown', 'Curl', 'Pull-ups', 'Barbell row', 'Chest row',
    ]);
  });

  it('leaves the plan untouched when nothing was skipped', () => {
    expect(promote(PLAN, new Set())).toBe(PLAN);
  });

  it('is a no-op when everything was skipped — nothing to bring forward', () => {
    expect(names(promote(PLAN, new Set(names(PLAN))))).toEqual(names(PLAN));
  });
});

describe('which session it reads from', () => {
  it('never crosses session types — a skipped back exercise says nothing about legs', () => {
    const workouts = [
      session('back', '2026-08-01', ['Pull-ups']),
      session('legs', '2026-08-02', ['Leg press']),
    ];
    expect(lastCompletedOf(workouts, 'back')?.date).toBe('2026-08-01');

    // Legs' own plan is ordered by legs history alone.
    const legPlan = [ex('Leg press'), ex('Leg curl')];
    const { order } = orderForSession(legPlan, lastCompletedOf(workouts, 'legs'));
    expect(names(order)).toEqual(['Leg curl', 'Leg press']); // Leg curl skipped on legs day
  });

  it('reads the most recent session, not the first', () => {
    const workouts = [
      session('back', '2026-08-01', ['Pull-ups']),
      session('back', '2026-08-08', ['Barbell row']),
    ];
    expect(lastCompletedOf(workouts, 'back')?.date).toBe('2026-08-08');
  });

  it('ignores the session currently in progress', () => {
    const workouts = [
      session('back', '2026-08-01', ['Pull-ups']),
      session('back', '2026-08-08', [], { status: 'in_progress' }),
    ];
    // Mid-session the order comes from last time, not from what has been
    // logged so far today.
    expect(lastCompletedOf(workouts, 'back')?.date).toBe('2026-08-01');
  });
});

describe('the rules, end to end', () => {
  it('applies once — completing it next time returns the default order', () => {
    const skippedRow = session('back', '2026-08-01', ['Pull-ups', 'Lat pulldown', 'Chest row', 'Curl']);
    const first = orderForSession(PLAN, skippedRow);
    expect(names(first.order)[0]).toBe('Barbell row');
    expect(first.promoted.has('Barbell row')).toBe(true);

    // Next session it gets done. Nothing to carry forward.
    const allDone = session('back', '2026-08-08', names(PLAN));
    const after = orderForSession(PLAN, allDone);
    expect(names(after.order)).toEqual(names(PLAN));
    expect(after.promoted.size).toBe(0);
  });

  it('skipped again just stays at the top — it does not climb or accumulate', () => {
    const once = orderForSession(PLAN, session('back', '2026-08-01', ['Pull-ups', 'Curl']));
    const twice = orderForSession(PLAN, session('back', '2026-08-08', ['Pull-ups', 'Curl']));
    // Identical both times: the second skip changes nothing about position,
    // and there is no count anywhere that could make it change.
    expect(names(twice.order)).toEqual(names(once.order));
    expect(names(twice.order)).toEqual([
      'Barbell row', 'Lat pulldown', 'Chest row', 'Pull-ups', 'Curl',
    ]);
  });

  it('the label marks exactly the promoted exercises and nothing else', () => {
    const { promoted } = orderForSession(
      PLAN,
      session('back', '2026-08-01', ['Pull-ups', 'Lat pulldown']),
    );
    expect([...promoted].sort()).toEqual(['Barbell row', 'Chest row', 'Curl']);
    expect(promoted.has('Pull-ups')).toBe(false);
  });

  it('a manual reorder wins — the overruled promotion does not re-hoist it', () => {
    const last = session('back', '2026-08-01', ['Pull-ups', 'Lat pulldown', 'Chest row', 'Curl']);

    // Barbell row was promoted, and the user dragged it back down. The plan
    // they saved is now the order they chose.
    const chosen = [ex('Pull-ups'), ex('Lat pulldown'), ex('Chest row'), ex('Curl'), ex('Barbell row')];

    // Without the override it would be hoisted straight back, undoing them.
    expect(names(orderForSession(chosen, last).order)[0]).toBe('Barbell row');

    // With it, what they chose is what they get.
    const held = orderForSession(chosen, last, last.id);
    expect(names(held.order)).toEqual(names(chosen));
    expect(held.promoted.size).toBe(0);
  });

  it('the override lapses at the next completed session, so later skips still promote', () => {
    const overruledFor = session('back', '2026-08-01', ['Pull-ups']).id;
    // A newer session, in which Curl was skipped.
    const newer = session('back', '2026-08-08', ['Pull-ups', 'Barbell row', 'Lat pulldown', 'Chest row']);

    const { order, promoted } = orderForSession(PLAN, newer, overruledFor);
    expect(names(order)[0]).toBe('Curl');
    expect(promoted.has('Curl')).toBe(true);
  });
});
