import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { playAlarm, resumeAudio, unlockAudio, vibrate } from '../alarm';
import { Button } from '../components/Button';
import { NumberField, parseNum } from '../components/Chrome';
import { TimerRing } from '../components/Ring';
import { SketchBorder, SketchCard } from '../components/Sketch';
import {
  DEFAULT_ALARM_SETTINGS,
  getAlarmSettings,
  saveAlarmSettings,
  type AlarmSettings,
  type ExerciseDef,
} from '../db/config';
import type { WorkoutSet } from '../db/schema';
import {
  adjustRest,
  formatRest,
  parseStoredTimer,
  restDone,
  restFraction,
  restRemaining,
  type RestTimerState,
} from '../domain/rest';
import { setLoadWarning } from '../domain/plausible';
import { formatDayLabel } from '../domain/time';
import {
  cancelRestNotification,
  notifyPermission,
  requestNotifyPermission,
  scheduleRestNotification,
  showRestNotificationNow,
} from '../notify';
import { overloadHint, type LastExercise } from '../domain/training';

/**
 * Shared between today's live logging screen and the history editor: the
 * exercise card, its set editor, the always-visible add-exercise panel, and
 * the rest timer. One place so both screens behave identically.
 */

// ── Rest timer ────────────────────────────────────────────────────────────

const REST_KEY = 'atlas.restTimer';

function loadRestTimer(): RestTimerState | null {
  try {
    return parseStoredTimer(localStorage.getItem(REST_KEY), Date.now());
  } catch {
    return null; // Private mode with localStorage disabled.
  }
}

/**
 * Counts down from an exercise's default rest, auto-started the moment a set
 * is confirmed — no tap to start it, hands are busy.
 *
 * NOTHING here counts elapsed time. The deadline is stored as an absolute
 * timestamp in localStorage and every reading is `endsAt - Date.now()`, so
 * the interval below is only a repaint trigger: if iOS throttles it to once
 * a minute, or stops it entirely while backgrounded, the number shown on
 * return is still correct because it was never derived from how often the
 * interval ran. visibilitychange, pageshow and focus each force a fresh read
 * for the same reason — whichever one the platform actually delivers, the
 * bar is right the instant it's back on screen.
 *
 * On completion every channel fires at once, because each one fails
 * somewhere: sound is lost to headphones, vibration doesn't exist on iOS
 * Safari, and only the notification survives a locked screen.
 */
