import type { ISODate } from '../db/schema';
import { daysBetween } from './time';

/**
 * The commitment engine.
 *
 * Every module is a CAPABILITY: fully built, always loggable, from day one.
 * A COMMITMENT is a capability that currently counts — toward the home
 * rings, on the today checklist, and in the weekly review. Commitments ramp
 * in on a schedule of weeks relative to the ramp start date, and every one
 * of them can be moved or disabled from Settings without touching code.
 *
 * Nothing in here scores the past. The engine answers exactly one question:
 * which commitments are active on a given date.
 *
 * Scope, as of the reduction: the four always-on pillars are sleep,
 * training, weight and food. Work, craft and life are full CAPABILITIES
 * still — every screen, table and domain function stays intact — but they
 * are gated behind ModuleFlags (see below), off by default, and excluded
 * from rings/checklist/upcoming entirely while off. Flip a flag in Settings
 * and they resume exactly where their own ramp week says they should.
 */

export type Section = 'train' | 'rest' | 'fuel' | 'other';

export type CommitmentId =
  | 'wake_time'
  | 'training_log'
  | 'weight_log'
  | 'nutrition'
  | 'rest_block'
  | 'calls'
  | 'focus_hours'
  | 'craft_hours';

export interface CommitmentDef {
  id: CommitmentId;
  section: Section;
  /** Handwritten label on cards and the checklist. No digits. */
  label: string;
  /** 1-based week of the ramp when this starts counting. */
  defaultWeek: number;
}

/** The plan as written. Settings overrides sit on top, never instead. */
export const COMMITMENT_DEFS: CommitmentDef[] = [
  { id: 'wake_time', section: 'rest', label: 'wake time', defaultWeek: 1 },
  { id: 'training_log', section: 'train', label: 'training', defaultWeek: 1 },
  { id: 'weight_log', section: 'fuel', label: 'weigh in', defaultWeek: 1 },
  { id: 'nutrition', section: 'fuel', label: 'nutrition', defaultWeek: 3 },
  { id: 'rest_block', section: 'other', label: 'rest block', defaultWeek: 5 },
  { id: 'calls', section: 'other', label: 'call someone', defaultWeek: 5 },
  { id: 'focus_hours', section: 'other', label: 'focus hours', defaultWeek: 7 },
  { id: 'craft_hours', section: 'other', label: 'craft hours', defaultWeek: 10 },
];

/**
 * Per-commitment override, stored in config. `week` moves the activation
 * (earlier or later); `disabled` removes it from scoring entirely while the
 * module stays fully usable.
 */
export interface CommitmentOverride {
  week?: number;
  disabled?: boolean;
}

export type CommitmentOverrides = Partial<
  Record<CommitmentId, CommitmentOverride>
>;

/** Rings: exactly these three, always in this order. `other` never rings. */
export const SECTIONS: { id: Section; label: string }[] = [
  { id: 'train', label: 'Train' },
  { id: 'rest', label: 'Rest' },
  { id: 'fuel', label: 'Fuel' },
];

// ── Module flags ─────────────────────────────────────────────────────────
//
// Work, craft and life are whole modules that can be switched off without
// losing anything — no code deleted, no table dropped, just excluded from
// what's active. `photos` and `insight` gate narrower slices (the InBody /
// composition-figure / projection complex, and photo attachments within
// it); `letter` gates the weekly letter on Progress. All default off, per
// the reduced scope; every one is a toggle in Settings.

export type ModuleKey = 'work' | 'craft' | 'life' | 'photos' | 'insight' | 'letter';

export interface ModuleFlags {
  work: boolean;
  craft: boolean;
  life: boolean;
  photos: boolean;
  insight: boolean;
  letter: boolean;
}

export const DEFAULT_MODULE_FLAGS: ModuleFlags = {
  work: false,
  craft: false,
  life: false,
  photos: false,
  insight: false,
  letter: false,
};

