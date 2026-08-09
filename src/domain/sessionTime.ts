import type { ISODate, Workout, WorkoutExercise } from '../db/schema';
import { addDays } from './time';

/**
 * When a session happened, how long it took, and how that compares across
 * the day.
 *
 * Every number here is DESCRIPTIVE. Duration is not a target and shortness
 * is not a fault — a 25-minute session is a session, and nothing in this
 * module or its callers is allowed to say otherwise. The comparison exists
 * to answer "am I actually stronger in the evening", which is a question
 * about information, not effort.
 */

export type DayBucket = 'morning' | 'afternoon' | 'evening';

export const BUCKETS: { id: DayBucket; label: string; window: string }[] = [
  { id: 'morning', label: 'morning', window: 'before 12' },
  { id: 'afternoon', label: 'afternoon', window: '12 – 5' },
  { id: 'evening', label: 'evening', window: '5 onwards' },
];

/**
 * Bucketed on LOCAL clock time, from when the first set was logged. Local
 * because the question is "was this a morning session for me", and a
 * session's character doesn't change because it's viewed from another
 * timezone.
 */
export function bucketFor(startedAt: number): DayBucket {
  const hour = new Date(startedAt).getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

// ── Volume ────────────────────────────────────────────────────────────────

/**
 * Volume is sets × reps × weight, summed.
 *
 * Note what this means for bodyweight work: weight is 0, so pull-ups
 * contribute nothing to the total however hard they were. That's inherent
 * to load-based volume rather than a bug, and it's why the per-exercise
 * comparison below drops exercises whose volume is zero throughout — a
 * column of zeroes carries no signal to compare.
 */
export function exerciseVolume(ex: WorkoutExercise): number {
  return ex.sets.reduce((sum, s) => sum + s.reps * s.weight, 0);
}

export function workoutVolume(w: Pick<Workout, 'exercises'>): number {
  return w.exercises.reduce((sum, ex) => sum + exerciseVolume(ex), 0);
}

// ── Duration ──────────────────────────────────────────────────────────────

/**
 * How long a rest can sit before "finish" is assumed to be late rather than
 * deliberate. Long enough to cover a genuinely slow set — a phone call, a
 * queue for the rack — short enough that a session forgotten overnight is
 * always caught.
 */
export const STALE_GAP_MS = 45 * 60 * 1000;

/** Whether the gap since the last logged set means "finish now" would
 * record a duration that never happened. */
export function isStale(lastSetAt: number | undefined, now: number): boolean {
  if (lastSetAt === undefined) return false;
  return now - lastSetAt > STALE_GAP_MS;
}

/** Duration of a finished session, or null while one is still open. */
export function durationOf(w: Pick<Workout, 'startedAt' | 'endedAt'>): number | null {
  if (w.startedAt === undefined || w.endedAt === undefined) return null;
  return Math.max(0, w.endedAt - w.startedAt);
}

/** '1h 12m' / '48m' / '—'. Never rounds to zero: a session that registered
 * at all reads as at least a minute. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  const minutes = Math.max(1, Math.round(ms / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** 'HH:MM', 24h, local — the same clock convention as the sleep module. */
export function formatClock(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Live elapsed readout, 'M:SS' under an hour then 'H:MM:SS'. Computed from
 * an absolute start against the wall clock, never accumulated, so
 * backgrounding the app can't skew it. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// ── Rolling volume ────────────────────────────────────────────────────────

/** Four weeks: long enough to cover every session type several times. */
export const ROLLING_VOLUME_DAYS = 28;

export interface ExerciseVolume {
  name: string;
  volume: number;
  /** Sessions in the window that included it, of any type. */
  sessions: number;
}

/**
 * Load per exercise over the trailing four weeks, every session type
 * included.
 *
 * Bonus sessions count here exactly as scheduled ones do — the set was
 * done, the load was moved, and which heading it happened under is not a
 * property of the barbell. Nothing is weighted or discounted by session
 * type, and this function has no way to tell them apart on purpose.
 *
 * Zero-volume lifts are dropped for the same reason as everywhere else:
 * bodyweight work scores nothing under sets × reps × weight, and a row of
 * zeroes is noise rather than information.
 */
export function rollingVolume(
  workouts: Workout[],
  endDate: ISODate,
  days = ROLLING_VOLUME_DAYS,
): ExerciseVolume[] {
  const from = addDays(endDate, -(days - 1));
  const byExercise = new Map<string, { volume: number; sessions: number }>();

  for (const w of workouts) {
    if (w.status === 'in_progress') continue;
    if (w.date < from || w.date > endDate) continue;
    for (const ex of w.exercises) {
      if (ex.sets.length === 0) continue;
      const cur = byExercise.get(ex.name) ?? { volume: 0, sessions: 0 };
      cur.volume += exerciseVolume(ex);
      cur.sessions += 1;
      byExercise.set(ex.name, cur);
    }
  }

  return [...byExercise.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .filter((e) => e.volume > 0)
    .sort((a, b) => b.volume - a.volume);
}

// ── Comparison ────────────────────────────────────────────────────────────

export interface ExerciseAverage {
  name: string;
  avgVolume: number;
  /** Sessions in this bucket that included the exercise at all. */
  sessions: number;
}

export interface BucketStats {
  bucket: DayBucket;
  sessions: number;
  /** Null when no session in the bucket has a usable duration. */
  avgDurationMs: number | null;
  avgVolume: number;
  perExercise: ExerciseAverage[];
}

/** Below this a bucket is a coincidence, not a pattern. */
export const MIN_SESSIONS_TO_COMPARE = 3;

function statsFor(bucket: DayBucket, ws: Workout[]): BucketStats {
  const durations = ws
    .map((w) => durationOf(w))
    .filter((d): d is number => d !== null);

  const byExercise = new Map<string, { total: number; sessions: number }>();
  for (const w of ws) {
    for (const ex of w.exercises) {
      const cur = byExercise.get(ex.name) ?? { total: 0, sessions: 0 };
      cur.total += exerciseVolume(ex);
      cur.sessions += 1;
      byExercise.set(ex.name, cur);
    }
  }

  return {
    bucket,
    sessions: ws.length,
    avgDurationMs:
      durations.length === 0
        ? null
        : durations.reduce((a, b) => a + b, 0) / durations.length,
    avgVolume:
      ws.length === 0 ? 0 : ws.reduce((sum, w) => sum + workoutVolume(w), 0) / ws.length,
    perExercise: [...byExercise.entries()]
      .map(([name, v]) => ({ name, avgVolume: v.total / v.sessions, sessions: v.sessions }))
      .sort((a, b) => b.avgVolume - a.avgVolume),
  };
}

/**
 * Bucket every session that has a start time. Sessions still in progress,
 * and old ones from before timing was recorded, are simply absent — there
 * is no time of day to file them under, and guessing one would be inventing
 * data.
 */
export function bucketStats(workouts: Workout[]): BucketStats[] {
  const timed = workouts.filter(
    (w) => w.status !== 'in_progress' && w.startedAt !== undefined,
  );
  return BUCKETS.map(({ id }) =>
    statsFor(
      id,
      timed.filter((w) => bucketFor(w.startedAt as number) === id),
    ),
  );
}

/**
 * The buckets worth putting side by side: those with enough sessions to
 * mean something, and only when at least two of them clear the bar. One
 * morning session next to twelve evening ones is not a comparison, it's a
 * coincidence with a chart around it.
 */
export function comparableBuckets(
  stats: BucketStats[],
  min = MIN_SESSIONS_TO_COMPARE,
): BucketStats[] {
  const eligible = stats.filter((s) => s.sessions >= min);
  return eligible.length >= 2 ? eligible : [];
}

/**
 * Exercises present in EVERY compared bucket and carrying real load, so the
 * per-lift rows compare like with like. Bodyweight-only movements are
 * dropped: their volume is zero everywhere, and "0 vs 0" is not a finding.
 */
export function comparableExercises(buckets: BucketStats[]): string[] {
  if (buckets.length < 2) return [];
  const [first, ...rest] = buckets;
  return (first as BucketStats).perExercise
    .filter((e) => e.avgVolume > 0)
    .filter((e) =>
      rest.every((b) => b.perExercise.some((o) => o.name === e.name && o.avgVolume > 0)),
    )
    .map((e) => e.name);
}
