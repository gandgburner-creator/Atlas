import { db, type DuoSession, type DuoSet, type DuoWeight, type ISODate } from './schema';
import {
  EMPTY_PREFS,
  SEASON_1_START,
  SEED_BODYWEIGHT,
  SEED_DATE,
  sessionKey,
  type DayKey,
  type DuoPrefs,
  type Profile,
} from '../domain/duo';

/**
 * Data layer for the two-person program. Every read and write goes through
 * this file, so moving to a shared backend means replacing these functions
 * and nothing else. Records already carry deterministic keys for that.
 */

// ── Which profile this device is ──────────────────────────────────────────

const PROFILE_KEY = 'atlas.profile';

export function getStoredProfile(): Profile | null {
  try {
    const v = localStorage.getItem(PROFILE_KEY);
    return v === 'ghaith' || v === 'gaby' ? v : null;
  } catch {
    return null;
  }
}

const OWNER_KEY = 'atlas.owner';

/**
 * Whose phone this is, fixed the first time a profile is chosen. The phone's
 * own weight log (the one Atlas already has) belongs to the owner; the other
 * person, when logged from this phone, keeps theirs in duoWeights.
 */
export function getOwner(): Profile {
  try {
    const v = localStorage.getItem(OWNER_KEY);
    if (v === 'ghaith' || v === 'gaby') return v;
  } catch {
    /* fall through */
  }
  return getStoredProfile() ?? 'ghaith';
}

export function storeProfile(p: Profile): void {
  try {
    if (!localStorage.getItem(OWNER_KEY)) localStorage.setItem(OWNER_KEY, p);
    localStorage.setItem(PROFILE_KEY, p);
  } catch {
    /* private mode: the choice just isn't remembered */
  }
}

// ── Bodyweight ────────────────────────────────────────────────────────────

/**
 * Ghaith's bodyweight is Atlas's existing weight log; Gaby's lives in
 * duoWeights. Seeds are idempotent (fixed keys), so a double effect is safe.
 */
export async function ensureDuoSeed(): Promise<void> {
  if (!getStoredProfile()) return; // nobody chosen yet; seeded right after the gate
  const owner = getOwner();
  const other: Profile = owner === 'ghaith' ? 'gaby' : 'ghaith';
  await db.transaction('rw', db.weightLogs, db.duoWeights, async () => {
    if ((await db.weightLogs.count()) === 0) {
      const now = Date.now();
      await db.weightLogs.put({ date: SEED_DATE, kg: SEED_BODYWEIGHT[owner], createdAt: now, updatedAt: now });
    }
    const k = `${other}:${SEED_DATE}`;
    if (!(await db.duoWeights.get(k))) {
      await db.duoWeights.put({ key: k, profile: other, date: SEED_DATE, kg: SEED_BODYWEIGHT[other], updatedAt: Date.now() });
    }
  });
}

export async function weightSeries(p: Profile): Promise<{ date: ISODate; kg: number }[]> {
  if (p === getOwner()) {
    return (await db.weightLogs.orderBy('date').toArray()).map((w) => ({ date: w.date, kg: w.kg }));
  }
  return (await db.duoWeights.where('profile').equals(p).sortBy('date')).map((w) => ({ date: w.date, kg: w.kg }));
}

/** Latest log on or before `date`; before the first log, the first log. */
export async function bodyweightOn(p: Profile, date: ISODate): Promise<number> {
  const all = await weightSeries(p);
  if (!all.length) return SEED_BODYWEIGHT[p];
  let pick = all[0]!;
  for (const w of all) if (w.date <= date) pick = w;
  return pick.kg;
}

export async function logBodyweight(p: Profile, date: ISODate, kg: number): Promise<void> {
  const now = Date.now();
  if (p === getOwner()) {
    const existing = await db.weightLogs.get(date);
    await db.weightLogs.put({ date, kg, createdAt: existing?.createdAt ?? now, updatedAt: now });
  } else {
    await db.duoWeights.put({ key: `${p}:${date}`, profile: p, date, kg, updatedAt: now } as DuoWeight);
  }
}

// ── Sessions ──────────────────────────────────────────────────────────────