export function useRestTimer() {
  const [timer, setTimer] = useState<RestTimerState | null>(loadRestTimer);
  const [, forceTick] = useState(0);
  const firedForRef = useRef<number | null>(null);
  const stopAlarmRef = useRef<(() => void) | null>(null);
  const [settings, setSettings] = useState<AlarmSettings>(DEFAULT_ALARM_SETTINGS);
  const [askToNotify, setAskToNotify] = useState(false);

  const live = useLiveQuery(getAlarmSettings, []);
  useEffect(() => {
    if (live) setSettings(live);
  }, [live]);

  // Unlock audio on the first tap anywhere in the session. iOS refuses to
  // play anything that wasn't authorised by a gesture, and the moment the
  // alarm needs to sound there is no gesture to hang it on — so it is done
  // here, minutes ahead, on a tap the user was making anyway.
  useEffect(() => {
    const onFirstTap = () => unlockAudio();
    document.addEventListener('pointerdown', onFirstTap, { once: true });
    return () => document.removeEventListener('pointerdown', onFirstTap);
  }, []);

  const start = useCallback(
    (exercise: string, seconds: number) => {
      const t: RestTimerState = {
        exercise,
        endsAt: Date.now() + seconds * 1000,
        total: seconds,
      };
      localStorage.setItem(REST_KEY, JSON.stringify(t));
      firedForRef.current = null;
      setTimer(t);
      // Already unlocked by the tap that logged the set; this just brings
      // the context back if the app has been backgrounded since.
      resumeAudio();

      if (settings.notifications) {
        const permission = notifyPermission();
        // Hand the alarm to the worker NOW — by the time rest is up the app
        // is likely backgrounded and unable to do anything itself.
        if (permission === 'granted') void scheduleRestNotification(exercise, t.endsAt);
        // First rest of all: explain before the system prompt appears.
        else if (permission === 'default' && !settings.askedToNotify) setAskToNotify(true);
      }
    },
    [settings.notifications, settings.askedToNotify],
  );

  const clear = useCallback(() => {
    stopAlarmRef.current?.();
    stopAlarmRef.current = null;
    localStorage.removeItem(REST_KEY);
    void cancelRestNotification();
    setTimer(null);
  }, []);

  const adjust = useCallback((deltaSec: number) => {
    setTimer((t) => {
      if (!t) return t;
      const next = adjustRest(t, deltaSec, Date.now());
      localStorage.setItem(REST_KEY, JSON.stringify(next));
      // The pending notification is now aimed at the wrong moment.
      void cancelRestNotification().then(() =>
        scheduleRestNotification(next.exercise, next.endsAt),
      );
      return next;
    });
  }, []);

  // Repaint only. Correctness comes from Date.now(), never from this.
  useEffect(() => {
    if (!timer) return;
    const tick = () => forceTick((n) => n + 1);
    const id = window.setInterval(tick, 250);
    const onWake = () => {
      resumeAudio();
      tick();
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('pageshow', onWake);
    window.addEventListener('focus', onWake);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('pageshow', onWake);
      window.removeEventListener('focus', onWake);
    };
  }, [timer]);

  // Recomputed on every render straight from the wall clock — never from
  // how many times the interval above managed to run.
  const now = Date.now();
  const remaining = restRemaining(timer, now);
  const done = restDone(timer, now);

  // Fire once per timer, keyed on the deadline so adjusting the clock
  // re-arms it and a re-render never double-fires.
  useEffect(() => {
    if (!timer || !done || firedForRef.current === timer.endsAt) return;
    firedForRef.current = timer.endsAt;

    if (settings.sound) stopAlarmRef.current = playAlarm(settings.tone);
    if (settings.vibration) vibrate();
    // The worker's scheduled copy may have been killed before it fired.
    // Same tag, so if it did fire this replaces it rather than buzzing twice.
    if (settings.notifications) void showRestNotificationNow(timer.exercise);
  }, [done, timer, settings]);

  const dismissAsk = useCallback(
    async (allow: boolean) => {
      setAskToNotify(false);
      const next = { ...settings, askedToNotify: true };
      await saveAlarmSettings(next);
      setSettings(next);
      if (!allow) return;
      const permission = await requestNotifyPermission();
      if (permission === 'granted') {
        const t = loadRestTimer();
        if (t && t.endsAt > Date.now()) void scheduleRestNotification(t.exercise, t.endsAt);
      }
    },
    [settings],
  );

  return {
    timer,
    remaining,
    done,
    start,
    adjust,
    skip: clear,
    dismiss: clear,
    askToNotify,
    dismissAsk,
  };
}

/** Fixed to the viewport bottom, and ONLY rendered while a timer is running
 * — idle, nothing here at all, so there's no dead gap above it. */
export function RestBar({
  restTimer,
}: {
  restTimer: ReturnType<typeof useRestTimer>;
}) {
  const { timer, remaining, done, adjust, skip, dismiss, askToNotify, dismissAsk } = restTimer;
  if (!timer) return null;

  const frac = restFraction(timer, Date.now());

  return (
    <div className="fixed inset-x-0 bottom-0 z-10 mx-auto max-w-[390px] px-5">
      <div className="pb-safe bg-[var(--board)] pt-2">
        {/* One line, in our own words, before the system prompt — which can
            only ever be shown once, and is unrecoverable if declined. */}
        {askToNotify && (
          <SketchCard filter="rough2" className="mb-2 px-4 py-3">
            <p className="text-[14px] leading-snug">
              Get a notification when rest is over, even with the screen locked?
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                variant="secondary"
                className="flex-1 text-[14px]"
                onClick={() => dismissAsk(false)}
              >
                Not now
              </Button>
              <Button className="flex-1 text-[14px]" onClick={() => dismissAsk(true)}>
                Allow
              </Button>
            </div>
          </SketchCard>
        )}
        <SketchCard
          className={`flex items-center gap-3 px-4 py-3 ${done ? 'rest-flash' : ''}`}
          stroke={done ? 'var(--success)' : 'var(--ink)'}
        >
          <TimerRing fraction={done ? 1 : frac} color={done ? 'var(--success)' : 'var(--accent)'} size={64}>
            <span className="tnum text-[15px] font-semibold">{formatRest(remaining)}</span>
          </TimerRing>
          <div className="min-w-0 flex-1">
            <p
              className="hand truncate text-[20px]"
              style={done ? { color: 'var(--success)' } : undefined}
            >
              {done ? 'next set' : 'rest'}
            </p>
            <p className="truncate text-[13px] font-medium text-[var(--ink-muted)]">{timer.exercise}</p>
          </div>
          {!done && (
            <div className="flex shrink-0 gap-1">
              <button
                onClick={() => adjust(-30)}
                aria-label="30 seconds less"
                className="hand h-9 w-9 text-[16px] text-[var(--ink-muted)]"
              >
                −30
              </button>
              <button
                onClick={() => adjust(30)}
                aria-label="30 seconds more"
                className="hand h-9 w-9 text-[16px] text-[var(--ink-muted)]"
              >
                +30
              </button>
            </div>
          )}
          <Button variant="secondary" onClick={done ? dismiss : skip} className="shrink-0 px-3 text-[14px]">
            {done ? 'Clear' : 'Skip'}
          </Button>
        </SketchCard>
      </div>
    </div>
  );
}

