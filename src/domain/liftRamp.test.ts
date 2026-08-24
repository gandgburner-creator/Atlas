import { describe, expect, it } from 'vitest';
import type { Workout } from '../db/schema';
import {
  bestWeightFor,
  DAY_TYPES,
  dayTypeFor,
  expectedWeight,
  isPersonalRecord,
  isRampComplete,
  liftHistory,
  mondayOf,
  percentForWeek,
  RAMP_SPLIT,
  rampWeekFor,
  roundToPlate,
  summarise,
  weekConsistency,
} from './liftRamp';

/** 2026-08-10 is a Monday. */
const MON = '2026-08-10';
const TUE = '2026-08-11';
const WED = '2026-08-12';
const THU = '2026-08-13';
const FRI = '2026-08-14';
const SUN = '2026-08-16';

function session(
  sessionType: string,
  date: string,
  exercises: { name: string; sets: { reps: number; weight: number }[] }[],
  extra: Partial<Workout> = {},
): Workout {
  return {
    id: Number(date.replaceAll('-', '')),
    date,
    sessionType,
    status: 'complete',
    exercises,
    ...extra,
  };
}

const lift = (name: string, ...weights: number[]) => ({
  name,
  sets: weights.map((weight) => ({ reps: 10, weight })),
});

describe('the rotation', () => {
  it('runs Monday to Thursday and rests the rest of the week', () => {
    expect(dayTypeFor(MON)).toBe('mon');
    expect(dayTypeFor(TUE)).toBe('tue');
    expect(dayTypeFor(WED)).toBe('wed');
    expect(dayTypeFor(THU)).toBe('thu');
    expect(dayTypeFor(FRI)).toBeNull();
    expect(dayTypeFor(SUN)).toBeNull();
  });

  it('lays the split out so the existing fixed-weekday mode reads it', () => {
    // fixedSlotFor indexes Monday-first, so slot order IS weekday order.
    expect(RAMP_SPLIT).toEqual(['mon', 'tue', 'wed', 'thu', 'rest', 'rest', 'rest']);
    expect(RAMP_SPLIT).toHaveLength(7);
    DAY_TYPES.forEach((d, i) => expect(RAMP_SPLIT[i]).toBe(d));
  });

  it('finds the Monday of any week, including Sunday night', () => {
    expect(mondayOf(MON)).toBe(MON);
    expect(mondayOf(THU)).toBe(MON);
    expect(mondayOf(SUN)).toBe(MON);
  });
});

describe('where you are in the ramp', () => {
  it('counts three weeks from the Monday of the starting week', () => {
    expect(rampWeekFor(MON, MON)).toBe(1);
    expect(rampWeekFor(MON, THU)).toBe(1);
    expect(rampWeekFor(MON, '2026-08-17')).toBe(2);
    expect(rampWeekFor(MON, '2026-08-24')).toBe(3);
    expect(rampWeekFor(MON, '2026-08-31')).toBeNull();
  });

  it('keeps a mid-week start in that same week rather than burning one', () => {
    // Starting on Wednesday, Thursday is still week 1 — not a two-day week
    // followed by a fresh week 1 on Monday.
    expect(rampWeekFor(WED, WED)).toBe(1);
    expect(rampWeekFor(WED, THU)).toBe(1);
    expect(rampWeekFor(WED, '2026-08-17')).toBe(2);
  });

  it('has no week zero — before the start date there is no ramp', () => {
    expect(rampWeekFor(WED, MON)).toBeNull();
  });

  it('reports complete once past week three, and not before', () => {
    expect(isRampComplete(MON, THU)).toBe(false);
    expect(isRampComplete(MON, '2026-08-24')).toBe(false);
    expect(isRampComplete(MON, '2026-08-31')).toBe(true);
    // Before it started is not "complete".
    expect(isRampComplete(WED, MON)).toBe(false);
  });

  it('ramps 60, 70, 80', () => {
    expect(percentForWeek(1)).toBe(0.6);
    expect(percentForWeek(2)).toBe(0.7);
    expect(percentForWeek(3)).toBe(0.8);
  });
});

