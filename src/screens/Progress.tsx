import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { allSleepLogs } from '../db/sleep';
import { Button } from '../components/Button';
import { DashedRule, SketchBorder, SketchCard } from '../components/Sketch';
import { getWeightPlan } from '../db/config';
import { db } from '../db/schema';
import type { ModuleFlags } from '../domain/commitments';
import {
  isRampComplete,
  isWeekRepeated,
  type RampConfig,
  weekNumberFor,
} from '../domain/ramp';
import { daysLogged, sevenDayAverageWake } from '../domain/stats';
import { addDays, formatDayLabel, fromISODate, weekStartOf } from '../domain/time';
import { formatHours } from '../domain/today';
import { latestRollingAvg, rollingAverageSeries } from '../domain/weight';
import { SleepChart } from './SleepChart';
import { WeightChart } from './WeightChart';

interface Props {
  ramp: RampConfig;
  today: string;
  moduleFlags: ModuleFlags;
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="hand text-[22px]">{label}</span>
      <span className="tnum text-[34px] leading-none font-semibold tracking-[-0.02em]">
        {value}
      </span>
      {sub && <span className="caption">{sub}</span>}
    </div>
  );
}

export function Progress({ ramp, today, moduleFlags }: Props) {
  const logs = useLiveQuery(() => allSleepLogs(), []);

  const weekStart = weekStartOf(today);
  const other = useLiveQuery(async () => {
    const [weights, plan, workouts, letter] = await Promise.all([
      db.weightLogs.toArray(),
      getWeightPlan(),
      db.workouts.where('date').aboveOrEqual(weekStart).toArray(),
      db.letters.get(weekStart),
    ]);
    const t0 = fromISODate(weekStart).getTime();
    const sessions = await db.focusSessions
      .where('start')
      .aboveOrEqual(t0)
      .toArray();
    return { weights, plan, workouts, letter, sessions };
  }, [weekStart]);

  if (!logs) return null;

  const week = weekNumberFor(ramp, today);
  const complete = isRampComplete(ramp, today);
  const repeated = isWeekRepeated(ramp, today);
  const { average, daysCounted } = sevenDayAverageWake(logs, today);
  const total = daysLogged(logs);

  const weightSeries = other ? rollingAverageSeries(other.weights) : [];
  const weightAvg = other ? latestRollingAvg(other.weights) : null;
  const focusMin = (area: 'work' | 'craft') =>
    (other?.sessions ?? [])
      // completed is only ever set once a session ends, so it implies `end` is set too.
      .filter((s) => (s.area ?? 'work') === area && s.completed)
      .reduce((sum, s) => sum + (s.end! - s.start) / 60000, 0);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="hand text-[40px]">Progress</h1>
        <span className="annot shrink-0">
          week of {formatDayLabel(weekStart)}
        </span>
      </header>

      {/* ── Sleep — slice 1, intact ────────────────────────────────────── */}
      <SketchCard className="px-4 pt-4 pb-3">
        <div className="flex items-baseline justify-between">
          <span className="hand text-[26px]">the ramp</span>
          <span className="tnum caption font-semibold">
            {ramp.steps[0]} → {ramp.steps[ramp.steps.length - 1]}
          </span>
        </div>
        <div className="mt-3">
          <SleepChart ramp={ramp} logs={logs} today={today} />
        </div>
        <DashedRule className="mt-2 pt-3" />
        <div className="flex flex-wrap items-center gap-4 pt-2">
          <span className="caption flex items-center gap-2">
            <svg width="22" height="8" aria-hidden="true">
              <path
                d="M1 5 Q7 1 12 5 T21 4"
                stroke="var(--ink)"
                strokeWidth="2.6"
                fill="none"
                strokeLinecap="round"
              />
            </svg>
            actual
          </span>
          <span className="caption flex items-center gap-2">
            <svg width="22" height="8" aria-hidden="true">
              <path
                d="M1 4h20"
                stroke="var(--accent)"
                strokeWidth="2.2"
                strokeDasharray="6 5"
                strokeLinecap="round"
              />
            </svg>
            target
          </span>
        </div>
      </SketchCard>

      <section className="grid grid-cols-2 gap-x-4 gap-y-6">
        <Stat
          label="week"
          value={week === null ? '—' : `${week}`}
          sub={
            week === null
              ? 'ramp not started'
              : repeated
                ? 'repeating this week'
                : complete
                  ? `holding at ${ramp.steps[ramp.steps.length - 1]}`
                  : `of ${ramp.steps.length}`
          }
        />
        <Stat
          label="7-day average"
          value={average ?? '—'}
          sub={
            daysCounted === 0
              ? 'no days logged this week'
              : `from ${daysCounted} logged ${daysCounted === 1 ? 'day' : 'days'}`
          }
        />
        <Stat
          label="days logged"
          value={`${total}`}
          sub={total === 1 ? 'entry' : 'entries'}
        />
        <Stat
          label="bodyweight"
          value={weightAvg !== null ? weightAvg.toFixed(1) : '—'}
          sub="7-day rolling avg, kg"
        />
        <Stat
          label="sessions"
          value={String(other?.workouts.length ?? 0)}
          sub="lifted this week"
        />
        {moduleFlags.work && (
          <Stat
            label="focus"
            value={formatHours(Math.round(focusMin('work')))}
            sub="this week"
          />
        )}
        {moduleFlags.craft && (
          <Stat
            label="craft"
            value={formatHours(Math.round(focusMin('craft')))}
            sub="this week"
          />
        )}
      </section>

      {total === 0 && (
        <p className="caption">
          Nothing plotted yet. Log a wake time on Today and it appears here.
        </p>
      )}

      {weightSeries.length >= 2 && other && (
        <WeightChart series={weightSeries} plan={other.plan} today={today} />
      )}

      {/* ── The letter — handwriting for heading and signature only ────── */}
      {moduleFlags.letter && (
        <LetterCard weekStart={weekStart} letter={other?.letter ?? undefined} />
      )}
    </div>
  );
}

