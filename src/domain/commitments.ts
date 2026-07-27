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
 */

export type Section = 'body' | 'work' | 'craft' | 'life';

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
  { id: 'wake_time', section: 'body', label: 'wake time', defaultWeek: 1 },
  { id: 'training_log', section: 'body', label: 'training', defaultWeek: 1 },
  { id: 'weight_log', section: 'body', label: 'weigh in', defaultWeek: 1 },
  { id: 'nutrition', section: 'body', label: 'nutrition', defaultWeek: 3 },
  { id: 'rest_block', section: 'life', label: 'rest block', defaultWeek: 5 },
  { id: 'calls', section: 'life', label: 'call someone', defaultWeek: 5 },
  { id: 'focus_hours', section: 'work', label: 'focus hours', defaultWeek: 7 },
  { id: 'craft_hours', section: 'craft', label: 'craft hours', defaultWeek: 10 },
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

export const SECTIONS: { id: Section; label: string }[] = [
  { id: 'body', label: 'Body' },
  { id: 'work', label: 'Work' },
  { id: 'craft', label: 'Craft' },
  { id: 'life', label: 'Life' },
];

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

/** The full plan, resolved against overrides, for a given date. */
export function resolveCommitments(
  rampStart: ISODate,
  date: ISODate,
  overrides: CommitmentOverrides,
): ResolvedCommitment[] {
  const currentWeek = rampWeekOn(rampStart, date);
  return COMMITMENT_DEFS.map((def) => {
    const o = overrides[def.id] ?? {};
    const week = o.week ?? def.defaultWeek;
    const disabled = o.disabled ?? false;
    const active = !disabled && currentWeek >= week;
    return {
      ...def,
      week,
      disabled,
      active,
      upcoming: !disabled && !active && week - currentWeek <= 2,
    };
  });
}

/** Active commitments on a date, grouped by section. */
export function activeBySection(
  rampStart: ISODate,
  date: ISODate,
  overrides: CommitmentOverrides,
): Record<Section, ResolvedCommitment[]> {
  const groups: Record<Section, ResolvedCommitment[]> = {
    body: [],
    work: [],
    craft: [],
    life: [],
  };
  for (const c of resolveCommitments(rampStart, date, overrides)) {
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
): RingState[] {
  const groups = activeBySection(rampStart, date, overrides);
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
