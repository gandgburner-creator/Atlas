import { db, type Workout, type WorkoutExercise } from './schema';
import { DEFAULT_RAMP, type RampConfig } from '../domain/ramp';
import {
  DEFAULT_MODULE_FLAGS,
  type CommitmentOverrides,
  type ModuleFlags,
} from '../domain/commitments';
import {
  advanceAfterSession,
  overrideToSession,
  passRestDays,
} from '../domain/training';

/**
 * Typed doors onto the config KV table. Everything the user can change
 * without editing code lives here — that is the point of the app.
 */

async function get<T>(key: string): Promise<T | undefined> {
  const row = await db.config.get(key);
  return row?.value as T | undefined;
}

async function set<T>(key: string, value: T): Promise<void> {
  await db.config.put({ key, value });
}

// ── Sleep ramp (slice 1 — untouched) ──────────────────────────────────────

export async function getRamp(): Promise<RampConfig | undefined> {
  const stored = await get<Partial<RampConfig>>('ramp');
  if (!stored?.startDate) return undefined;
  // Merge over defaults so a ramp written by an older build still loads.
  return {
    startDate: stored.startDate,
    baselineWake: stored.baselineWake ?? DEFAULT_RAMP.baselineWake,
    steps: stored.steps ?? DEFAULT_RAMP.steps,
    repeats: stored.repeats ?? [],
  };
}

export async function saveRamp(ramp: RampConfig): Promise<void> {
  await set('ramp', ramp);
}

/** First run: record the start date and seed the default six-week ramp. */
export async function initRamp(startDate: string): Promise<RampConfig> {
  const ramp: RampConfig = { ...DEFAULT_RAMP, startDate };
  await saveRamp(ramp);
  return ramp;
}

// ── First run ─────────────────────────────────────────────────────────────

/**
 * Whether the intro has been shown. Anyone who already has a ramp is treated
 * as having seen it — an existing user must never be handed a tutorial for an
 * app they've been using for weeks.
 */
export async function getTutorialSeen(): Promise<boolean> {
  if (await get<boolean>('tutorialSeen')) return true;
  return Boolean(await get<unknown>('ramp'));
}

export function setTutorialSeen(seen: boolean): Promise<void> {
  return set('tutorialSeen', seen);
}

// ── Commitments ───────────────────────────────────────────────────────────

export function getCommitmentOverrides(): Promise<CommitmentOverrides | undefined> {
  return get<CommitmentOverrides>('commitmentOverrides');
}

export function saveCommitmentOverrides(o: CommitmentOverrides): Promise<void> {
  return set('commitmentOverrides', o);
}

// Rapid taps on the settings steppers issue overlapping read-modify-writes;
// chaining them keeps every tap's increment instead of the last read winning.
let overrideQueue: Promise<unknown> = Promise.resolve();

export function updateCommitmentOverride(
  id: string,
  patch: (current: { week?: number; disabled?: boolean }) => {
    week?: number;
    disabled?: boolean;
  },
): Promise<void> {
  const run = overrideQueue.then(async () => {
    const stored = (await getCommitmentOverrides()) ?? {};
    const cur = stored[id as keyof CommitmentOverrides] ?? {};
    await saveCommitmentOverrides({
      ...stored,
      [id]: { ...cur, ...patch(cur) },
    });
  });
  overrideQueue = run.catch(() => undefined);
  return run;
}

// ── Module flags ──────────────────────────────────────────────────────────

/**
 * Work, craft, life, photos, insight and the weekly letter — all off by
 * default. Flipping one back on is instant and touches no other state: the
 * module's own data, ramp week, and overrides were never deleted, only
 * excluded while off.
 */
export async function getModuleFlags(): Promise<ModuleFlags> {
  const stored = await get<Partial<ModuleFlags>>('moduleFlags');
  return { ...DEFAULT_MODULE_FLAGS, ...stored };
}

export function saveModuleFlags(flags: ModuleFlags): Promise<void> {
  return set('moduleFlags', flags);
}

// ── Training ──────────────────────────────────────────────────────────────

export interface TrainingPause {
  since: string; // ISODate
  reason?: string;
}

export interface TrainingState {
  /** The split as a queue. Editable in settings. */
  split: string[];
  /** Index into split of the NEXT session. */
  pointer: number;
  /** 'queue' (default) or 'fixed' weekly mapping. */
  mode: 'queue' | 'fixed';
  /** Last date a rest slot was allowed to pass. */
  lastRestPass?: string;
  /** Sick / injured / travelling. Freezes the queue entirely. */
  pause?: TrainingPause | null;
}

