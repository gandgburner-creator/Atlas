import type { DuoSession, DuoSet, ISODate, Workout } from '../db/schema';
import { addDays, fromISODate, weekStartOf } from './time';

/**
 * The two-person program and the head-to-head challenge.
 *
 * Pure: no storage, no clock. Every function takes the dates and sessions it
 * needs, and all day keys come from LOCAL calendar dates (`fromISODate` builds
 * a local Date), never from `toISOString()`, so the Sunday -> Monday boundary
 * falls at local midnight (Asia/Taipei), not at UTC midnight.
 */

export type Profile = 'ghaith' | 'gaby';
export const PROFILES: Profile[] = ['ghaith', 'gaby'];
export const PROFILE_NAME: Record<Profile, string> = { ghaith: 'Ghaith', gaby: 'Gaby' };

export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'sat';
export const DAY_KEYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'sat'];
export const DAY_LABEL: Record<DayKey, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', sat: 'Sat',
};
/** Offset from the Monday that starts the week. */
const DAY_OFFSET: Record<DayKey, number> = { mon: 0, tue: 1, wed: 2, thu: 3, sat: 5 };

export const SEASON_1_START: ISODate = '2026-10-19';
export const SEED_DATE: ISODate = '2026-10-12';
export const SEED_BODYWEIGHT: Record<Profile, number> = { ghaith: 100, gaby: 49 };

export const SESSION_TARGET_MIN = 45;
export const SESSION_WARN_MIN = 40;

// ── The program ───────────────────────────────────────────────────────────

export interface AltDef {
  name: string;
  /** Volume multiplier for this alternative. */
  mult: number;
  /** Load = bodyweight + logged weight (negative = assisted). */
  bodyweight?: boolean;
}

export interface SlotDef {
  id: string;
  name: string;
  sets: number;
  repLow: number;
  repHigh: number;
  perLeg?: boolean;
  rest: number;
  mult: number;
  bodyweight?: boolean;
  alts: AltDef[];
  cue?: { profile: Profile; text: string };
}

const KNEE_CUE = {
  profile: 'ghaith' as Profile,
  text: 'Depth just above parallel; stop if the right knee complains.',
};

function slot(
  id: string, name: string, sets: number, repLow: number, repHigh: number,
  rest: number, mult: number, alts: AltDef[], extra: Partial<SlotDef> = {},
): SlotDef {
  return { id, name, sets, repLow, repHigh, rest, mult, alts, ...extra };
}
const alt = (name: string, mult: number, bodyweight = false): AltDef => ({ name, mult, bodyweight });

