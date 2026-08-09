import { describe, expect, it } from 'vitest';
import type { ExerciseDef, ExercisePlans } from '../db/config';
import type { Workout } from '../db/schema';
import {
  BONUS_SESSION,
  BONUS_WINDOW_DAYS,
  doneInBonusSince,
  exerciseLibrary,
  muscleGroupOf,
  recentlySkipped,
  resolveDefs,
} from './bonus';

const ex = (name: string): ExerciseDef => ({
  name,
  repRangeTop: 10,
  equipment: 'machine',
  restSec: 90,
});

const PLANS: ExercisePlans = {
  back: [ex('Pull-ups'), ex('Barbell row'), ex('Barbell curl')],
  chest: [ex('Barbell bench press'), ex('Cable fly'), ex('Overhead tricep ext')],
  legs: [ex('Leg press'), ex('Seated leg curl')],
};

/** A completed session that logged exactly the names given. */
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
    exercises: logged.map((name) => ({ name, sets: [{ reps: 8, weight: 40 }] })),
    ...extra,
  };
}

const TODAY = '2026-08-09';
/** Inside the window: today minus six days. */
const SIX_AGO = '2026-08-03';
/** One day past it. */
const SEVEN_AGO = '2026-08-02';

const flat = (groups: { group: string; exercises: ExerciseDef[] }[]) =>
  groups.map((g) => [g.group, g.exercises.map((e) => e.name)] as const);

describe('the seven day window', () => {
  it('offers what a session in the window left undone', () => {
    const workouts = [session('back', SIX_AGO, ['Pull-ups'])];
    expect(flat(recentlySkipped(PLANS, workouts, TODAY))).toEqual([
      ['back', ['Barbell row']],
      ['arms', ['Barbell curl']],
    ]);
  });

  it('drops anything older than the window, silently and for good', () => {
    const workouts = [session('back', SEVEN_AGO, ['Pull-ups'])];
    expect(recentlySkipped(PLANS, workouts, TODAY)).toEqual([]);
  });

  it('lets a gap age out rather than carrying it forward', () => {
    const workouts = [session('back', SIX_AGO, ['Pull-ups'])];
    // The same history, read one day later. Nothing was added or removed —
    // the window simply moved past it, which is the whole mechanism.
    expect(recentlySkipped(PLANS, workouts, '2026-08-10')).toEqual([]);
  });

  it('is seven days, counting today as one of them', () => {
    expect(BONUS_WINDOW_DAYS).toBe(7);
    const workouts = [session('back', TODAY, ['Pull-ups'])];
    expect(recentlySkipped(PLANS, workouts, TODAY)).not.toEqual([]);
  });
});

describe('grouping', () => {
  it('groups by muscle, not by the session an exercise is filed under', () => {
    // Barbell curl lives on back day and the tricep extension on chest day,
    // but together they are the arms session — which is the point of the
    // grouping: what could I actually do.
    const workouts = [
      session('back', '2026-08-05', ['Pull-ups', 'Barbell row']),
      session('chest', '2026-08-06', ['Barbell bench press', 'Cable fly']),
    ];
    expect(flat(recentlySkipped(PLANS, workouts, TODAY))).toEqual([
      ['arms', ['Overhead tricep ext', 'Barbell curl']],
    ]);
  });

  it('falls back to the session type for anything not specially grouped', () => {
    expect(muscleGroupOf('Leg press', 'legs')).toBe('legs');
    expect(muscleGroupOf('Barbell curl', 'back')).toBe('arms');
    // A renamed exercise is no longer recognised, and says so by taking its
    // session type rather than guessing.
    expect(muscleGroupOf('My curl variation', 'back')).toBe('back');
  });

  it('puts the most recent gap first', () => {
    const workouts = [
      session('legs', '2026-08-04', ['Leg press']),
      session('chest', '2026-08-07', ['Barbell bench press', 'Overhead tricep ext']),
    ];
    expect(flat(recentlySkipped(PLANS, workouts, TODAY))).toEqual([
      ['chest', ['Cable fly']],
      ['legs', ['Seated leg curl']],
    ]);
  });
});