function LetterCard({
  weekStart,
  letter,
}: {
  weekStart: string;
  letter?: { title: string; body: string; writtenAt: number };
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(letter?.title ?? '');
  const [body, setBody] = useState(letter?.body ?? '');

  async function save() {
    await db.letters.put({
      weekStart,
      title: title.trim() || 'untitled',
      body: body.trim(),
      writtenAt: Date.now(),
    });
    setEditing(false);
  }

  if (!editing && !letter) {
    return (
      <SketchCard filter="rough2" className="px-5 py-5">
        <span className="hand text-[26px]">the letter</span>
        <p className="caption mt-1">
          A few lines to yourself at the end of the week. Never graded, never
          required.
        </p>
        <Button
          variant="secondary"
          className="mt-3 w-full"
          onClick={() => setEditing(true)}
        >
          Write this week's
        </Button>
      </SketchCard>
    );
  }

  if (editing) {
    return (
      <SketchCard className="flex flex-col gap-3 px-5 py-5">
        <span className="hand text-[26px]">the letter</span>
        <div className="relative flex h-[52px] items-center bg-[var(--paper)] px-4 [--field-stroke:var(--ink)] focus-within:[--field-stroke:var(--accent)]">
          <SketchBorder filter="rough2" radius={4} strokeWidth={2} stroke="var(--field-stroke)" />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="a title for the week"
            className="relative w-full bg-transparent text-[17px] font-medium outline-none placeholder:text-[var(--ink-faint)]"
          />
        </div>
        <div className="relative bg-[var(--paper)] px-4 py-3 [--field-stroke:var(--ink)] focus-within:[--field-stroke:var(--accent)]">
          <SketchBorder filter="rough2" radius={4} strokeWidth={2} stroke="var(--field-stroke)" />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            placeholder="what actually happened, in your own words"
            className="relative w-full resize-none bg-transparent text-[16px] leading-[1.55] outline-none placeholder:text-[var(--ink-faint)]"
          />
        </div>
        <Button onClick={save} disabled={!body.trim()}>
          Keep it
        </Button>
      </SketchCard>
    );
  }

  return (
    <SketchCard className="px-5 py-5">
      <div className="flex items-baseline justify-between">
        <span className="annot">
          week of {formatDayLabel(weekStart)} –{' '}
          {formatDayLabel(addDays(weekStart, 6))}
        </span>
        <button
          onClick={() => setEditing(true)}
          className="hand text-[19px] text-[var(--ink-muted)]"
        >
          edit
        </button>
      </div>
      <h3 className="hand mt-2 text-[32px]">{letter!.title}</h3>
      <p className="mt-2 whitespace-pre-wrap text-[16px] leading-[1.55]">
        {letter!.body}
      </p>
      <p className="hand mt-3 text-[20px] text-[var(--ink-muted)]">
        — written{' '}
        {new Date(letter!.writtenAt).toLocaleDateString(undefined, {
          day: 'numeric',
          month: 'short',
        })}
      </p>
    </SketchCard>
  );
}
