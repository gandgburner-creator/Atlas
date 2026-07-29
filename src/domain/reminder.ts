import type { ExportReminderState } from '../db/config';
import { fromISODate } from './time';

/**
 * Sundays only, and never twice for the same week — once dismissed, it
 * stays quiet until `dismissedWeek` (this Monday) no longer matches, which
 * only happens once the following Sunday rolls the week over.
 */
export function shouldShowExportReminder(
  state: ExportReminderState,
  today: string,
  weekStart: string,
): boolean {
  const isSunday = fromISODate(today).getDay() === 0;
  return state.enabled && isSunday && state.dismissedWeek !== weekStart;
}
