import { describe, expect, it } from 'vitest';
import {
  adjustRest,
  formatRest,
  parseStoredTimer,
  restDone,
  restFraction,
  restRemaining,
  RESTORE_GRACE_MS,
  type RestTimerState,
} from './rest';

const T0 = 1_800_000_000_000; // arbitrary fixed "now"
const timer = (endsAt: number, total = 180): RestTimerState => ({
  exercise: 'Barbell row',
  endsAt,
  total,
});

describe('rest timer survives being backgrounded', () => {
  it('reads correctly the instant the app returns, however long it was away', () => {
    // A 3-minute rest started at T0. iOS throttles or kills the interval the
    // moment the screen locks, so the only thing that can be trusted is the
    // deadline — these are the readings a returning app would take.
    const t = timer(T0 + 180_000);

    expect(restRemaining(t, T0)).toBe(180_000);
    expect(restRemaining(t, T0 + 60_000)).toBe(120_000); // 1 min later
    expect(restRemaining(t, T0 + 179_000)).toBe(1_000); // nearly up

    // Backgrounded for a full hour: still correct, still floored at zero,
    // never a negative countdown that keeps running.
    expect(restRemaining(t, T0 + 3_600_000)).toBe(0);
    expect(restDone(t, T0 + 3_600_000)).toBe(true);
  });

  it('reports done the moment the deadline passes, not a tick later', () => {
    const t = timer(T0 + 1000);
    expect(restDone(t, T0 + 999)).toBe(false);
    expect(restDone(t, T0 + 1000)).toBe(true);
    expect(restDone(t, T0 + 1001)).toBe(true);
  });

  it('is inert with no timer running', () => {
    expect(restRemaining(null, T0)).toBe(0);
    expect(restDone(null, T0)).toBe(false);
    expect(restFraction(null, T0)).toBe(0);
  });
});

describe('the ring fraction', () => {
  it('runs 1 → 0 across the rest and clamps at both ends', () => {
    const t = timer(T0 + 120_000, 120);
    expect(restFraction(t, T0)).toBe(1);
    expect(restFraction(t, T0 + 60_000)).toBeCloseTo(0.5, 5);
    expect(restFraction(t, T0 + 120_000)).toBe(0);
    // Long overdue must not drive the ring negative.
    expect(restFraction(t, T0 + 999_999)).toBe(0);
  });

  it('clamps above 1 when the timer was extended past its original length', () => {
    // +60s onto a 120s timer with 120s still on the clock: more time
    // remains than `total` accounts for, and the ring must not overfill.
    const t = timer(T0 + 180_000, 120);
    expect(restFraction(t, T0)).toBe(1);
  });
});

describe('adjusting a running timer', () => {
  it('shifts the deadline and the ring length together', () => {
    const t = timer(T0 + 120_000, 120);
    const longer = adjustRest(t, 30, T0);
    expect(longer.endsAt).toBe(T0 + 150_000);
    expect(longer.total).toBe(150);
  });

  it('never pushes the deadline into the past', () => {
    // −30 with only 10s left: lands on zero rather than 20s overdue, so the
    // alarm fires now instead of appearing to have already been missed.
    const t = timer(T0 + 10_000, 120);
    const shorter = adjustRest(t, -30, T0);
    expect(shorter.endsAt).toBe(T0);
    expect(restRemaining(shorter, T0)).toBe(0);
    expect(restDone(shorter, T0)).toBe(true);
  });
});

describe('restoring a stored timer', () => {
  it('restores one that is still running', () => {
    const raw = JSON.stringify(timer(T0 + 90_000));
    expect(parseStoredTimer(raw, T0)?.endsAt).toBe(T0 + 90_000);
  });

  it('still restores one that finished moments ago, so the alarm state is visible', () => {
    const raw = JSON.stringify(timer(T0 - 30_000));
    expect(parseStoredTimer(raw, T0)).not.toBeNull();
  });

  it('drops one long past its grace window — that is yesterday, not now', () => {
    const raw = JSON.stringify(timer(T0 - RESTORE_GRACE_MS - 1));
    expect(parseStoredTimer(raw, T0)).toBeNull();
  });

  it('survives absent, malformed and half-written values', () => {
    expect(parseStoredTimer(null, T0)).toBeNull();
    expect(parseStoredTimer('not json', T0)).toBeNull();
    expect(parseStoredTimer('{"exercise":"Squat"}', T0)).toBeNull();
    expect(parseStoredTimer('{"endsAt":"soon","total":90}', T0)).toBeNull();
  });
});

describe('the clock face', () => {
  it('formats as m:ss with a padded seconds field', () => {
    expect(formatRest(180_000)).toBe('3:00');
    expect(formatRest(65_000)).toBe('1:05');
    expect(formatRest(9_000)).toBe('0:09');
    expect(formatRest(0)).toBe('0:00');
  });

  it('never shows a negative clock', () => {
    expect(formatRest(-5_000)).toBe('0:00');
  });
});