/** Open the week's session for a day, or return the one that exists. */
export async function startDuoSession(
  profile: Profile,
  weekStart: ISODate,
  day: DayKey,
  date: ISODate,
  deload: boolean,
): Promise<DuoSession> {
  const key = sessionKey(profile, weekStart, day);
  const bodyweight = await bodyweightOn(profile, date);
  return db.transaction('rw', db.duoSessions, async () => {
    const existing = await db.duoSessions.get(key);
    if (existing) return existing;
    const s: DuoSession = {
      key, profile, weekStart, day, date, bodyweight,
      exercises: [], deload, status: 'in_progress', startedAt: Date.now(),
    };
    await db.duoSessions.put(s);
    return s;
  });
}

/** Atomic read-modify-write, so rapid taps can't overwrite each other. */
async function mutate(key: string, fn: (s: DuoSession) => void): Promise<void> {
  await db.transaction('rw', db.duoSessions, async () => {
    const s = await db.duoSessions.get(key);
    if (!s) return;
    fn(s);
    await db.duoSessions.put(s);
  });
}

/** Saved the instant it's confirmed. Re-confirming an edited set overwrites it. */
export function confirmDuoSet(
  key: string,
  slotId: string,
  name: string,
  index: number,
  set: Omit<DuoSet, 'confirmedAt'>,
): Promise<void> {
  return mutate(key, (s) => {
    let ex = s.exercises.find((e) => e.slotId === slotId);
    if (!ex) {
      ex = { slotId, name, sets: [] };
      s.exercises.push(ex);
    }
    while (ex.sets.length <= index) ex.sets.push(null);
    ex.sets[index] = { ...set, confirmedAt: Date.now() };
    if (s.status === 'complete') s.status = 'in_progress';
  });
}

export function setDuoNote(key: string, note: string): Promise<void> {
  return mutate(key, (s) => {
    s.note = note || undefined;
  });
}

/** Ends a session early or on time. A session with nothing confirmed is discarded. */
export async function finishDuoSession(key: string): Promise<void> {
  await db.transaction('rw', db.duoSessions, async () => {
    const s = await db.duoSessions.get(key);
    if (!s) return;
    const any = s.exercises.some((e) => e.sets.some(Boolean));
    if (!any) {
      await db.duoSessions.delete(key);
      return;
    }
    s.status = 'complete';
    s.endedAt = Date.now();
    await db.duoSessions.put(s);
  });
}

// ── Preferences, deload, season ───────────────────────────────────────────

const prefsKey = (p: Profile) => `duoPrefs:${p}`;

export async function getPrefs(p: Profile): Promise<DuoPrefs> {
  const row = await db.config.get(prefsKey(p));
  const v = (row?.value ?? {}) as Partial<DuoPrefs>;
  return { ...EMPTY_PREFS, swaps: v.swaps ?? {}, steps: v.steps ?? {}, rests: v.rests ?? {} };
}

export function updatePrefs(p: Profile, fn: (x: DuoPrefs) => DuoPrefs): Promise<void> {
  return db.transaction('rw', db.config, async () => {
    const row = await db.config.get(prefsKey(p));
    const v = (row?.value ?? {}) as Partial<DuoPrefs>;
    const cur: DuoPrefs = { swaps: v.swaps ?? {}, steps: v.steps ?? {}, rests: v.rests ?? {} };
    await db.config.put({ key: prefsKey(p), value: fn(cur) });
  });
}

export async function getDeloadWeeks(): Promise<string[]> {
  return ((await db.config.get('duoDeloadWeeks'))?.value as string[] | undefined) ?? [];
}

export function toggleDeload(weekStart: ISODate): Promise<void> {
  return db.transaction('rw', db.config, async () => {
    const cur = ((await db.config.get('duoDeloadWeeks'))?.value as string[] | undefined) ?? [];
    const next = cur.includes(weekStart) ? cur.filter((w) => w !== weekStart) : [...cur, weekStart];
    await db.config.put({ key: 'duoDeloadWeeks', value: next });
  });
}

export async function getSeasonStart(): Promise<ISODate> {
  return ((await db.config.get('duoSeasonStart'))?.value as string | undefined) ?? SEASON_1_START;
}

/** Resets the scoreboard only: every session and every log stays. */
export function setSeasonStart(date: ISODate): Promise<void> {
  return db.config.put({ key: 'duoSeasonStart', value: date }).then(() => undefined);
}
