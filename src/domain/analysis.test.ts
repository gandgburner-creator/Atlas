import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * The analysis export exists to be pasted into a chat, so its two hard
 * requirements are: it must contain the numbers, and it must contain
 * nothing that only means something inside this app — no row ids, no
 * epoch timestamps.
 */

const TODAY = '2026-07-29';

describe('analysis markdown export', () => {
  let db: typeof import('../db/schema').db;
  let analysis: typeof import('./analysis');

  beforeEach(async () => {
    const schema = await import('../db/schema');
    await schema.db.delete();
    await schema.db.open();
    db = schema.db;
    analysis = await import('./analysis');
  });

  it('includes a finished session with its sets, and excludes an in_progress one', async () => {
    await db.workouts.add({
      date: '2026-07-28',
      sessionType: 'back',
      exercises: [{ name: 'Pull-ups', sets: [{ reps: 8, weight: 0 }, { reps: 7, weight: 0 }] }],
      status: 'complete',
    });
    await db.workouts.add({
      date: '2026-07-29',
      sessionType: 'chest',
      exercises: [],
      status: 'in_progress',
    });

    const md = await analysis.buildAnalysisMarkdown('30', TODAY);
    expect(md).toContain('Pull-ups');
    expect(md).toContain('8, 7');
    // The in_progress session gets no heading of its own in the log.
    expect(md).not.toContain('### Jul 29 — chest');
  });

  it('never leaks an epoch timestamp', async () => {
    await db.workouts.add({
      date: '2026-07-28',
      sessionType: 'back',
      exercises: [{ name: 'Bench', sets: [{ reps: 8, weight: 80 }] }],
      status: 'complete',
    });
    await db.focusSessions.add({
      start: Date.UTC(2026, 6, 28, 9, 0),
      end: Date.UTC(2026, 6, 28, 10, 0),
      intent: 'ship the thing',
      tag: 'deep',
      satisfaction: 4,
      completed: true,
      area: 'work',
    });

    const md = await analysis.buildAnalysisMarkdown('30', TODAY);
    // No 13-digit epoch millis anywhere in the document.
    expect(md).not.toMatch(/\b1\d{12}\b/);
  });

  it('restricts to the selected range', async () => {
    await db.weightLogs.add({ date: '2026-06-01', kg: 95 });
    await db.weightLogs.add({ date: '2026-07-25', kg: 91 });

    const last7 = await analysis.buildAnalysisMarkdown('7', TODAY);
    expect(last7).toContain('91.0');
    expect(last7).not.toContain('95.0');

    const all = await analysis.buildAnalysisMarkdown('all', TODAY);
    expect(all).toContain('91.0');
    expect(all).toContain('95.0');
  });

  it('aggregates focus sessions into hours by tag, not raw timestamps', async () => {
    await db.focusSessions.add({
      start: Date.UTC(2026, 6, 28, 9, 0),
      end: Date.UTC(2026, 6, 28, 11, 0),
      intent: '',
      tag: 'deep',
      satisfaction: 4,
      completed: true,
      area: 'work',
    });
    // A still-running session (no `end`) must never crash the export.
    await db.focusSessions.add({ start: Date.now(), intent: '', tag: 'deep', area: 'work' });

    const md = await analysis.buildAnalysisMarkdown('30', TODAY);
    expect(md).toContain('| deep | 2.0 | 0.0 |');
  });
});
