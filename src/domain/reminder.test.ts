import { describe, expect, it } from 'vitest';
import { shouldShowExportReminder } from './reminder';

// 2026-07-26 is a Sunday; 2026-07-20 is the Monday that begins its week.
const SUNDAY = '2026-07-26';
const WEEK_START = '2026-07-20';
const MONDAY = '2026-07-27';

describe('the weekly export reminder', () => {
  it('shows on Sunday when enabled and not yet dismissed this week', () => {
    expect(shouldShowExportReminder({ enabled: true }, SUNDAY, WEEK_START)).toBe(true);
  });

  it('stays quiet on any day that is not Sunday', () => {
    expect(shouldShowExportReminder({ enabled: true }, MONDAY, WEEK_START)).toBe(false);
  });

  it('stays off entirely once disabled', () => {
    expect(shouldShowExportReminder({ enabled: false }, SUNDAY, WEEK_START)).toBe(false);
  });

  it('never nags twice for the same week once dismissed', () => {
    const dismissed = { enabled: true, dismissedWeek: WEEK_START };
    expect(shouldShowExportReminder(dismissed, SUNDAY, WEEK_START)).toBe(false);
  });

  it('re-arms the following Sunday, once the week has rolled over', () => {
    const dismissedLastWeek = { enabled: true, dismissedWeek: '2026-07-13' };
    expect(shouldShowExportReminder(dismissedLastWeek, SUNDAY, WEEK_START)).toBe(true);
  });
});
