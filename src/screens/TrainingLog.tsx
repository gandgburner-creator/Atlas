import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '../components/Button';
import { NumberField, parseNum, PushHeader } from '../components/Chrome';
import { TimerRing } from '../components/Ring';
import { SketchBorder, SketchCard } from '../components/Sketch';
import {
  getExercisePlans,
  getTrainingState,
  saveExercisePlans,
  saveTrainingState,
  type ExerciseDef,
} from '../db/config';
import { db, type WorkoutSet } from '../db/schema';
import {
  advanceAfterSession,
  lastTimeFor,
  overloadHint,
  passRestDays,
  sessionFor,
  type LastExercise,
} from '../domain/training';
import { formatDayLabel } from '../domain/time';
import { useNav } from '../nav';

interface Props {
  today: string;
}

type Draft = Record<string, (WorkoutSet | null)[]>;

const REST_KEY = 'atlas.restTimer';

export function TrainingLog({ today }: Props) {
  const nav = useNav();
  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);

  const data = useLiveQuery(async () => {
    const [state, plans, workouts] = await Promise.all([
      getTrainingState(),
      getExercisePlans(),
      db.workouts.toArray(),
    ]);
    return { state: passRestDays(state, today), plans, workouts };
  }, [today]);

  if (!data) return null;
  const { state, plans, workouts } = data;
  const session = sessionFor(state, today);
  const paused = Boolean(state.pause);
  const exercises = plans[session] ?? [];
  const last = lastTimeFor(workouts, session);

  const loggedAnything = Object.values(draft).some((sets) =>
    sets.some((s) => s !== null),
  );

  async function finish() {
    setSaving(true);
    try {
      const done = Object.entries(draft)
        .map(([name, sets]) => ({
          name,
          sets: sets.filter((s): s is WorkoutSet => s !== null),
        }))
        .filter((e) => e.sets.length > 0);
      await db.workouts.add({ date: today, sessionType: session, exercises: done });
      // Two of four exercises IS a completed session: the pointer advances,
      // there is no warning and no debt.
      await saveTrainingState(advanceAfterSession(state, today));
      nav.pop();
    } finally {
      setSaving(false);
    }
  }

  async function togglePause(reason?: string) {
    const next = state.pause
      ? { ...state, pause: null }
      : { ...state, pause: { since: today, reason } };
    await saveTrainingState(next);
    setPauseOpen(false);
  }

  async function passRest() {
    await saveTrainingState(advanceAfterSession(state, today));
  }

  return (
    <div className="flex flex-col gap-5 pb-28">
      <PushHeader
        title={paused ? 'paused' : session === 'rest' ? 'rest day' : session}
        right={
          <button
            onClick={() => setPauseOpen((v) => !v)}
            className="hand px-2 py-2 text-[19px] text-[var(--ink-muted)]"
          >
            {paused ? 'resume' : 'pause'}
          </button>
        }
      />

      {pauseOpen && !paused && <PauseCard onPause={togglePause} />}
      {paused && (
        <SketchCard className="px-5 py-4">
          <p className="caption">
            Queue frozen since {formatDayLabel(state.pause!.since)}
            {state.pause?.reason ? ` — ${state.pause.reason}` : ''}. These days
            are excluded, not missed.
          </p>
          <Button variant="secondary" className="mt-3 w-full" onClick={() => togglePause()}>
            Resume the queue
          </Button>
        </SketchCard>
      )}

      {!paused && session === 'rest' && (
        <SketchCard className="px-5 py-5">
          <p className="hand text-[26px]">rest is on the plan</p>
          <p className="caption mt-1">
            The queue moves past rest by itself at midnight. Trained anyway or
            want tomorrow's session today?
          </p>
          <Button variant="secondary" className="mt-3 w-full" onClick={passRest}>
            Skip ahead to the next session
          </Button>
        </SketchCard>
      )}

      {!paused && session !== 'rest' && exercises.length === 0 && (
        <DefinePlan session={session} plans={plans} />
      )}

      {!paused &&
        session !== 'rest' &&
        exercises.map((def) => (
          <ExerciseCard
            key={def.name}
            def={def}
            last={last.get(def.name)}
            sets={draft[def.name] ?? [null, null, null, null]}
            onChange={(sets) => setDraft((d) => ({ ...d, [def.name]: sets }))}
          />
        ))}

      {!paused && session !== 'rest' && exercises.length > 0 && (
        <Button onClick={finish} disabled={!loggedAnything || saving}>
          {saving ? 'Saving…' : 'Finish session'}
        </Button>
      )}

      {!paused && session !== 'rest' && <RestTimer />}
    </div>
  );
}

