import { describe, expect, it } from 'vitest';
import { draftFromExercises, shouldAdoptRow } from './draft';

describe('draft from a stored row', () => {
  it('keeps the sets that were logged', () => {
    expect(
      draftFromExercises([{ name: 'Barbell row', sets: [{ reps: 8, weight: 60 }] }]),
    ).toEqual({ 'Barbell row': [{ reps: 8, weight: 60 }] });
  });

  it('gives an exercise with no sets one empty slot to tap', () => {
    expect(draftFromExercises([{ name: 'Barbell row', sets: [] }])).toEqual({
      'Barbell row': [null],
    });
  });
});

describe('adopting the stored row', () => {
  it('adopts a session being resumed', () => {
    expect(shouldAdoptRow(7, null, false)).toBe(true);
  });

  it('never adopts a row this screen just created', () => {
    // The row is empty by construction and the first set is still in
    // flight. Adopting here wipes it, and the next exercise logged saves
    // the emptied draft over the top — losing the first exercise entirely.
    expect(shouldAdoptRow(7, null, true)).toBe(false);
  });

  it('does not re-adopt a row it already adopted', () => {
    // Every write re-runs the live query; re-adopting each time would
    // clobber a set being edited mid-tap.
    expect(shouldAdoptRow(7, 7, false)).toBe(false);
  });

  it('adopts a different row after switching session', () => {
    expect(shouldAdoptRow(8, 7, false)).toBe(true);
  });

  it('has nothing to adopt when no session is open', () => {
    expect(shouldAdoptRow(undefined, null, false)).toBe(false);
  });
});