// ── Exercise card ─────────────────────────────────────────────────────────

type Draft = (WorkoutSet | null)[];

export function repRangeLabel(def: ExerciseDef): string {
  if (def.progressToWeighted) return `max reps (start ${def.seedReps ?? def.repRangeTop})`;
  if (def.repRangeBottom && def.repRangeBottom !== def.repRangeTop) {
    return `${def.repRangeBottom}-${def.repRangeTop} reps`;
  }
  return `${def.repRangeTop} reps`;
}

interface ExerciseCardProps {
  def: ExerciseDef;
  last: LastExercise | undefined;
  sets: Draft;
  /** Brought to the top because it got no sets last time. */
  promoted?: boolean;
  /** Ramp phase: the weight this week's percentage works out at. Prefills
   * an untouched set and is shown as the plan. Null when there's no
   * history to take a percentage of. */
  expected?: number | null;
  /** Ramp phase: 'week 2 · 70%', shown under the rep range. */
  planLabel?: string;
  /** Called with the top weight when a confirmed set beats every previous
   * one for this lift. */
  onPersonalRecord?: (weight: number) => void;
  onChange: (sets: Draft) => void;
  onSetLogged?: (def: ExerciseDef) => void;
  /** Rename / reorder / remove / edit rest. */
  manage?: {
    onRename: (name: string) => void;
    onMoveUp?: () => void;
    onMoveDown?: () => void;
    onRemove: () => void;
    onEditRest: (restSec: number) => void;
  };
}

