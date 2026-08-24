import { useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { allSleepLogs } from '../db/sleep';
import { Button } from '../components/Button';
import { DashedRule, SketchBorder, SketchCard } from '../components/Sketch';
import { getExercisePlans, getLiftRamp, getWeightPlan } from '../db/config';
import { db, type Workout } from '../db/schema';
import type { ModuleFlags } from '../domain/commitments';
import {
  bucketStats,
  comparableBuckets,
  comparableExercises,
  formatDuration,
  MIN_SESSIONS_TO_COMPARE,
  rollingVolume,
} from '../domain/sessionTime';
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
import { DAY_TYPES, liftHistory } from '../domain/liftRamp';
import { SleepChart } from './SleepChart';
import { LiftProgressRow } from './TrainingRamp';
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
    const [weights, plan, workouts, letter, allWorkouts] = await Promise.all([
      db.weightLogs.toArray(),
      getWeightPlan(),
      db.workouts.where('date').aboveOrEqual(weekStart).toArray(),
      db.letters.get(weekStart),
      // The time-of-day comparison needs the whole history, not this week —
      // three sessions per bucket takes a while to accumulate.
      db.workouts.toArray(),
    ]);
    const t0 = fromISODate(weekStart).getTime();
    const sessions = await db.focusSessions
      .where('start')
      .aboveOrEqual(t0)
      .toArray();
    return { weights, plan, workouts, letter, sessions, allWorkouts };
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

      <LiftProgressCard workouts={other?.allWorkouts ?? []} today={today} />

      <RollingVolumeCard workouts={other?.allWorkouts ?? []} today={today} />

      <TimeOfDayCard workouts={other?.allWorkouts ?? []} />

      {/* ── The letter — handwriting for heading and signature only ────── */}
      {moduleFlags.letter && (
        <LetterCard weekStart={weekStart} letter={other?.letter ?? undefined} />
      )}
    </div>
  );
}

/**
 * Weight over sessions, per lift.
 *
 * Only while the ramp phase is running, and only for the lifts it
 * programmes — outside it, the four-week volume card below is the better
 * read. Sorted by how recently the lift was trained, so today's session is
 * at the top where you can see what it did.
 */
function LiftProgressCard({ workouts, today }: { workouts: Workout[]; today: string }) {
  const ramp = useLiveQuery(getLiftRamp, [today]);
  const plans = useLiveQuery(getExercisePlans, [today]);
  if (!ramp || !plans) return null;

  const names = [...new Set(DAY_TYPES.flatMap((d) => (plans[d] ?? []).map((e) => e.name)))];
  const rows = names
    .map((name) => ({ name, points: liftHistory(workouts, name) }))
    .filter((r) => r.points.length > 0)
    .sort((a, b) =>
      (b.points[b.points.length - 1]?.date ?? '').localeCompare(
        a.points[a.points.length - 1]?.date ?? '',
      ),
    );
  if (rows.length === 0) return null;

  return (
    <SketchCard className="px-4 pt-4 pb-3">
      <span className="hand text-[26px]">per lift</span>
      <p className="caption mt-0.5">
        Top set each session, oldest left. The climb through the ramp is the
        plan, not a comeback.
      </p>
      <div className="mt-2">
        {rows.map((r) => (
          <LiftProgressRow key={r.name} name={r.name} points={r.points} />
        ))}
      </div>
    </SketchCard>
  );
}

/**
 * Load per exercise over the trailing four weeks.
 *
 * Every session counts the same — scheduled or bonus, the set was done. The
 * list is descriptive: no target, no trend arrow, no comment on whether a
 * number should be higher. It's here to answer "how much of this have I
 * actually been doing lately", which is a question about the past.
 */
function RollingVolumeCard({ workouts, today }: { workouts: Workout[]; today: string }) {
  const [expanded, setExpanded] = useState(false);
  const lifts = rollingVolume(workouts, today);
  if (lifts.length === 0) return null;

  const shown = expanded ? lifts : lifts.slice(0, 6);

  return (
    <SketchCard className="px-4 pt-4 pb-4">
      <span className="hand text-[26px]">last four weeks</span>
      <p className="caption mt-0.5">
        Volume per lift — sets × reps × weight. Bonus sessions count like any
        other.
      </p>
      <div className="mt-3 flex flex-col gap-1.5">
        {shown.map((e) => (
          <div key={e.name} className="flex items-baseline justify-between gap-3">
            <span className="truncate text-[14px] font-medium">{e.name}</span>
            <span className="tnum shrink-0 text-[15px] font-semibold">
              {Math.round(e.volume).toLocaleString()}
            </span>
          </div>
        ))}
      </div>
      {lifts.length > shown.length && (
        <button
          onClick={() => setExpanded(true)}
          className="hand mt-2 text-[17px] text-[var(--ink-muted)]"
        >
          show all {lifts.length}
        </button>
      )}
    </SketchCard>
  );
}

