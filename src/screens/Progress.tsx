import { useLiveQuery } from 'dexie-react-hooks';
import { allSleepLogs } from '../db/sleep';
import { DashedRule, SketchCard } from '../components/Sketch';
import {
  isRampComplete,
  isWeekRepeated,
  type RampConfig,
  weekNumberFor,
} from '../domain/ramp';
import { daysLogged, sevenDayAverageWake } from '../domain/stats';
import { SleepChart } from './SleepChart';

interface Props {
  ramp: RampConfig;
  today: string;
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

export function Progress({ ramp, today }: Props) {
  const logs = useLiveQuery(() => allSleepLogs(), []);

  if (!logs) return null;

  const week = weekNumberFor(ramp, today);
  const complete = isRampComplete(ramp, today);
  const repeated = isWeekRepeated(ramp, today);
  const { average, daysCounted } = sevenDayAverageWake(logs, today);
  const total = daysLogged(logs);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="hand text-[40px]">Progress</h1>
        <span className="annot shrink-0">wake time · 6 weeks</span>
      </header>

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
      </section>

      {total === 0 && (
        <p className="caption">
          Nothing plotted yet. Log a wake time on Today and it appears here.
        </p>
      )}
    </div>
  );
}