export const MODULE_DEFS: { id: ModuleKey; label: string; hint: string }[] = [
  { id: 'work', label: 'work', hint: 'deep work focus timer + hours' },
  { id: 'craft', label: 'craft', hint: 'craft session timer + pipeline' },
  { id: 'life', label: 'life', hint: 'rest block + calls' },
  { id: 'insight', label: 'body insight', hint: 'composition figure, projection, InBody' },
  { id: 'photos', label: 'photos', hint: 'attach a photo to an InBody reading' },
  { id: 'letter', label: 'the weekly letter', hint: 'a few lines to yourself, on Progress' },
];

/** Which module flag (if any) a commitment is gated behind. */
export const COMMITMENT_MODULE: Partial<Record<CommitmentId, ModuleKey>> = {
  rest_block: 'life',
  calls: 'life',
  focus_hours: 'work',
  craft_hours: 'craft',
};

/** 1-based ramp week containing `date`; 0 or negative before the ramp. */
export function rampWeekOn(rampStart: ISODate, date: ISODate): number {
  return Math.floor(daysBetween(rampStart, date) / 7) + 1;
}

export interface ResolvedCommitment extends CommitmentDef {
  /** Week it actually activates after overrides. */
  week: number;
  disabled: boolean;
  /** Counting toward rings and the checklist on the asked-about date. */
  active: boolean;
  /** Activates within the next two weeks — shown quietly, never scored. */
  upcoming: boolean;
}

/** The full plan, resolved against overrides and module flags, for a date. */
export function resolveCommitments(
  rampStart: ISODate,
  date: ISODate,
  overrides: CommitmentOverrides,
  moduleFlags: ModuleFlags = DEFAULT_MODULE_FLAGS,
): ResolvedCommitment[] {
  const currentWeek = rampWeekOn(rampStart, date);
  return COMMITMENT_DEFS.map((def) => {
    const o = overrides[def.id] ?? {};
    const week = o.week ?? def.defaultWeek;
    const disabled = o.disabled ?? false;
    const moduleKey = COMMITMENT_MODULE[def.id];
    // A commitment behind a module that's off is never active or upcoming —
    // "Home shows only today's items for active modules" — but nothing
    // about its week/disabled state is touched, so re-enabling the module
    // resumes exactly where its own ramp says it should.
    const moduleOff = moduleKey ? !moduleFlags[moduleKey] : false;
    const active = !disabled && !moduleOff && currentWeek >= week;
    return {
      ...def,
      week,
      disabled,
      active,
      upcoming: !disabled && !moduleOff && !active && week - currentWeek <= 2,
    };
  });
}

/** Active commitments on a date, grouped by section. */
export function activeBySection(
  rampStart: ISODate,
  date: ISODate,
  overrides: CommitmentOverrides,
  moduleFlags: ModuleFlags = DEFAULT_MODULE_FLAGS,
): Record<Section, ResolvedCommitment[]> {
  const groups: Record<Section, ResolvedCommitment[]> = {
    train: [],
    rest: [],
    fuel: [],
    other: [],
  };
  for (const c of resolveCommitments(rampStart, date, overrides, moduleFlags)) {
    if (c.active) groups[c.section].push(c);
  }
  return groups;
}

/**
 * A section ring's state for the day. `null` fraction means no active
 * commitments — the ring renders greyed: visible, uncounted, never a failure.
 */
export interface RingState {
  section: Section;
  label: string;
  done: number;
  total: number;
  fraction: number | null;
}

export function ringStates(
  rampStart: ISODate,
  date: ISODate,
  overrides: CommitmentOverrides,
  doneIds: Set<CommitmentId>,
  moduleFlags: ModuleFlags = DEFAULT_MODULE_FLAGS,
): RingState[] {
  const groups = activeBySection(rampStart, date, overrides, moduleFlags);
  return SECTIONS.map(({ id, label }) => {
    const cs = groups[id];
    const done = cs.filter((c) => doneIds.has(c.id)).length;
    return {
      section: id,
      label,
      done,
      total: cs.length,
      fraction: cs.length === 0 ? null : done / cs.length,
    };
  });
}
