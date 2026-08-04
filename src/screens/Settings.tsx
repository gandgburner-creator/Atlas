import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ALARM_MS, playAlarm, TONES, unlockAudio, vibrate } from '../alarm';
import {
  notifyPermission,
  requestNotifyPermission,
  type NotifyPermission,
} from '../notify';
import { Button } from '../components/Button';
import { NumberField, parseNum, PushHeader, YesNo } from '../components/Chrome';
import { SketchBorder, SketchCard } from '../components/Sketch';
import { TimeField } from '../components/TimeField';
import { useNav } from '../nav';
import {
  getAlarmSettings,
  getCalorieTarget,
  getCommitmentOverrides,
  getCraftGoalMin,
  saveAlarmSettings,
  updateCommitmentOverride,
  getFatTarget,
  type AlarmSettings,
  getFocusGoalMin,
  getLeanMassKg,
  getModuleFlags,
  getProteinTarget,
  getTrainingState,
  getWeightPlan,
  overrideNextSession,
  saveCalorieTarget,
  saveCraftGoalMin,
  saveFatTarget,
  saveFocusGoalMin,
  saveModuleFlags,
  saveProteinTarget,
  saveRamp,
  saveTrainingState,
  saveWeightPlan,
  type MacroRange,
} from '../db/config';
import {
  COMMITMENT_DEFS,
  COMMITMENT_MODULE,
  MODULE_DEFS,
  rampWeekOn,
  type CommitmentOverrides,
  type ModuleFlags,
} from '../domain/commitments';
import type { RampConfig } from '../domain/ramp';
import { currentSlot, passRestDays } from '../domain/training';
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
  const nav = useNav();
  const data = useLiveQuery(async () => {
    const [overrides, training, kcal, proteinTarget, fatTarget, focusMin, craftMin, plan, lean, moduleFlags, alarm] =
      await Promise.all([
        getCommitmentOverrides(),
        getTrainingState(),
        getCalorieTarget(),
        getProteinTarget(),
        getFatTarget(),
        getFocusGoalMin(),
        getCraftGoalMin(),
        getWeightPlan(),
        getLeanMassKg(),
        getModuleFlags(),
        getAlarmSettings(),
      ]);
    return {
      overrides: overrides ?? {},
      training,
      kcal,
      proteinTarget,
      fatTarget,
      focusMin,
      craftMin,
      plan,
      lean,
      moduleFlags,
      alarm,
    };
  }, []);

  if (!data) return null;
  const currentWeek = rampWeekOn(ramp.startDate, today);

  return (
    <div className="flex flex-col gap-5">
      <PushHeader title="settings" />
      <p className="annot -mt-3">
        ramp week {Math.max(0, currentWeek)} · started {ramp.startDate}
      </p>

      <ModulesEditor flags={data.moduleFlags} />
      <CommitmentsEditor
        overrides={data.overrides}
        currentWeek={currentWeek}
        moduleFlags={data.moduleFlags}
      />
      <NextSessionEditor training={data.training} today={today} />
      <SplitEditor training={data.training} />
      <AlarmEditor settings={data.alarm} />
      <TargetsEditor
        kcal={data.kcal}
        proteinTarget={data.proteinTarget}
        fatTarget={data.fatTarget}
        focusMin={data.focusMin}
        craftMin={data.craftMin}
        plan={data.plan}
        lean={data.lean}
        moduleFlags={data.moduleFlags}
      />
      <RampEditor ramp={ramp} onRampChange={onRampChange} />

      <SketchCard filter="rough2" className="px-4 pt-4 pb-4">
        <span className="hand text-[26px]">backup & export</span>
        <p className="caption mt-0.5">
          Full JSON backup, restore, and a plain-markdown summary to paste
          into a chat.
        </p>
        <Button variant="secondary" className="mt-3 w-full" onClick={() => nav.push({ name: 'export' })}>
          Open export
        </Button>
      </SketchCard>

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

// ── Rest alarm ────────────────────────────────────────────────────────────

/**
 * Every channel is separately switchable because each one fails somewhere
 * different, and which one matters depends on whether you train with
 * headphones in, with the phone in a pocket, or with the screen locked.
 */
function AlarmEditor({ settings }: { settings: AlarmSettings }) {
  const [permission, setPermission] = useState<NotifyPermission>(notifyPermission);
  const [testing, setTesting] = useState(false);

  function update(patch: Partial<AlarmSettings>) {
    void saveAlarmSettings({ ...settings, ...patch });
  }

  async function enableNotifications() {
    unlockAudio();
    const next = await requestNotifyPermission();
    setPermission(next);
    update({ notifications: next === 'granted', askedToNotify: true });
  }

  function test() {
    // The tap that started the test is also what authorises audio on iOS,
    // which makes this button a genuine check that the alarm will sound
    // later — not just a preview of the tone.
    unlockAudio();
    setTesting(true);
    if (settings.sound) playAlarm(settings.tone);
    if (settings.vibration) vibrate();
    window.setTimeout(() => setTesting(false), ALARM_MS);
  }

  return (
    <SketchCard className="px-4 pt-4 pb-4">
      <span className="hand text-[26px]">rest alarm</span>
      <p className="caption mt-0.5">
        All three fire together when rest is up, since each one gets lost
        somewhere: sound to headphones, buzz to iOS, both to a locked screen.
      </p>

      <div className="mt-3 flex flex-col">
        <div className="flex items-center justify-between border-b-[1.5px] border-dashed border-[var(--rule)] py-2.5">
          <span className="hand text-[21px] text-[var(--ink-muted)]">sound</span>
          <YesNo value={settings.sound} onChange={(v) => update({ sound: v })} />
        </div>
        <div className="flex items-center justify-between border-b-[1.5px] border-dashed border-[var(--rule)] py-2.5">
          <div className="min-w-0 flex-1">
            <p className="hand text-[21px] text-[var(--ink-muted)]">vibration</p>
            <p className="caption">iPhone ignores this — Android and desktop honour it</p>
          </div>
          <YesNo value={settings.vibration} onChange={(v) => update({ vibration: v })} />
        </div>
        <div className="py-2.5">
          <div className="flex items-center justify-between">
            <span className="hand text-[21px] text-[var(--ink-muted)]">notifications</span>
            {permission === 'granted' ? (
              <YesNo
                value={settings.notifications}
                onChange={(v) => update({ notifications: v })}
              />
            ) : (
              <Button
                variant="secondary"
                className="shrink-0 px-3 text-[14px]"
                onClick={enableNotifications}
                disabled={permission === 'denied' || permission === 'unsupported'}
              >
                Turn on
              </Button>
            )}
          </div>
          {permission === 'denied' && (
            <p className="caption mt-1">
              Blocked. iOS won't let the app ask again — turn it back on under
              Settings › Notifications › Atlas.
            </p>
          )}
          {permission === 'unsupported' && (
            <p className="caption mt-1">
              This browser has no notifications. Install Atlas to the home
              screen to get them.
            </p>
          )}
        </div>
      </div>

      <span className="annot mt-2 block">tone</span>
      <div className="mt-1.5 flex flex-col gap-1.5">
        {TONES.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              update({ tone: t.id });
              unlockAudio();
              if (settings.sound) playAlarm(t.id);
            }}
            className="relative flex items-center justify-between px-3 py-2 text-left"
            style={
              settings.tone === t.id
                ? { background: 'var(--btn-fill)', color: 'var(--btn-text)', borderRadius: 5 }
                : undefined
            }
          >
            {settings.tone !== t.id && <SketchBorder radius={5} strokeWidth={1.8} stroke="var(--rule)" />}
            <span className="relative text-[15px] font-semibold">{t.label}</span>
            <span
              className="relative text-[12px]"
              style={{ color: settings.tone === t.id ? 'var(--btn-text)' : 'var(--ink-muted)' }}
            >
              {t.hint}
            </span>
          </button>
        ))}
      </div>

      <Button variant="secondary" className="mt-3 w-full" onClick={test} disabled={testing}>
        {testing ? 'Sounding…' : 'Test alarm'}
      </Button>

      <p className="caption mt-2">
        With the screen locked, iOS plays its own notification sound rather
        than the tone above — that's the platform, not a fault here.
      </p>
    </SketchCard>
  );
}

