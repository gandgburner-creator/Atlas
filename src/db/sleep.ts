import { db, type ClockTime, type ISODate, type SleepLog } from './schema';

export interface SleepEntryInput {
  date: ISODate;
  targetWake: ClockTime;
  actualWake: ClockTime;
  sleepOnset?: ClockTime;
  note?: string;
}

/**
 * Write today's entry. Keyed by date, so saving twice edits rather than
 * duplicates — the "already logged today, edit it" path is the same code.
 */
export async function saveSleepLog(input: SleepEntryInput): Promise<void> {
  const now = Date.now();
  const existing = await db.sleepLogs.get(input.date);
  await db.sleepLogs.put({
    ...input,
    // Drop empty optionals rather than storing '' — absent means absent.
    sleepOnset: input.sleepOnset || undefined,
    note: input.note?.trim() || undefined,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

export function getSleepLog(date: ISODate): Promise<SleepLog | undefined> {
  return db.sleepLogs.get(date);
}

/** All logs, oldest first. Small enough to hold in memory for years. */
export function allSleepLogs(): Promise<SleepLog[]> {
  return db.sleepLogs.orderBy('date').toArray();
}