export const DEFAULT_TRAINING_STATE: TrainingState = {
  split: ['back', 'shoulders', 'rest', 'legs', 'chest', 'rest'],
  pointer: 0,
  mode: 'queue',
  pause: null,
};

export async function getTrainingState(): Promise<TrainingState> {
  const s = await get<Partial<TrainingState>>('trainingState');
  return { ...DEFAULT_TRAINING_STATE, ...s };
}

export function saveTrainingState(s: TrainingState): Promise<void> {
  return set('trainingState', s);
}

/** Exercise definitions per session type, set on first use of each. */
export interface ExerciseDef {
  name: string;
  /** Rep range top used for the overload hint — and for "max reps" work
   * (pull-ups), the clear-it-and-add-weight threshold. */
  repRangeTop: number;
  /** Bottom of the target range, display only — e.g. "10-12 reps". */
  repRangeBottom?: number;
  /** Decides the increment hint: barbell +2.5kg, dumbbell next size up,
   * machine "next pin" (no invented number — pin spacing varies by gym). */
  equipment: 'barbell' | 'dumbbell' | 'bodyweight' | 'machine';
  /** First-ever tap pre-fills these, before any history exists. */
  seedWeight?: number;
  seedReps?: number;
  /** Default rest after a set of THIS exercise, seconds. Auto-starts the
   * timer — heavy compounds need 3+ minutes for phosphocreatine recovery,
   * isolation work recovers in 60-90s and longer just wastes gym time. */
  restSec: number;
  /** Bodyweight exercises normally progress by adding a rep. A few (pull-ups)
   * progress by adding load once the rep ceiling is cleared instead. */
  progressToWeighted?: boolean;
  /** How many blank sets a fresh session starts with. Defaults to 4. */
  sets?: number;
}

export type ExercisePlans = Record<string, ExerciseDef[]>;

/** The full four-day program. Every session type — legs included — is
 * equally editable: add, rename, reorder, remove. */
export const DEFAULT_EXERCISE_PLANS: ExercisePlans = {
  back: [
    { name: 'Pull-ups', repRangeTop: 8, equipment: 'bodyweight', seedReps: 8, restSec: 180, progressToWeighted: true },
    { name: 'Barbell row', repRangeTop: 8, equipment: 'barbell', restSec: 180 },
    { name: 'Lat pulldown', repRangeTop: 12, repRangeBottom: 10, equipment: 'machine', restSec: 120 },
    { name: 'Chest-supported row', repRangeTop: 12, repRangeBottom: 10, equipment: 'machine', restSec: 120 },
    { name: 'Barbell curl', repRangeTop: 10, equipment: 'barbell', restSec: 90 },
  ],
  shoulders: [
    { name: 'DB shoulder press', repRangeTop: 8, equipment: 'dumbbell', seedWeight: 22.5, seedReps: 8, restSec: 150 },
    { name: 'Lateral raise', repRangeTop: 15, repRangeBottom: 12, equipment: 'dumbbell', restSec: 75 },
    { name: 'Face pull', repRangeTop: 15, equipment: 'machine', restSec: 75 },
    { name: 'Cable lateral raise', repRangeTop: 15, repRangeBottom: 12, equipment: 'machine', restSec: 60 },
    { name: 'Shrugs', repRangeTop: 12, equipment: 'barbell', restSec: 90 },
  ],
  legs: [
    { name: 'Leg press', repRangeTop: 12, repRangeBottom: 8, equipment: 'machine', restSec: 180, sets: 4 },
    { name: 'Romanian deadlift', repRangeTop: 10, repRangeBottom: 8, equipment: 'barbell', restSec: 180, sets: 4 },
    { name: 'Leg extension', repRangeTop: 15, repRangeBottom: 12, equipment: 'machine', restSec: 90, sets: 3 },
    { name: 'Seated leg curl', repRangeTop: 12, repRangeBottom: 10, equipment: 'machine', restSec: 90, sets: 3 },
    { name: 'Hip abduction', repRangeTop: 15, equipment: 'machine', restSec: 60, sets: 3 },
    { name: 'Hip adduction', repRangeTop: 15, equipment: 'machine', restSec: 60, sets: 3 },
  ],
  chest: [
    { name: 'Barbell bench press', repRangeTop: 8, equipment: 'barbell', seedWeight: 80, seedReps: 8, restSec: 180 },
    { name: 'Incline DB press', repRangeTop: 10, repRangeBottom: 8, equipment: 'dumbbell', restSec: 150 },
    { name: 'Dips / machine press', repRangeTop: 10, equipment: 'machine', restSec: 120 },
    { name: 'Cable fly', repRangeTop: 15, repRangeBottom: 12, equipment: 'machine', restSec: 75 },
    { name: 'Overhead tricep ext', repRangeTop: 12, repRangeBottom: 10, equipment: 'machine', restSec: 90 },
  ],
};

