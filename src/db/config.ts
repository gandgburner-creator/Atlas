import { db } from './schema';
import { DEFAULT_RAMP, type RampConfig } from '../domain/ramp';
import type { CommitmentOverrides } from '../domain/commitments';

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
  /** Rep range top used for the overload hint. */
  repRangeTop: number;
  /** 'barbell' | 'dumbbell' | 'bodyweight' — decides the increment hint. */
  equipment: 'barbell' | 'dumbbell' | 'bodyweight';
  /** First-ever tap pre-fills these, before any history exists. */
  seedWeight?: number;
  seedReps?: number;
}

export type ExercisePlans = Record<string, ExerciseDef[]>;

/**
 * Seed plan. Legs is squats and RDL ONLY — knee injury history, squats stop
 * just below 90°. Never add leg exercises here.
 */
export const DEFAULT_EXERCISE_PLANS: ExercisePlans = {
  legs: [
    { name: 'Squat', repRangeTop: 8, equipment: 'barbell' },
    { name: 'Romanian deadlift', repRangeTop: 10, equipment: 'barbell' },
  ],
  chest: [
    { name: 'Bench press', repRangeTop: 8, equipment: 'barbell', seedWeight: 80, seedReps: 8 },
  ],
  shoulders: [
    { name: 'DB shoulder press', repRangeTop: 8, equipment: 'dumbbell', seedWeight: 22.5, seedReps: 8 },
  ],
  back: [
    { name: 'Pull-ups', repRangeTop: 10, equipment: 'bodyweight', seedReps: 8 },
  ],
};

export async function getExercisePlans(): Promise<ExercisePlans> {
  return (await get<ExercisePlans>('exercisePlans')) ?? DEFAULT_EXERCISE_PLANS;
}

export function saveExercisePlans(p: ExercisePlans): Promise<void> {
  return set('exercisePlans', p);
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
  return (await get<number>('calorieTarget')) ?? 2300;
}

export function saveCalorieTarget(kcal: number): Promise<void> {
  return set('calorieTarget', kcal);
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