// ── Modules ───────────────────────────────────────────────────────────────

/**
 * Master switches. Nothing behind a flag is deleted — the screens, the
 * Dexie tables, the ramp week they'd resume at are all still there. This
 * only decides whether they're currently part of the app you see.
 */
function ModulesEditor({ flags }: { flags: ModuleFlags }) {
  function set(id: keyof ModuleFlags, v: boolean) {
    void saveModuleFlags({ ...flags, [id]: v });
  }

  return (
    <SketchCard filter="rough2" className="px-4 pt-4 pb-4">
      <span className="hand text-[26px]">modules</span>
      <p className="caption mt-0.5">
        Off doesn't mean gone — nothing is deleted, and switching one back on
        picks up exactly where it left off.
      </p>
      <div className="mt-3 flex flex-col">
        {MODULE_DEFS.map((m) => (
          <div
            key={m.id}
            className="flex items-center gap-3 border-b-[1.5px] border-dashed border-[var(--rule)] py-2.5 last:border-0"
          >
            <div className="min-w-0 flex-1">
              <p className="hand truncate text-[22px]">{m.label}</p>
              <p className="caption truncate">{m.hint}</p>
            </div>
            <YesNo value={flags[m.id]} onChange={(v) => set(m.id, v)} />
          </div>
        ))}
      </div>
    </SketchCard>
  );
}

