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

  /** Start a session and log one real set into it. A session with nothing
   * logged is discarded on finish, so anything asserting on the pointer has
   * to put actual work in first. */
  async function startWithASet(date: string, sessionType: string): Promise<number> {
    const id = await config.startTrainingSession(date, sessionType);
    await config.updateWorkout(id, [{ name: 'Something', sets: [{ reps: 8, weight: 60 }] }]);
    return id;
  }

  it('finishing one session advances the pointer by exactly one position', async () => {
    await config.saveTrainingState({ ...config.DEFAULT_TRAINING_STATE, split: SPLIT, pointer: 0 });
    const id = await startWithASet(TODAY, 'back');
    const record = await config.finishTrainingSession(id, TODAY);
    const state = await config.getTrainingState();
    expect(state.pointer).toBe(1);
    expect(SPLIT[state.pointer % SPLIT.length]).toBe('shoulders');
    expect(record?.sessionType).toBe('back');
  });

  it('a concurrent day-boundary check cannot compound with a finish into more than one advance', async () => {
    // This is the exact race the bug report implied: a background
    // "let rest days pass" check firing at the same moment as a user
    // tapping "Finish session". Both are queued through the same serial
    // chain now, so no interleaving can move the pointer by more than the
    // one step "Finish" is entitled to.
    await config.saveTrainingState({ ...config.DEFAULT_TRAINING_STATE, split: SPLIT, pointer: 0 });
    const id = await startWithASet(TODAY, 'back');

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
        const id = await startWithASet(TODAY, passed);
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
    expect(reopened?.id).toBe(record?.workoutId); // same row, not a duplicate
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

    expect(second?.workoutId).toBe(first?.workoutId);
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
    const id = await startWithASet(TODAY, 'back');
    const record = await config.finishTrainingSession(id, TODAY);
    await config.deleteWorkout(record!.workoutId);
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

  // ── Reported bug 1: opening the log screen registered a session ────────
  //
  // Three phantom sessions reached real data this way — an empty legs
  // session, an empty chest session logged while demoing the app, and an
  // empty back session. Each one burned a slot in the queue.

  it('finishing with nothing logged discards the session and leaves the pointer alone', async () => {
    await config.saveTrainingState({ ...config.DEFAULT_TRAINING_STATE, split: SPLIT, pointer: 0 });
    const id = await config.startTrainingSession(TODAY, 'back');

    const record = await config.finishTrainingSession(id, TODAY);

    expect(record).toBeNull();
    const state = await config.getTrainingState();
    expect(state.pointer).toBe(0); // still 'back' — nothing happened
    const schema = await import('./schema');
    expect(await schema.db.workouts.get(id)).toBeUndefined(); // row discarded
    expect(await config.getLastFinish()).toBeUndefined(); // nothing to undo
  });

  it('a discarded empty session leaves no trace in history', async () => {
    await config.saveTrainingState({ ...config.DEFAULT_TRAINING_STATE, split: SPLIT, pointer: 0 });
    const schema = await import('./schema');

    // Open-and-close three times over, as happened for real.
    for (const [date, type] of [
      ['2026-07-31', 'legs'],
      ['2026-08-03', 'chest'],
      ['2026-08-04', 'back'],
    ] as const) {
      const id = await config.startTrainingSession(date, type);
      await config.finishTrainingSession(id, date);
    }

    expect(await schema.db.workouts.count()).toBe(0);
    expect((await config.getTrainingState()).pointer).toBe(0);
  });

  it('an exercise carrying no sets still counts as nothing logged', async () => {
    await config.saveTrainingState({ ...config.DEFAULT_TRAINING_STATE, split: SPLIT, pointer: 0 });
    const id = await config.startTrainingSession(TODAY, 'back');
    await config.updateWorkout(id, [{ name: 'Pull-ups', sets: [] }]);

    expect(await config.finishTrainingSession(id, TODAY)).toBeNull();
    expect((await config.getTrainingState()).pointer).toBe(0);
  });

  it('cleans up sessions already stored empty, and puts the pointer back', async () => {
    const schema = await import('./schema');
    // A real session, then two phantoms that pushed the pointer past it.
    await schema.db.workouts.add({
      date: '2026-07-30',
      sessionType: 'back',
      exercises: [{ name: 'Pull-ups', sets: [{ reps: 8, weight: 0 }] }],
      status: 'complete',
    });
    await schema.db.workouts.add({
      date: '2026-07-31', sessionType: 'legs', exercises: [], status: 'complete',
    });
    await schema.db.workouts.add({
      date: '2026-08-03', sessionType: 'chest', exercises: [], status: 'complete',
    });
    await config.saveTrainingState({ ...config.DEFAULT_TRAINING_STATE, split: SPLIT, pointer: 5 });

    const removed = await config.cleanupEmptySessions();

    expect(removed).toBe(2);
    expect(await schema.db.workouts.count()).toBe(1); // only the real one left
    // 'back' is index 0, so the queue is back to 'shoulders' — where it
    // stood before the phantoms pushed it along.
    const state = await config.getTrainingState();
    expect(state.pointer).toBe(1);
    expect(SPLIT[state.pointer % SPLIT.length]).toBe('shoulders');
  });

  it('the cleanup is a no-op once there is nothing empty left', async () => {
    await config.saveTrainingState({ ...config.DEFAULT_TRAINING_STATE, split: SPLIT, pointer: 0 });
    const id = await startWithASet(TODAY, 'back');
    await config.finishTrainingSession(id, TODAY);
    const before = await config.getTrainingState();

    expect(await config.cleanupEmptySessions()).toBe(0);
    expect(await config.getTrainingState()).toEqual(before); // pointer untouched
  });

  // ── Reported bug 2: the session switcher did nothing ───────────────────

  it('switching session works for every type, including one already trained today', async () => {
    await config.saveTrainingState({ ...config.DEFAULT_TRAINING_STATE, split: SPLIT, pointer: 0 });
    // Train chest today and finish it — the old UI then greyed chest out.
    const done = await startWithASet(TODAY, 'chest');
    await config.finishTrainingSession(done, TODAY);

    await config.switchSession('chest', TODAY);

    const state = await config.getTrainingState();
    expect(SPLIT[state.pointer % SPLIT.length]).toBe('chest');
  });

  it('switching retargets the open session so the screen actually changes', async () => {
    await config.saveTrainingState({ ...config.DEFAULT_TRAINING_STATE, split: SPLIT, pointer: 0 });
    const id = await startWithASet(TODAY, 'back');

    await config.switchSession('legs', TODAY);

    // The row the log screen reads its title from now says legs — moving
    // only the pointer used to leave it stuck on 'back'.
    const open = await config.getTodaysInProgressWorkout(TODAY);
    expect(open?.id).toBe(id);
    expect(open?.sessionType).toBe('legs');
    expect(open?.exercises[0]?.sets).toHaveLength(1); // logged work kept
    expect(SPLIT[(await config.getTrainingState()).pointer % SPLIT.length]).toBe('legs');
  });

  it('switching away from an untouched session discards its row rather than relabelling it', async () => {
    await config.saveTrainingState({ ...config.DEFAULT_TRAINING_STATE, split: SPLIT, pointer: 0 });
    const id = await config.startTrainingSession(TODAY, 'back');

    await config.switchSession('legs', TODAY);

    const schema = await import('./schema');
    expect(await schema.db.workouts.get(id)).toBeUndefined();
    expect(await config.getTodaysInProgressWorkout(TODAY)).toBeUndefined();
  });

  // ── Reported bug 3: deleting a session left the pointer advanced ───────

  it('deleting the most recent session rolls the pointer back to before it', async () => {
    await config.saveTrainingState({ ...config.DEFAULT_TRAINING_STATE, split: SPLIT, pointer: 0 });
    const backId = await startWithASet('2026-08-01', 'back');
    await config.finishTrainingSession(backId, '2026-08-01');
    const shouldersId = await startWithASet('2026-08-02', 'shoulders');
    await config.finishTrainingSession(shouldersId, '2026-08-02');
    expect((await config.getTrainingState()).pointer).toBe(2);

    await config.deleteWorkout(shouldersId);

    // Back to one past 'back' — exactly where it stood before shoulders.
    const state = await config.getTrainingState();
    expect(state.pointer).toBe(1);
    expect(SPLIT[state.pointer % SPLIT.length]).toBe('shoulders');
  });

  it('deleting the only session resets the pointer to the start of the split', async () => {
    await config.saveTrainingState({ ...config.DEFAULT_TRAINING_STATE, split: SPLIT, pointer: 0 });
    const id = await startWithASet(TODAY, 'back');
    await config.finishTrainingSession(id, TODAY);

    await config.deleteWorkout(id);

    expect((await config.getTrainingState()).pointer).toBe(0);
  });

  it('deleting an OLDER session leaves the pointer alone', async () => {
    await config.saveTrainingState({ ...config.DEFAULT_TRAINING_STATE, split: SPLIT, pointer: 0 });
    const backId = await startWithASet('2026-08-01', 'back');
    await config.finishTrainingSession(backId, '2026-08-01');
    const shouldersId = await startWithASet('2026-08-02', 'shoulders');
    await config.finishTrainingSession(shouldersId, '2026-08-02');

    await config.deleteWorkout(backId);

    // Shoulders is still the most recent session, so the queue's position
    // is unchanged — and rest days passed since must not be undone.
    expect((await config.getTrainingState()).pointer).toBe(2);
  });

  // ── Session timing ─────────────────────────────────────────────────────

  it('the clock starts at the first logged set, not when the row was created', async () => {
    const schema = await import('./schema');
    const id = await config.startTrainingSession(TODAY, 'back');
    // Row exists, nothing logged: no timing yet, because nothing happened.
    expect((await schema.db.workouts.get(id))?.startedAt).toBeUndefined();

    const first = Date.UTC(2026, 7, 4, 18, 0);
    await config.updateWorkout(id, [{ name: 'Bench', sets: [{ reps: 8, weight: 80 }] }], first);
    const started = await schema.db.workouts.get(id);
    expect(started?.startedAt).toBe(first);
    expect(started?.lastSetAt).toBe(first);
  });

  it('every later set moves lastSetAt but never rewrites the start', async () => {
    const schema = await import('./schema');
    const id = await config.startTrainingSession(TODAY, 'back');
    const first = Date.UTC(2026, 7, 4, 18, 0);
    const later = Date.UTC(2026, 7, 4, 18, 40);
    await config.updateWorkout(id, [{ name: 'Bench', sets: [{ reps: 8, weight: 80 }] }], first);
    await config.updateWorkout(
      id,
      [{ name: 'Bench', sets: [{ reps: 8, weight: 80 }, { reps: 8, weight: 80 }] }],
      later,
    );

    const w = await schema.db.workouts.get(id);
    expect(w?.startedAt).toBe(first);
    expect(w?.lastSetAt).toBe(later);
  });

  it('finishing stores endedAt and a duration that agrees with it', async () => {
    const schema = await import('./schema');
    await config.saveTrainingState({ ...config.DEFAULT_TRAINING_STATE, split: SPLIT, pointer: 0 });
    const id = await config.startTrainingSession(TODAY, 'back');
    const start = Date.UTC(2026, 7, 4, 18, 0);
    const end = Date.UTC(2026, 7, 4, 19, 15);
    await config.updateWorkout(id, [{ name: 'Bench', sets: [{ reps: 8, weight: 80 }] }], start);

    await config.finishTrainingSession(id, TODAY, end);

    const w = await schema.db.workouts.get(id);
    expect(w?.endedAt).toBe(end);
    expect(w?.durationMs).toBe(75 * 60_000);
    expect(w?.durationMs).toBe((w?.endedAt as number) - (w?.startedAt as number));
  });

  it('a session finished at its last set records that, not the fourteen-hour gap', async () => {
    const schema = await import('./schema');
    await config.saveTrainingState({ ...config.DEFAULT_TRAINING_STATE, split: SPLIT, pointer: 0 });
    const id = await config.startTrainingSession(TODAY, 'back');
    const start = Date.UTC(2026, 7, 3, 18, 0);
    const lastSet = Date.UTC(2026, 7, 3, 19, 10);
    await config.updateWorkout(id, [{ name: 'Bench', sets: [{ reps: 8, weight: 80 }] }], start);
    await config.updateWorkout(
      id,
      [{ name: 'Bench', sets: [{ reps: 8, weight: 80 }, { reps: 6, weight: 85 }] }],
      lastSet,
    );

    // Noticed the next morning. Closed at the last set instead of now.
    await config.finishTrainingSession(id, TODAY, lastSet);

    const w = await schema.db.workouts.get(id);
    expect(w?.durationMs).toBe(70 * 60_000);
  });

  it('retiming a session keeps the stored duration in step', async () => {
    const schema = await import('./schema');
    const id = await config.startTrainingSession(TODAY, 'back');
    const start = Date.UTC(2026, 7, 4, 18, 0);
    await config.updateWorkout(id, [{ name: 'Bench', sets: [{ reps: 8, weight: 80 }] }], start);
    await config.finishTrainingSession(id, TODAY, Date.UTC(2026, 7, 4, 19, 0));

    // The auto-detected end was wrong; correct it.
    await config.retimeWorkout(id, { endedAt: Date.UTC(2026, 7, 4, 18, 40) });

    const w = await schema.db.workouts.get(id);
    expect(w?.durationMs).toBe(40 * 60_000);
    expect(w?.startedAt).toBe(start); // untouched
  });

  // ── Rest alarm settings ────────────────────────────────────────────────

  it('every alarm channel is on by default, and the prompt has not been asked', async () => {
    const s = await config.getAlarmSettings();
    expect(s.sound).toBe(true);
    expect(s.vibration).toBe(true);
    expect(s.notifications).toBe(true);
    expect(s.tone).toBe('bell');
    // Nothing has been asked yet — the permission prompt waits for the first
    // rest timer rather than firing on launch.
    expect(s.askedToNotify).toBe(false);
  });

  it('a partially stored alarm setting merges over the defaults', async () => {
    // Written by an older build that had no tone picker: the missing keys
    // must fill in rather than coming back undefined.
    const schema = await import('./schema');
    await schema.db.config.put({ key: 'alarmSettings', value: { sound: false } });

    const s = await config.getAlarmSettings();
    expect(s.sound).toBe(false);
    expect(s.vibration).toBe(true);
    expect(s.tone).toBe('bell');
  });

  it('alarm settings round-trip', async () => {
    await config.saveAlarmSettings({
      ...config.DEFAULT_ALARM_SETTINGS,
      sound: false,
      tone: 'beeps',
      askedToNotify: true,
    });
    const s = await config.getAlarmSettings();
    expect(s).toEqual({
      sound: false,
      vibration: true,
      notifications: true,
      tone: 'beeps',
      askedToNotify: true,
    });
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
