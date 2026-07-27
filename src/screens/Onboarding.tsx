import { useState } from 'react';
import { Button } from '../components/Button';
import { DashedRule, SketchCard } from '../components/Sketch';
import { TimeField } from '../components/TimeField';
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
    <div className="flex flex-col gap-7">
      <header className="flex flex-col gap-2">
        <span className="annot">personal tracking</span>
        <h1 className="hand text-[64px] leading-[0.9]">Atlas</h1>
        <p className="text-base leading-[1.55]">
          Shifting your wake time 30 minutes earlier each week. Wake is the
          anchor; bedtime follows it.
        </p>
      </header>

      <DashedRule />

      <TimeField
        type="date"
        label="week 1 begins"
        value={date}
        onChange={setDate}
        hint={date ? formatDayLabel(date) : undefined}
      />

      <SketchCard filter="rough2" className="px-5 pt-4 pb-5">
        <span className="hand text-[26px]">the ramp</span>
        <ul className="mt-3 flex flex-col gap-2">
          {DEFAULT_RAMP.steps.map((step, i) => (
            <li key={step} className="flex items-baseline justify-between">
              <span className="caption">Week {i + 1}</span>
              <span className="tnum text-xl font-semibold">{step}</span>
            </li>
          ))}
        </ul>
        <DashedRule className="mt-4 pt-3" />
        <p className="caption pt-1">
          You can hold any week for longer without losing your place.
        </p>
      </SketchCard>

      <Button onClick={start} disabled={!date || busy}>
        {busy ? 'Starting…' : 'Start'}
      </Button>
    </div>
  );
}
