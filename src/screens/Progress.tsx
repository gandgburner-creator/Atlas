import { useLiveQuery } from 'dexie-react-hooks';
import { allSleepLogs } from '../db/sleep';
import { RoughUnderline } from '../components/Rough';
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

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="annot">{label}</p>
      <p className="tnum mt-1 text-3xl font-semibold leading-none">{value}</p>
      {sub && <p className="mt-1 text-xs text-ink-soft">{sub}</p>}
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
    <div className="flex flex-col gap-7">
      <header>
        <p className="annot">Progress</p>
        <RoughUnderline className="mt-2" seed={9} />
      </header>

      <SleepChart ramp={ramp} logs={logs} today={today} />

      <section className="grid grid-cols-2 gap-x-4 gap-y-6">
        <Stat
          label="Week"
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
          label="7-day average wake"
          value={average ?? '—'}
          sub={
            daysCounted === 0
              ? 'no days logged this week'
              : `from ${daysCounted} logged ${daysCounted === 1 ? 'day' : 'days'}`
          }
        />
        <Stat
          label="Days logged"
          value={`${total}`}
          sub={total === 1 ? 'entry' : 'entries'}
        />
      </section>

      {total === 0 && (
        <p className="text-sm text-ink-soft">
          Nothing plotted yet. Log a wake time on Today and it appears here.
        </p>
      )}
    </div>
  );
}