// ── Pause ─────────────────────────────────────────────────────────────────

function PauseCard({ onPause }: { onPause: (reason?: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <SketchCard filter="rough2" className="px-5 py-4">
      <p className="hand text-[24px]">pause the queue</p>
      <p className="caption mt-1">
        Sick, injured, travelling. Days while paused are excluded, not missed.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {['sick', 'injured', 'travelling'].map((r) => (
          <button
            key={r}
            onClick={() => setReason(r)}
            className="relative px-4 py-2.5 text-[14px] font-semibold"
            style={
              reason === r
                ? { background: 'var(--btn-fill)', color: 'var(--btn-text)', borderRadius: 999 }
                : { color: 'var(--ink-muted)' }
            }
          >
            {reason !== r && <SketchBorder radius={999} strokeWidth={1.8} stroke="var(--rule)" />}
            <span className="relative">{r}</span>
          </button>
        ))}
      </div>
      <Button variant="secondary" className="mt-3 w-full" onClick={() => onPause(reason || undefined)}>
        Pause
      </Button>
    </SketchCard>
  );
}

// ── Exercise card ─────────────────────────────────────────────────────────

function ExerciseCard({
  def,
  last,
  sets,
  onChange,
}: {
  def: ExerciseDef;
  last: LastExercise | undefined;
  sets: (WorkoutSet | null)[];
  onChange: (sets: (WorkoutSet | null)[]) => void;
}) {
  const hint = overloadHint(last, def);
  const [editing, setEditing] = useState<number | null>(null);

  function prefill(i: number) {
    // One tap = last time's numbers for that set. The common case.
    const from = last?.sets[Math.min(i, (last?.sets.length ?? 1) - 1)];
    const filled: WorkoutSet = from
      ? { reps: from.reps, weight: from.weight }
      : { reps: def.seedReps ?? def.repRangeTop, weight: def.seedWeight ?? 0 };
    const next = [...sets];
    next[i] = filled;
    onChange(next);
  }

  function clear(i: number) {
    const next = [...sets];
    next[i] = null;
    onChange(next);
    setEditing(null);
  }

  return (
    <SketchCard className="px-4 pt-4 pb-4">
      <span className="hand text-[26px]">{def.name}</span>

      {/* LAST TIME — first and most prominent. At the rack this is the only
          thing that matters. */}
      {last ? (
        <div className="mt-1 bg-[var(--sunk)] px-3 py-2">
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
        <p className="caption mt-1">first time — whatever you lift becomes last time</p>
      )}

      {hint && <p className="caption mt-2 text-[var(--success)]">{hint.text}</p>}

      <div className="mt-3 flex flex-col gap-2">
        {sets.map((s, i) =>
          editing === i ? (
            <SetEditor
              key={i}
              initial={s ?? undefined}
              bodyweight={def.equipment === 'bodyweight'}
              onDone={(v) => {
                const next = [...sets];
                next[i] = v;
                onChange(next);
                setEditing(null);
              }}
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
      </div>
    </SketchCard>
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

// ── First-use plan definition ─────────────────────────────────────────────

function DefinePlan({
  session,
  plans,
}: {
  session: string;
  plans: Record<string, ExerciseDef[]>;
}) {
  const [name, setName] = useState('');
  const [equipment, setEquipment] = useState<ExerciseDef['equipment']>('barbell');

  async function add() {
    if (!name.trim()) return;
    const def: ExerciseDef = {
      name: name.trim(),
      repRangeTop: equipment === 'bodyweight' ? 10 : 8,
      equipment,
    };
    await saveExercisePlans({
      ...plans,
      [session]: [...(plans[session] ?? []), def],
    });
    setName('');
  }

  return (
    <SketchCard className="px-5 py-5">
      <p className="hand text-[26px]">first {session} day</p>
      <p className="caption mt-1">
        Name the exercises once; after that it's one tap per set.
      </p>
      <div className="mt-3 flex flex-col gap-3">
        <div className="relative flex h-[56px] items-center bg-[var(--paper)] px-4 [--field-stroke:var(--ink)] focus-within:[--field-stroke:var(--accent)]">
          <SketchBorder filter="rough2" radius={4} strokeWidth={2.2} stroke="var(--field-stroke)" />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Exercise name"
            className="relative w-full bg-transparent text-[18px] font-medium outline-none placeholder:text-[var(--ink-faint)]"
          />
        </div>
        <div className="flex gap-2">
          {(['barbell', 'dumbbell', 'bodyweight'] as const).map((eq) => (
            <button
              key={eq}
              onClick={() => setEquipment(eq)}
              className="relative flex h-[44px] flex-1 items-center justify-center text-[14px] font-semibold"
              style={
                equipment === eq
                  ? { background: 'var(--btn-fill)', color: 'var(--btn-text)', borderRadius: 5 }
                  : { color: 'var(--ink-muted)' }
              }
            >
              {equipment !== eq && <SketchBorder radius={5} strokeWidth={2} />}
              <span className="relative">{eq}</span>
            </button>
          ))}
        </div>
        <Button variant="secondary" onClick={add} disabled={!name.trim()}>
          Add exercise
        </Button>
      </div>
    </SketchCard>
  );
}

// ── Rest timer ────────────────────────────────────────────────────────────

interface TimerState {
  endsAt: number;
  total: number;
}

/**
 * Counts down 90/120/180s between sets. The deadline lives in localStorage,
 * so backgrounding the app — the normal case, phone locked between sets —
 * loses nothing: on visibility the remaining time recomputes from the clock.
 * Notifies however the platform allows: vibration, a title flash, and the
 * Notification API where it's been granted.
 */
function RestTimer() {
  const [timer, setTimer] = useState<TimerState | null>(() => {
    try {
      const raw = localStorage.getItem(REST_KEY);
      if (!raw) return null;
      const t = JSON.parse(raw) as TimerState;
      return t.endsAt > Date.now() ? t : null;
    } catch {
      return null;
    }
  });
  const [now, setNow] = useState(Date.now());
  const firedRef = useRef(false);

  const start = useCallback((seconds: number) => {
    const t = { endsAt: Date.now() + seconds * 1000, total: seconds };
    localStorage.setItem(REST_KEY, JSON.stringify(t));
    firedRef.current = false;
    setTimer(t);
    // Ask once, on first use, from a user gesture.
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  }, []);

  const stop = useCallback(() => {
    localStorage.removeItem(REST_KEY);
    setTimer(null);
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

  useEffect(() => {
    if (!timer || remaining > 0 || firedRef.current) return;
    firedRef.current = true;
    navigator.vibrate?.([200, 100, 200]);
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('Rest over', { body: 'Next set.' });
      } catch {
        /* iOS: constructor unsupported — vibration and the ring suffice. */
      }
    }
    localStorage.removeItem(REST_KEY);
  }, [remaining, timer]);

  const mm = Math.floor(remaining / 60000);
  const ss = Math.floor((remaining % 60000) / 1000);

  if (!timer) {
    return (
      <div className="fixed inset-x-0 bottom-0 mx-auto max-w-[390px] px-5">
        <div className="pb-safe flex gap-2 bg-[var(--board)] pt-2">
          {[90, 120, 180].map((s) => (
            <Button key={s} variant="secondary" className="flex-1" onClick={() => start(s)}>
              <span className="tnum">rest {s}s</span>
            </Button>
          ))}
        </div>
      </div>
    );
  }

  const frac = remaining / (timer.total * 1000);
  const done = remaining <= 0;

  return (
    <div className="fixed inset-x-0 bottom-0 mx-auto max-w-[390px] px-5">
      <div className="pb-safe bg-[var(--board)] pt-2">
        <SketchCard className="flex items-center gap-4 px-4 py-3">
          <TimerRing
            fraction={done ? 1 : frac}
            color={done ? 'var(--success)' : 'var(--accent)'}
            size={72}
          >
            <span className="tnum text-[16px] font-semibold">
              {done ? '0:00' : `${mm}:${String(ss).padStart(2, '0')}`}
            </span>
          </TimerRing>
          <div className="flex-1">
            <p className="hand text-[22px]">{done ? 'next set' : 'rest'}</p>
            <p className="tnum caption">of {Math.floor(timer.total / 60)}:{String(timer.total % 60).padStart(2, '0')}</p>
          </div>
          <Button variant="secondary" onClick={stop}>
            {done ? 'Clear' : 'Stop'}
          </Button>
        </SketchCard>
      </div>
    </div>
  );
}