export const DUO_PROGRAM: Record<DayKey, { title: string; slots: SlotDef[] }> = {
  mon: {
    title: 'Shoulders + Abs',
    slots: [
      slot('mon-1', 'Seated DB Shoulder Press', 3, 6, 10, 150, 2, [alt('Machine Shoulder Press', 1), alt('Standing DB Shoulder Press', 2)]),
      slot('mon-2', 'Lateral Raise', 4, 10, 15, 75, 2, [alt('Cable Lateral Raise', 2), alt('Machine Lateral Raise', 1)]),
      slot('mon-3', 'Reverse Pec Deck', 3, 12, 15, 75, 1, [alt('Rear Delt Cable Fly', 2), alt('Face Pull', 1)]),
      slot('mon-4', 'Cable Crunch', 3, 10, 15, 60, 1, [alt('Machine Crunch', 1), alt('Weighted Crunch', 1)]),
      slot('mon-5', 'Hanging Leg Raise', 2, 10, 15, 60, 0, [alt('Reverse Crunch', 0), alt("Captain's Chair Leg Raise", 0)]),
    ],
  },
  tue: {
    title: 'Back + Biceps',
    slots: [
      slot('tue-1', 'Lat Pulldown', 3, 6, 10, 150, 1, [alt('Pull-up', 1, true), alt('Assisted Pull-up', 1, true)]),
      slot('tue-2', 'Low Row', 3, 8, 10, 120, 1, [alt('Chest-Supported Row', 1), alt('One-Arm DB Row', 2)]),
      slot('tue-3', 'Pullover', 2, 10, 15, 90, 1, [alt('Straight-Arm Pulldown', 1), alt('DB Pullover', 1)]),
      slot('tue-4', 'Incline DB Curl', 3, 8, 12, 75, 2, [alt('Seated DB Curl', 2), alt('Cable Curl', 1)]),
      slot('tue-5', 'Hammer Curl', 2, 10, 12, 60, 2, [alt('Cable Rope Hammer Curl', 1), alt('Cross-Body Hammer Curl', 2)]),
    ],
  },
  wed: {
    title: 'Legs A (quads)',
    slots: [
      slot('wed-1', 'Squat', 3, 6, 10, 180, 1, [alt('Hack Squat', 1), alt('Smith Machine Squat', 1)], { cue: KNEE_CUE }),
      slot('wed-2', 'Leg Press', 2, 10, 12, 120, 1, [alt('Hack Squat', 1), alt('Goblet Squat', 1)]),
      slot('wed-3', 'Leg Extension', 3, 10, 15, 75, 1, [alt('Single-Leg Extension', 1)]),
      slot('wed-4', 'Seated Leg Curl', 2, 10, 12, 75, 1, [alt('Lying Leg Curl', 1), alt('Single-Leg Curl', 1)]),
      slot('wed-5', 'Standing Calf Raise', 3, 8, 12, 60, 1, [alt('Leg Press Calf Raise', 1), alt('Smith Calf Raise', 1)]),
    ],
  },
  thu: {
    title: 'Chest + Triceps',
    slots: [
      slot('thu-1', 'Incline DB Press', 3, 6, 10, 150, 2, [alt('Incline Machine Press', 1), alt('Incline Barbell Press', 1)]),
      slot('thu-2', 'Bench Press', 3, 6, 10, 150, 1, [alt('Machine Chest Press', 1), alt('Flat DB Press', 2)]),
      slot('thu-3', 'Cable Fly / Pec Deck', 2, 10, 15, 75, 1, [alt('DB Fly', 2), alt('Push-up', 1, true)]),
      slot('thu-4', 'Triceps Pressdown', 3, 10, 12, 75, 1, [alt('Rope Pressdown', 1), alt('Dip Machine', 1)]),
      slot('thu-5', 'Overhead Cable Triceps Extension', 2, 10, 12, 60, 1, [alt('Overhead DB Triceps Extension', 1), alt('Skull Crusher', 1)]),
    ],
  },
  sat: {
    title: 'Legs B (glutes + hamstrings)',
    slots: [
      slot('sat-1', 'Romanian Deadlift', 3, 6, 10, 150, 1, [alt('DB Romanian Deadlift', 2), alt('Good Morning', 1)]),
      slot('sat-2', 'Hip Thrust', 3, 8, 12, 120, 1, [alt('Machine Hip Thrust', 1), alt('Glute Bridge', 1)]),
      slot('sat-3', 'DB Bulgarian Split Squat', 2, 8, 12, 90, 4, [alt('DB Reverse Lunge', 4), alt('Smith Split Squat', 2)], { perLeg: true, cue: KNEE_CUE }),
      slot('sat-4', 'Lying Leg Curl', 3, 10, 12, 75, 1, [alt('Seated Leg Curl', 1), alt('Single-Leg Curl', 1)]),
      slot('sat-5', 'Seated Calf Raise', 2, 12, 15, 60, 1, [alt('Standing Calf Raise', 1), alt('Leg Press Calf Raise', 1)]),
    ],
  },
};

export function plannedSets(sets: number, deload: boolean): number {
  return deload ? Math.ceil(sets / 2) : sets;
}

export function dayPlannedSets(day: DayKey, deload: boolean): number {
  return DUO_PROGRAM[day].slots.reduce((n, s) => n + plannedSets(s.sets, deload), 0);
}

export function weekPlannedSets(deload: boolean): number {
  return DAY_KEYS.reduce((n, d) => n + dayPlannedSets(d, deload), 0);
}

// ── Per-profile preferences ───────────────────────────────────────────────

export interface DuoPrefs {
  /** slotId -> chosen alternative's name. */
  swaps: Record<string, string>;
  steps: Record<string, number>;
  rests: Record<string, number>;
}
export const EMPTY_PREFS: DuoPrefs = { swaps: {}, steps: {}, rests: {} };

