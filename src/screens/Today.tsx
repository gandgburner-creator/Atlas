import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '../components/Button';
import { DashedRule, SketchBorder, SketchCard } from '../components/Sketch';
import { TimeField } from '../components/TimeField';
import { saveRamp } from '../db/config';
import { getSleepLog, saveSleepLog } from '../db/sleep';
import {
  isRampComplete,
  isWeekRepeated,
  targetFor,
  toggleRepeat,
  weekNumberFor,
  type RampConfig,
} from '../domain/ramp';
import {
  describeDelta,
  formatDayLabel,
  formatWeekday,
  nowClock,
} from '../domain/time';

interface Props {
  ramp: RampConfig;
  today: string;
  onRampChange: (ramp: RampConfig) => void;
}

export function Today({ ramp, today, onRampChange }: Props) {
  // Coalesce to null: useLiveQuery uses undefined for "still loading", so a
  // missing row has to report as something else or the two are indistinguishable.
  const query = useLiveQuery(
    async () => (await getSleepLog(today)) ?? null,
    [today],
  );
  const loading = query === undefined;
  const log = query ?? undefined;

  const target = targetFor(ramp, today);
  const week = weekNumberFor(ramp, today);
  const repeated = isWeekRepeated(ramp, today);
  const complete = isRampComplete(ramp, today);

  const [editing, setEditing] = useState(false);
  const [wake, setWake] = useState(nowClock);
  const [onset, setOnset] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (log) {
      setWake(log.actualWake);
      setOnset(log.sleepOnset ?? '');
      setNote(log.note ?? '');
    }
  }, [log]);

  async function save() {
    if (!wake) return;
    setSaving(true);
    try {
      await saveSleepLog({
        date: today,
        targetWake: target,
        actualWake: wake,
        sleepOnset: onset || undefined,
        note,
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  async function onToggleRepeat() {
    const next = toggleRepeat(ramp, today);
    await saveRamp(next);
    onRampChange(next);
  }

  const showForm = editing || (!loading && !log);

  return (
    <div className="flex flex-col gap-6">
      {/*
        The weekday is handwritten; the date is not. Caveat never sets a
        numeral, so "Monday" and "27 Jul" are two different typefaces.
      */}
      <header className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <h1 className="hand text-[40px]">{formatWeekday(today)}</h1>
          <span className="tnum caption">{formatDayLabel(today)}</span>
        </div>
        <span className="annot shrink-0">
          {week === null
            ? 'not started'
            : complete
              ? `holding · wk ${week}`
              : `week ${week}/${ramp.steps.length}`}
        </span>
      </header>

      {/* Target — the one number that matters this morning. */}
      <SketchCard className="px-5 pt-4 pb-5">
        <div className="flex items-center justify-between">
          <span className="hand text-2xl">wake target</span>
          {repeated && (
            <span
              className="caption font-semibold"
              style={{ color: 'var(--accent)' }}
            >
              repeating
            </span>
          )}
        </div>
        <p className="tnum metric mt-1">{target}</p>
        <p className="caption mt-2">Wake is the anchor. Bedtime follows it.</p>
      </SketchCard>

      {loading ? null : showForm ? (
        <section className="flex flex-col gap-5">
          <TimeField
            label="woke at"
            value={wake}
            onChange={setWake}
            hint={wake ? (describeDelta(wake, target) ?? undefined) : undefined}
          />
          <TimeField
            label="fell asleep"
            value={onset}
            onChange={setOnset}
            optional
            hint="A rough estimate is fine."
          />

          <div className="flex flex-col gap-2">
            <label htmlFor="note" className="hand text-[22px]">
              what happened today
            </label>
            <div className="relative flex h-[56px] items-center bg-[var(--paper)] px-4 [--field-stroke:var(--ink)] focus-within:[--field-stroke:var(--accent)]">
              <SketchBorder
                filter="rough2"
                radius={4}
                strokeWidth={2.2}
                stroke="var(--field-stroke)"
              />
              <input
                id="note"
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="One line, or nothing at all"
                enterKeyHint="done"
                className="relative w-full bg-transparent text-base outline-none placeholder:text-[var(--ink-faint)]"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={!wake || saving} className="flex-1">
              {saving ? 'Saving…' : 'Save'}
            </Button>
            {log && (
              <Button variant="secondary" onClick={() => {
                setWake(log.actualWake);
                setOnset(log.sleepOnset ?? '');
                setNote(log.note ?? '');
                setEditing(false);
              }}>
                Cancel
              </Button>
            )}
          </div>
        </section>
      ) : (
        log && (
          <SketchCard filter="rough2" className="px-5 pt-4 pb-5">
            <div className="flex items-center justify-between">
              <span className="hand text-2xl">woke at</span>
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--success)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                filter="url(#roughSoft)"
                aria-hidden="true"
              >
                <path d="M4.5 12.8 9.6 18 20 6.4" />
              </svg>
            </div>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="tnum metric-sm">{log.actualWake}</span>
              {describeDelta(log.actualWake, log.targetWake) && (
                <span className="caption">
                  {describeDelta(log.actualWake, log.targetWake)}
                </span>
              )}
            </div>
            {log.sleepOnset && (
              <p className="tnum caption mt-3">
                Asleep around {log.sleepOnset}
              </p>
            )}
            {log.note && (
              <p className="mt-3 text-base leading-[1.55]">{log.note}</p>
            )}
            <Button
              variant="secondary"
              className="mt-4 w-full"
              onClick={() => setEditing(true)}
            >
              Edit
            </Button>
          </SketchCard>
        )
      )}

      {/*
        Repeating a week is a valid, encouraged choice — so it lives in the
        main flow rather than buried in a settings screen, and it toggles
        back off just as easily.
      */}
      {week !== null && (
        <section className="flex flex-col gap-3">
          <DashedRule className="mt-1" />
          <p className="caption">
            {repeated
              ? `Holding ${target} for another week. The ramp picks up after that.`
              : 'Need more time at this wake time? Hold it — the ramp waits.'}
          </p>
          <Button variant="secondary" onClick={onToggleRepeat}>
            {repeated ? 'Advance instead' : 'Repeat this week'}
          </Button>
        </section>
      )}
    </div>
  );
}