describe('expected weight', () => {
  const history = [
    session('chest', '2026-07-01', [lift('Barbell bench press', 80, 82.5)]),
    session('legs', '2026-07-02', [lift('Back squat', 100)]),
    session('back', '2026-07-03', [lift('Pull-ups', 0, 0)]),
  ];

  it('takes a percentage of the heaviest set ever recorded', () => {
    expect(bestWeightFor(history, 'Bench Press')).toBe(82.5);
    // 82.5 × 0.6 = 49.5, rounded to a loadable 50.
    expect(expectedWeight(history, 'Bench Press', 1)).toBe(50);
    expect(expectedWeight(history, 'Bench Press', 2)).toBe(57.5);
    expect(expectedWeight(history, 'Bench Press', 3)).toBe(65);
  });

  it('follows a lift across its old name', () => {
    // Squat was logged as "Back squat" under the previous program.
    expect(bestWeightFor(history, 'Squat')).toBe(100);
    expect(expectedWeight(history, 'Squat', 1)).toBe(60);
  });

  it('rounds to something you can actually load', () => {
    expect(roundToPlate(49.5)).toBe(50);
    expect(roundToPlate(63.2)).toBe(62.5);
    expect(roundToPlate(64)).toBe(65);
    // Exactly between two plates rounds up, as arithmetic rounding does.
    // At 60–80% of a working weight the 1.25 kg either way is noise.
    expect(roundToPlate(61.25)).toBe(62.5);
  });

  it('says nothing rather than inventing a number for a new lift', () => {
    // Low Row and High Row are deliberately not aliased — either could
    // mean more than one old lift, and a confidently wrong number on the
    // bar is worse than asking once.
    expect(bestWeightFor(history, 'Low Row')).toBeNull();
    expect(expectedWeight(history, 'Low Row', 1)).toBeNull();
  });

  it('has no percentage to offer for bodyweight work', () => {
    expect(bestWeightFor(history, 'Pull Ups')).toBeNull();
    expect(expectedWeight(history, 'Pull Ups', 2)).toBeNull();
  });

  it('ignores a session still in progress', () => {
    const open = [
      ...history,
      session('mon', MON, [lift('Squat', 200)], { status: 'in_progress' }),
    ];
    expect(bestWeightFor(open, 'Squat')).toBe(100);
  });
});

describe('weekly consistency', () => {
  it('counts distinct rotation days trained this week, out of four', () => {
    const w = [
      session('mon', MON, [lift('Squat', 60)]),
      session('tue', TUE, [lift('Leg Press', 80)]),
    ];
    expect(weekConsistency(w, THU)).toBe(2);
  });

  it('counts a day once however many sessions it held', () => {
    const w = [
      session('mon', MON, [lift('Squat', 60)]),
      { ...session('mon', MON, [lift('RDL', 60)]), id: 999 },
    ];
    expect(weekConsistency(w, THU)).toBe(1);
  });

  it('ignores last week', () => {
    const w = [session('mon', '2026-08-03', [lift('Squat', 60)])];
    expect(weekConsistency(w, THU)).toBe(0);
  });

  it('ignores a session with nothing logged in it', () => {
    const w = [session('mon', MON, [{ name: 'Squat', sets: [] }])];
    expect(weekConsistency(w, THU)).toBe(0);
  });

  it('ignores sessions that are not part of the rotation', () => {
    const w = [session('bonus', MON, [lift('Squat', 60)])];
    expect(weekConsistency(w, THU)).toBe(0);
  });
});

describe('per-exercise progress', () => {
  it('reports the top set per session, oldest first, across old names', () => {
    const w = [
      session('mon', MON, [lift('Squat', 60, 62.5)]),
      session('legs', '2026-07-02', [lift('Back squat', 100)]),
    ];
    expect(liftHistory(w, 'Squat')).toEqual([
      { date: '2026-07-02', topWeight: 100, reps: 10 },
      { date: MON, topWeight: 62.5, reps: 10 },
    ]);
  });
});

describe('personal records', () => {
  const history = [session('legs', '2026-07-02', [lift('Back squat', 100)])];

  it('does not fire during the ramp, which is the point of training at 60%', () => {
    expect(isPersonalRecord(history, 'Squat', 60)).toBe(false);
    expect(isPersonalRecord(history, 'Squat', 100)).toBe(false);
  });

  it('fires when a lift genuinely beats everything before it', () => {
    expect(isPersonalRecord(history, 'Squat', 102.5)).toBe(true);
  });

  it('is never claimed for bodyweight work', () => {
    expect(isPersonalRecord(history, 'Pull Ups', 0)).toBe(false);
  });

  it('does not call a first-ever lift a record', () => {
    // Most of week 1 is a lift the app has never seen. A baseline is not a
    // best, and flashing for each one would empty the signal.
    expect(isPersonalRecord(history, 'Hammer Curl', 20)).toBe(false);
    expect(isPersonalRecord([], 'Squat', 100)).toBe(false);
  });

  it('does not count bodyweight history as something to beat', () => {
    const bw = [session('back', '2026-07-03', [lift('Pull-ups', 0, 0)])];
    expect(isPersonalRecord(bw, 'Pull Ups', 5)).toBe(false);
  });

  it('does not count the session being logged against itself', () => {
    const withToday = [
      ...history,
      session('mon', MON, [lift('Squat', 105)]),
    ];
    const todayId = Number(MON.replaceAll('-', ''));
    expect(isPersonalRecord(withToday, 'Squat', 105)).toBe(false);
    expect(isPersonalRecord(withToday, 'Squat', 105, todayId)).toBe(true);
  });
});

describe('session summary', () => {
  it('counts exercises done, sets completed and total volume', () => {
    const w = session('mon', MON, [
      lift('Squat', 60, 60),
      lift('RDL', 50),
      { name: 'Bicep Curl', sets: [] }, // skipped
    ]);
    expect(summarise(w)).toEqual({ exercises: 2, sets: 3, volume: 60 * 10 * 2 + 50 * 10 });
  });

  it('is all zeroes for a session with nothing in it', () => {
    expect(summarise({ exercises: [] })).toEqual({ exercises: 0, sets: 0, volume: 0 });
  });
});
