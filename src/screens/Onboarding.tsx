import { useState } from 'react';
import { Button } from '../components/Button';
import { RoughUnderline } from '../components/Rough';
import { initRamp } from '../db/config';
import { DEFAULT_RAMP, type RampConfig } from '../domain/ramp';
import { formatDayLabel, todayISO } from '../domain/time';

interface Props {
  onReady: (ramp: RampConfig) => void;
}

/**
 * First run. One question — when does week 1 begin — and then out of the way.
 * Everything else about the ramp is derived from that date.
 */
export function Onboarding({ onReady }: Props) {
  const [date, setDate] = useState(todayISO);
  const [busy, setBusy] = useState(false);

  async function start() {
    if (!date) return;
    setBusy(true);
    try {
      onReady(await initRamp(date));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-3xl font-semibold">Atlas</h1>
        <p className="mt-2 text-base text-ink-soft">
          Shifting your wake time 30 minutes earlier each week. Wake time is
          the anchor; bedtime follows it.
        </p>
        <RoughUnderline className="mt-4" seed={2} />
      </header>

      <section>
        <label htmlFor="start" className="annot block">
          Week 1 begins
        </label>
        <input
          id="start"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="tnum mt-1 w-full bg-transparent py-2 text-2xl outline-none"
        />
        <RoughUnderline seed={6} />
        {date && (
          <p className="mt-2 text-sm text-ink-soft">{formatDayLabel(date)}</p>
        )}
      </section>

      <section>
        <p className="annot">The ramp</p>
        <ul className="mt-3 flex flex-col gap-1">
          {DEFAULT_RAMP.steps.map((step, i) => (
            <li key={step} className="flex items-baseline justify-between">
              <span className="text-sm text-ink-soft">Week {i + 1}</span>
              <span className="tnum text-lg">{step}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-ink-soft">
          You can hold any week for longer without losing your place.
        </p>
      </section>

      <Button onClick={start} disabled={!date || busy}>
        {busy ? 'Starting…' : 'Start'}
      </Button>
    </div>
  );
}