const BIG_STEP = new Set(['Squat', 'Romanian Deadlift', 'Leg Press', 'Hip Thrust']);
export const defaultStep = (name: string): number => (BIG_STEP.has(name) ? 5 : 2.5);

export interface ResolvedSlot {
  slotId: string;
  baseName: string;
  name: string;
  sets: number;
  repLow: number;
  repHigh: number;
  perLeg: boolean;
  rest: number;
  mult: number;
  bodyweight: boolean;
  step: number;
  cue?: string;
  alts: AltDef[];
}

export function resolveSlot(s: SlotDef, prefs: DuoPrefs, profile: Profile): ResolvedSlot {
  const chosen = prefs.swaps[s.id];
  const a = chosen ? s.alts.find((x) => x.name === chosen) : undefined;
  return {
    slotId: s.id,
    baseName: s.name,
    name: a ? a.name : s.name,
    sets: s.sets,
    repLow: s.repLow,
    repHigh: s.repHigh,
    perLeg: Boolean(s.perLeg),
    rest: prefs.rests[s.id] ?? s.rest,
    mult: a ? a.mult : s.mult,
    bodyweight: a ? Boolean(a.bodyweight) : Boolean(s.bodyweight),
    step: prefs.steps[s.id] ?? defaultStep(s.name),
    cue: s.cue && s.cue.profile === profile ? s.cue.text : undefined,
    alts: s.alts,
  };
}

/** Multiplier and bodyweight flag for whatever name was actually logged. */
function metaFor(s: SlotDef, name: string): { mult: number; bodyweight: boolean } {
  if (name === s.name) return { mult: s.mult, bodyweight: Boolean(s.bodyweight) };
  const a = s.alts.find((x) => x.name === name);
  return a ? { mult: a.mult, bodyweight: Boolean(a.bodyweight) } : { mult: s.mult, bodyweight: false };
}

// ── Dates (local time) ────────────────────────────────────────────────────

/** Program day for a local date, or null on Friday / Sunday. */
export function dayKeyFor(date: ISODate): DayKey | null {
  const dow = fromISODate(date).getDay(); // 0 = Sun
  const map: Record<number, DayKey> = { 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 6: 'sat' };
  return map[dow] ?? null;
}

export const weekStartFor = weekStartOf;

export function dateOfDay(weekStart: ISODate, day: DayKey): ISODate {
  return addDays(weekStart, DAY_OFFSET[day]);
}

export const sessionKey = (p: Profile, weekStart: ISODate, day: DayKey) =>
  `${p}:${weekStart}:${day}`;

// ── Load, volume, e1RM ────────────────────────────────────────────────────

export const epley = (load: number, reps: number): number => load * (1 + reps / 30);

export function loadOf(weight: number, bodyweightMove: boolean, bodyweight: number): number {
  return bodyweightMove ? bodyweight + weight : weight;
}

export interface SessionStats {
  planned: number;
  done: number;
  volume: number;
  complete: boolean;
  /** volume / bodyweight at that session. */
  relVolume: number;
}

export function sessionStats(s: DuoSession, deload: boolean): SessionStats {
  const day = DUO_PROGRAM[s.day];
  let planned = 0;
  let done = 0;
  let volume = 0;
  for (const sl of day.slots) {
    const p = plannedSets(sl.sets, deload);
    planned += p;
    const ex = s.exercises.find((e) => e.slotId === sl.id);
    if (!ex) continue;
    const { mult, bodyweight } = metaFor(sl, ex.name);
    for (const set of ex.sets.slice(0, p)) {
      if (!set) continue;
      done += 1;
      volume += loadOf(set.weight, bodyweight, s.bodyweight) * set.reps * mult;
    }
  }
  return {
    planned,
    done,
    volume,
    complete: planned > 0 && done === planned,
    relVolume: s.bodyweight > 0 ? volume / s.bodyweight : 0,
  };
}

// ── History, last time, targets, PRs ──────────────────────────────────────

export interface HistSet { weight: number; reps: number; load: number }
export interface HistEntry { date: ISODate; name: string; sets: HistSet[] }

const norm = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Old exercise names that are clearly the same lift as a new one. Only the
 * unambiguous ones: anything that could be two different movements is left
 * out on purpose and listed in UNCLEAR_LEGACY for the user to rule on.
 */
