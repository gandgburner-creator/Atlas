import { describe, expect, it } from 'vitest';
import { DEFAULT_TRAINING_STATE, type TrainingState } from '../db/config';
import {
  advanceAfterSession,
  currentSlot,
  hasLoggedSets,
  lastTimeFor,
  overloadHint,
  overrideToSession,
  passRestDays,
  pointerFromHistory,
  sessionFor,
} from './training';
import type { Workout } from '../db/schema';

const base: TrainingState = { ...DEFAULT_TRAINING_STATE };
const SPLIT = ['back', 'shoulders', 'rest', 'legs', 'chest', 'rest'];
// split: ['back','shoulders','rest','legs','chest','rest']

describe('the queue', () => {
  it('advances only on a completed session', () => {
    expect(currentSlot(base)).toBe('back');
    const after = advanceAfterSession(base, '2026-08-03');
    expect(currentSlot(after)).toBe('shoulders');
  });

  it('advances by exactly one position from every starting slot, wrapping at the end', () => {
    // Regression coverage for the reported bug: finishing 'back' must land
    // on 'shoulders', never skip ahead to 'legs' or 'chest'. Checked from
    // every position in the split, not just the one that was reported.
    SPLIT.forEach((_, i) => {
      const s: TrainingState = { ...base, pointer: i };
      const after = advanceAfterSession(s, '2026-08-03');
      expect(after.pointer).toBe(i + 1);
      expect(currentSlot(after)).toBe(SPLIT[(i + 1) % SPLIT.length]);
    });
  });

  it('does NOT advance on a skipped day — the session is simply next tomorrow', () => {
    // Three days pass with no logging while 'back' is up. Nothing moves.
    const s = { ...base, lastRestPass: '2026-08-01' };
    const later = passRestDays(s, '2026-08-04');
    expect(currentSlot(later)).toBe('back');
    // And there is no debt or missed-day state anywhere to consult.
    expect(later.pointer).toBe(0);
  });

  it('lets a rest day pass by itself at the day boundary', () => {
    // Pointer at index 2 = rest, marked yesterday.
    const s: TrainingState = { ...base, pointer: 2, lastRestPass: '2026-08-01' };
    const next = passRestDays(s, '2026-08-02');
    expect(currentSlot(next)).toBe('legs');
  });

  it('consumes one elapsed day per rest slot, not all at once', () => {
    // Two consecutive rest slots but only one day has passed.
    const s: TrainingState = {
      ...base,
      split: ['back', 'rest', 'rest', 'legs'],
      pointer: 1,
      lastRestPass: '2026-08-01',
    };
    const oneDay = passRestDays(s, '2026-08-02');
    expect(currentSlot(oneDay)).toBe('rest'); // second rest still holding
    const twoDays = passRestDays(s, '2026-08-03');
    expect(currentSlot(twoDays)).toBe('legs');
  });

  it('a rest-day pass never advances more than one slot even with a large day gap', () => {
    // Long-stale lastRestPass (weeks ago) must still stop at the very next
    // non-rest slot — passRestDays is not a substitute for "Finish session".
    const s: TrainingState = { ...base, pointer: 2, lastRestPass: '2026-07-01' };
    const next = passRestDays(s, '2026-08-20');
    expect(currentSlot(next)).toBe('legs');
    expect(next.pointer).toBe(3);
  });

  it('wraps around the split', () => {
    let s = { ...base, pointer: 5 }; // final rest slot
    s = advanceAfterSession(s, '2026-08-02');
    expect(currentSlot(s)).toBe('back');
  });

  it('freezes completely while paused — days are excluded, not missed', () => {
    const s: TrainingState = {
      ...base,
      pointer: 2, // rest
      lastRestPass: '2026-08-01',
      pause: { since: '2026-08-01', reason: 'sick' },
    };
    const later = passRestDays(s, '2026-08-20');
    expect(later.pointer).toBe(2);
  });

  it('fixed-weekly mode maps the weekday directly', () => {
    const s: TrainingState = { ...base, mode: 'fixed' };
    expect(sessionFor(s, '2026-08-03')).toBe('back'); // Monday
    expect(sessionFor(s, '2026-08-05')).toBe('rest'); // Wednesday
  });
});

describe('a session with nothing logged', () => {
  it('is not a session, however the empty row is shaped', () => {
    expect(hasLoggedSets({ exercises: [] })).toBe(false);
    // An exercise can be present with no sets under it — still nothing logged.
    expect(hasLoggedSets({ exercises: [{ name: 'Back squat', sets: [] }] })).toBe(false);
    expect(
      hasLoggedSets({ exercises: [{ name: 'Back squat', sets: [{ reps: 5, weight: 100 }] }] }),
    ).toBe(true);
  });
});

describe('pointer recomputed from history', () => {
  it('lands one past the most recent session, wherever that sits in the split', () => {
    expect(pointerFromHistory(SPLIT, [{ date: '2026-08-03', sessionType: 'back' }])).toBe(1);
    expect(pointerFromHistory(SPLIT, [{ date: '2026-08-03', sessionType: 'legs' }])).toBe(4);
    expect(pointerFromHistory(SPLIT, [{ date: '2026-08-03', sessionType: 'chest' }])).toBe(5);
  });

  it('reads the most recent by date, not by array order', () => {
    const out = pointerFromHistory(SPLIT, [
      { date: '2026-08-04', sessionType: 'shoulders' },
      { date: '2026-08-01', sessionType: 'chest' },
      { date: '2026-08-02', sessionType: 'back' },
    ]);
    expect(out).toBe(2); // shoulders is index 1 — one past it is 2
  });

  it('resets to the start of the split when no sessions remain', () => {
    expect(pointerFromHistory(SPLIT, [])).toBe(0);
  });

  it('declines to guess when the session type is no longer in the split', () => {
    // The split was edited and 'arms' dropped out. Returning null lets the
    // caller leave the pointer where it is rather than invent a position.
    expect(pointerFromHistory(SPLIT, [{ date: '2026-08-03', sessionType: 'arms' }])).toBeNull();
  });
});

