import type { ISODate, WeightLog } from '../db/schema';
import type { WeightPlan } from '../db/config';
import { addDays, daysBetween, fromISODate, toISODate } from './time';

/**
 * Weight math. The headline is always the 7-day rolling average — the daily
 * number is noise (creatine water retention will mask real change for
 * weeks), so it renders small and secondary everywhere.
 */

/** Latest log per day, ascending by date. */
export function byDay(logs: WeightLog[]): WeightLog[] {
  const map = new Map<string, number>();
  for (const l of logs) map.set(l.date, l.kg);
  return [...map.entries()]
    .map(([date, kg]) => ({ date, kg }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Rolling 7-day average ending on each logged day. Days without a log are
 * absent from the window, not zeroes — a gap must never drag the average.
 */
export function rollingAverageSeries(
  logs: WeightLog[],
): { date: ISODate; kg: number; avg: number }[] {
  const days = byDay(logs);
  return days.map((d, i) => {
    const from = addDays(d.date, -6);
    const window = days.filter(
      (x, j) => j <= i && x.date >= from && x.date <= d.date,
    );
    const avg = window.reduce((s, x) => s + x.kg, 0) / window.length;
    return { date: d.date, kg: d.kg, avg };
  });
}

export function latestRollingAvg(logs: WeightLog[]): number | null {
  const s = rollingAverageSeries(logs);
  return s.length ? (s[s.length - 1]?.avg ?? null) : null;
}

/**
 * Observed rate: least-squares slope of the rolling average over the last 28
 * days of logs, falling back to 21 then 14. Below 14 days of data the answer
 * is null — a date computed from noise is worse than no date.
 * Positive result = losing weight, in kg/week.
 */
export function observedRate(
  logs: WeightLog[],
  today: ISODate,
): { ratePerWeek: number; windowDays: number } | null {
  const series = rollingAverageSeries(logs);
  for (const windowDays of [28, 21, 14]) {
    const from = addDays(today, -windowDays);
    const pts = series.filter((p) => p.date >= from && p.date <= today);
    if (pts.length < 2) continue;
    const first = pts[0]?.date;
    const last = pts[pts.length - 1]?.date;
    if (!first || !last) continue;
    // The data must actually span the window it claims to be fitted over —
    // 14 days of window needs 14 days of history, or the answer is noise.
    if (daysBetween(first, last) < windowDays - 1) continue;

    const xs = pts.map((p) => daysBetween(first, p.date));
    const ys = pts.map((p) => p.avg);
    const n = xs.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += ((xs[i] ?? 0) - mx) * ((ys[i] ?? 0) - my);
      den += ((xs[i] ?? 0) - mx) ** 2;
    }
    if (den === 0) continue;
    const slopePerDay = num / den;
    // Loss is a negative slope; report as positive kg/week lost.
    return { ratePerWeek: -slopePerDay * 7, windowDays };
  }
  return null;
}

/**
 * The dashed target line: a straight ramp from the plan anchor to the target
 * date. Anchored at 100 kg on the ramp's first weigh-in era; drawn from
 * whatever the plan says so editing the plan redraws history too.
 */
export function targetLineAt(
  plan: WeightPlan,
  anchorDate: ISODate,
  anchorKg: number,
  date: ISODate,
): number {
  const total = Math.max(1, daysBetween(anchorDate, plan.targetDate));
  const t = Math.min(1, Math.max(0, daysBetween(anchorDate, date) / total));
  return anchorKg + (plan.targetKg - anchorKg) * t;
}

/** Date the target line crosses each milestone, for the little markers. */
export function milestoneDates(
  plan: WeightPlan,
  anchorDate: ISODate,
  anchorKg: number,
): { kg: number; date: ISODate }[] {
  const total = Math.max(1, daysBetween(anchorDate, plan.targetDate));
  const drop = anchorKg - plan.targetKg;
  if (drop <= 0) return [];
  return plan.milestonesKg
    .filter((kg) => kg < anchorKg && kg >= plan.targetKg)
    .map((kg) => {
      const t = (anchorKg - kg) / drop;
      const d = fromISODate(anchorDate);
      d.setDate(d.getDate() + Math.round(t * total));
      return { kg, date: toISODate(d) };
    });
}