export function ExerciseCard({
  def,
  last,
  sets,
  promoted = false,
  expected,
  planLabel,
  onPersonalRecord,
  onChange,
  onSetLogged,
  manage,
}: ExerciseCardProps) {
  const hint = overloadHint(last, def);
  const [hintDismissed, setHintDismissed] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [managing, setManaging] = useState(false);

  /**
   * A set wildly out of line with the others already logged for this
   * exercise today — "80, 80, 80, 8" is a slipped digit, and it silently
   * corrupts volume and every progression read off it.
   *
   * Derived from what's on screen rather than latched at log time, so
   * correcting the set makes the note go away by itself. Nothing is
   * blocked and nothing is auto-changed: if 8 kg is what you lifted, log
   * it and read past this.
   */
  const loadWarnings = sets.map((s, i) =>
    s === null
      ? null
      : setLoadWarning(
          s.weight,
          sets.slice(0, i).filter((p): p is WorkoutSet => p !== null).map((p) => p.weight),
        ),
  );

  function prefill(i: number) {
    const from = last?.sets[Math.min(i, (last?.sets.length ?? 1) - 1)];
    // During the ramp the planned weight wins over "same as last time":
    // last time was a different percentage, and following it would undo
    // the ramp entirely.
    const filled: WorkoutSet =
      expected != null
        ? { reps: def.repRangeBottom ?? def.repRangeTop, weight: expected }
        : from
          ? { reps: from.reps, weight: from.weight }
          : { reps: def.seedReps ?? def.repRangeTop, weight: def.seedWeight ?? 0 };
    const next = [...sets];
    next[i] = { ...filled, confirmedAt: Date.now() };
    onChange(next);
    onSetLogged?.(def);
    if (filled.weight > 0) onPersonalRecord?.(filled.weight);
  }

  function confirm(i: number, v: WorkoutSet) {
    const next = [...sets];
    // The confirm tap is what locks the set: the stamp is the record that
    // this number was deliberate rather than a half-finished edit.
    next[i] = { ...v, confirmedAt: Date.now() };
    onChange(next);
    setEditing(null);
    onSetLogged?.(def);
    if (v.weight > 0) onPersonalRecord?.(v.weight);
  }

  function clear(i: number) {
    const next = [...sets];
    next[i] = null;
    onChange(next);
    setEditing(null);
  }

  return (
    <SketchCard className="px-4 pt-4 pb-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="hand text-[26px]">{def.name}</span>
          <p className="caption">
            {repRangeLabel(def)}
            {planLabel && ` · ${planLabel}`}
          </p>
          {expected != null && (
            <p className="caption">
              plan: <span className="tnum font-semibold">{expected} kg</span>
            </p>
          )}
          {/* Plain statement of where it came from. Not "missed", not
              "owed" — nothing was lost by not doing it last time. Caption
              styling rather than the uppercase annotation: this is an aside,
              and it should read like one. */}
          {promoted && <p className="caption mt-0.5">moved up from last session</p>}
        </div>
        {manage && (
          <button
            onClick={() => setManaging((v) => !v)}
            className="hand shrink-0 px-1 py-1 text-[16px] text-[var(--ink-muted)]"
            aria-label={`manage ${def.name}`}
          >
            {managing ? 'done' : 'edit'}
          </button>
        )}
      </div>

      {manage && managing && (
        <ManagePanel def={def} manage={manage} onClose={() => setManaging(false)} />
      )}

      {/* LAST TIME — first and most prominent. At the rack this is the only
          thing that matters. */}
      {last ? (
        <div className="mt-2 bg-[var(--sunk)] px-3 py-2">
          <span className="annot">last time · {formatDayLabel(last.date)}</span>
          <p className="tnum mt-0.5 text-[22px] font-semibold leading-snug">
            {last.sets
              .map((s) => (s.weight > 0 ? `${s.weight}×${s.reps}` : `${s.reps}`))
              .join('  ·  ')}
            {last.sets.every((s) => s.weight === 0) && (
              <span className="text-[14px] font-medium text-[var(--ink-muted)]"> bw</span>
            )}
          </p>
        </div>
      ) : (
        <p className="caption mt-2">first time — whatever you lift becomes last time</p>
      )}

      {hint && !hintDismissed && (
        <div className="mt-2 flex items-start justify-between gap-2">
          <p className="caption text-[var(--success)]">{hint.text}</p>
          <button
            onClick={() => setHintDismissed(true)}
            aria-label="dismiss suggestion"
            className="shrink-0 text-[14px] text-[var(--ink-muted)]"
          >
            ×
          </button>
        </div>
      )}

      <div className="mt-3 flex flex-col gap-2">
        {sets.map((s, i) =>
          editing === i ? (
            <SetEditor
              key={i}
              initial={s ?? undefined}
              bodyweight={def.equipment === 'bodyweight'}
              onDone={(v) => confirm(i, v)}
              onClear={() => clear(i)}
            />
          ) : (
            <div key={i} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <button
                onClick={() => (s ? setEditing(i) : prefill(i))}
                className="relative flex h-[52px] flex-1 items-center justify-between px-4"
                style={s ? { background: 'var(--sunk)' } : undefined}
              >
                <SketchBorder
                  filter="rough2"
                  radius={5}
                  strokeWidth={s ? 2.6 : 2}
                  stroke={s ? 'var(--success)' : 'var(--rule)'}
                  dashed={!s}
                />
                <span className="annot relative">set {i + 1}</span>
                <span className="tnum relative text-[19px] font-semibold">
                  {s
                    ? s.weight > 0
                      ? `${s.weight} kg × ${s.reps}`
                      : `${s.reps} reps`
                    : last
                      ? 'tap = last time'
                      : 'tap to log'}
                </span>
              </button>
              {s && (
                <button
                  onClick={() => setEditing(i)}
                  className="hand h-[52px] px-2 text-[18px] text-[var(--ink-muted)]"
                >
                  edit
                </button>
              )}
            </div>
            {loadWarnings[i] && (
              <p className="caption" style={{ color: 'var(--accent)' }}>
                {loadWarnings[i]}
              </p>
            )}
            </div>
          ),
        )}
        <button
          onClick={() => onChange([...sets, null])}
          className="hand py-1 text-[16px] text-[var(--ink-muted)]"
        >
          + add a set
        </button>
      </div>
    </SketchCard>
  );
}