describe('manual override', () => {
  it('jumps to the nearest occurrence of a session type, searching forward', () => {
    // From 'back' (0), the nearest 'rest' is index 2, not index 5.
    const s = overrideToSession(base, 'rest', '2026-08-03');
    expect(s.pointer).toBe(2);
  });

  it('wraps to find a session type behind the current pointer', () => {
    // From pointer 4 (chest), the nearest 'back' wraps around to index 0.
    const s = overrideToSession({ ...base, pointer: 4 }, 'back', '2026-08-03');
    expect(currentSlot(s)).toBe('back');
  });

  it('is a no-op for a session type not in the split', () => {
    const s = overrideToSession(base, 'arms', '2026-08-03');
    expect(s).toBe(base);
  });
});

describe('last time', () => {
  const workouts: Workout[] = [
    {
      date: '2026-08-01',
      sessionType: 'chest',
      exercises: [
        { name: 'Bench press', sets: [{ reps: 8, weight: 80 }, { reps: 8, weight: 80 }] },
      ],
    },
    {
      date: '2026-07-25',
      sessionType: 'chest',
      exercises: [
        { name: 'Bench press', sets: [{ reps: 6, weight: 80 }] },
        { name: 'Incline DB', sets: [{ reps: 10, weight: 26 }] },
      ],
    },
  ];

  it('returns the most recent sets per exercise for the session type', () => {
    const map = lastTimeFor(workouts, 'chest');
    expect(map.get('Bench press')?.date).toBe('2026-08-01');
    expect(map.get('Bench press')?.sets).toHaveLength(2);
    // An exercise skipped last session still shows its older numbers.
    expect(map.get('Incline DB')?.date).toBe('2026-07-25');
  });

  it('excludes the date being edited, so re-opening today does not show itself', () => {
    const map = lastTimeFor(workouts, 'chest', '2026-08-01');
    expect(map.get('Bench press')?.date).toBe('2026-07-25');
  });
});

describe('overload hint', () => {
  const bench = { name: 'Bench press', repRangeTop: 8, equipment: 'barbell' as const, restSec: 180 };

  it('suggests +2.5kg on a barbell when every set hit the top', () => {
    const hint = overloadHint(
      { name: 'Bench press', date: '2026-08-01', sets: [{ reps: 8, weight: 80 }, { reps: 8, weight: 80 }] },
      bench,
    );
    expect(hint?.weight).toBe(82.5);
  });

  it('stays quiet when any set fell short', () => {
    const hint = overloadHint(
      { name: 'Bench press', date: '2026-08-01', sets: [{ reps: 8, weight: 80 }, { reps: 6, weight: 80 }] },
      bench,
    );
    expect(hint).toBeNull();
  });

  it('never comments when the load or reps dropped from last time — a deficit makes that normal', () => {
    // Fewer reps than the range top, or a lighter weight than usual: silence
    // either way, never a warning.
    const dropped = overloadHint(
      { name: 'Bench press', date: '2026-08-01', sets: [{ reps: 5, weight: 75 }] },
      bench,
    );
    expect(dropped).toBeNull();
  });

  it('suggests the next dumbbell up, not +2.5', () => {
    const hint = overloadHint(
      { name: 'DB press', date: '2026-08-01', sets: [{ reps: 8, weight: 22.5 }] },
      { name: 'DB press', repRangeTop: 8, equipment: 'dumbbell', restSec: 150 },
    );
    expect(hint?.weight).toBe(25);
  });

  it('names the pin, not an invented number, for cable/machine work', () => {
    const hint = overloadHint(
      { name: 'Lat pulldown', date: '2026-08-01', sets: [{ reps: 12, weight: 50 }] },
      { name: 'Lat pulldown', repRangeTop: 12, equipment: 'machine', restSec: 120 },
    );
    expect(hint?.weight).toBeNull();
    expect(hint?.text).toContain('pin');
  });

  it('suggests reps, not load, for ordinary bodyweight work', () => {
    const hint = overloadHint(
      { name: 'Dips', date: '2026-08-01', sets: [{ reps: 10, weight: 0 }] },
      { name: 'Dips', repRangeTop: 10, equipment: 'bodyweight', restSec: 120 },
    );
    expect(hint?.text).toContain('11 reps');
  });

  it('suggests adding weight for pull-ups once the rep ceiling clears on every set', () => {
    const hint = overloadHint(
      {
        name: 'Pull-ups',
        date: '2026-08-01',
        sets: [
          { reps: 12, weight: 0 },
          { reps: 12, weight: 0 },
          { reps: 12, weight: 0 },
          { reps: 12, weight: 0 },
        ],
      },
      { name: 'Pull-ups', repRangeTop: 12, equipment: 'bodyweight', restSec: 180, progressToWeighted: true },
    );
    expect(hint?.text).toContain('adding weight');
  });

  it('stays quiet on pull-ups below the 12-rep ceiling', () => {
    const hint = overloadHint(
      { name: 'Pull-ups', date: '2026-08-01', sets: [{ reps: 9, weight: 0 }] },
      { name: 'Pull-ups', repRangeTop: 12, equipment: 'bodyweight', restSec: 180, progressToWeighted: true },
    );
    expect(hint).toBeNull();
  });
});