// ── Commitments ───────────────────────────────────────────────────────────

function CommitmentsEditor({
  overrides,
  currentWeek,
  moduleFlags,
}: {
  overrides: CommitmentOverrides;
  currentWeek: number;
  moduleFlags: ModuleFlags;
}) {
  // Serialized in the config layer so rapid taps each land.
  const update = updateCommitmentOverride;
  // Fine-tuning only makes sense for what's currently switched on.
  const visibleDefs = COMMITMENT_DEFS.filter((def) => {
    const moduleKey = COMMITMENT_MODULE[def.id];
    return !moduleKey || moduleFlags[moduleKey];
  });

  return (
    <SketchCard className="px-4 pt-4 pb-4">
      <span className="hand text-[26px]">commitments</span>
      <p className="caption mt-0.5">
        Every active module already works. These decide what counts, and from when.
      </p>
      <div className="mt-3 flex flex-col">
        {visibleDefs.map((def) => {
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

// ── Next session override ───────────────────────────────────────────────

/**
 * Trained out of order, or missed a week? Fix it yourself in two taps: pick
 * what's actually next, and the queue jumps to the nearest occurrence of it
 * without touching anything before that point.
 */
function NextSessionEditor({
  training,
  today,
}: {
  training: Awaited<ReturnType<typeof getTrainingState>>;
  today: string;
}) {
  const passed = passRestDays(training, today);
  const current = currentSlot(passed);
  const slotTypes = [...new Set(training.split)];

  return (
    <SketchCard filter="rough2" className="px-4 pt-4 pb-4">
      <div className="flex items-baseline justify-between">
        <span className="hand text-[26px]">next session</span>
        <span className="tnum caption font-semibold">{current}</span>
      </div>
      <p className="caption mt-0.5">
        Not what you expect? Pick the right one — the queue jumps to it.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {slotTypes.map((t) => (
          <button
            key={t}
            onClick={() => overrideNextSession(t, today)}
            disabled={t === current}
            className="relative px-4 py-2 text-[14px] font-semibold disabled:opacity-40"
          >
            <SketchBorder radius={999} strokeWidth={1.8} stroke="var(--rule)" />
            <span className="relative">{t}</span>
          </button>
        ))}
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
  proteinTarget,
  fatTarget,
  focusMin,
  craftMin,
  plan,
  lean,
  moduleFlags,
}: {
  kcal: number;
  proteinTarget: MacroRange;
  fatTarget: MacroRange;
  focusMin: number;
  craftMin: number;
  plan: Awaited<ReturnType<typeof getWeightPlan>>;
  lean: number;
  moduleFlags: ModuleFlags;
}) {
  const [kcalV, setKcalV] = useState(String(kcal));
  const [proteinMinV, setProteinMinV] = useState(String(proteinTarget.min));
  const [proteinMaxV, setProteinMaxV] = useState(String(proteinTarget.max));
  const [fatMinV, setFatMinV] = useState(String(fatTarget.min));
  const [fatMaxV, setFatMaxV] = useState(String(fatTarget.max));
  const [focusV, setFocusV] = useState(String(focusMin));
  const [craftV, setCraftV] = useState(String(craftMin));
  const [targetKgV, setTargetKgV] = useState(String(plan.targetKg));
  const [targetDateV, setTargetDateV] = useState(plan.targetDate);

  async function save() {
    const k = parseNum(kcalV);
    if (k) await saveCalorieTarget(Math.round(k));
    const pMin = parseNum(proteinMinV);
    const pMax = parseNum(proteinMaxV);
    if (pMin && pMax) await saveProteinTarget({ min: Math.round(pMin), max: Math.round(pMax) });
    const fMin = parseNum(fatMinV);
    const fMax = parseNum(fatMaxV);
    if (fMin && fMax) await saveFatTarget({ min: Math.round(fMin), max: Math.round(fMax) });
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
        <NumberField label="protein min" unit="g" value={proteinMinV} onChange={setProteinMinV} integer />
        <NumberField label="protein max" unit="g" value={proteinMaxV} onChange={setProteinMaxV} integer />
        <NumberField label="fat min" unit="g" value={fatMinV} onChange={setFatMinV} integer />
        <NumberField label="fat max" unit="g" value={fatMaxV} onChange={setFatMaxV} integer />
        {moduleFlags.work && (
          <NumberField label="focus / day" unit="min" value={focusV} onChange={setFocusV} integer />
        )}
        {moduleFlags.craft && (
          <NumberField label="craft / day" unit="min" value={craftV} onChange={setCraftV} integer />
        )}
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
        lean mass {lean.toFixed(1)} kg — maintained by InBody readings
        {(moduleFlags.work || moduleFlags.craft) && ' · goals today: '}
        {moduleFlags.work && `focus ${formatHours(focusMin)}`}
        {moduleFlags.work && moduleFlags.craft && ', '}
        {moduleFlags.craft && `craft ${formatHours(craftMin)}`}
      </p>
      <Button variant="secondary" className="mt-3 w-full" onClick={save}>
        Save targets
      </Button>
    </SketchCard>
  );
}

// ── Sleep ramp ────────────────────────────────────────────────────────────

/**
 * The sleep schedule, fully editable: when it starts, the wake time for
 * every week, and how many weeks there are. Wake times are stored as a
 * definition (src/domain/ramp.ts), so changing a step here re-derives every
 * past and future target — including history already on the chart. Raw
 * sleep logs are never touched; only the target line moves.
 */
function RampEditor({
  ramp,
  onRampChange,
}: {
  ramp: RampConfig;
  onRampChange: (r: RampConfig) => void;
}) {
  const [start, setStart] = useState(ramp.startDate);
  const [baseline, setBaseline] = useState(ramp.baselineWake);
  const [steps, setSteps] = useState(ramp.steps);

  const dirty =
    start !== ramp.startDate ||
    baseline !== ramp.baselineWake ||
    steps.join(',') !== ramp.steps.join(',');

  async function save() {
    const next: RampConfig = { ...ramp, startDate: start, baselineWake: baseline, steps };
    await saveRamp(next);
    onRampChange(next);
  }

  function setStep(i: number, value: string) {
    setSteps(steps.map((s, j) => (j === i ? value : s)));
  }

  return (
    <SketchCard filter="rough2" className="px-4 pt-4 pb-4">
      <span className="hand text-[26px]">the sleep schedule</span>
      <p className="caption mt-0.5">
        This is the plan behind the wake-time screen. Change any week's
        target, add or remove weeks, or move the start date — history
        redraws to match, the raw logs never change.
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

      <div className="mt-4">
        <TimeField label="before the ramp" value={baseline} onChange={setBaseline} />
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <span className="annot">weekly wake targets</span>
        {steps.map((step, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="annot w-14 shrink-0">wk {i + 1}</span>
            <div className="relative flex h-11 flex-1 items-center px-3">
              <SketchBorder radius={4} strokeWidth={1.8} stroke="var(--rule)" />
              <input
                type="time"
                value={step}
                onChange={(e) => setStep(i, e.target.value)}
                className="tnum relative w-full bg-transparent text-[16px] font-semibold outline-none"
              />
            </div>
            <button
              onClick={() => setSteps(steps.filter((_, j) => j !== i))}
              disabled={steps.length <= 1}
              aria-label={`remove week ${i + 1}`}
              className="hand h-11 px-2 text-[19px] text-[var(--ink-muted)] disabled:opacity-30"
            >
              drop
            </button>
          </div>
        ))}
        <Button
          variant="secondary"
          onClick={() => setSteps([...steps, steps[steps.length - 1] ?? baseline])}
        >
          Add a week
        </Button>
      </div>

      <Button className="mt-4 w-full" onClick={save} disabled={!dirty}>
        Save the schedule
      </Button>
    </SketchCard>
  );
}
