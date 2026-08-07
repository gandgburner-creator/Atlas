import { describe, expect, it } from 'vitest';
import type { Workout } from '../db/schema';
import {
  bucketFor,
  bucketStats,
  comparableBuckets,
  comparableExercises,
  durationOf,
  exerciseVolume,
  formatClock,
  formatDuration,
  formatElapsed,
  isStale,
  STALE_GAP_MS,
  workoutVolume,
} from './sessionTime';

/** Local wall-clock, which is what the buckets are defined against. */
const at = (hour: number, minute = 0, day = 4) =>
  new Date(2026, 7, day, hour, minute, 0, 0).getTime();

const MIN = 60_000;

function session(overrides: Partial<Workout> = {}): Workout {
  return {
    date: '2026-08-04',
    sessionType: 'back',
    status: 'complete',
    exercises: [],
    ...overrides,
  };
}

describe('time-of-day buckets', () => {
  it('splits the day at noon and five', () => {
    expect(bucketFor(at(0, 0))).toBe('morning');
    expect(bucketFor(at(6, 30))).toBe('morning');
    expect(bucketFor(at(11, 59))).toBe('morning');
    expect(bucketFor(at(12, 0))).toBe('afternoon');
    expect(bucketFor(at(16, 59))).toBe('afternoon');
    expect(bucketFor(at(17, 0))).toBe('evening');
    expect(bucketFor(at(23, 59))).toBe('evening');
  });
});

describe('volume', () => {
  it('is sets × reps × weight, summed', () => {
    expect(
      exerciseVolume({
        name: 'Bench',
        sets: [
          { reps: 8, weight: 80 },
          { reps: 8, weight: 80 },
          { reps: 6, weight: 85 },
        ],
      }),
    ).toBe(8 * 80 + 8 * 80 + 6 * 85);
  });

  it('is zero for bodyweight work — inherent to a load-based measure', () => {
    expect(exerciseVolume({ name: 'Pull-ups', sets: [{ reps: 12, weight: 0 }] })).toBe(0);
  });

  it('sums across a whole session', () => {
    const w = session({
      exercises: [
        { name: 'Squat', sets: [{ reps: 5, weight: 100 }] },
        { name: 'RDL', sets: [{ reps: 8, weight: 80 }] },
      ],
    });
    expect(workoutVolume(w)).toBe(500 + 640);
  });
});

describe('stale detection', () => {
  const now = at(20, 0);

  it('leaves a normal rest between sets alone', () => {
    expect(isStale(now - 3 * MIN, now)).toBe(false);
    expect(isStale(now - 44 * MIN, now)).toBe(false);
  });

  it('trips only once the gap passes the threshold', () => {
    expect(isStale(now - STALE_GAP_MS, now)).toBe(false);
    expect(isStale(now - STALE_GAP_MS - 1, now)).toBe(true);
  });

  it('catches the case this exists for — finish tapped the next morning', () => {
    expect(isStale(at(19, 30, 3), at(8, 0, 4))).toBe(true);
  });

  it('says nothing about a session with no sets logged yet', () => {
    expect(isStale(undefined, now)).toBe(false);
  });
});

describe('duration', () => {
  it('is the span between first set and close-out', () => {
    expect(durationOf({ startedAt: at(18, 0), endedAt: at(19, 12) })).toBe(72 * MIN);
  });

  it('is null while the session is still open, rather than zero', () => {
    expect(durationOf({ startedAt: at(18, 0), endedAt: undefined })).toBeNull();
    expect(durationOf({ startedAt: undefined, endedAt: undefined })).toBeNull();
  });

  it('never goes negative if the times were edited the wrong way round', () => {
    expect(durationOf({ startedAt: at(19, 0), endedAt: at(18, 0) })).toBe(0);
  });
});

describe('formatting', () => {
  it('writes durations in hours and minutes', () => {
    expect(formatDuration(72 * MIN)).toBe('1h 12m');
    expect(formatDuration(48 * MIN)).toBe('48m');
    expect(formatDuration(null)).toBe('—');
  });

  it('never rounds a real session down to nothing', () => {
    // A session that registered at all reads as at least a minute — "0m"
    // would look like a failure to record rather than a short session.
    expect(formatDuration(20_000)).toBe('1m');
  });

  it('formats the live clock, growing to hours', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(65_000)).toBe('1:05');
    expect(formatElapsed(3_725_000)).toBe('1:02:05');
  });

  it('writes wall-clock times 24h, zero-padded', () => {
    expect(formatClock(at(9, 5))).toBe('09:05');
    expect(formatClock(at(18, 40))).toBe('18:40');
  });
});

