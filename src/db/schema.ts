import Dexie, { type EntityTable } from 'dexie';

/**
 * Atlas storage.
 *
 * The whole app's schema is declared here, not just the slice that's built.
 * Adding a table later is a version bump and a migration; declaring them all
 * up front costs nothing (empty stores are free) and means the sleep slice
 * doesn't have to be the thing that dictates the shape of everything else.
 *
 * Every table stores RAW observations. Week numbers, wake targets, averages,
 * calorie totals, 1RM estimates — all derived at read time, never persisted.
 * The ramp will change; derived values written to disk would be lies later.
 *
 * `date` is a local calendar day, 'YYYY-MM-DD'. Clock times are local
 * 'HH:MM'. Neither is a UTC instant: "I woke at 07:00" stays 07:00 across a
 * timezone change, which is what a person means. `focusSessions` is the
 * exception — a session is a real interval, so it stores epoch millis.
 */

/** Local calendar day, 'YYYY-MM-DD'. */
export type ISODate = string;

/** Local wall-clock time, 'HH:MM', 24h. */
export type ClockTime = string;

// ── Slice 1: sleep ────────────────────────────────────────────────────────

export interface SleepLog {
  /** Primary key. The day you woke up. */
  date: ISODate;
  /**
   * The target in force when this was logged, snapshotted for history.
   * Display and charts re-derive from the ramp instead of trusting this,
   * so editing the ramp retroactively fixes the whole chart.
   */
  targetWake: ClockTime;
  actualWake: ClockTime;
  /** Estimated, optional. May be after midnight (02:00 = same calendar day). */
  sleepOnset?: ClockTime;
  /** "what happened today" — one line, free text. */
  note?: string;
  createdAt: number;
  updatedAt: number;
}

// ── Later slices: declared, unused ────────────────────────────────────────

export interface WeightLog {
  date: ISODate;
  kg: number;
}

export interface FoodLog {
  id?: number;
  date: ISODate;
  /** Reference into a food library added in a later slice. */
  itemId: string;
  quantity: number;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}

export interface WorkoutSet {
  reps: number;
  weight: number;
}

export interface WorkoutExercise {
  name: string;
  sets: WorkoutSet[];
}

export interface Workout {
  id?: number;
  date: ISODate;
  /** e.g. 'push' | 'pull' | 'legs' — defined by config.splitDefinition. */
  sessionType: string;
  exercises: WorkoutExercise[];
  /**
   * Every set is written to this row the moment it's logged, so the row
   * exists from the instant the session starts. 'in_progress' means it's
   * still open (mid-session, or left open from a previous day); 'complete'
   * means "finish session" was tapped. Absent on old rows = complete — they
   * were always saved whole under the pre-autosave model.
   */
  status?: 'in_progress' | 'complete';
}

export interface FocusSession {
  id?: number;
  /** Epoch millis — a session is an instant-anchored interval, not a day. */
  start: number;
  /** Absent while the session is still running — that, not `completed`, is
   * what marks a row as still open (see startFocusSession/endFocusSession). */
  end?: number;
  intent: string;
  tag: string;
  /** 1–5, how the session felt. Set only when it ends. */
  satisfaction?: number;
  /** Whether the INTENT was accomplished — asked and set only when the
   * session ends; meaningless (and absent) while one is still running. */
  completed?: boolean;
  /** Which section the hours count toward. Absent on old rows = 'work'. */
  area?: 'work' | 'craft';
}

export interface LifeLog {
  date: ISODate;
  restBlock: boolean;
  call: boolean;
  social: boolean;
}

export interface Photo {
  id?: number;
  date: ISODate;
  /** e.g. 'progress' | 'inbody' | 'meal'. */
  type: string;
  blob: Blob;
}

/**
 * An InBody scan. The core five fields are required to mark the reading
 * complete; everything else is optional and hidden behind "more
 * measurements" in the form. The row is written as a draft as soon as the
 * first field is filled in, so all fields are optional at the storage
 * layer — validation of the core set happens at save time, in the form.
 * `photoId` points at the printout photo in the photos table.
 */
export interface InBodyReading {
  id?: number;
  date: ISODate;
  /** Absent while the reading is a draft in progress. */
  status?: 'in_progress' | 'complete';
  weightKg?: number;
  skeletalMuscleMassKg?: number;
  bodyFatMassKg?: number;
  bodyFatPercent?: number;
  fatFreeMassKg?: number;
  // Segmental lean mass, kg
  leanRightArm?: number;
  leanLeftArm?: number;
  leanTrunk?: number;
  leanRightLeg?: number;
  leanLeftLeg?: number;
  // Segmental fat mass, kg
  fatRightArm?: number;
  fatLeftArm?: number;
  fatTrunk?: number;
  fatRightLeg?: number;
  fatLeftLeg?: number;
  // Metabolic & health
  visceralFatLevel?: number;
  basalMetabolicRate?: number;
  totalBodyWaterL?: number;
  ecwTbwRatio?: number;
  proteinMassKg?: number;
  mineralMassKg?: number;
  bmi?: number;
  inbodyScore?: number;
  waistHipRatio?: number;
  photoId?: number;
}

/** The weekly letter: a few lines written once a week, never graded. */
export interface Letter {
  /** Monday of the week it covers. Primary key. */
  weekStart: ISODate;
  title: string;
  body: string;
  writtenAt: number;
}

/** A craft pipeline item: Idea > Scripted > Filmed > Edited > Published. */
export interface CraftItem {
  id?: number;
  title: string;
  status: 'idea' | 'scripted' | 'filmed' | 'edited' | 'published';
  note?: string;
  createdAt: number;
  updatedAt: number;
}

// ── Config ────────────────────────────────────────────────────────────────

/**
 * Key/value rather than columns: config keys arrive one slice at a time
 * (calorieTarget, splitDefinition, currentPhase...) and a KV store absorbs
 * each one without a schema version bump. `value` is typed per key by the
 * accessors in ./config.ts, which are the only sanctioned way in.
 */
export interface ConfigEntry {
  key: string;
  value: unknown;
}

export class AtlasDB extends Dexie {
  sleepLogs!: EntityTable<SleepLog, 'date'>;
  weightLogs!: EntityTable<WeightLog, 'date'>;
  foodLogs!: EntityTable<FoodLog, 'id'>;
  workouts!: EntityTable<Workout, 'id'>;
  focusSessions!: EntityTable<FocusSession, 'id'>;
  lifeLogs!: EntityTable<LifeLog, 'date'>;
  photos!: EntityTable<Photo, 'id'>;
  inbody!: EntityTable<InBodyReading, 'id'>;
  craftItems!: EntityTable<CraftItem, 'id'>;
  letters!: EntityTable<Letter, 'weekStart'>;
  config!: EntityTable<ConfigEntry, 'key'>;

  constructor() {
    super('atlas');
    // Indexes are for what gets queried: a day, or a range of days.
    this.version(1).stores({
      sleepLogs: 'date',
      weightLogs: 'date',
      foodLogs: '++id, date, itemId',
      workouts: '++id, date, sessionType',
      focusSessions: '++id, start, tag',
      lifeLogs: 'date',
      photos: '++id, date, type',
      config: 'key',
    });
    // v2: the full app. Existing tables untouched — sleep data carries over
    // byte for byte. focusSessions rows gain an un-indexed `area` property
    // ('work' | 'craft') which needs no schema change.
    this.version(2).stores({
      inbody: '++id, date',
      craftItems: '++id, status',
    });
    this.version(3).stores({
      letters: 'weekStart',
    });
  }
}

export const db = new AtlasDB();
