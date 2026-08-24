import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '../components/Button';
import { DashedRule, SketchBorder, SketchCard } from '../components/Sketch';
import {
  endLiftRamp,
  getExercisePlans,
  getLiftRamp,
  markRampTransitionSeen,
  startLiftRamp,
  RAMP_EXERCISE_PLANS,
} from '../db/config';
import { db } from '../db/schema';
import {
  DAY_FOCUS,
  DAY_TYPES,
  dayTypeFor,
  expectedWeight,
  isRampComplete,
  percentForWeek,
  RAMP_DAYS_PER_WEEK,
  RAMP_REP_HIGH,
  RAMP_REP_LOW,
  RAMP_SETS,
  RAMP_SPLIT,
  RAMP_WEEKS,
  rampWeekFor,
  weekConsistency,
  type DayType,
} from '../domain/liftRamp';
import { useNav } from '../nav';

/**
 * The ramp phase, everywhere it shows up outside the log screen: the offer
 * to start it, today's card, where you are in the three weeks, and the
 * prompt when it's over.
 *
 * The percentages are the point of the card. Training at 60% only feels
 * like progress if the app says out loud that 60% IS the plan this week —
 * otherwise every number looks like a number you used to beat.
 */

export function useLiftRampData(today: string) {
  return useLiveQuery(async () => {
    const [ramp, plans, workouts] = await Promise.all([
      getLiftRamp(),
      getExercisePlans(),
      db.workouts.toArray(),
    ]);
    return { ramp, plans, workouts };
  }, [today]);
}

/** Dots for weeks 1–3, the current one filled. Position at a glance. */
function WeekDots({ week }: { week: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: RAMP_WEEKS }, (_, i) => i + 1).map((w) => (
        <span
          key={w}
          className="block h-2.5 w-2.5 rounded-full"
          style={{
            background: w <= week ? 'var(--ink)' : 'transparent',
            border: `1.8px solid ${w <= week ? 'var(--ink)' : 'var(--rule)'}`,
          }}
        />
      ))}
    </div>
  );
}

/**
 * Today's session: the day's lifts and what each one works out at this
 * week. Tapping anywhere opens the log.
 */
export function RampTodayCard({ today }: { today: string }) {
  const nav = useNav();
  const data = useLiftRampData(today);
  if (!data?.ramp) return null;

  const week = rampWeekFor(data.ramp.startDate, today);
  const dayType = dayTypeFor(today);

  if (week === null) return null;

  if (dayType === null) {
    return (
      <SketchCard className="px-5 pt-4 pb-5">
        <div className="flex items-center justify-between">
          <span className="hand text-[26px]">rest day</span>
          <WeekDots week={week} />
        </div>
        <p className="caption mt-1">
          The rotation runs Monday to Thursday. Friday to Sunday are part of
          the plan, not gaps in it.
        </p>
      </SketchCard>
    );
  }

  const plan = data.plans[dayType] ?? RAMP_EXERCISE_PLANS[dayType] ?? [];
  const pct = Math.round(percentForWeek(week) * 100);

  return (
    <button onClick={() => nav.push({ name: 'training-log' })} className="text-left">
      <SketchCard className="px-5 pt-4 pb-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="hand text-[26px]">{dayType} · {DAY_FOCUS[dayType]}</span>
            <p className="caption mt-0.5">
              week {week} of {RAMP_WEEKS} · {pct}% · {RAMP_SETS} sets ·{' '}
              {RAMP_REP_LOW}–{RAMP_REP_HIGH} reps
            </p>
          </div>
          <WeekDots week={week} />
        </div>

        <DashedRule className="mt-3 pt-2" />
        <div className="flex flex-col gap-1.5 pt-1">
          {plan.map((def) => {
            const kg = expectedWeight(data.workouts, def.name, week);
            return (
              <div key={def.name} className="flex items-baseline justify-between gap-3">
                <span className="truncate text-[14px] font-medium">{def.name}</span>
                <span className="tnum shrink-0 text-[15px] font-semibold">
                  {kg === null ? (
                    <span className="caption">first time</span>
                  ) : (
                    `${kg} kg`
                  )}
                </span>
              </div>
            );
          })}
        </div>

        <p className="caption mt-3">
          Leave 3–4 reps in reserve. Nothing here is meant to be hard yet.
        </p>
      </SketchCard>
    </button>
  );
}

