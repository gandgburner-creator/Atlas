import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '../components/Button';
import { RoughBox, RoughUnderline } from '../components/Rough';
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
import { describeDelta, formatDayLabel, nowClock } from '../domain/time';

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
    <div className="flex flex-col gap-7">
      <header>
        <p className="annot">{formatDayLabel(today)}</p>
        <RoughUnderline className="mt-2" seed={4} />
      </header>

      {/* Target — the one number that matters this morning. */}
      <section>
        <p className="annot">
          {week === null
            ? 'ramp starts soon'
            : complete
              ? `holding · week ${week}`
              : `week ${week} of ${ramp.steps.length}`}
          {repeated && ' · repeating'}
        </p>
        <p className="tnum mt-1 text-7xl leading-none font-semibold">
          {target}
        </p>
        <p className="mt-2 text-sm text-ink-soft">
          Target wake time. Bedtime follows it.
        </p>
      </section>

      {loading ? null : showForm ? (
        <section className="flex flex-col gap-6">
          <TimeField
            label="Woke at"
            value={wake}
            onChange={setWake}
            hint={wake ? (describeDelta(wake, target) ?? undefined) : undefined}
          />
          <TimeField
            label="Fell asleep"
            value={onset}
            onChange={setOnset}
            optional
            hint="Rough estimate is fine."
          />
          <div>
            <label htmlFor="note" className="annot block">
              What happened today
            </label>
            <input
              id="note"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="One line, or nothing at all"
              enterKeyHint="done"
              className="mt-1 w-full bg-transparent py-2 text-base outline-none placeholder:text-ink-faint"
            />
            <RoughUnderline seed={11} />
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={!wake || saving} className="flex-1">
              {saving ? 'Saving…' : 'Save'}
            </Button>
            {log && (
              <Button
                variant="quiet"
                seed={19}
                onClick={() => {
                  setWake(log.actualWake);
                  setOnset(log.sleepOnset ?? '');
                  setNote(log.note ?? '');
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </section>
      ) : (
        log && (
          <RoughBox seed={5} className="p-5">
            <p className="annot">Logged</p>
            <p className="tnum mt-1 text-4xl font-semibold">
              {log.actualWake}
            </p>
            {describeDelta(log.actualWake, log.targetWake) && (
              <p className="mt-1 text-sm text-ink-soft">
                {describeDelta(log.actualWake, log.targetWake)}
              </p>
            )}
            {log.sleepOnset && (
              <p className="tnum mt-3 text-sm text-ink-soft">
                Asleep around {log.sleepOnset}
              </p>
            )}
            {log.note && <p className="mt-3 text-base">{log.note}</p>}
            <Button
              variant="quiet"
              seed={23}
              className="mt-4"
              onClick={() => setEditing(true)}
            >
              Edit
            </Button>
          </RoughBox>
        )
      )}

      {/*
        Repeating a week is a valid, encouraged choice — so it lives in the
        main flow rather than buried in a settings screen, and it toggles
        back off just as easily.
      */}
      {week !== null && (
        <section>
          <RoughUnderline seed={31} />
          <div className="mt-4 flex items-start justify-between gap-4">
            <p className="text-sm text-ink-soft">
              {repeated
                ? `Holding ${target} for another week. The ramp picks up after that.`
                : 'Need more time at this wake time? Hold it.'}
            </p>
            <Button
              variant="quiet"
              seed={27}
              onClick={onToggleRepeat}
              className="shrink-0 text-sm"
            >
              {repeated ? 'Advance instead' : 'Repeat this week'}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