export const LEGACY_ALIASES: Record<string, string[]> = {
  'Seated DB Shoulder Press': ['DB shoulder press', 'Shoulder Press'],
  'Lateral Raise': ['Lateral raise', 'Cable lateral raise'],
  'Lat Pulldown': ['Lat pulldown', 'Pull Down', 'Pull Down Machine'],
  'Pull-up': ['Pull-ups', 'Pull Ups'],
  'Hammer Curl': ['Hammer Curl'],
  Squat: ['Back squat', 'Squat'],
  'Leg Press': ['Leg press', 'Leg Press'],
  'Leg Extension': ['Leg extension'],
  'Seated Leg Curl': ['Seated leg curl'],
  'Incline DB Press': ['Incline DB press', 'Incline Press'],
  'Bench Press': ['Barbell bench press', 'Bench Press'],
  'Cable Fly / Pec Deck': ['Cable fly'],
  'Triceps Pressdown': ['Tricep Pressdown'],
  'Overhead Cable Triceps Extension': ['Overhead tricep ext', 'Overhead Tricep Extension'],
  'Romanian Deadlift': ['Romanian deadlift', 'RDL'],
};

/** Old names left unmapped because they could mean more than one new lift. */
export const UNCLEAR_LEGACY: string[] = [
  'Rear Delt Fly (Reverse Pec Deck?)',
  'Low Row / Chest-supported row / Barbell row (Low Row?)',
  'Leg Curl / Hamstring Curl (Seated or Lying?)',
  'Hip Extension (Hip Thrust?)',
  'Face Pull, Shrugs, Barbell curl, Decline Press, High Row (no match)',
];

const REVERSE = new Map<string, string>();
for (const [canon, olds] of Object.entries(LEGACY_ALIASES)) {
  REVERSE.set(norm(canon), canon);
  for (const o of olds) REVERSE.set(norm(o), canon);
}
const BW_NAMES = new Set<string>();
for (const d of DAY_KEYS) {
  for (const s of DUO_PROGRAM[d].slots) {
    if (s.bodyweight) BW_NAMES.add(s.name);
    for (const a of s.alts) if (a.bodyweight) BW_NAMES.add(a.name);
  }
}

export function canonicalName(name: string): string {
  return REVERSE.get(norm(name)) ?? name;
}

