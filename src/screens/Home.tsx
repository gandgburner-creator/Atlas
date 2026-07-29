import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '../components/Button';
import { Icon, type IconName } from '../components/Icon';
import { Ring } from '../components/Ring';
import { SketchCard } from '../components/Sketch';
import {
  deleteWorkout,
  finishTrainingSession,
  getCommitmentOverrides,
  getExportReminder,
  getLastFinish,
  getStaleInProgressWorkout,
  saveExportReminder,
  undoLastFinish,
} from '../db/config';
import {
  resolveCommitments,
  ringStates,
  type CommitmentId,
  type ResolvedCommitment,
} from '../domain/commitments';
import type { RampConfig } from '../domain/ramp';
import { shouldShowExportReminder } from '../domain/reminder';
import { formatHours, summariseDay } from '../domain/today';
import { formatDayLabel, formatWeekday, weekStartOf } from '../domain/time';
import { useNav, type Tab } from '../nav';

interface Props {
  ramp: RampConfig;
  today: string;
}

const ITEM_ICON: Record<CommitmentId, IconName> = {
  wake_time: 'sleep',
  training_log: 'lift',
  weight_log: 'weigh',
  nutrition: 'food',
  rest_block: 'life',
  calls: 'call',
  focus_hours: 'focus',
  craft_hours: 'craft',
};

/** Where one tap on a checklist row lands. */
const ITEM_TAB: Record<CommitmentId, Tab> = {
  wake_time: 'today',
  training_log: 'body',
  weight_log: 'body',
  nutrition: 'body',
  rest_block: 'life',
  calls: 'life',
  focus_hours: 'work',
  craft_hours: 'craft',
};

