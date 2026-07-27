import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RAMP,
  effectiveStepIndex,
  isRampComplete,
  isWeekRepeated,
  rampLengthDays,
  targetFor,
  toggleRepeat,
  weekNumberFor,
  type RampConfig,
} from './ramp';
import { addDays } from './time';

const START = '2026-03-02'; // a Monday
const ramp: RampConfig = { ...DEFAULT_RAMP, startDate: START };

/** Day n of the ramp, 0-based. */
const day = (n: number) => addDays(START, n);

describe('targetFor', () => {
  it('holds the baseline before the ramp starts', () => {
    expect(targetFor(ramp, day(-1))).toBe('10:00');
    expect(targetFor(ramp, day(-40))).toBe('10:00');
  });

  it('steps 30 minutes earlier each week', () => {
    const expected = ['09:30', '09:00', '08:30', '08:00', '07:30', '07:00'];
    expected.forEach((t, week) => {
      expect(targetFor(ramp, day(week * 7))).toBe(t);
      expect(targetFor(ramp, day(week * 7 + 6))).toBe(t);
    });
  });

  it('holds the final target after the ramp completes', () => {
    expect(targetFor(ramp, day(42))).toBe('07:00');
    expect(targetFor(ramp, day(400))).toBe('07:00');
  });

  it('re-derives every target when the ramp definition changes', () => {
    // The whole point of storing a definition rather than dated targets.
    const gentler: RampConfig = {
      ...ramp,
      steps: ['09:45', '09:30', '09:15'],
    };
    expect(targetFor(gentler, day(0))).toBe('09:45');
    expect(targetFor(gentler, day(8))).toBe('09:30');
    expect(targetFor(gentler, day(30))).toBe('09:15');
  });
});

describe('weekNumberFor', () => {
  it('is null before the ramp starts', () => {
    expect(weekNumberFor(ramp, day(-1))).toBeNull();
  });

  it('is 1-based and clamped to the ramp length', () => {
    expect(weekNumberFor(ramp, day(0))).toBe(1);
    expect(weekNumberFor(ramp, day(21))).toBe(4);
    expect(weekNumberFor(ramp, day(41))).toBe(6);
    expect(weekNumberFor(ramp, day(200))).toBe(6);
  });
});

describe('repeat this week', () => {
  it('holds the current target for an extra week', () => {
    // Press repeat during week 2 (09:00).
    const held = toggleRepeat(ramp, day(10));

    expect(targetFor(held, day(10))).toBe('09:00'); // this week: unchanged
    expect(targetFor(held, day(17))).toBe('09:00'); // next week: held
    expect(targetFor(held, day(24))).toBe('08:30'); // then it resumes
    expect(weekNumberFor(held, day(17))).toBe(2);
    expect(weekNumberFor(held, day(24))).toBe(3);
  });

  it('does not shift weeks before the held one', () => {
    const held = toggleRepeat(ramp, day(10));
    expect(targetFor(held, day(0))).toBe('09:30');
    expect(targetFor(held, day(9))).toBe('09:00');
  });

  it('stacks across separate weeks', () => {
    let r = toggleRepeat(ramp, day(0)); // hold week 1
    r = toggleRepeat(r, day(10)); // during the held week, hold again
    expect(targetFor(r, day(7))).toBe('09:30');
    expect(targetFor(r, day(14))).toBe('09:30');
    expect(targetFor(r, day(21))).toBe('09:00');
  });

  it('is idempotent within one calendar week, and undoes itself', () => {
    const once = toggleRepeat(ramp, day(8));
    expect(isWeekRepeated(once, day(10))).toBe(true);

    // Pressing again the same week releases the hold rather than doubling it.
    const off = toggleRepeat(once, day(10));
    expect(isWeekRepeated(off, day(8))).toBe(false);
    expect(targetFor(off, day(14))).toBe(targetFor(ramp, day(14)));
  });

  it('ignores markers dated before the ramp started', () => {
    const bogus: RampConfig = { ...ramp, repeats: [day(-3)] };
    expect(targetFor(bogus, day(7))).toBe('09:00');
    expect(rampLengthDays(bogus)).toBe(42);
  });

  it('extends the ramp length so the chart makes room', () => {
    expect(rampLengthDays(ramp)).toBe(42);
    expect(rampLengthDays(toggleRepeat(ramp, day(10)))).toBe(49);
  });
});

describe('isRampComplete', () => {
  it('is false during the ramp and true once past the last step', () => {
    expect(isRampComplete(ramp, day(41))).toBe(false);
    expect(isRampComplete(ramp, day(42))).toBe(true);
  });

  it('accounts for held weeks', () => {
    const held = toggleRepeat(ramp, day(10));
    expect(isRampComplete(held, day(42))).toBe(false);
    expect(isRampComplete(held, day(49))).toBe(true);
  });
});

describe('effectiveStepIndex', () => {
  it('survives a DST transition without drifting a day', () => {
    // Europe/London springs forward on 2026-03-29, inside week 5 here.
    expect(effectiveStepIndex(ramp, day(27))).toBe(3);
    expect(effectiveStepIndex(ramp, day(28))).toBe(4);
    expect(effectiveStepIndex(ramp, day(35))).toBe(5);
  });
});
