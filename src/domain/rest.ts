/**
 * Rest-timer arithmetic, kept pure and away from React.
 *
 * The whole design rests on one rule: a rest timer is an ABSOLUTE DEADLINE,
 * never a countdown. Nothing accumulates elapsed time, because on iOS
 * nothing is allowed to — intervals throttle to a crawl when the app is
 * backgrounded and stop dead when the screen locks, so a timer that counted
 * its own ticks would come back minutes wrong. Every reading here is a
 * subtraction against a clock the platform can't suspend, which is why the
 * bar is correct the instant it's back on screen no matter how long the app
 * was away.
 */

export interface RestTimerState {
  exercise: string;
  /** Epoch ms. The single source of truth. */
  endsAt: number;
  /** Seconds the timer was set for — for the ring's fraction only. */
  total: number;
}

/** Milliseconds left, floored at zero. */
export function restRemaining(timer: RestTimerState | null, now: number): number {
  if (!timer) return 0;
  return Math.max(0, timer.endsAt - now);
}

export function restDone(timer: RestTimerState | null, now: number): boolean {
  return timer !== null && restRemaining(timer, now) <= 0;
}

/** 1 → just started, 0 → over. Clamped, so an adjusted timer can't overfill
 * the ring or drive it negative. */
export function restFraction(timer: RestTimerState | null, now: number): number {
  if (!timer || timer.total <= 0) return 0;
  return Math.min(1, Math.max(0, restRemaining(timer, now) / (timer.total * 1000)));
}

/** 'm:ss'. Digits are set in Outfit with tabular figures by the caller. */
export function formatRest(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * A timer stays restorable for a couple of minutes past its deadline: coming
 * back to a bar that says "next set" is how you confirm the alarm actually
 * fired while you were away. Older than that and it's yesterday's business.
 */
export const RESTORE_GRACE_MS = 120_000;

export function parseStoredTimer(raw: string | null, now: number): RestTimerState | null {
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as Partial<RestTimerState>;
    if (typeof t.endsAt !== 'number' || typeof t.total !== 'number') return null;
    if (t.endsAt <= now - RESTORE_GRACE_MS) return null;
    return { exercise: String(t.exercise ?? ''), endsAt: t.endsAt, total: t.total };
  } catch {
    return null;
  }
}

/** Shifting a running timer. The deadline can never move into the past, so
 * "−30" on a timer with 10s left lands on zero rather than going negative. */
export function adjustRest(
  timer: RestTimerState,
  deltaSec: number,
  now: number,
): RestTimerState {
  return {
    ...timer,
    endsAt: Math.max(now, timer.endsAt + deltaSec * 1000),
    total: Math.max(1, timer.total + deltaSec),
  };
}