describe('what closes a gap', () => {
  it('a later regular session that did the exercise', () => {
    const workouts = [
      session('back', '2026-08-04', ['Pull-ups']),
      session('back', '2026-08-07', ['Pull-ups', 'Barbell row', 'Barbell curl']),
    ];
    expect(recentlySkipped(PLANS, workouts, TODAY)).toEqual([]);
  });

  it('a bonus session that did the exercise', () => {
    const workouts = [
      session('back', '2026-08-04', ['Pull-ups']),
      session(BONUS_SESSION, '2026-08-05', ['Barbell row', 'Barbell curl']),
    ];
    expect(recentlySkipped(PLANS, workouts, TODAY)).toEqual([]);
  });

  it('bonus work today settles a gap from the far end of the window', () => {
    const workouts = [
      session('back', SIX_AGO, ['Pull-ups']),
      session(BONUS_SESSION, TODAY, ['Barbell row']),
    ];
    expect(flat(recentlySkipped(PLANS, workouts, TODAY))).toEqual([
      ['arms', ['Barbell curl']],
    ]);
  });

  it('a bonus session never creates a gap of its own', () => {
    // Bonus is a menu, not a plan — there is nothing it can fail to do.
    const workouts = [session(BONUS_SESSION, '2026-08-05', ['Barbell curl'])];
    expect(recentlySkipped({ ...PLANS, bonus: PLANS.back! }, workouts, TODAY)).toEqual([]);
  });

  it('a session still in progress settles nothing and skips nothing', () => {
    const workouts = [
      session('back', '2026-08-05', ['Pull-ups'], { status: 'in_progress' }),
    ];
    expect(recentlySkipped(PLANS, workouts, TODAY)).toEqual([]);
  });
});

describe('nothing to offer', () => {
  it('an empty week is an empty list, not an error', () => {
    expect(recentlySkipped(PLANS, [], TODAY)).toEqual([]);
  });

  it('a week where everything got done is the same empty list', () => {
    const workouts = [session('legs', '2026-08-05', ['Leg press', 'Seated leg curl'])];
    expect(recentlySkipped(PLANS, workouts, TODAY)).toEqual([]);
  });
});

describe('the library', () => {
  it('offers every exercise, deduped, whether or not it was skipped', () => {
    const names = exerciseLibrary(PLANS).map((e) => e.def.name);
    expect(names).toContain('Leg press');
    expect(names).toContain('Barbell curl');
    expect(new Set(names).size).toBe(names.length);
  });

  it('carries each exercise\'s muscle group, not just its session', () => {
    const curl = exerciseLibrary(PLANS).find((e) => e.def.name === 'Barbell curl');
    expect(curl?.sessionType).toBe('back');
    expect(curl?.group).toBe('arms');
  });

  it('leaves any stored bonus plan out — bonus has no plan to offer', () => {
    const withBonus = { ...PLANS, [BONUS_SESSION]: [ex('Ghost lift')] };
    expect(exerciseLibrary(withBonus).map((e) => e.def.name)).not.toContain('Ghost lift');
  });

  it('resolves picked names back to definitions, in the order picked', () => {
    const lib = exerciseLibrary(PLANS);
    expect(resolveDefs(['Cable fly', 'Pull-ups'], lib).map((d) => d.name)).toEqual([
      'Cable fly',
      'Pull-ups',
    ]);
  });

  it('still resolves a name the library has since lost', () => {
    // Renamed or deleted out from under a session that already used it.
    const [only] = resolveDefs(['Something removed'], exerciseLibrary(PLANS));
    expect(only?.name).toBe('Something removed');
    expect(only?.restSec).toBeGreaterThan(0);
  });
});

describe('bonus work and the skip promotion', () => {
  it('reports what a bonus session logged since a given date', () => {
    const workouts = [session(BONUS_SESSION, '2026-08-05', ['Barbell row'])];
    expect([...doneInBonusSince(workouts, '2026-08-04')]).toEqual(['Barbell row']);
  });

  it('ignores bonus work done before the session that skipped it', () => {
    // Curled on Monday, then had a back day on Wednesday and skipped the
    // curl. Wednesday's skip stands — Monday doesn't undo it.
    const workouts = [session(BONUS_SESSION, '2026-08-03', ['Barbell curl'])];
    expect(doneInBonusSince(workouts, '2026-08-05').size).toBe(0);
  });

  it('ignores regular sessions — only bonus work is read here', () => {
    const workouts = [session('back', '2026-08-05', ['Barbell row'])];
    expect(doneInBonusSince(workouts, '2026-08-04').size).toBe(0);
  });

  it('ignores a bonus session still in progress', () => {
    const workouts = [
      session(BONUS_SESSION, '2026-08-05', ['Barbell row'], { status: 'in_progress' }),
    ];
    expect(doneInBonusSince(workouts, '2026-08-04').size).toBe(0);
  });
});