// Every stored `exercisePlans` written before legs was unlocked has this
// EXACT pair for legs — the lock enforced it on every save, so there was
// never any other possible value. That makes it safe to detect and swap
// for the new list, exactly once: after the swap, legs no longer matches
// this signature, so a user's own future edits are never touched again.
const OLD_LOCKED_LEGS: ExerciseDef[] = [
  { name: 'Back squat', repRangeTop: 8, repRangeBottom: 6, equipment: 'barbell', restSec: 210 },
  { name: 'Romanian deadlift', repRangeTop: 10, repRangeBottom: 8, equipment: 'barbell', restSec: 180 },
];

export async function getExercisePlans(): Promise<ExercisePlans> {
  const stored = await get<ExercisePlans>('exercisePlans');
  if (!stored) return DEFAULT_EXERCISE_PLANS;
  if (JSON.stringify(stored.legs) === JSON.stringify(OLD_LOCKED_LEGS)) {
    // Non-null: 'legs' is a key defined directly in the literal above.
    const migrated = { ...stored, legs: DEFAULT_EXERCISE_PLANS.legs! };
    await set('exercisePlans', migrated);
    return migrated;
  }
  return stored;
}

export function saveExercisePlans(p: ExercisePlans): Promise<void> {
  return set('exercisePlans', p);
}

// ── Training: atomic, serialized mutations ─────────────────────────────────
//
// Every write to trainingState — auto-passing a rest day, finishing a
// session, undoing that finish, or manually overriding what's next — goes
// through this one queue. Two of these firing close together (a background
// day-boundary check landing while a "Finish session" tap is mid-flight, for
// instance) must never compound into more than the semantically correct
// change; serializing them here is what guarantees the pointer only ever
// moves the amount each individual action is supposed to move it.

let trainingQueue: Promise<unknown> = Promise.resolve();

