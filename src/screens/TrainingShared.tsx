import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../components/Button';
import { NumberField, parseNum } from '../components/Chrome';
import { TimerRing } from '../components/Ring';
import { SketchBorder, SketchCard } from '../components/Sketch';
import type { ExerciseDef } from '../db/config';
import type { WorkoutSet } from '../db/schema';
import { formatDayLabel } from '../domain/time';
import { overloadHint, type LastExercise } from '../domain/training';

/**
 * Shared between today's live logging screen and the history editor: the
 * exercise card, its set editor, the always-visible add-exercise panel, and
 * the rest timer. One place so both screens behave identically.
 */

// ── Rest timer ────────────────────────────────────────────────────────────

interface RestTimerState {
  exercise: string;
  endsAt: number;
  total: number;
}

const REST_KEY = 'atlas.restTimer';

function loadRestTimer(): RestTimerState | null {
  try {
    const raw = localStorage.getItem(REST_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as RestTimerState;
    return t.endsAt > Date.now() - 1000 ? t : null;
  } catch {
    return null;
  }
}

/**
 * Counts down from an exercise's default rest, auto-started the moment a set
 * is confirmed — no tap to start it, hands are busy. The deadline lives in
 * localStorage keyed to wall-clock time, so backgrounding the app or locking
 * the screen between sets loses nothing: on the next tick the remaining time
 * recomputes from `Date.now()`, not from an interval that could have been
 * suspended.
 */
export function useRestTimer() {
  const [timer, setTimer] = useState<RestTimerState | null>(loadRestTimer);
  const [now, setNow] = useState(Date.now());
  const firedRef = useRef(false);

  const start = useCallback((exercise: string, seconds: number) => {
    const t: RestTimerState = { exercise, endsAt: Date.now() + seconds * 1000, total: seconds };
    localStorage.setItem(REST_KEY, JSON.stringify(t));
    firedRef.current = false;
    setTimer(t);
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  }, []);

  const dismiss = useCallback(() => {
    localStorage.removeItem(REST_KEY);
    setTimer(null);
  }, []);

  const skip = dismiss;

  const adjust = useCallback((deltaSec: number) => {
    setTimer((t) => {
      if (!t) return t;
      const next: RestTimerState = {
        ...t,
        endsAt: Math.max(Date.now(), t.endsAt + deltaSec * 1000),
        total: Math.max(1, t.total + deltaSec),
      };
      localStorage.setItem(REST_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  useEffect(() => {
    if (!timer) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    const onVis = () => setNow(Date.now());
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [timer]);

  const remaining = timer ? Math.max(0, timer.endsAt - now) : 0;
  const done = Boolean(timer) && remaining <= 0;

  useEffect(() => {
    if (!timer || remaining > 0 || firedRef.current) return;
    firedRef.current = true;
    navigator.vibrate?.([200, 100, 200]);
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('Rest over', { body: `${timer.exercise} — next set.` });
      } catch {
        /* iOS: constructor unsupported — vibration and the ring suffice. */
      }
    }
  }, [remaining, timer]);

  return { timer, remaining, done, start, adjust, skip, dismiss };
}

/** Fixed to the viewport bottom, and ONLY rendered while a timer is running
 * — idle, nothing here at all, so there's no dead gap above it. */
export function RestBar({
  restTimer,
}: {
  restTimer: ReturnType<typeof useRestTimer>;
}) {
  const { timer, remaining, done, adjust, skip, dismiss } = restTimer;
  if (!timer) return null;

  const mm = Math.floor(remaining / 60000);
  const ss = Math.floor((remaining % 60000) / 1000);
  const frac = remaining / (timer.total * 1000);

  return (
    <div className="fixed inset-x-0 bottom-0 z-10 mx-auto max-w-[390px] px-5">
      <div className="pb-safe bg-[var(--board)] pt-2">
        <SketchCard className="flex items-center gap-3 px-4 py-3">
          <TimerRing fraction={done ? 1 : frac} color={done ? 'var(--success)' : 'var(--accent)'} size={64}>
            <span className="tnum text-[15px] font-semibold">
              {done ? '0:00' : `${mm}:${String(ss).padStart(2, '0')}`}
            </span>
          </TimerRing>
          <div className="min-w-0 flex-1">
            <p className="hand truncate text-[20px]">{done ? 'next set' : 'rest'}</p>
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
  onChange: (sets: Draft) => void;
  onSetLogged?: (def: ExerciseDef) => void;
  /** Rename / reorder / remove / edit rest — hidden entirely for legs. */
  manage?: {
    onRename: (name: string) => void;
    onMoveUp?: () => void;
    onMoveDown?: () => void;
    onRemove: () => void;
    onEditRest: (restSec: number) => void;
  };
}

export function ExerciseCard({ def, last, sets, onChange, onSetLogged, manage }: ExerciseCardProps) {
  const hint = overloadHint(last, def);
  const [hintDismissed, setHintDismissed] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [managing, setManaging] = useState(false);

  function prefill(i: number) {
    const from = last?.sets[Math.min(i, (last?.sets.length ?? 1) - 1)];
    const filled: WorkoutSet = from
      ? { reps: from.reps, weight: from.weight }
      : { reps: def.seedReps ?? def.repRangeTop, weight: def.seedWeight ?? 0 };
    const next = [...sets];
    next[i] = filled;
    onChange(next);
    onSetLogged?.(def);
  }

  function confirm(i: number, v: WorkoutSet) {
    const next = [...sets];
    next[i] = v;
    onChange(next);
    setEditing(null);
    onSetLogged?.(def);
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
          <p className="caption">{repRangeLabel(def)}</p>
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
            <div key={i} className="flex items-center gap-2">
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

/** Always visible at the bottom of the list — never gated behind an empty
 * state, per the brief. Hidden for legs by the caller (locked). */
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
