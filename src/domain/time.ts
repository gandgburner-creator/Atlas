import type { ClockTime, ISODate } from '../db/schema';

const MS_PER_DAY = 86_400_000;

/** Local calendar day for a Date, as 'YYYY-MM-DD'. */
export function toISODate(d: Date): ISODate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayISO(): ISODate {
  return toISODate(new Date());
}

/** Local midnight for an ISO date. Never `new Date(iso)` — that parses as UTC. */
export function fromISODate(iso: ISODate): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/**
 * Whole days from `from` to `to`. Both are snapped to local midnight first,
 * so DST transitions (a 23- or 25-hour day) can't produce a fractional day.
 */
export function daysBetween(from: ISODate, to: ISODate): number {
  const a = fromISODate(from).getTime();
  const b = fromISODate(to).getTime();
  return Math.round((b - a) / MS_PER_DAY);
}

export function addDays(iso: ISODate, n: number): ISODate {
  const d = fromISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/** 'HH:MM' → minutes past midnight. */
export function toMinutes(t: ClockTime): number {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Minutes past midnight → 'HH:MM'. Wraps at the day boundary. */
export function toClock(minutes: number): ClockTime {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function nowClock(): ClockTime {
  const d = new Date();
  return toClock(d.getHours() * 60 + d.getMinutes());
}

/** 'Sunday' — safe to set in Caveat, because it holds no digits. */
export function formatWeekday(iso: ISODate): string {
  return fromISODate(iso).toLocaleDateString(undefined, { weekday: 'long' });
}

/** '26 Jul' — contains a numeral, so it must be set in Outfit. */
export function formatDayLabel(iso: ISODate): string {
  return fromISODate(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}

/**
 * Signed difference actual − target, as human text: "18m later than target".
 * A statement of fact, not a score — there's no threshold at which it changes
 * tone or colour.
 *
 * Returns null past three hours out. The wake field defaults to *now*, so
 * opening the app at teatime would otherwise read "9h 28m later than target",
 * which is both useless and the exact flavour of nagging this app doesn't do.
 */
export function describeDelta(
  actual: ClockTime,
  target: ClockTime,
): string | null {
  const diff = toMinutes(actual) - toMinutes(target);
  if (Math.abs(diff) > 180) return null;
  if (diff === 0) return 'exactly on target';
  const mag = Math.abs(diff);
  const h = Math.floor(mag / 60);
  const m = mag % 60;
  const parts = [h > 0 ? `${h}h` : null, m > 0 ? `${m}m` : null].filter(Boolean);
  return `${parts.join(' ')} ${diff > 0 ? 'later' : 'earlier'} than target`;
}