export function buildHistory(
  profile: Profile,
  sessions: DuoSession[],
  legacy: Workout[],
  excludeKey: string | undefined,
  fallbackBodyweight: number,
): HistEntry[] {
  const out: HistEntry[] = [];
  for (const s of sessions) {
    if (s.profile !== profile || s.key === excludeKey) continue;
    for (const ex of s.exercises) {
      const sets = ex.sets.filter((x): x is DuoSet => x !== null);
      if (!sets.length) continue;
      const bw = BW_NAMES.has(ex.name);
      out.push({
        date: s.date,
        name: ex.name,
        sets: sets.map((x) => ({ weight: x.weight, reps: x.reps, load: loadOf(x.weight, bw, s.bodyweight) })),
      });
    }
  }
  // Everything logged before the two-person program belongs to Ghaith.
  if (profile === 'ghaith') {
    for (const w of legacy) {
      if (w.status === 'in_progress') continue;
      for (const ex of w.exercises) {
        if (!ex.sets.length) continue;
        const name = canonicalName(ex.name);
        const bw = BW_NAMES.has(name);
        out.push({
          date: w.date,
          name,
          sets: ex.sets.map((x) => ({ weight: x.weight, reps: x.reps, load: loadOf(x.weight, bw, fallbackBodyweight) })),
        });
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function lastTime(hist: HistEntry[], name: string): HistEntry | undefined {
  for (let i = hist.length - 1; i >= 0; i--) if (hist[i]!.name === name) return hist[i];
  return undefined;
}

export function bestE1rm(hist: HistEntry[], name: string): number {
  let best = 0;
  for (const h of hist) {
    if (h.name !== name) continue;
    for (const s of h.sets) best = Math.max(best, epley(s.load, s.reps));
  }
  return best;
}

export interface Target {
  weight: number | null;
  label: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Double progression. */
export function targetFor(last: HistEntry | undefined, r: ResolvedSlot): Target {
  if (!last) return { weight: null, label: 'first time: pick a weight you can do clean' };
  const w = Math.max(...last.sets.map((s) => s.weight));
  const allTop = last.sets.every((s) => s.reps >= r.repHigh);
  if (allTop) {
    const next = round2(w + r.step);
    return { weight: next, label: `${next} kg, back to ${r.repLow}+ reps` };
  }
  const best = Math.max(...last.sets.map((s) => s.reps));
  return { weight: w, label: `${w} kg, beat ${best} reps` };
}

/**
 * Whether set `index` is a PR: its e1RM beats the best of all earlier history
 * AND the earlier sets this session. A lift with no history has nothing to
 * beat, so its first appearance is a baseline, not a record.
 */
export function isPr(
  hist: HistEntry[],
  name: string,
  sets: (DuoSet | null)[],
  index: number,
  moveIsBodyweight: boolean,
  bodyweight: number,
): boolean {
  const s = sets[index];
  if (!s) return false;
  const prior = bestE1rm(hist, name);
  if (prior <= 0) return false;
  let best = prior;
  for (let j = 0; j < index; j++) {
    const p = sets[j];
    if (p) best = Math.max(best, epley(loadOf(p.weight, moveIsBodyweight, bodyweight), p.reps));
  }
  return epley(loadOf(s.weight, moveIsBodyweight, bodyweight), s.reps) > best;
}

export function sessionPrCount(s: DuoSession, hist: HistEntry[]): number {
  let n = 0;
  for (const ex of s.exercises) {
    const bw = BW_NAMES.has(ex.name);
    for (let i = 0; i < ex.sets.length; i++) if (isPr(hist, ex.name, ex.sets, i, bw, s.bodyweight)) n += 1;
  }
  return n;
}

// ── Scoring ───────────────────────────────────────────────────────────────

export interface WeekScore {
  sets: number;
  planned: number;
  sessionsComplete: number;
  perfect: boolean;
  points: number;
  volume: number;
  /** Sum of each session's volume / that session's stored bodyweight. */
  relVolume: number;
  completionPct: number;
}

export function weekScore(sessions: DuoSession[], deload: boolean): WeekScore {
  let sets = 0;
  let sessionsComplete = 0;
  let volume = 0;
  let relVolume = 0;
  for (const s of sessions) {
    const st = sessionStats(s, deload);
    sets += st.done;
    volume += st.volume;
    relVolume += st.relVolume;
    if (st.complete) sessionsComplete += 1;
  }
  const planned = weekPlannedSets(deload);
  const perfect = sessionsComplete === DAY_KEYS.length;
  return {
    sets,
    planned,
    sessionsComplete,
    perfect,
    points: sets + sessionsComplete * 10 + (perfect ? 20 : 0),
    volume,
    relVolume,
    completionPct: planned ? Math.round((sets / planned) * 100) : 0,
  };
}

export interface WeekRow {
  weekStart: ISODate;
  ended: boolean;
  scores: Record<Profile, WeekScore>;
  winner: Profile | null;
}

export interface Season {
  started: boolean;
  startsOn: ISODate;
  weeks: WeekRow[];
  wins: Record<Profile, number>;
  points: Record<Profile, number>;
  streak: Record<Profile, { current: number; best: number }>;
  leader: Profile | null;
  cumulative: Record<Profile, number[]>;
}

export function weekWinner(a: WeekScore, b: WeekScore): Profile | null {
  if (a.points === 0 && b.points === 0) return null;
  if (a.points !== b.points) return a.points > b.points ? 'ghaith' : 'gaby';
  if (a.relVolume !== b.relVolume) return a.relVolume > b.relVolume ? 'ghaith' : 'gaby';
  return null;
}

function runs(flags: { perfect: boolean; ended: boolean }[]): { current: number; best: number } {
  let best = 0;
  let run = 0;
  for (const f of flags) {
    run = f.perfect ? run + 1 : 0;
    best = Math.max(best, run);
  }
  // The week in progress only extends a streak; it never breaks one.
  const trimmed = flags.length && !flags[flags.length - 1]!.ended && !flags[flags.length - 1]!.perfect
    ? flags.slice(0, -1)
    : flags;
  let current = 0;
  for (let i = trimmed.length - 1; i >= 0 && trimmed[i]!.perfect; i--) current += 1;
  return { current, best };
}

export function buildSeason(
  sessions: DuoSession[],
  seasonStart: ISODate,
  today: ISODate,
  deloadWeeks: string[],
): Season {
  const thisWeek = weekStartOf(today);
  const first = weekStartOf(seasonStart);
  const weeks: WeekRow[] = [];
  for (let w = first; w <= thisWeek; w = addDays(w, 7)) {
    const scores = {} as Record<Profile, WeekScore>;
    for (const p of PROFILES) {
      scores[p] = weekScore(
        sessions.filter((s) => s.profile === p && s.weekStart === w),
        deloadWeeks.includes(w),
      );
    }
    weeks.push({ weekStart: w, ended: w < thisWeek, scores, winner: weekWinner(scores.ghaith, scores.gaby) });
  }
  const wins: Record<Profile, number> = { ghaith: 0, gaby: 0 };
  const points: Record<Profile, number> = { ghaith: 0, gaby: 0 };
  const cumulative: Record<Profile, number[]> = { ghaith: [], gaby: [] };
  for (const row of weeks) {
    if (row.ended && row.winner) wins[row.winner] += 1;
    for (const p of PROFILES) {
      points[p] += row.scores[p].points;
      cumulative[p].push(points[p]);
    }
  }
  const streak = {
    ghaith: runs(weeks.map((r) => ({ perfect: r.scores.ghaith.perfect, ended: r.ended }))),
    gaby: runs(weeks.map((r) => ({ perfect: r.scores.gaby.perfect, ended: r.ended }))),
  };
  let leader: Profile | null = null;
  if (wins.ghaith !== wins.gaby) leader = wins.ghaith > wins.gaby ? 'ghaith' : 'gaby';
  else if (points.ghaith !== points.gaby) leader = points.ghaith > points.gaby ? 'ghaith' : 'gaby';
  return { started: today >= first, startsOn: first, weeks, wins, points, streak, leader, cumulative };
}

/** Monday a "New season" should start on: today if it is Monday, else next Monday. */
export function nextSeasonStart(today: ISODate): ISODate {
  const ws = weekStartOf(today);
  return ws === today ? today : addDays(ws, 7);
}

// ── Merging (for sync) ────────────────────────────────────────────────────

/**
 * Combine two copies of the same session, never losing a confirmed set.
 *
 * Both phones can log into the same session (one person logging both of
 * you while the other phone logs too), so a plain "latest copy wins" would
 * drop sets. Instead sets are merged slot by slot and index by index, the
 * most recently confirmed copy of each winning; only the session-level
 * fields (note, status) follow whichever copy was edited last.
 */
export function mergeSession(a: DuoSession, b: DuoSession): DuoSession {
  const newer = (a.updatedAt ?? 0) >= (b.updatedAt ?? 0) ? a : b;
  const older = newer === a ? b : a;
  const slotIds = [...newer.exercises, ...older.exercises].map((e) => e.slotId);
  const exercises = [...new Set(slotIds)].map((slotId) => {
    const ea = newer.exercises.find((e) => e.slotId === slotId);
    const eb = older.exercises.find((e) => e.slotId === slotId);
    if (!ea || !eb) return (ea ?? eb)!;
    const n = Math.max(ea.sets.length, eb.sets.length);
    const sets: (DuoSet | null)[] = [];
    for (let i = 0; i < n; i++) {
      const x = ea.sets[i] ?? null;
      const y = eb.sets[i] ?? null;
      sets.push(!x ? y : !y ? x : y.confirmedAt > x.confirmedAt ? y : x);
    }
    return { slotId, name: ea.sets.some(Boolean) ? ea.name : eb.name, sets };
  });
  return {
    ...newer,
    exercises,
    startedAt: Math.min(a.startedAt, b.startedAt),
    updatedAt: Math.max(a.updatedAt ?? 0, b.updatedAt ?? 0),
  };
}

export const hasConfirmedSets = (s: DuoSession): boolean =>
  s.exercises.some((e) => e.sets.some(Boolean));

/** JSON with sorted keys, so two equal records compare equal whatever their key order. */
export function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}