function ManagePanel({
  def,
  manage,
  onClose,
}: {
  def: ExerciseDef;
  manage: NonNullable<ExerciseCardProps['manage']>;
  onClose: () => void;
}) {
  const [name, setName] = useState(def.name);
  const [rest, setRest] = useState(String(def.restSec));

  return (
    <div className="mt-2 flex flex-col gap-2 bg-[var(--sunk)] p-3">
      <div className="relative flex h-[44px] items-center bg-[var(--paper)] px-3">
        <SketchBorder filter="rough2" radius={4} strokeWidth={1.8} />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="relative w-full bg-transparent text-[15px] font-medium outline-none"
        />
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <NumberField label="rest" unit="s" value={rest} onChange={setRest} integer />
        </div>
        {manage.onMoveUp && (
          <button onClick={manage.onMoveUp} aria-label="move up" className="hand h-11 px-2 text-[15px]">
            up
          </button>
        )}
        {manage.onMoveDown && (
          <button onClick={manage.onMoveDown} aria-label="move down" className="hand h-11 px-2 text-[15px]">
            down
          </button>
        )}
      </div>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          className="flex-1"
          onClick={() => {
            if (name.trim() && name.trim() !== def.name) manage.onRename(name.trim());
            const r = parseNum(rest);
            if (r && r !== def.restSec) manage.onEditRest(Math.round(r));
            onClose();
          }}
        >
          Save
        </Button>
        <button
          onClick={manage.onRemove}
          className="hand px-3 text-[15px] text-[var(--accent)]"
        >
          remove
        </button>
      </div>
    </div>
  );
}

function SetEditor({
  initial,
  bodyweight,
  onDone,
  onClear,
}: {
  initial?: WorkoutSet;
  bodyweight: boolean;
  onDone: (s: WorkoutSet) => void;
  onClear: () => void;
}) {
  const [reps, setReps] = useState(initial ? String(initial.reps) : '');
  const [weight, setWeight] = useState(
    initial && initial.weight > 0 ? String(initial.weight) : '',
  );
  const r = parseNum(reps);
  const w = bodyweight ? 0 : (parseNum(weight) ?? 0);

  return (
    <div className="flex items-end gap-2">
      {!bodyweight && (
        <div className="flex-1">
          <NumberField label="kg" value={weight} onChange={setWeight} autoFocus />
        </div>
      )}
      <div className="flex-1">
        <NumberField label="reps" value={reps} onChange={setReps} integer autoFocus={bodyweight} />
      </div>
      <Button
        onClick={() => r && onDone({ reps: r, weight: w })}
        disabled={!r}
        className="shrink-0"
      >
        Set
      </Button>
      <button onClick={onClear} className="hand h-[52px] px-1 text-[18px] text-[var(--ink-muted)]">
        clear
      </button>
    </div>
  );
}

// ── Add exercise ──────────────────────────────────────────────────────────

/** Always visible at the bottom of the list, for every session type — never
 * gated behind an empty state. */
export function AddExercisePanel({
  onAdd,
}: {
  onAdd: (def: ExerciseDef) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [equipment, setEquipment] = useState<ExerciseDef['equipment']>('barbell');
  const [repTop, setRepTop] = useState('8');
  const [rest, setRest] = useState('120');

  function add() {
    if (!name.trim()) return;
    const top = parseNum(repTop) ?? 8;
    const restSec = parseNum(rest) ?? 120;
    onAdd({
      name: name.trim(),
      repRangeTop: Math.round(top),
      equipment,
      restSec: Math.round(restSec),
    });
    setName('');
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="hand w-full py-3 text-[20px] text-[var(--accent)]"
      >
        + add exercise
      </button>
    );
  }

  return (
    <SketchCard filter="rough2" className="px-4 py-4">
      <span className="hand text-[22px]">new exercise</span>
      <div className="mt-3 flex flex-col gap-3">
        <div className="relative flex h-[52px] items-center bg-[var(--paper)] px-4 [--field-stroke:var(--ink)] focus-within:[--field-stroke:var(--accent)]">
          <SketchBorder filter="rough2" radius={4} strokeWidth={2} stroke="var(--field-stroke)" />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Exercise name"
            autoFocus
            className="relative w-full bg-transparent text-[16px] font-medium outline-none placeholder:text-[var(--ink-faint)]"
          />
        </div>
        <div className="flex gap-2">
          {(['barbell', 'dumbbell', 'machine', 'bodyweight'] as const).map((eq) => (
            <button
              key={eq}
              onClick={() => setEquipment(eq)}
              className="relative flex h-[40px] flex-1 items-center justify-center text-[12.5px] font-semibold"
              style={
                equipment === eq
                  ? { background: 'var(--btn-fill)', color: 'var(--btn-text)', borderRadius: 5 }
                  : { color: 'var(--ink-muted)' }
              }
            >
              {equipment !== eq && <SketchBorder radius={5} strokeWidth={1.8} />}
              <span className="relative">{eq}</span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="rep target" value={repTop} onChange={setRepTop} integer />
          <NumberField label="rest" unit="s" value={rest} onChange={setRest} integer />
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={add} disabled={!name.trim()}>
            Add
          </Button>
        </div>
      </div>
    </SketchCard>
  );
}