/**
 * Training by time of day.
 *
 * The point of the whole timing feature: whether particular lifts actually
 * go better at particular hours, or whether it just feels that way. Which
 * means it has to earn the right to say anything — nothing appears until at
 * least two buckets carry three sessions each, because a single morning
 * session next to a dozen evening ones is a coincidence with a table around
 * it.
 *
 * It reports and stops. No bucket is called better, no session is called
 * short, and there is no target anywhere on this card.
 */
function TimeOfDayCard({ workouts }: { workouts: Workout[] }) {
  const stats = bucketStats(workouts);
  const shown = comparableBuckets(stats);
  const lifts = comparableExercises(shown);

  if (shown.length === 0) {
    const counts = stats.filter((s) => s.sessions > 0);
    return (
      <SketchCard filter="rough2" className="px-5 py-4">
        <span className="hand text-[26px]">time of day</span>
        <p className="caption mt-1">
          {counts.length === 0
            ? 'Once sessions carry a start time, this compares how training goes at different hours.'
            : `Needs ${MIN_SESSIONS_TO_COMPARE} sessions in each of two time slots before it's worth comparing. So far: ${counts
                .map((s) => `${s.bucket} ${s.sessions}`)
                .join(' · ')}.`}
        </p>
      </SketchCard>
    );
  }

  const cols = `repeat(${shown.length}, minmax(0, 1fr))`;

  return (
    <SketchCard className="px-4 pt-4 pb-4">
      <span className="hand text-[26px]">time of day</span>
      <p className="caption mt-0.5">
        Volume is sets × reps × weight. Descriptive only — no slot is the
        right one to train in.
      </p>

      <div className="mt-3 grid gap-x-3 gap-y-1" style={{ gridTemplateColumns: cols }}>
        {shown.map((s) => (
          <span key={s.bucket} className="hand text-[21px]">
            {s.bucket}
          </span>
        ))}
        {shown.map((s) => (
          <span key={s.bucket} className="annot">
            {s.sessions} {s.sessions === 1 ? 'session' : 'sessions'}
          </span>
        ))}
      </div>

      <DashedRule className="mt-3 pt-2" />
      <Row label="average length" cols={cols}>
        {shown.map((s) => (
          <span key={s.bucket} className="tnum text-[17px] font-semibold">
            {formatDuration(s.avgDurationMs)}
          </span>
        ))}
      </Row>
      <Row label="average volume" cols={cols}>
        {shown.map((s) => (
          <span key={s.bucket} className="tnum text-[17px] font-semibold">
            {Math.round(s.avgVolume).toLocaleString()}
          </span>
        ))}
      </Row>

      {lifts.length > 0 && (
        <>
          <DashedRule className="mt-3 pt-2" />
          <span className="annot">average volume per lift</span>
          {lifts.map((name) => (
            <Row key={name} label={name} cols={cols}>
              {shown.map((s) => {
                const e = s.perExercise.find((x) => x.name === name);
                return (
                  <span key={s.bucket} className="tnum text-[15px] font-semibold">
                    {e ? Math.round(e.avgVolume).toLocaleString() : '—'}
                  </span>
                );
              })}
            </Row>
          ))}
          <p className="caption mt-2">
            Only lifts done in every slot shown appear here. Bodyweight work
            is left out — its volume is zero by this measure whatever the
            hour.
          </p>
        </>
      )}
    </SketchCard>
  );
}

function Row({
  label,
  cols,
  children,
}: {
  label: string;
  cols: string;
  children: ReactNode;
}) {
  return (
    <div className="mt-2">
      <span className="caption">{label}</span>
      <div className="grid gap-x-3" style={{ gridTemplateColumns: cols }}>
        {children}
      </div>
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