/** 0–4 for the week, as filled squares. Descriptive, never a target. */
export function ConsistencyRow({ today }: { today: string }) {
  const data = useLiftRampData(today);
  if (!data?.ramp) return null;
  const done = weekConsistency(data.workouts, today);
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="annot">this week</span>
      <div className="flex items-center gap-2">
        <div className="flex gap-1">
          {DAY_TYPES.map((d, i) => (
            <span
              key={d}
              className="block h-3.5 w-3.5"
              style={{
                background: i < done ? 'var(--ink)' : 'transparent',
                border: `1.8px solid ${i < done ? 'var(--ink)' : 'var(--rule)'}`,
                borderRadius: 3,
              }}
            />
          ))}
        </div>
        <span className="tnum text-[14px] font-semibold">
          {done} of {RAMP_DAYS_PER_WEEK}
        </span>
      </div>
    </div>
  );
}

/**
 * The offer to begin, and the prompt when the three weeks are up.
 *
 * Starting is one tap and it names today as week 1 — the ramp is measured
 * from when you actually begin, not from a date picked in advance and then
 * missed.
 */
export function RampPhaseCard({ today }: { today: string }) {
  const data = useLiftRampData(today);
  if (!data) return null;

  if (!data.ramp) {
    return (
      <SketchCard filter="rough2" className="px-5 pt-4 pb-5">
        <span className="hand text-[26px]">ramp phase</span>
        <p className="caption mt-1">
          Three weeks back in, Monday to Thursday. {RAMP_SETS} sets an
          exercise at {RAMP_PERCENT_LABEL} of your previous working weight,{' '}
          {RAMP_REP_LOW}–{RAMP_REP_HIGH} reps, never to failure.
        </p>
        <div className="mt-3 flex flex-col gap-1">
          {DAY_TYPES.map((d) => (
            <div key={d} className="flex items-baseline justify-between gap-3">
              <span className="text-[14px] font-medium">{d}</span>
              <span className="caption">{DAY_FOCUS[d]}</span>
            </div>
          ))}
        </div>
        <p className="caption mt-3">
          Your current split is kept and put back when the phase ends.
        </p>
        <Button
          className="mt-3 w-full"
          onClick={() => void startLiftRamp(today, RAMP_SPLIT)}
        >
          Start the ramp — today is week 1
        </Button>
      </SketchCard>
    );
  }

  const complete = isRampComplete(data.ramp.startDate, today);
  const week = rampWeekFor(data.ramp.startDate, today);

  if (complete && !data.ramp.transitionSeen) {
    return (
      <SketchCard className="px-5 pt-4 pb-5">
        <span className="hand text-[26px]">ramp phase complete</span>
        <p className="caption mt-1">
          Three weeks done — 60, 70, 80. Ready to progress to a full PPL
          split whenever you want to define one.
        </p>
        <div className="mt-3 flex gap-2">
          <Button
            variant="secondary"
            className="flex-1 text-[14px]"
            onClick={() => void markRampTransitionSeen()}
          >
            Keep going for now
          </Button>
          <Button className="flex-1 text-[14px]" onClick={() => void endLiftRamp()}>
            End the phase
          </Button>
        </div>
      </SketchCard>
    );
  }

  return (
    <SketchCard filter="rough2" className="px-5 pt-4 pb-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="hand text-[24px]">ramp phase</span>
          <p className="caption mt-0.5">
            {week === null
              ? 'past week 3 — carrying on at 80%'
              : `week ${week} of ${RAMP_WEEKS} · ${Math.round(percentForWeek(week) * 100)}% of previous`}
          </p>
        </div>
        {week !== null && <WeekDots week={week} />}
      </div>
      <div className="mt-3">
        <ConsistencyRow today={today} />
      </div>
      <button
        onClick={() => void endLiftRamp()}
        className="hand mt-3 text-[16px] text-[var(--ink-muted)] underline"
      >
        end the phase and restore my split
      </button>
    </SketchCard>
  );
}

const RAMP_PERCENT_LABEL = '60 / 70 / 80%';

/**
 * Weight over sessions for one lift — the flattest possible chart, because
 * during the ramp the interesting shape is deliberately a staircase up from
 * 60%, and a fancier one would invite reading it as performance.
 */
export function LiftProgressRow({
  name,
  points,
}: {
  name: string;
  points: { date: string; topWeight: number }[];
}) {
  if (points.length === 0) return null;
  const max = Math.max(...points.map((p) => p.topWeight));
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[14px] font-medium">{name}</span>
        <span className="tnum shrink-0 text-[14px] font-semibold">
          {points[points.length - 1]?.topWeight} kg
        </span>
      </div>
      <div className="mt-1.5 flex items-end gap-1" style={{ height: 28 }}>
        {points.slice(-12).map((p, i) => (
          <span
            key={`${p.date}-${i}`}
            className="relative flex-1"
            style={{
              height: `${max > 0 ? Math.max(8, (p.topWeight / max) * 100) : 8}%`,
              background: 'var(--sunk)',
              borderRadius: 2,
            }}
          >
            <SketchBorder radius={2} strokeWidth={1.4} stroke="var(--rule)" />
          </span>
        ))}
      </div>
    </div>
  );
}

export type { DayType };
