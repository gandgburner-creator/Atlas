import { describe, expect, it } from 'vitest';
import {
  activeBySection,
  rampWeekOn,
  resolveCommitments,
  ringStates,
} from './commitments';

const START = '2026-07-06'; // a Monday

describe('the commitment engine', () => {
  it('ramps commitments in on their default weeks', () => {
    // Week 1: wake_time, training_log, weight_log. Nothing else.
    const w1 = resolveCommitments(START, '2026-07-08', {});
    expect(w1.filter((c) => c.active).map((c) => c.id)).toEqual([
      'wake_time',
      'training_log',
      'weight_log',
    ]);

    // Week 3 adds nutrition; week 10 has everything.
    const w3 = resolveCommitments(START, '2026-07-21', {});
    expect(w3.find((c) => c.id === 'nutrition')?.active).toBe(true);
    expect(w3.find((c) => c.id === 'rest_block')?.active).toBe(false);

    const w10 = resolveCommitments(START, '2026-09-08', {});
    expect(w10.every((c) => c.active)).toBe(true);
  });

  it('overrides move activation without touching code', () => {
    // Pull craft_hours from week 10 to week 2; push nutrition to week 8.
    const overrides = {
      craft_hours: { week: 2 },
      nutrition: { week: 8 },
    } as const;
    const w2 = resolveCommitments(START, '2026-07-14', overrides);
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
    const body = rings.find((r) => r.section === 'body')!;
    expect(body.total).toBe(3);
    expect(body.done).toBe(2);
    expect(body.fraction).toBeCloseTo(2 / 3, 5);
  });

  it('a section with nothing active is null — greyed, never a failure', () => {
    const rings = ringStates(START, '2026-07-08', {}, new Set());
    expect(rings.find((r) => r.section === 'craft')?.fraction).toBeNull();
    expect(rings.find((r) => r.section === 'life')?.fraction).toBeNull();
  });

  it('groups actives by section', () => {
    const groups = activeBySection(START, '2026-09-08', {});
    expect(groups.body.map((c) => c.id)).toContain('nutrition');
    expect(groups.craft.map((c) => c.id)).toEqual(['craft_hours']);
  });

  it('week numbering is 1-based from the ramp start', () => {
    expect(rampWeekOn(START, START)).toBe(1);
    expect(rampWeekOn(START, '2026-07-13')).toBe(2);
    expect(rampWeekOn(START, '2026-07-05')).toBe(0);
  });
});
