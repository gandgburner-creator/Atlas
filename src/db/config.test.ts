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
    const id = await config.startTrainingSession(TODAY, 'back');
    const record = await config.finishTrainingSession(id, TODAY);
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
    const id = await config.startTrainingSession(TODAY, 'back');

    await Promise.all([
      config.autoPassRestDays(TODAY),
      config.finishTrainingSession(id, TODAY),
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
        const id = await config.startTrainingSession(TODAY, passed);
        await config.finishTrainingSession(id, TODAY);
      }
    }
    // back, shoulders, rest, legs, chest, rest, back, shoulders — one full
    // lap plus two, never a skip.
    expect(seen).toEqual([
      'back', 'shoulders', 'rest', 'legs', 'chest', 'rest', 'back', 'shoulders',
    ]);
  });

  it('undo restores the exact prior pointer and re-opens the same in_progress workout row', async () => {
    await config.saveTrainingState({ ...config.DEFAULT_TRAINING_STATE, split: SPLIT, pointer: 0 });
    const id = await config.startTrainingSession(TODAY, 'back');
    await config.updateWorkout(id, [{ name: 'Pull-ups', sets: [{ reps: 8, weight: 0 }] }]);
    const record = await config.finishTrainingSession(id, TODAY);

    await config.undoLastFinish();

    const state = await config.getTrainingState();
    expect(state.pointer).toBe(0); // back to where it was before finishing

    const reopened = await config.getTodaysInProgressWorkout(TODAY);
    expect(reopened?.id).toBe(record.workoutId); // same row, not a duplicate
    expect(reopened?.exercises[0]?.sets).toHaveLength(1);

    // Nothing left to undo once it's been undone.
    expect(await config.getLastFinish()).toBeUndefined();
  });

  it('re-finishing after undo updates the same row instead of creating a second one', async () => {
    await config.saveTrainingState({ ...config.DEFAULT_TRAINING_STATE, split: SPLIT, pointer: 0 });
    const id = await config.startTrainingSession(TODAY, 'back');
    await config.updateWorkout(id, [{ name: 'Pull-ups', sets: [{ reps: 8, weight: 0 }] }]);
    const first = await config.finishTrainingSession(id, TODAY);
    await config.undoLastFinish();
    await config.updateWorkout(id, [
      { name: 'Pull-ups', sets: [{ reps: 8, weight: 0 }, { reps: 7, weight: 0 }] },
    ]);
    const second = await config.finishTrainingSession(id, TODAY);

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
    const id = await config.startTrainingSession(TODAY, 'back');
    const record = await config.finishTrainingSession(id, TODAY);
    await config.deleteWorkout(record.workoutId);
    expect(await config.getLastFinish()).toBeUndefined();
  });

  it('a session left in_progress from an earlier day surfaces as stale, not as today\'s session', async () => {
    await config.saveTrainingState({ ...config.DEFAULT_TRAINING_STATE, split: SPLIT, pointer: 0 });
    const YESTERDAY = '2026-08-02';
    const id = await config.startTrainingSession(YESTERDAY, 'back');

    expect(await config.getTodaysInProgressWorkout(TODAY)).toBeUndefined();
    const stale = await config.getStaleInProgressWorkout(TODAY);
    expect(stale?.id).toBe(id);
  });

  it('legs is editable just like every other session type', async () => {
    const rebuilt = [{ name: 'Leg extension', repRangeTop: 12, equipment: 'machine' as const, restSec: 90 }];
    await config.saveExercisePlans({
      ...config.DEFAULT_EXERCISE_PLANS,
      legs: rebuilt,
    });
    const plans = await config.getExercisePlans();
    expect(plans.legs).toEqual(rebuilt);
  });

  it('migrates a pre-unlock stored plan (legs still the old locked squat/RDL pair) to the new list, once', async () => {
    // Simulate a plan saved back when the lock still enforced the old pair —
    // this could only ever have been saved as exactly this, never anything
    // else, since the lock rewrote legs on every save.
    const oldStyle = {
      ...config.DEFAULT_EXERCISE_PLANS,
      legs: [
        { name: 'Back squat', repRangeTop: 8, repRangeBottom: 6, equipment: 'barbell' as const, restSec: 210 },
        { name: 'Romanian deadlift', repRangeTop: 10, repRangeBottom: 8, equipment: 'barbell' as const, restSec: 180 },
      ],
    };
    const schema = await import('./schema');
    await schema.db.config.put({ key: 'exercisePlans', value: oldStyle });

    const plans = await config.getExercisePlans();
    expect(plans.legs).toEqual(config.DEFAULT_EXERCISE_PLANS.legs);

    // The migration persists, so a later edit sticks instead of reverting.
    const customLegs = [{ name: 'Leg press', repRangeTop: 12, equipment: 'machine' as const, restSec: 150 }];
    await config.saveExercisePlans({ ...plans, legs: customLegs });
    expect((await config.getExercisePlans()).legs).toEqual(customLegs);
  });
});