describe('bucketed comparison', () => {
  const bench = (weight: number) => ({
    name: 'Bench',
    sets: [{ reps: 8, weight }],
  });

  /** n sessions in one bucket, each an hour long. */
  function sessions(hour: number, weights: number[]): Workout[] {
    return weights.map((w, i) =>
      session({
        startedAt: at(hour, 0, 4 + i),
        endedAt: at(hour + 1, 0, 4 + i),
        exercises: [bench(w)],
      }),
    );
  }

  it('groups by start time and averages duration and volume', () => {
    const stats = bucketStats(sessions(18, [100, 110, 120]));
    const evening = stats.find((s) => s.bucket === 'evening')!;
    expect(evening.sessions).toBe(3);
    expect(evening.avgDurationMs).toBe(60 * MIN);
    expect(evening.avgVolume).toBe((800 + 880 + 960) / 3);
    expect(stats.find((s) => s.bucket === 'morning')!.sessions).toBe(0);
  });

  it('ignores sessions still in progress and ones with no start time', () => {
    const stats = bucketStats([
      session({ startedAt: at(18), endedAt: at(19), exercises: [bench(100)] }),
      session({ startedAt: at(18), status: 'in_progress', exercises: [bench(100)] }),
      session({ exercises: [bench(100)] }), // logged before timing existed
    ]);
    expect(stats.find((s) => s.bucket === 'evening')!.sessions).toBe(1);
  });

  it('says nothing from one morning session against a dozen evenings', () => {
    const stats = bucketStats([...sessions(7, [100]), ...sessions(18, [100, 110, 120])]);
    // Evening clears the bar; morning has one. Nothing to compare.
    expect(comparableBuckets(stats)).toEqual([]);
  });

  it('compares only once two buckets each carry three sessions', () => {
    const two = bucketStats([...sessions(7, [90, 95]), ...sessions(18, [100, 110, 120])]);
    expect(comparableBuckets(two)).toEqual([]);

    const three = bucketStats([...sessions(7, [90, 95, 100]), ...sessions(18, [100, 110, 120])]);
    const shown = comparableBuckets(three);
    expect(shown.map((s) => s.bucket)).toEqual(['morning', 'evening']);
  });

  it('per-lift rows cover only lifts done in every bucket compared', () => {
    const morning = sessions(7, [90, 95, 100]);
    const evening = sessions(18, [100, 110, 120]);
    // A lift only ever done in the evening can't be compared across slots.
    evening[0]!.exercises.push({ name: 'Rows', sets: [{ reps: 10, weight: 60 }] });

    const shown = comparableBuckets(bucketStats([...morning, ...evening]));
    expect(comparableExercises(shown)).toEqual(['Bench']);
  });

  it('drops bodyweight lifts from the per-lift comparison — 0 against 0 is not a finding', () => {
    const withPullups = (hour: number, weights: number[]) =>
      sessions(hour, weights).map((s) => ({
        ...s,
        exercises: [...s.exercises, { name: 'Pull-ups', sets: [{ reps: 10, weight: 0 }] }],
      }));

    const shown = comparableBuckets(
      bucketStats([...withPullups(7, [90, 95, 100]), ...withPullups(18, [100, 110, 120])]),
    );
    expect(comparableExercises(shown)).toEqual(['Bench']);
  });

  it('reports a null average length rather than zero when nothing was timed', () => {
    const untimedButBucketed = [0, 1, 2].map((i) =>
      session({ startedAt: at(18, 0, 4 + i), exercises: [bench(100)] }),
    );
    const evening = bucketStats(untimedButBucketed).find((s) => s.bucket === 'evening')!;
    expect(evening.sessions).toBe(3);
    expect(evening.avgDurationMs).toBeNull();
    expect(formatDuration(evening.avgDurationMs)).toBe('—');
  });
});
