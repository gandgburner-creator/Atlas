import { describe, expect, it } from 'vitest';
import { DEFAULT_TRAINING_STATE, type TrainingState } from '../db/config';
import {
  advanceAfterSession,
  currentSlot,
  lastTimeFor,
  overloadHint,
  passRestDays,
  sessionFor,
} from './training';
import type { Workout } from '../db/schema';

const base: TrainingState = { ...DEFAULT_TRAINING_STATE };
// split: ['back','shoulders','rest','legs','chest','rest']

describe('the queue', () => {
  it('advances only on a completed session', () => {
    expect(currentSlot(base)).toBe('back');
    const after = advanceAfterSession(base, '2026-08-03');
    expect(currentSlot(after)).toBe('shoulders');
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
});

describe('overload hint', () => {
  const bench = { name: 'Bench press', repRangeTop: 8, equipment: 'barbell' as const };

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

  it('suggests the next dumbbell up, not +2.5', () => {
    const hint = overloadHint(
      { name: 'DB press', date: '2026-08-01', sets: [{ reps: 8, weight: 22.5 }] },
      { name: 'DB press', repRangeTop: 8, equipment: 'dumbbell' },
    );
    expect(hint?.weight).toBe(25);
  });

  it('suggests reps, not load, for bodyweight work', () => {
    const hint = overloadHint(
      { name: 'Pull-ups', date: '2026-08-01', sets: [{ reps: 10, weight: 0 }] },
      { name: 'Pull-ups', repRangeTop: 10, equipment: 'bodyweight' },
    );
    expect(hint?.text).toContain('11 reps');
  });
});
