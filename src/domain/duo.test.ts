import { describe, expect, it } from 'vitest';
import type { DuoSession, DuoSet } from '../db/schema';
import {
  buildHistory, buildSeason, canonicalName, dayKeyFor, dayPlannedSets, DAY_KEYS, DUO_PROGRAM,
  epley, isPr, lastTime, nextSeasonStart, plannedSets, resolveSlot, sessionKey, sessionStats,
  targetFor, weekPlannedSets, weekScore, weekStartFor, weekWinner, EMPTY_PREFS, type DayKey, type Profile,
} from './duo';
import { toISODate } from './time';

// Weeks run Mon-Sun in device-local time. Pin the zone the app is used in.
(globalThis as unknown as { process: { env: Record<string, string> } }).process.env.TZ = 'Asia/Taipei';

const set = (weight: number, reps: number): DuoSet => ({ weight, reps, confirmedAt: 1 });

/** A session with the first `n` planned sets of every exercise confirmed. */
function sess(p: Profile, week: string, day: DayKey, fill: number | 'all', bw = 100, deload = false): DuoSession {
  const exercises = DUO_PROGRAM[day].slots.map((sl) => {
    const planned = plannedSets(sl.sets, deload);
    const n = fill === 'all' ? planned : Math.min(planned, fill);
    return { slotId: sl.id, name: sl.name, sets: Array.from({ length: n }, () => set(50, 8)) };
  });
  return {
    key: sessionKey(p, week, day), profile: p, weekStart: week, day, date: week,
    bodyweight: bw, exercises, deload, status: 'complete', startedAt: 1,
  };
}

const W1 = '2026-10-19'; // season 1, week 1 (Monday)
const W2 = '2026-10-26';

describe('program', () => {
  it('is 67 working sets a week', () => {
    expect(weekPlannedSets(false)).toBe(67);
    expect(DAY_KEYS.map((d) => dayPlannedSets(d, false))).toEqual([15, 13, 13, 13, 13]);
  });
  it('deload halves sets, rounded up', () => {
    expect(plannedSets(3, true)).toBe(2);
    expect(plannedSets(2, true)).toBe(1);
    expect(plannedSets(4, true)).toBe(2);
    expect(weekPlannedSets(true)).toBe(41);
  });
});

describe('local-time weeks (Asia/Taipei)', () => {
  it('Sunday belongs to the week that started the Monday before', () => {
    expect(weekStartFor('2026-10-18')).toBe('2026-10-12');
    expect(weekStartFor('2026-10-19')).toBe('2026-10-19');
    expect(dayKeyFor('2026-10-18')).toBeNull(); // Sunday
    expect(dayKeyFor('2026-10-19')).toBe('mon');
    expect(dayKeyFor('2026-10-16')).toBeNull(); // Friday
    expect(dayKeyFor('2026-10-17')).toBe('sat');
  });
  it('a Taipei morning that is still the previous day in UTC lands on the right day', () => {
    // 00:30 Monday 19 Oct in Taipei is 16:30 Sunday 18 Oct UTC.
    const d = new Date('2026-10-18T16:30:00Z');
    expect(toISODate(d)).toBe('2026-10-19');
    expect(d.toISOString().slice(0, 10)).toBe('2026-10-18'); // the trap
    expect(weekStartFor(toISODate(d))).toBe('2026-10-19');
    // 23:30 Sunday Taipei is still the old week.
    expect(weekStartFor(toISODate(new Date('2026-10-18T15:30:00Z')))).toBe('2026-10-12');
  });
  it('next season starts today if Monday, else next Monday', () => {
    expect(nextSeasonStart('2026-10-19')).toBe('2026-10-19');
    expect(nextSeasonStart('2026-10-22')).toBe('2026-10-26');
    expect(nextSeasonStart('2026-10-25')).toBe('2026-10-26');
  });
});