export function Home({ ramp, today }: Props) {
  const nav = useNav();
  const [discarding, setDiscarding] = useState(false);
  const [busy, setBusy] = useState(false);

  // summariseDay queries every table that feeds done-ness, so the live query
  // re-runs whenever any of them changes.
  const data = useLiveQuery(async () => {
    const overrides = (await getCommitmentOverrides()) ?? {};
    const summary = await summariseDay(today);
    const lastFinish = await getLastFinish();
    // A session left in_progress from an earlier day — never auto-closed,
    // never silently resumed (that's only for today's own session), just
    // surfaced here with a choice.
    const stale = await getStaleInProgressWorkout(today);
    const exportReminder = await getExportReminder();
    return { overrides, summary, lastFinish, stale, exportReminder };
  }, [today]);

  if (!data) return null;
  const { overrides, summary, lastFinish, stale, exportReminder } = data;
  const canUndo = lastFinish?.date === today;
  const weekStart = weekStartOf(today);
  const showExportReminder = shouldShowExportReminder(exportReminder, today, weekStart);

  async function dismissExportReminder() {
    await saveExportReminder({ ...exportReminder, dismissedWeek: weekStart });
  }

  async function undo() {
    await undoLastFinish();
    nav.push({ name: 'training-log' });
  }

  async function finishStale() {
    if (!stale?.id) return;
    setBusy(true);
    try {
      await finishTrainingSession(stale.id, today);
    } finally {
      setBusy(false);
    }
  }

  async function discardStale() {
    if (!stale?.id) return;
    setBusy(true);
    try {
      await deleteWorkout(stale.id);
      setDiscarding(false);
    } finally {
      setBusy(false);
    }
  }

  const rings = ringStates(ramp.startDate, today, overrides, summary.doneIds);
  const commitments = resolveCommitments(ramp.startDate, today, overrides);
  const active = commitments.filter((c) => c.active);
  const upcoming = commitments.filter((c) => c.upcoming);

  function open(c: ResolvedCommitment) {
    if (c.id === 'wake_time') nav.push({ name: 'sleep' });
    else if (c.id === 'training_log') nav.push({ name: 'training-log' });
    else nav.setTab(ITEM_TAB[c.id]);
  }

  function detail(c: ResolvedCommitment): string | null {
    switch (c.id) {
      case 'nutrition':
        return summary.kcalToday > 0
          ? `${summary.kcalToday.toLocaleString()} of ${summary.kcalTarget.toLocaleString()} kcal`
          : null;
      case 'focus_hours':
        return `${formatHours(summary.focusMinToday)} of ${formatHours(summary.focusGoalMin)}`;
      case 'craft_hours':
        return `${formatHours(summary.craftMinToday)} of ${formatHours(summary.craftGoalMin)}`;
      case 'training_log':
        return summary.trainingPaused
          ? 'paused'
          : summary.trainingSession === 'rest'
            ? 'rest day'
            : summary.trainingSession;
      default:
        return null;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <h1 className="hand text-[40px]">{formatWeekday(today)}</h1>
          <span className="tnum caption">{formatDayLabel(today)}</span>
        </div>
        <button
          onClick={() => nav.push({ name: 'settings' })}
          aria-label="Settings"
          className="flex h-12 w-12 items-center justify-center text-[var(--ink-muted)]"
        >
          <Icon name="settings" size={22} />
        </button>
      </header>

      {/* Four rings. Greyed = nothing scheduled, never a failure. */}
      <SketchCard className="px-3 pt-5 pb-4">
        <div className="grid grid-cols-4">
          {rings.map((r) => (
            <button
              key={r.section}
              onClick={() => nav.setTab(r.section as Tab)}
              className="flex flex-col items-center"
            >
              <Ring
                section={r.section}
                fraction={r.fraction}
                size={72}
                label={r.label}
                sub={
                  r.fraction === null
                    ? undefined
                    : `${r.done} of ${r.total}`
                }
              />
            </button>
          ))}
        </div>
      </SketchCard>

      {/* Sunday nudge — dismissible, and never twice for the same week. */}
      {showExportReminder && (
        <SketchCard filter="rough2" className="flex items-center gap-3 px-4 py-3">
          <p className="flex-1 text-[14px] leading-snug">
            <span className="hand text-[20px]">weekly export</span> — back up
            or paste an update into a chat.
          </p>
          <Button
            variant="secondary"
            onClick={() => nav.push({ name: 'export' })}
            className="shrink-0 px-3 text-[14px]"
          >
            Open
          </Button>
          <button
            onClick={dismissExportReminder}
            aria-label="dismiss weekly export reminder"
            className="shrink-0 text-[16px] text-[var(--ink-muted)]"
          >
            ×
          </button>
        </SketchCard>
      )}

      {/* Undo stays available for the rest of the day it was finished on. */}
      {canUndo && (
        <SketchCard filter="rough2" className="flex items-center gap-3 px-4 py-3">
          <p className="flex-1 text-[14px] leading-snug">
            <span className="hand text-[20px]">{lastFinish!.sessionType}</span> was
            just finished.
          </p>
          <Button variant="secondary" onClick={undo} className="shrink-0 px-3 text-[14px]">
            Undo
          </Button>
        </SketchCard>
      )}

      {/* A session left open from an earlier day — never auto-closed, never
          blocks today's own session, just needs a decision. */}
      {stale && (
        <SketchCard filter="rough2" className="px-4 py-3">
          <p className="text-[14px] leading-snug">
            <span className="hand text-[20px]">{stale.sessionType}</span> from{' '}
            {formatDayLabel(stale.date)} is still open.
          </p>
          {discarding ? (
            <div className="mt-2 flex gap-2">
              <p className="caption flex-1 self-center">Discard it? This can't be undone.</p>
              <Button variant="secondary" onClick={() => setDiscarding(false)} className="shrink-0 px-3 text-[14px]">
                Keep it
              </Button>
              <Button onClick={discardStale} disabled={busy} className="shrink-0 px-3 text-[14px]">
                Discard
              </Button>
            </div>
          ) : (
            <div className="mt-2 flex gap-2">
              <Button variant="secondary" onClick={() => setDiscarding(true)} disabled={busy} className="flex-1 text-[14px]">
                Discard
              </Button>
              <Button onClick={finishStale} disabled={busy} className="flex-1 text-[14px]">
                Finish it
              </Button>
            </div>
          )}
        </SketchCard>
      )}

      {/* Today's checklist — every row is one tap from done. */}
      <section className="flex flex-col gap-2.5">
        {active.map((c) => {
          const done = summary.doneIds.has(c.id);
          const sub = detail(c);
          return (
            <button key={c.id} onClick={() => open(c)} className="text-left">
              <SketchCard
                filter={done ? 'rough2' : 'rough'}
                stroke={done ? 'var(--success)' : 'var(--ink)'}
                className="px-4 py-3"
              >
                <div className="flex items-center gap-3.5">
                  <span
                    style={{
                      color: done ? 'var(--success)' : 'var(--ink-muted)',
                    }}
                  >
                    <Icon name={done ? 'check' : ITEM_ICON[c.id]} size={26} strokeWidth={done ? 3 : 2.4} />
                  </span>
                  <span
                    className="hand flex-1 text-[24px]"
                    style={{
                      color: done ? 'var(--success)' : 'var(--ink)',
                    }}
                  >
                    {c.label}
                  </span>
                  {sub && <span className="tnum caption">{sub}</span>}
                </div>
              </SketchCard>
            </button>
          );
        })}

        {active.length === 0 && (
          <SketchCard className="px-5 py-6">
            <p className="hand text-[24px] text-[var(--ink-muted)]">
              nothing scheduled yet
            </p>
            <p className="caption mt-1">
              Commitments ramp in from settings. Every module already works if
              you want to log something anyway.
            </p>
          </SketchCard>
        )}

        {upcoming.length > 0 && (
          <p className="caption px-1 pt-1">
            coming up:{' '}
            {upcoming.map((c) => `${c.label} (wk ${c.week})`).join(' · ')}
          </p>
        )}
      </section>
    </div>
  );
}
