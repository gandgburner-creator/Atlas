import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '../components/Button';
import { NumberField, parseNum, PushHeader } from '../components/Chrome';
import { SketchBorder, SketchCard } from '../components/Sketch';
import {
  getCalorieTarget,
  getCommitmentOverrides,
  getCraftGoalMin,
  updateCommitmentOverride,
  getFocusGoalMin,
  getLeanMassKg,
  getTrainingState,
  getWeightPlan,
  saveCalorieTarget,
  saveCraftGoalMin,
  saveFocusGoalMin,
  saveRamp,
  saveTrainingState,
  saveWeightPlan,
} from '../db/config';
import {
  COMMITMENT_DEFS,
  rampWeekOn,
  type CommitmentOverrides,
} from '../domain/commitments';
import type { RampConfig } from '../domain/ramp';
import { formatHours } from '../domain/today';

interface Props {
  ramp: RampConfig;
  today: string;
  onRampChange: (r: RampConfig) => void;
  onReplayTutorial: () => void;
}

/**
 * The plan, editable. Activate a commitment early, push one back, disable
 * it, reorder the split — all without touching code. That is the contract:
 * the app never needs editing to change the plan.
 */
export function Settings({ ramp, today, onRampChange, onReplayTutorial }: Props) {
  const data = useLiveQuery(async () => {
    const [overrides, training, kcal, focusMin, craftMin, plan, lean] =
      await Promise.all([
        getCommitmentOverrides(),
        getTrainingState(),
        getCalorieTarget(),
        getFocusGoalMin(),
        getCraftGoalMin(),
        getWeightPlan(),
        getLeanMassKg(),
      ]);
    return { overrides: overrides ?? {}, training, kcal, focusMin, craftMin, plan, lean };
  }, []);

  if (!data) return null;
  const currentWeek = rampWeekOn(ramp.startDate, today);

  return (
    <div className="flex flex-col gap-5">
      <PushHeader title="settings" />
      <p className="annot -mt-3">
        ramp week {Math.max(0, currentWeek)} · started {ramp.startDate}
      </p>

      <CommitmentsEditor overrides={data.overrides} currentWeek={currentWeek} />
      <SplitEditor training={data.training} />
      <TargetsEditor
        kcal={data.kcal}
        focusMin={data.focusMin}
        craftMin={data.craftMin}
        plan={data.plan}
        lean={data.lean}
      />
      <RampEditor ramp={ramp} onRampChange={onRampChange} />

      <SketchCard filter="rough2" className="px-4 pt-4 pb-4">
        <span className="hand text-[26px]">the intro</span>
        <p className="caption mt-0.5">
          The four cards shown on first open. Nothing is changed by watching
          it again.
        </p>
        <Button variant="secondary" className="mt-3 w-full" onClick={onReplayTutorial}>
          Show me the intro again
        </Button>
      </SketchCard>
    </div>
  );
}

// ── Commitments ───────────────────────────────────────────────────────────

function CommitmentsEditor({
  overrides,
  currentWeek,
}: {
  overrides: CommitmentOverrides;
  currentWeek: number;
}) {
  // Serialized in the config layer so rapid taps each land.
  const update = updateCommitmentOverride;

  return (
    <SketchCard className="px-4 pt-4 pb-4">
      <span className="hand text-[26px]">commitments</span>
      <p className="caption mt-0.5">
        Every module always works. These decide what counts, and from when.
      </p>
      <div className="mt-3 flex flex-col">
        {COMMITMENT_DEFS.map((def) => {
          const o = overrides[def.id] ?? {};
          const week = o.week ?? def.defaultWeek;
          const disabled = o.disabled ?? false;
          const active = !disabled && currentWeek >= week;
          return (
            <div
              key={def.id}
              className="flex items-center gap-2 border-b-[1.5px] border-dashed border-[var(--rule)] py-2.5 last:border-0"
              style={{ opacity: disabled ? 0.5 : 1 }}
            >
              <div className="min-w-0 flex-1">
                <p className="hand truncate text-[22px]">{def.label}</p>
                <p className="tnum caption">
                  {disabled
                    ? 'off — not scored'
                    : active
                      ? `active since week ${week}`
                      : `starts week ${week}`}
                </p>
              </div>
              <button
                onClick={() => update(def.id, (c) => ({ week: Math.max(1, (c.week ?? def.defaultWeek) - 1) }))}
                disabled={disabled || week <= 1}
                aria-label={`${def.label} one week earlier`}
                className="tnum h-11 w-11 text-[20px] font-semibold text-[var(--ink-muted)] disabled:opacity-30"
              >
                −
              </button>
              <span className="tnum w-8 text-center text-[17px] font-semibold">
                {week}
              </span>
              <button
                onClick={() => update(def.id, (c) => ({ week: (c.week ?? def.defaultWeek) + 1 }))}
                disabled={disabled}
                aria-label={`${def.label} one week later`}
                className="tnum h-11 w-11 text-[20px] font-semibold text-[var(--ink-muted)] disabled:opacity-30"
              >
                +
              </button>
              <button
                onClick={() => update(def.id, (c) => ({ disabled: !(c.disabled ?? false) }))}
                className="hand w-12 text-[19px]"
                style={{ color: disabled ? 'var(--accent)' : 'var(--ink-muted)' }}
              >
                {disabled ? 'on' : 'off'}
              </button>
            </div>
          );
        })}
      </div>
    </SketchCard>
  );
}

// ── Split ─────────────────────────────────────────────────────────────────

const SLOT_OPTIONS = ['back', 'shoulders', 'chest', 'legs', 'arms', 'rest'];

