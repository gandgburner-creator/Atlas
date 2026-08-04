import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '../components/Button';
import { PushHeader } from '../components/Chrome';
import { SketchBorder, SketchCard } from '../components/Sketch';
import {
  finishTrainingSession,
  getExercisePlans,
  getTodaysInProgressWorkout,
  getTrainingState,
  saveExercisePlans,
  saveTrainingState,
  skipRestDay,
  startTrainingSession,
  switchSession,
  updateWorkout,
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

  if (!data) return null;
  const { state, plans, workouts, session, inProgress } = data;
  const paused = Boolean(state.pause);
  // The session actually being trained is whichever row is already open
  // today, if any — its own type, not necessarily today's freshly computed
  // slot, so resuming after a reload always lands back on the right one.
  const activeSession = inProgress?.sessionType ?? session;
  const exercises = plans[activeSession] ?? [];
  const last = lastTimeFor(workouts, activeSession, inProgress ? today : undefined);

  /** The row for this session, created on demand. Opening the screen must
   * leave no trace, so this is only ever reached from a real logged set. */
  async function ensureWorkoutId(): Promise<number> {
    if (inProgress?.id) return inProgress.id;
    if (!startPromiseRef.current) {
      startPromiseRef.current = startTrainingSession(today, activeSession);
    }
    return startPromiseRef.current;
  }

  async function persist(nextDraft: Draft) {
    const done: WorkoutExercise[] = Object.entries(nextDraft)
      .map(([name, sets]) => ({
        name,
        sets: sets.filter((s): s is WorkoutSet => s !== null),
      }))
      .filter((e) => e.sets.length > 0);
    // Clearing the last set of an untouched session must not conjure a row
    // to store nothing in — no sets and no row yet means nothing happened.
    if (done.length === 0 && !inProgress?.id && !startPromiseRef.current) return;
    await updateWorkout(await ensureWorkoutId(), done);
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
      // Nothing logged means there is no session to finish: no row was ever
      // created, so there is nothing to discard and the queue stays put.
      // finishTrainingSession applies the same rule to a row that exists but
      // is empty, so both routes leave the pointer alone.
      const id = inProgress?.id ?? (await startPromiseRef.current) ?? null;
      if (id !== null) await finishTrainingSession(id, today);
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
    // Retargets the open row as well as the pointer, so the screen actually
    // changes — moving the pointer alone leaves an in-progress session
    // showing its own old type and the switch looks like it did nothing.
    await switchSession(type, today);
    startPromiseRef.current = null;
    setDraft({});
    setLoadedFor(null);
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
              {/* Never disabled, for any type, in any state — this is the
                  manual override, and an override that can be unavailable
                  is not one. The current session included: re-picking it is
                  a harmless no-op, and greying it out just looks broken. */}
              {slotTypes.map((t) => (
                <button
                  key={t}
                  onClick={() => changeTo(t)}
                  className="relative px-3 py-2 text-[14px] font-semibold"
                  style={
                    t === activeSession
                      ? { background: 'var(--btn-fill)', color: 'var(--btn-text)', borderRadius: 999 }
                      : { color: 'var(--ink)' }
                  }
                >
                  {t !== activeSession && (
                    <SketchBorder radius={999} strokeWidth={1.8} stroke="var(--rule)" />
                  )}
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
              sets={draft[def.name] ?? Array(def.sets ?? 4).fill(null)}
              onChange={(sets) => updateDraft(def.name, sets)}
              onSetLogged={(d) => restTimer.start(d.name, d.restSec)}
              manage={{
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
              }}
            />
          ))}

          <AddExercisePanel onAdd={(def) => setExercises([...exercises, def])} />

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
