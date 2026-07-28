import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * DB-level regression coverage for the training pointer bug.
 *
 * The reported symptom — finishing 'back' landing on 'chest' instead of
 * 'shoulders' — could not be reproduced from the pure domain arithmetic
 * (advanceAfterSession and passRestDays both check out on every starting
 * position; see training.test.ts). The defensible fix is structural: every
 * training-state write now goes through one serialized queue in this file,
 * reading fresh from storage at write time rather than trusting a
 * possibly-stale render-time snapshot. These tests exercise that queue
 * directly against a real (in-memory) IndexedDB, including the exact class
 * of race a background day-boundary check could cause if it landed while a
 * "Finish session" tap was in flight.
 */

const SPLIT = ['back', 'shoulders', 'rest', 'legs', 'chest', 'rest'];
const TODAY = '2026-08-03'; // a Monday

describe('training state: serialized writes', () => {
  let config: typeof import('./config');

  // config.ts writes through the shared Dexie singleton in schema.ts, so
  // each test wipes and reopens that same database rather than creating a
  // separate instance — a separate instance wouldn't be the one config.ts
  // is actually talking to.
  beforeEach(async () => {
    const schema = await import('./schema');
    await schema.db.delete();
    await schema.db.open();
    config = await import('./config');
  });

  it('finishing one session advances the pointer by exactly one position', async () => {
    await config.saveTrainingState({ ...config.DEFAULT_TRAINING_STATE, split: SPLIT, pointer: 0 });
    const record = await config.finishTrainingSession(TODAY, 'back', []);
    const state = await config.getTrainingState();
    expect(state.pointer).toBe(1);
    expect(SPLIT[state.pointer % SPLIT.length]).toBe('shoulders');
    expect(record.sessionType).toBe('back');
  });

  it('a concurrent day-boundary check cannot compound with a finish into more than one advance', async () => {
    // This is the exact race the bug report implied: a background
    // "let rest days pass" check firing at the same moment as a user
    // tapping "Finish session". Both are queued through the same serial
    // chain now, so no interleaving can move the pointer by more than the
    // one step "Finish" is entitled to.
    await config.saveTrainingState({ ...config.DEFAULT_TRAINING_STATE, split: SPLIT, pointer: 0 });

    await Promise.all([
      config.autoPassRestDays(TODAY),
      config.finishTrainingSession(TODAY, 'back', []),
      config.autoPassRestDays(TODAY),
    ]);

    const state = await config.getTrainingState();
    expect(state.pointer).toBe(1);
    expect(SPLIT[state.pointer % SPLIT.length]).toBe('shoulders');
  });

  it('finishing every session in sequence walks the split exactly once each, wrapping at the end', async () => {
    await config.saveTrainingState({ ...config.DEFAULT_TRAINING_STATE, split: SPLIT, pointer: 0 });
    const seen: string[] = [];
    for (let i = 0; i < SPLIT.length + 2; i++) {
      const state = await config.getTrainingState();
      const passed = SPLIT[state.pointer % SPLIT.length] as string;
      seen.push(passed);
      if (passed === 'rest') {
        await config.skipRestDay(TODAY);
      } else {
        await config.finishTrainingSession(TODAY, passed, []);
      }
    }
    // back, shoulders, rest, legs, chest, rest, back, shoulders — one full
    // lap plus two, never a skip.
    expect(seen).toEqual([
      'back', 'shoulders', 'rest', 'legs', 'chest', 'rest', 'back', 'shoulders',
    ]);
  });

  it('undo restores the exact prior pointer and re-opening finds the same workout row', async () => {
    await config.saveTrainingState({ ...config.DEFAULT_TRAINING_STATE, split: SPLIT, pointer: 0 });
    const record = await config.finishTrainingSession(TODAY, 'back', [
      { name: 'Pull-ups', sets: [{ reps: 8, weight: 0 }] },
    ]);

    await config.undoLastFinish();

    const state = await config.getTrainingState();
    expect(state.pointer).toBe(0); // back to where it was before finishing

    const reopened = await config.getWorkoutFor(TODAY, 'back');
    expect(reopened?.id).toBe(record.workoutId); // same row, not a duplicate
    expect(reopened?.exercises[0]?.sets).toHaveLength(1);

    // Nothing left to undo once it's been undone.
    expect(await config.getLastFinish()).toBeUndefined();
  });

  it('re-finishing after undo updates the same row instead of creating a second one', async () => {
    await config.saveTrainingState({ ...config.DEFAULT_TRAINING_STATE, split: SPLIT, pointer: 0 });
    const first = await config.finishTrainingSession(TODAY, 'back', [
      { name: 'Pull-ups', sets: [{ reps: 8, weight: 0 }] },
    ]);
    await config.undoLastFinish();
    const second = await config.finishTrainingSession(TODAY, 'back', [
      { name: 'Pull-ups', sets: [{ reps: 8, weight: 0 }, { reps: 7, weight: 0 }] },
    ]);

    expect(second.workoutId).toBe(first.workoutId);
    const schema = await import('./schema');
    const rows = await schema.db.workouts.where({ date: TODAY, sessionType: 'back' }).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.exercises[0]?.sets).toHaveLength(2);

    const state = await config.getTrainingState();
    expect(state.pointer).toBe(1); // advanced exactly once overall
  });

  it('manual override jumps to the nearest occurrence without disturbing earlier weeks', async () => {
    await config.saveTrainingState({ ...config.DEFAULT_TRAINING_STATE, split: SPLIT, pointer: 0 });
    await config.overrideNextSession('chest', TODAY);
    const state = await config.getTrainingState();
    expect(SPLIT[state.pointer % SPLIT.length]).toBe('chest');
  });

  it('deleting a workout clears the undo banner only when it was the one just finished', async () => {
    await config.saveTrainingState({ ...config.DEFAULT_TRAINING_STATE, split: SPLIT, pointer: 0 });
    const record = await config.finishTrainingSession(TODAY, 'back', []);
    await config.deleteWorkout(record.workoutId);
    expect(await config.getLastFinish()).toBeUndefined();
  });

  it('legs stays locked even if a save is attempted against it', async () => {
    await config.saveExercisePlans({
      ...config.DEFAULT_EXERCISE_PLANS,
      legs: [{ name: 'Leg extension', repRangeTop: 12, equipment: 'machine', restSec: 90 }],
    });
    const plans = await config.getExercisePlans();
    expect(plans.legs).toEqual(config.DEFAULT_EXERCISE_PLANS.legs);
  });
});