function SplitEditor({ training }: { training: Awaited<ReturnType<typeof getTrainingState>> }) {
  const [split, setSplit] = useState(training.split);

  async function save() {
    await saveTrainingState({
      ...training,
      split,
      pointer: training.pointer % Math.max(1, split.length),
    });
  }

  const dirty = split.join(',') !== training.split.join(',');

  return (
    <SketchCard filter="rough2" className="px-4 pt-4 pb-4">
      <div className="flex items-baseline justify-between">
        <span className="hand text-[26px]">the split</span>
        <span className="caption">queue · advances only on completion</span>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {split.map((slot, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="annot w-8">{i + 1}</span>
            <div className="relative flex-1">
              <SketchBorder radius={4} strokeWidth={1.8} stroke="var(--rule)" />
              <select
                value={slot}
                onChange={(e) =>
                  setSplit(split.map((s, j) => (j === i ? e.target.value : s)))
                }
                className="relative h-11 w-full appearance-none bg-transparent px-3 text-[15px] font-semibold outline-none"
              >
                {SLOT_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={() => setSplit(split.filter((_, j) => j !== i))}
              disabled={split.length <= 2}
              aria-label={`remove slot ${i + 1}`}
              className="hand h-11 px-2 text-[19px] text-[var(--ink-muted)] disabled:opacity-30"
            >
              drop
            </button>
          </div>
        ))}
        <div className="flex gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => setSplit([...split, 'rest'])}
          >
            Add a slot
          </Button>
          <Button className="flex-1" onClick={save} disabled={!dirty}>
            Save split
          </Button>
        </div>
        <p className="caption">
          Mode: {training.mode === 'queue' ? 'queue (skips delay, never punish)' : 'fixed weekly'} ·{' '}
          <button
            className="underline"
            onClick={() =>
              saveTrainingState({
                ...training,
                mode: training.mode === 'queue' ? 'fixed' : 'queue',
              })
            }
          >
            switch
          </button>
        </p>
      </div>
    </SketchCard>
  );
}

// ── Targets ───────────────────────────────────────────────────────────────

function TargetsEditor({
  kcal,
  focusMin,
  craftMin,
  plan,
  lean,
}: {
  kcal: number;
  focusMin: number;
  craftMin: number;
  plan: Awaited<ReturnType<typeof getWeightPlan>>;
  lean: number;
}) {
  const [kcalV, setKcalV] = useState(String(kcal));
  const [focusV, setFocusV] = useState(String(focusMin));
  const [craftV, setCraftV] = useState(String(craftMin));
  const [targetKgV, setTargetKgV] = useState(String(plan.targetKg));
  const [targetDateV, setTargetDateV] = useState(plan.targetDate);

  async function save() {
    const k = parseNum(kcalV);
    if (k) await saveCalorieTarget(Math.round(k));
    const f = parseNum(focusV);
    if (f) await saveFocusGoalMin(Math.round(f));
    const c = parseNum(craftV);
    if (c) await saveCraftGoalMin(Math.round(c));
    const t = parseNum(targetKgV);
    if (t && targetDateV) {
      await saveWeightPlan({ ...plan, targetKg: t, targetDate: targetDateV });
    }
  }

  return (
    <SketchCard className="px-4 pt-4 pb-4">
      <span className="hand text-[26px]">targets</span>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <NumberField label="calories" unit="kcal" value={kcalV} onChange={setKcalV} integer />
        <NumberField label="target weight" unit="kg" value={targetKgV} onChange={setTargetKgV} />
        <NumberField label="focus / day" unit="min" value={focusV} onChange={setFocusV} integer />
        <NumberField label="craft / day" unit="min" value={craftV} onChange={setCraftV} integer />
        <label className="col-span-2 flex flex-col gap-1.5">
          <span className="hand text-[21px] text-[var(--ink-muted)]">target date</span>
          <input
            type="date"
            value={targetDateV}
            onChange={(e) => setTargetDateV(e.target.value)}
            className="tnum h-[56px] w-full bg-[var(--paper)] px-4 text-[18px] font-semibold outline-none"
            style={{ border: '2.2px solid var(--ink)', borderRadius: 4 }}
          />
        </label>
      </div>
      <p className="tnum caption mt-2">
        lean mass {lean.toFixed(1)} kg — maintained by InBody readings ·
        goals today: focus {formatHours(focusMin)}, craft {formatHours(craftMin)}
      </p>
      <Button variant="secondary" className="mt-3 w-full" onClick={save}>
        Save targets
      </Button>
    </SketchCard>
  );
}

// ── Sleep ramp ────────────────────────────────────────────────────────────

function RampEditor({
  ramp,
  onRampChange,
}: {
  ramp: RampConfig;
  onRampChange: (r: RampConfig) => void;
}) {
  const [start, setStart] = useState(ramp.startDate);

  async function save() {
    const next = { ...ramp, startDate: start };
    await saveRamp(next);
    onRampChange(next);
  }

  return (
    <SketchCard filter="rough2" className="px-4 pt-4 pb-4">
      <span className="hand text-[26px]">the ramp</span>
      <p className="caption mt-0.5">
        Moving the start date re-derives every week number and wake target —
        history included. Raw logs never change.
      </p>
      <label className="mt-3 flex flex-col gap-1.5">
        <span className="hand text-[21px] text-[var(--ink-muted)]">week 1 begins</span>
        <input
          type="date"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          className="tnum h-[56px] w-full bg-[var(--paper)] px-4 text-[18px] font-semibold outline-none"
          style={{ border: '2.2px solid var(--ink)', borderRadius: 4 }}
        />
      </label>
      <Button
        variant="secondary"
        className="mt-3 w-full"
        onClick={save}
        disabled={start === ramp.startDate}
      >
        Move the start
      </Button>
    </SketchCard>
  );
}