describe('scoring', () => {
  it('1 per set, +10 per complete session, +20 for a perfect week', () => {
    const all = DAY_KEYS.map((d) => sess('ghaith', W1, d, 'all'));
    const w = weekScore(all, false);
    expect(w.sets).toBe(67);
    expect(w.sessionsComplete).toBe(5);
    expect(w.perfect).toBe(true);
    expect(w.points).toBe(67 + 50 + 20);
  });
  it('partial sessions only score their sets', () => {
    const w = weekScore([sess('gaby', W1, 'mon', 1), sess('gaby', W1, 'tue', 'all')], false);
    expect(w.sets).toBe(5 + 13);
    expect(w.sessionsComplete).toBe(1);
    expect(w.points).toBe(18 + 10);
    expect(w.perfect).toBe(false);
  });
  it('a session logged on another day still counts for its own week and slot', () => {
    const makeup = { ...sess('ghaith', W1, 'mon', 'all'), date: '2026-10-23' }; // Monday's session done on Friday
    expect(weekScore([makeup], false).sessionsComplete).toBe(1);
  });
  it('deload scores against the reduced plan', () => {
    const all = DAY_KEYS.map((d) => sess('ghaith', W1, d, 'all', 100, true));
    const w = weekScore(all, true);
    expect(w.sets).toBe(41);
    expect(w.perfect).toBe(true);
    expect(w.completionPct).toBe(100);
    // The same sets against the full plan are incomplete.
    expect(weekScore(all, false).sessionsComplete).toBe(0);
  });
  it('volume uses multipliers: x1, x2 per hand, x4 split squat, x0 leg raise', () => {
    const s = sess('ghaith', W1, 'mon', 'all');
    // 50kg x 8 reps per set: press 3 sets x2, lateral 4 x2, pec deck 3 x1, crunch 3 x1, leg raise 2 x0
    expect(sessionStats(s, false).volume).toBe(50 * 8 * (3 * 2 + 4 * 2 + 3 + 3 + 0));
    const sat = sess('ghaith', W1, 'sat', 'all');
    const split = 50 * 8 * 2 * 4; // 2 sets x4
    const rest = 50 * 8 * (3 + 3 + 3 + 2);
    expect(sessionStats(sat, false).volume).toBe(split + rest);
  });
  it('bodyweight swaps load bodyweight plus added weight', () => {
    const s = sess('gaby', W1, 'tue', 'all', 49);
    s.exercises[0] = { slotId: 'tue-1', name: 'Assisted Pull-up', sets: [set(-20, 8), set(-20, 8), set(-20, 8)] };
    const stat = sessionStats(s, false);
    const others = sessionStats({ ...s, exercises: s.exercises.slice(1) }, false).volume;
    expect(stat.volume - others).toBe((49 - 20) * 8 * 3);
  });
  it('relative volume divides by the bodyweight stored on each session', () => {
    const a = sess('ghaith', W1, 'mon', 'all', 100);
    expect(sessionStats(a, false).relVolume).toBeCloseTo(sessionStats(a, false).volume / 100);
    // A later bodyweight change must not touch a past session.
    expect(sessionStats({ ...a }, false).relVolume).toBeCloseTo(sessionStats(a, false).volume / 100);
  });
});

describe('season and winners', () => {
  const full = (p: Profile, w: string) => DAY_KEYS.map((d) => sess(p, w, d, 'all'));
  it('more points wins the week; tie goes to relative volume', () => {
    const a = weekScore(full('ghaith', W1), false);
    const b = weekScore([sess('gaby', W1, 'mon', 'all', 49)], false);
    expect(weekWinner(a, b)).toBe('ghaith');
    const x = weekScore([sess('ghaith', W1, 'mon', 'all', 100)], false);
    const y = weekScore([sess('gaby', W1, 'mon', 'all', 49)], false);
    expect(x.points).toBe(y.points);
    expect(weekWinner(x, y)).toBe('gaby'); // same work, lighter body = more relative volume
    expect(weekWinner(weekScore([], false), weekScore([], false))).toBeNull();
  });
  it('counts wins only for finished weeks and keeps perfect-week streaks', () => {
    const s = [
      ...full('ghaith', W1), ...full('gaby', W1).slice(0, 2),
      ...full('ghaith', W2), ...full('gaby', W2),
    ];
    const season = buildSeason(s, W1, '2026-10-28', []); // Wed of week 2
    expect(season.weeks.length).toBe(2);
    expect(season.wins).toEqual({ ghaith: 1, gaby: 0 }); // week 2 is live, not banked
    expect(season.streak.ghaith).toEqual({ current: 2, best: 2 });
    expect(season.streak.gaby.best).toBe(1); // only week 2 is perfect
    expect(season.leader).toBe('ghaith');
    expect(season.cumulative.ghaith).toEqual([137, 274]);
  });
  it('an unfinished current week does not break a streak', () => {
    const s = [...full('ghaith', W1), sess('ghaith', W2, 'mon', 'all')];
    expect(buildSeason(s, W1, '2026-10-28', []).streak.ghaith).toEqual({ current: 1, best: 1 });
  });
  it('earlier logs are practice, and the season is not started before its date', () => {
    const season = buildSeason(full('ghaith', '2026-10-12'), W1, '2026-10-14', []);
    expect(season.started).toBe(false);
    expect(season.points.ghaith).toBe(0);
  });
});