function queueTraining<T>(fn: () => Promise<T>): Promise<T> {
  const run = trainingQueue.then(fn);
  trainingQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Let any elapsed rest days pass. Safe to call on every app open. */
export function autoPassRestDays(today: string): Promise<TrainingState> {
  return queueTraining(async () => {
    const fresh = await getTrainingState();
    const next = passRestDays(fresh, today);
    if (next !== fresh) await saveTrainingState(next);
    return next;
  });
}

/**
 * Record of the most recent "finish session", kept only so the undo
 * affordance on Home knows whether there's anything to undo today, and so
 * undoing can restore the EXACT prior state rather than guessing "pointer
 * minus one" — a guess that could be wrong if something else touched the
 * queue in between.
 */
export interface LastFinish {
  date: string; // ISODate — the undo banner only shows while this is today
  sessionType: string;
  workoutId: number;
  priorState: TrainingState;
}

export async function getLastFinish(): Promise<LastFinish | undefined> {
  // Cleared by storing null explicitly (see saveLastFinish); normalize that
  // back to undefined so callers only ever check one "nothing here" value.
  return (await get<LastFinish | null>('lastFinish')) ?? undefined;
}

function saveLastFinish(f: LastFinish | null): Promise<void> {
  return set('lastFinish', f);
}

/**
 * Start a session: create its workout row immediately, before a single set
 * is logged, so nothing is ever held only in component state pending a
 * later save. Callers should check getInProgressWorkout() first and only
 * start a new one when there isn't one open already.
 */
export function startTrainingSession(today: string, sessionType: string): Promise<number> {
  return queueTraining(async () => {
    return (await db.workouts.add({
      date: today,
      sessionType,
      exercises: [],
      status: 'in_progress',
    })) as number;
  });
}

/**
 * Today's session left open — reopening the app resumes straight into this,
 * no prompt. Scoped to today so an in_progress session abandoned on an
 * EARLIER day (surfaced instead on Home, with its own finish/discard
 * choice) never blocks today's session from starting fresh.
 */
export function getTodaysInProgressWorkout(today: string): Promise<Workout | undefined> {
  return db.workouts.where({ date: today }).filter((w) => w.status === 'in_progress').first();
}

/**
 * An in_progress session left open on a day before today — surfaced on Home
 * with a finish/discard choice, since silently resuming into it would be
 * surprising this many days later. There is at most one at a time, since a
 * new session never starts while an earlier in_progress row is still open
 * for a PAST day; only today's own row is created alongside it.
 */
export function getStaleInProgressWorkout(today: string): Promise<Workout | undefined> {
  return db.workouts.filter((w) => w.status === 'in_progress' && w.date !== today).first();
}

/**
 * Finish a session: every set was already written to the workout row the
 * moment it was logged (see updateWorkout), so finishing only flips the
 * row's status to complete and advances the pointer by exactly one. Reads
 * the CURRENT state fresh, inside the queue, rather than trusting whatever
 * the caller's UI last rendered — a screen that's been open a while must
 * not be able to advance the queue from a stale snapshot.
 */
export function finishTrainingSession(workoutId: number, today: string): Promise<LastFinish> {
  return queueTraining(async () => {
    const workout = await db.workouts.get(workoutId);
    if (!workout) throw new Error(`finishTrainingSession: no workout ${workoutId}`);

    const fresh = await getTrainingState();
    const passed = passRestDays(fresh, today);
    await db.workouts.update(workoutId, { status: 'complete' });

    const next = advanceAfterSession(passed, today);
    await saveTrainingState(next);

    const record: LastFinish = {
      date: workout.date,
      sessionType: workout.sessionType,
      workoutId,
      priorState: passed,
    };
    await saveLastFinish(record);
    return record;
  });
}

/**
 * Undo the last finish: put the pointer back exactly where it was — from
 * the stored snapshot, not a recomputed guess — flip the workout back to
 * in_progress, and clear the record, since once undone there's nothing left
 * to undo. Flipping the status is what lets the ordinary "resume the
 * in-progress session" path pick it straight back up, with nothing
 * special-cased for the just-undone case.
 */
export function undoLastFinish(): Promise<void> {
  return queueTraining(async () => {
    const record = await getLastFinish();
    if (!record) return;
    await saveTrainingState(record.priorState);
    await db.workouts.update(record.workoutId, { status: 'in_progress' });
    await saveLastFinish(null);
  });
}

/**
 * Manually skip today's rest slot ahead, without logging a workout — there's
 * nothing to save or later reopen, just the plan moving on a day early
 * because you asked it to.
 */
export function skipRestDay(today: string): Promise<TrainingState> {
  return queueTraining(async () => {
    const fresh = await getTrainingState();
    const passed = passRestDays(fresh, today);
    const next = advanceAfterSession(passed, today);
    await saveTrainingState(next);
    return next;
  });
}

/**
 * Manual override: jump the pointer to the nearest occurrence of
 * `sessionType` in the split. For training out of order or fixing a missed
 * week yourself — two taps, no code.
 */
export function overrideNextSession(sessionType: string, today: string): Promise<TrainingState> {
  return queueTraining(async () => {
    const fresh = await getTrainingState();
    const next = overrideToSession(fresh, sessionType, today);
    await saveTrainingState(next);
    return next;
  });
}

/** Delete a past session outright. Routed through the same queue as every
 * other training write so it can't land mid-finish and clobber an upsert. */
export function deleteWorkout(id: number): Promise<void> {
  return queueTraining(async () => {
    await db.workouts.delete(id);
    // Deleting the session the undo banner points at retires the banner —
    // there's nothing left to reopen.
    const record = await getLastFinish();
    if (record?.workoutId === id) await saveLastFinish(null);
  });
}

/** Write a session's logged sets — called after every single set while a
 * session is in progress (the autosave), and from the history editor for a
 * past one. */
export function updateWorkout(id: number, exercises: WorkoutExercise[]): Promise<void> {
  return queueTraining(async () => {
    await db.workouts.update(id, { exercises });
  });
}

// ── Weight & composition ──────────────────────────────────────────────────

export interface WeightPlan {
  targetKg: number;
  targetDate: string; // ISODate
  milestonesKg: number[];
  planRateKgPerWeek: number;
}

export const DEFAULT_WEIGHT_PLAN: WeightPlan = {
  targetKg: 90,
  targetDate: '2026-12-31',
  milestonesKg: [97, 95, 93, 91],
  planRateKgPerWeek: 0.45,
};

export async function getWeightPlan(): Promise<WeightPlan> {
  const p = await get<Partial<WeightPlan>>('weightPlan');
  return { ...DEFAULT_WEIGHT_PLAN, ...p };
}

export function saveWeightPlan(p: WeightPlan): Promise<void> {
  return set('weightPlan', p);
}

/** Lean mass default until InBody readings exist; then maintained from them. */
export const DEFAULT_LEAN_MASS_KG = 78;

export async function getLeanMassKg(): Promise<number> {
  return (await get<number>('leanMassKg')) ?? DEFAULT_LEAN_MASS_KG;
}

export function saveLeanMassKg(kg: number): Promise<void> {
  return set('leanMassKg', kg);
}

/** First date each whole-% stage was reached, e.g. { 22: '2026-08-14' }. */
export type StageDates = Record<number, string>;

export async function getStageDates(): Promise<StageDates> {
  return (await get<StageDates>('stageDates')) ?? {};
}

export function saveStageDates(d: StageDates): Promise<void> {
  return set('stageDates', d);
}

export interface PinnedProjection {
  bfPercent: number;
  weightKg: number;
  pinnedOn: string; // ISODate
}

export function getPinnedProjection(): Promise<PinnedProjection | undefined> {
  return get<PinnedProjection>('pinnedProjection');
}

export function savePinnedProjection(
  p: PinnedProjection | null,
): Promise<void> {
  return set('pinnedProjection', p);
}

/** Observed-rate cache: recomputed at most once per calendar day. */
export interface RateCache {
  date: string;
  ratePerWeek: number | null;
  windowDays: number;
}

export function getRateCache(): Promise<RateCache | undefined> {
  return get<RateCache>('rateCache');
}

export function saveRateCache(c: RateCache): Promise<void> {
  return set('rateCache', c);
}

// ── Targets ───────────────────────────────────────────────────────────────

export async function getCalorieTarget(): Promise<number> {
  return (await get<number>('calorieTarget')) ?? 2200;
}

export function saveCalorieTarget(kcal: number): Promise<void> {
  return set('calorieTarget', kcal);
}

/** A macro target as a range — protein and fat are bands, not single numbers. */
export interface MacroRange {
  min: number;
  max: number;
}

export async function getProteinTarget(): Promise<MacroRange> {
  return (await get<MacroRange>('proteinTarget')) ?? { min: 190, max: 210 };
}

export function saveProteinTarget(range: MacroRange): Promise<void> {
  return set('proteinTarget', range);
}

export async function getFatTarget(): Promise<MacroRange> {
  return (await get<MacroRange>('fatTarget')) ?? { min: 60, max: 70 };
}

export function saveFatTarget(range: MacroRange): Promise<void> {
  return set('fatTarget', range);
}

/** Daily goals in minutes for the hour-based commitments. */
export async function getFocusGoalMin(): Promise<number> {
  return (await get<number>('focusGoalMin')) ?? 60;
}

export function saveFocusGoalMin(min: number): Promise<void> {
  return set('focusGoalMin', min);
}

export async function getCraftGoalMin(): Promise<number> {
  return (await get<number>('craftGoalMin')) ?? 60;
}

export function saveCraftGoalMin(min: number): Promise<void> {
  return set('craftGoalMin', min);
}

// ── Export reminder ──────────────────────────────────────────────────────

/** Weekly nudge to back up or paste an analysis export, Sundays. Dismissing
 * records the Monday of the week it was dismissed in, so it never nags
 * twice for the same week — it re-arms itself the following Sunday. */
export interface ExportReminderState {
  enabled: boolean;
  dismissedWeek?: string; // ISODate — Monday of the week last dismissed
}

export async function getExportReminder(): Promise<ExportReminderState> {
  const stored = await get<Partial<ExportReminderState>>('exportReminder');
  return { enabled: stored?.enabled ?? true, dismissedWeek: stored?.dismissedWeek };
}

export function saveExportReminder(s: ExportReminderState): Promise<void> {
  return set('exportReminder', s);
}
