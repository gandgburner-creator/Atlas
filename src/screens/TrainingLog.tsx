import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '../components/Button';
import { PushHeader } from '../components/Chrome';
import { SketchBorder, SketchCard } from '../components/Sketch';
import {
  finishTrainingSession,
  getExercisePlans,
  getTodaysInProgressWorkout,
  getTrainingState,
  overrideNextSession,
  saveExercisePlans,
  saveTrainingState,
  skipRestDay,
  startTrainingSession,
  updateWorkout,
  LOCKED_SESSION,
  type ExerciseDef,
} from '../db/config';
import { db, type WorkoutExercise, type WorkoutSet } from '../db/schema';
import { lastTimeFor, passRestDays, sessionFor } from '../domain/training';
import { formatDayLabel } from '../domain/time';
import { useNav } from '../nav';
import {
  AddExercisePanel,
  ExerciseCard,
  RestBar,
  useRestTimer,
} from './TrainingShared';

interface Props {
  today: string;
}

type Draft = Record<string, (WorkoutSet | null)[]>;

function draftFromExercises(exercises: WorkoutExercise[]): Draft {
  const d: Draft = {};
  for (const ex of exercises) d[ex.name] = ex.sets.length ? ex.sets : [null];
  return d;
}

export function TrainingLog({ today }: Props) {
  const nav = useNav();
  const [finishing, setFinishing] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const restTimer = useRestTimer();
  // Bridges the gap between "user tapped log set" and "the row this session
  // writes to actually exists in Dexie" — only ever needed for the first set
  // of a fresh session, since the mount effect below normally wins the race.
  const startPromiseRef = useRef<Promise<number> | null>(null);

  const data = useLiveQuery(async () => {
    const [rawState, plans, workouts] = await Promise.all([
      getTrainingState(),
      getExercisePlans(),
      db.workouts.toArray(),
    ]);
    const state = passRestDays(rawState, today);
    const session = sessionFor(state, today);
    // Scoped to today: a session left in_progress from an earlier day is
    // Home's problem (finish/discard banner), never silently resumed here —
    // that would block today's session from starting fresh.
    const inProgress = await getTodaysInProgressWorkout(today);
    return { state, plans, workouts, session, inProgress };
  }, [today]);

  const [draft, setDraft] = useState<Draft>({});
  const [loadedFor, setLoadedFor] = useState<number | null>(null);

  // Load the in-progress row's already-logged sets into the draft exactly
  // once per workout shown — keyed on the row's id, not the session name —
  // so mid-tap editing isn't clobbered by the live query re-running.
  if (data?.inProgress && loadedFor !== data.inProgress.id) {
    setDraft(draftFromExercises(data.inProgress.exercises));
    setLoadedFor(data.inProgress.id ?? null);
  }

  // Starting a session creates its Dexie row the instant it's opened — the
  // record must exist before a single set is logged, never held only in
  // this component's state. Guarded per session type so a pending creation
  // isn't re-fired on every render, and re-armed once the pointer moves on.
  const startedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!data) return;
    const { state, session, inProgress } = data;
    if (state.pause || session === 'rest' || inProgress) return;
    if (startedForRef.current === session) return;
    startedForRef.current = session;
    void startTrainingSession(today, session);
  }, [data, today]);

  if (!data) return null;
  const { state, plans, workouts, session, inProgress } = data;
  const paused = Boolean(state.pause);
  // The session actually being trained is whichever row is already open
  // today, if any — its own type, not necessarily today's freshly computed
  // slot, so resuming after a reload always lands back on the right one.
  const activeSession = inProgress?.sessionType ?? session;
  const exercises = plans[activeSession] ?? [];
  const last = lastTimeFor(workouts, activeSession, inProgress ? today : undefined);
  const locked = activeSession === LOCKED_SESSION;

  async function ensureWorkoutId(): Promise<number> {
    if (inProgress?.id) return inProgress.id;
    if (!startPromiseRef.current) {
      startPromiseRef.current = startTrainingSession(today, session);
    }
    return startPromiseRef.current;
  }

  async function persist(nextDraft: Draft) {
    const id = await ensureWorkoutId();
    const done: WorkoutExercise[] = Object.entries(nextDraft)
      .map(([name, sets]) => ({
        name,
        sets: sets.filter((s): s is WorkoutSet => s !== null),
      }))
      .filter((e) => e.sets.length > 0);
    await updateWorkout(id, done);
  }

  function updateDraft(name: string, sets: (WorkoutSet | null)[]) {
    setDraft((d) => {
      const next = { ...d, [name]: sets };
      void persist(next);
      return next;
    });
  }

  async function finish() {
    setFinishing(true);
    try {
      // Zero sets logged is still a valid, complete session — the button is
      // never disabled for it, and finishing it still advances the queue.
      const id = await ensureWorkoutId();
      await finishTrainingSession(id, today);
      nav.pop();
    } finally {
      setFinishing(false);
    }
  }

  async function togglePause(reason?: string) {
    const next = state.pause
      ? { ...state, pause: null }
      : { ...state, pause: { since: today, reason } };
    await saveTrainingState(next);
    setPauseOpen(false);
  }

  async function changeTo(type: string) {
    await overrideNextSession(type, today);
    setChangeOpen(false);
  }

  function setExercises(next: ExerciseDef[]) {
    void saveExercisePlans({ ...plans, [activeSession]: next });
  }

  const slotTypes = [...new Set(state.split)];

  return (
    <div className={`flex flex-col gap-5 ${restTimer.timer ? 'pb-28' : 'pb-4'}`}>
      <PushHeader
        title={paused ? 'paused' : activeSession === 'rest' ? 'rest day' : activeSession}
        right={
          <div className="flex items-center gap-1">
            <button
              onClick={() => nav.push({ name: 'training-history' })}
              className="hand px-2 py-2 text-[17px] text-[var(--ink-muted)]"
            >
              history
            </button>
            <button
              onClick={() => setPauseOpen((v) => !v)}
              className="hand px-2 py-2 text-[19px] text-[var(--ink-muted)]"
            >
              {paused ? 'resume' : 'pause'}
            </button>
          </div>
        }
      />

      {!paused && activeSession !== 'rest' && inProgress && (
        <p className="annot -mt-3 text-[var(--success)]">✓ every set saves as you log it</p>
      )}

      {!paused && (
        <div>
          <button
            onClick={() => setChangeOpen((v) => !v)}
            className="hand text-[16px] text-[var(--ink-muted)] underline"
          >
            not this? change session
          </button>
          {changeOpen && (
            <div className="mt-2 flex flex-wrap gap-2">
              {slotTypes.map((t) => (
                <button
                  key={t}
                  onClick={() => changeTo(t)}
                  disabled={t === session}
                  className="relative px-3 py-2 text-[14px] font-semibold disabled:opacity-40"
                  style={{ color: 'var(--ink)' }}
                >
                  <SketchBorder radius={999} strokeWidth={1.8} stroke="var(--rule)" />
                  <span className="relative">{t}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

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

      {!paused && activeSession === 'rest' && (
        <SketchCard className="px-5 py-5">
          <p className="hand text-[26px]">rest is on the plan</p>
          <p className="caption mt-1">
            The queue moves past rest by itself at midnight. Trained anyway or
            want tomorrow's session today?
          </p>
          <Button
            variant="secondary"
            className="mt-3 w-full"
            onClick={() => skipRestDay(today)}
          >
            Skip ahead to the next session
          </Button>
        </SketchCard>
      )}

      {!paused && activeSession !== 'rest' && (
        <>
          {exercises.map((def, i) => (
            <ExerciseCard
              key={def.name}
              def={def}
              last={last.get(def.name)}
              sets={draft[def.name] ?? [null, null, null, null]}
              onChange={(sets) => updateDraft(def.name, sets)}
              onSetLogged={(d) => restTimer.start(d.name, d.restSec)}
              manage={
                locked
                  ? undefined
                  : {
                      onRename: (name) => {
                        const next = [...exercises];
                        next[i] = { ...def, name };
                        setExercises(next);
                        setDraft((d) => {
                          const { [def.name]: sets, ...rest } = d;
                          const nextDraft = sets ? { ...rest, [name]: sets } : d;
                          void persist(nextDraft);
                          return nextDraft;
                        });
                      },
                      onMoveUp: i > 0 ? () => {
                        const next = [...exercises];
                        [next[i - 1], next[i]] = [next[i] as ExerciseDef, next[i - 1] as ExerciseDef];
                        setExercises(next);
                      } : undefined,
                      onMoveDown: i < exercises.length - 1 ? () => {
                        const next = [...exercises];
                        [next[i], next[i + 1]] = [next[i + 1] as ExerciseDef, next[i] as ExerciseDef];
                        setExercises(next);
                      } : undefined,
                      onRemove: () => setExercises(exercises.filter((_, j) => j !== i)),
                      onEditRest: (restSec) => {
                        const next = [...exercises];
                        next[i] = { ...def, restSec };
                        setExercises(next);
                      },
                    }
              }
            />
          ))}

          {!locked && (
            <AddExercisePanel onAdd={(def) => setExercises([...exercises, def])} />
          )}

          <Button onClick={finish} disabled={finishing} className="mt-1">
            {finishing ? 'Saving…' : 'Finish session'}
          </Button>
        </>
      )}

      <RestBar restTimer={restTimer} />
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
