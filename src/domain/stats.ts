import type { ISODate, SleepLog } from '../db/schema';
import { addDays, daysBetween, toClock, toMinutes } from './time';

/**
 * Average of clock times, wrap-safe.
 *
 * Plain minute averaging breaks across midnight: 23:50 and 00:10 average to
 * 12:00, not 00:00. Wake times cluster tightly, so anchoring on the first
 * sample and folding the rest into the ±12h window around it gives the right
 * answer without needing full vector circular statistics.
 */
export function averageClockTime(times: string[]): string | null {
  if (times.length === 0) return null;
  const anchor = toMinutes(times[0] as string);
  let sum = 0;
  for (const t of times) {
    let m = toMinutes(t);
    if (m - anchor > 720) m -= 1440;
    else if (anchor - m > 720) m += 1440;
    sum += m;
  }
  return toClock(sum / times.length);
}

/**
 * Mean wake time over the 7 calendar days ending at `endDate`, counting only
 * days that were logged. Missing days are absent from the mean, not zeroes —
 * a gap must never drag the average down.
 */
export function sevenDayAverageWake(
  logs: SleepLog[],
  endDate: ISODate,
): { average: string | null; daysCounted: number } {
  const start = addDays(endDate, -6);
  const inWindow = logs.filter(
    (l) => l.date >= start && l.date <= endDate && l.actualWake,
  );
  return {
    average: averageClockTime(inWindow.map((l) => l.actualWake)),
    daysCounted: inWindow.length,
  };
}

/**
 * How many days carry a log. Not a streak: this only ever counts up, and a
 * missed day costs nothing that was already earned.
 */
export function daysLogged(logs: SleepLog[]): number {
  return logs.filter((l) => Boolean(l.actualWake)).length;
}

/** Days elapsed since the ramp began, inclusive of today. */
export function daysSinceStart(startDate: ISODate, today: ISODate): number {
  return Math.max(0, daysBetween(startDate, today) + 1);
}
