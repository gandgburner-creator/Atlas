import { describe, expect, it } from 'vitest';
import {
  caloriesWarning,
  hoursAsleep,
  kcalFromMacros,
  setLoadWarning,
  sleepOnsetWarning,
} from './plausible';

describe('sleep onset', () => {
  it('measures across midnight', () => {
    expect(hoursAsleep('02:00', '08:00')).toBe(6);
    expect(hoursAsleep('23:20', '08:20')).toBe(9);
  });

  it('flags the AM/PM slip that put bedtime at lunchtime', () => {
    // The three real cases from the backup: a 13:0x onset against a
    // morning wake reads as most of a day in bed.
    expect(sleepOnsetWarning('13:00', '08:02')).toMatch(/19h/);
    expect(sleepOnsetWarning('13:07', '10:18')).toMatch(/21h/);
    expect(sleepOnsetWarning('13:31', '11:00')).toMatch(/21h/);
  });

  it('suggests the time twelve hours away, which is what the slip produces', () => {
    expect(sleepOnsetWarning('13:00', '08:02')).toContain('01:00');
  });

  it('says nothing about an ordinary night', () => {
    expect(sleepOnsetWarning('02:00', '09:30')).toBeNull();
    expect(sleepOnsetWarning('23:20', '08:20')).toBeNull();
    expect(sleepOnsetWarning('03:40', '10:00')).toBeNull();
  });

  it('leaves a night shift alone — it checks the span, not the hour', () => {
    // Asleep at 09:00, up at 16:00. Odd for most people, seven hours for
    // this one, and a fixed "bedtime must be in the evening" band would
    // cry wolf about it every single day.
    expect(sleepOnsetWarning('09:00', '16:00')).toBeNull();
  });

  it('flags a span too short to be a night', () => {
    expect(sleepOnsetWarning('06:00', '07:00')).toMatch(/only 1h/);
  });

  it('has nothing to say when either time is missing', () => {
    expect(sleepOnsetWarning(undefined, '08:00')).toBeNull();
    expect(sleepOnsetWarning('02:00', undefined)).toBeNull();
  });
});

describe('set load', () => {
  it('flags the dropped digit', () => {
    // The real case: 80, 80, 80, then 8.
    expect(setLoadWarning(8, [80, 80, 80])).toMatch(/80 kg/);
  });

  it('says nothing about a normal drop set or a top set', () => {
    expect(setLoadWarning(60, [80, 80, 80])).toBeNull();
    expect(setLoadWarning(100, [80, 80, 80])).toBeNull();
  });

  it('waits for two prior sets before calling a third one wrong', () => {
    expect(setLoadWarning(8, [80])).toBeNull();
    expect(setLoadWarning(8, [])).toBeNull();
  });

  it('never flags bodyweight work, which is zero by design', () => {
    expect(setLoadWarning(0, [0, 0, 0])).toBeNull();
    expect(setLoadWarning(8, [0, 0, 0])).toBeNull();
  });

  it('says nothing when the whole session moved together', () => {
    // A deload is every set lighter, not one set out of line.
    expect(setLoadWarning(40, [40, 40])).toBeNull();
  });
});

describe('calories against macros', () => {
  it('adds up the way a label does', () => {
    expect(kcalFromMacros(82, 75, 15)).toBe(763);
  });

  it('flags an entry that clearly does not reconcile', () => {
    expect(caloriesWarning(950, 82, 75, 15)).toMatch(/763/);
    expect(caloriesWarning(500, 82, 75, 15)).toMatch(/763/);
  });

  it('tolerates the few percent a real label is out by', () => {
    // Rounding, fibre and sugar alcohols mean stated calories and stated
    // macros rarely agree exactly, and this app treats the LABEL as
    // authoritative on purpose — so the tolerance is loose.
    expect(caloriesWarning(790, 82, 75, 15)).toBeNull();
  });

  it('leaves the backup\'s own quick-add row alone, at 7.5% out', () => {
    // 82p + 75c + 15f is 763, logged as 820. Cited in the bug report, but
    // it sits inside the 10% tolerance that same report asked for. Pinned
    // here so the gap between the example and the threshold is a decision
    // on the record rather than something to rediscover.
    expect(caloriesWarning(820, 82, 75, 15)).toBeNull();
  });

  it('says nothing when there is nothing to compare', () => {
    expect(caloriesWarning(0, 82, 75, 15)).toBeNull();
    expect(caloriesWarning(820, 0, 0, 0)).toBeNull();
  });
});
