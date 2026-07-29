import { describe, expect, it } from 'vitest';
import {
  activeBySection,
  DEFAULT_MODULE_FLAGS,
  rampWeekOn,
  resolveCommitments,
  ringStates,
} from './commitments';

const START = '2026-07-06'; // a Monday
const ALL_ON = {
  ...DEFAULT_MODULE_FLAGS,
  work: true,
  craft: true,
  life: true,
};

describe('the commitment engine', () => {
  it('ramps commitments in on their default weeks', () => {
    // Week 1: wake_time, training_log, weight_log. Nothing else.
    const w1 = resolveCommitments(START, '2026-07-08', {});
    expect(w1.filter((c) => c.active).map((c) => c.id)).toEqual([
      'wake_time',
      'training_log',
      'weight_log',
    ]);

    // Week 3 adds nutrition; week 10, with every module switched on, has everything.
    const w3 = resolveCommitments(START, '2026-07-21', {});
    expect(w3.find((c) => c.id === 'nutrition')?.active).toBe(true);
    expect(w3.find((c) => c.id === 'rest_block')?.active).toBe(false);

    const w10 = resolveCommitments(START, '2026-09-08', {}, ALL_ON);
    expect(w10.every((c) => c.active)).toBe(true);
  });

  it('work/craft/life commitments never count while their module flag is off, regardless of week', () => {
    // Ramp week is 10, well past every default week — but the modules are
    // off by default, so none of their commitments count.
    const w10 = resolveCommitments(START, '2026-09-08', {});
    expect(w10.find((c) => c.id === 'craft_hours')?.active).toBe(false);
    expect(w10.find((c) => c.id === 'focus_hours')?.active).toBe(false);
    expect(w10.find((c) => c.id === 'rest_block')?.active).toBe(false);
    expect(w10.find((c) => c.id === 'calls')?.active).toBe(false);
    expect(w10.find((c) => c.id === 'craft_hours')?.upcoming).toBe(false);
  });

  it('switching a module flag back on resumes its commitment at its own ramp week', () => {
    const withCraftOn = { ...DEFAULT_MODULE_FLAGS, craft: true };
    const before = resolveCommitments(START, '2026-07-08', {}, withCraftOn); // week 1, craft starts week 10
    expect(before.find((c) => c.id === 'craft_hours')?.active).toBe(false);

    const after = resolveCommitments(START, '2026-09-08', {}, withCraftOn); // week 10
    expect(after.find((c) => c.id === 'craft_hours')?.active).toBe(true);
    // Other off-by-default modules stay off.
    expect(after.find((c) => c.id === 'focus_hours')?.active).toBe(false);
  });

  it('overrides move activation without touching code', () => {
    // Pull craft_hours from week 10 to week 2 (with craft switched on); push nutrition to week 8.
    const overrides = {
      craft_hours: { week: 2 },
      nutrition: { week: 8 },
    } as const;
    const w2 = resolveCommitments(START, '2026-07-14', overrides, ALL_ON);
    expect(w2.find((c) => c.id === 'craft_hours')?.active).toBe(true);
    expect(w2.find((c) => c.id === 'nutrition')?.active).toBe(false);
  });

  it('a disabled commitment stops counting entirely', () => {
    const w1 = resolveCommitments(START, '2026-07-08', {
      weight_log: { disabled: true },
    });
    expect(w1.find((c) => c.id === 'weight_log')?.active).toBe(false);
  });

  it('rings show fraction of active commitments done', () => {
    const rings = ringStates(
      START,
      '2026-07-08',
      {},
      new Set(['wake_time', 'weight_log']),
    );
    // train: training_log only; rest: wake_time only; fuel: weight_log (nutrition not ramped yet)
    const train = rings.find((r) => r.section === 'train')!;
    const rest = rings.find((r) => r.section === 'rest')!;
    const fuel = rings.find((r) => r.section === 'fuel')!;
    expect(train.total).toBe(1);
    expect(train.done).toBe(0);
    expect(rest.fraction).toBe(1);
    expect(fuel.fraction).toBe(1);
  });

  it('a section with nothing active is null — greyed, never a failure', () => {
    // Before the ramp has even started, nothing is active anywhere.
    const rings = ringStates(START, '2026-06-01', {}, new Set());
    expect(rings.find((r) => r.section === 'fuel')?.fraction).toBeNull();
    expect(rings.find((r) => r.section === 'train')?.fraction).toBeNull();
  });

  it('groups actives by section, and work/craft/life never appear under "other" unless switched on', () => {
    const groupsOff = activeBySection(START, '2026-09-08', {});
    expect(groupsOff.other).toEqual([]);

    const groupsOn = activeBySection(START, '2026-09-08', {}, ALL_ON);
    expect(groupsOn.other.map((c) => c.id).sort()).toEqual(
      ['calls', 'craft_hours', 'focus_hours', 'rest_block'].sort(),
    );
    expect(groupsOn.fuel.map((c) => c.id)).toContain('nutrition');
  });

  it('week numbering is 1-based from the ramp start', () => {
    expect(rampWeekOn(START, START)).toBe(1);
    expect(rampWeekOn(START, '2026-07-13')).toBe(2);
    expect(rampWeekOn(START, '2026-07-05')).toBe(0);
  });
});