describe('targets and PRs', () => {
  const slotDef = DUO_PROGRAM.tue.slots[0]!; // Lat Pulldown 3 x 6-10
  const r = resolveSlot(slotDef, EMPTY_PREFS, 'ghaith');
  const entry = (sets: [number, number][]) => ({
    date: '2026-10-10', name: 'Lat Pulldown', sets: sets.map(([w, reps]) => ({ weight: w, reps, load: w })),
  });
  it('adds one step only when every set hit the top of the range', () => {
    expect(targetFor(entry([[60, 10], [60, 10], [60, 10]]), r).weight).toBe(62.5);
    expect(targetFor(entry([[60, 10], [60, 9], [60, 8]]), r).weight).toBe(60);
    expect(targetFor(undefined, r).weight).toBeNull();
  });
  it('uses +5 for Squat, RDL, Leg Press and Hip Thrust, and honours an edited step', () => {
    const squat = resolveSlot(DUO_PROGRAM.wed.slots[0]!, EMPTY_PREFS, 'ghaith');
    expect(squat.step).toBe(5);
    expect(resolveSlot(slotDef, { ...EMPTY_PREFS, steps: { 'tue-1': 1 } }, 'ghaith').step).toBe(1);
  });
  it('swaps keep sets/reps and are per profile', () => {
    const swapped = resolveSlot(slotDef, { ...EMPTY_PREFS, swaps: { 'tue-1': 'Assisted Pull-up' } }, 'gaby');
    expect(swapped.name).toBe('Assisted Pull-up');
    expect(swapped.sets).toBe(3);
    expect(swapped.bodyweight).toBe(true);
  });
  it('flags a PR only against existing history, including earlier sets today', () => {
    const hist = [entry([[60, 8]])];
    const sets = [set(60, 8), set(62.5, 8), set(62.5, 8)];
    expect(isPr(hist, 'Lat Pulldown', sets, 0, false, 100)).toBe(false);
    expect(isPr(hist, 'Lat Pulldown', sets, 1, false, 100)).toBe(true);
    expect(isPr(hist, 'Lat Pulldown', sets, 2, false, 100)).toBe(false); // ties the set before it
    expect(isPr([], 'Lat Pulldown', sets, 1, false, 100)).toBe(false); // first time is a baseline
    expect(epley(60, 8)).toBeCloseTo(76);
  });
  it('carries Ghaith\'s old history across renamed lifts, and Gaby gets none', () => {
    expect(canonicalName('Pull Down Machine')).toBe('Lat Pulldown');
    expect(canonicalName('Back squat')).toBe('Squat');
    const legacy = [{
      id: 1, date: '2026-08-01', sessionType: 'back', status: 'complete' as const,
      exercises: [{ name: 'Pull Down', sets: [{ reps: 10, weight: 50 }] }, { name: 'Face pull', sets: [{ reps: 12, weight: 20 }] }],
    }];
    const g = buildHistory('ghaith', [], legacy, undefined, 100);
    expect(lastTime(g, 'Lat Pulldown')?.sets[0]?.weight).toBe(50);
    expect(lastTime(g, 'Face pull')?.sets.length).toBe(1); // unmapped stays under its own name
    expect(buildHistory('gaby', [], legacy, undefined, 49)).toEqual([]);
  });
});
