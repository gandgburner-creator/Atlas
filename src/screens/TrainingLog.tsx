import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '../components/Button';
import { PushHeader } from '../components/Chrome';
import { SketchBorder, SketchCard } from '../components/Sketch';
import {
  finishTrainingSession,
  getBonusDay,
  getBonusPicks,
  getLiftRamp,
  getExercisePlans,
  getOrderOverrides,
  getTodaysInProgressWorkout,
  getTrainingState,
  saveBonusPicks,
  saveExercisePlans,
  saveSessionMeta,
  saveOrderOverride,
  saveTrainingState,
  setBonusDay,
  skipRestDay,
  startTrainingSession,
  switchSession,
  updateWorkout,
  type ExerciseDef,
} from '../db/config';
import { db, type WorkoutExercise, type WorkoutSet } from '../db/schema';
import {
  BONUS_SESSION,
  doneInBonusSince,
  exerciseLibrary,
  isBonus,
  recentlySkipped,
  resolveDefs,
} from '../domain/bonus';
import {
  expectedWeight,
  isPersonalRecord,
  percentForWeek,
  rampWeekFor,
  summarise,
} from '../domain/liftRamp';
import { lastCompletedOf, orderForSession } from '../domain/exerciseOrder';
import { formatClock, formatElapsed, isStale } from '../domain/sessionTime';
import { lastTimeFor, passRestDays, sessionFor } from '../domain/training';
import { formatDayLabel } from '../domain/time';
import { useNav } from '../nav';
import { draftFromExercises, shouldAdoptRow, type Draft } from './draft';
import { BonusPicker } from './TrainingBonus';
import {
  AddExercisePanel,
  ExerciseCard,
  RestBar,
  useRestTimer,
} from './TrainingShared';

interface Props {
  today: string;
}

export function TrainingLog({ today }: Props) {
  const nav = useNav();
  const [finishing, setFinishing] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  // 'finish' — tapped finish after a long gap. 'resume' — walked back into a
  // session that was left open. Same question either way: when did this end?
  const [stalePrompt, setStalePrompt] = useState<'finish' | 'resume' | null>(null);
  const [staleAcknowledged, setStaleAcknowledged] = useState(false);
  const restTimer = useRestTimer();
  // Bridges the gap between "user tapped log set" and "the row this session
  // writes to actually exists in Dexie" — only ever needed for the first set
  // of a fresh session, since the mount effect below normally wins the race.
  const startPromiseRef = useRef<Promise<number> | null>(null);

  const data = useLiveQuery(async () => {
    const [rawState, plans, workouts, orderOverrides, bonusDay, bonusPicks, liftRamp] =
      await Promise.all([
        getTrainingState(),
        getExercisePlans(),
        db.workouts.toArray(),
        getOrderOverrides(),
        getBonusDay(),
        getBonusPicks(),
        getLiftRamp(),
      ]);
    const state = passRestDays(rawState, today);
    const session = sessionFor(state, today);
    // Scoped to today: a session left in_progress from an earlier day is
    // Home's problem (finish/discard banner), never silently resumed here —
    // that would block today's session from starting fresh.
    const inProgress = await getTodaysInProgressWorkout(today);
    return {
      state,
      plans,
      workouts,
      session,
      inProgress,
      orderOverrides,
      // Only ever true for today. Yesterday's bonus day means nothing, so
      // there is nothing to expire or clean up.
      bonusToday: bonusDay === today,
      bonusPicks,
      liftRamp,
    };
  }, [today]);

  const [draft, setDraft] = useState<Draft>({});
  const [loadedFor, setLoadedFor] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  // Set the moment a confirmed set beats every previous one for that lift.
  // Deliberately not expected during the ramp — that's what 60% means.
  const [prLift, setPrLift] = useState<string | null>(null);
  // The end-of-session pass: rating, then the summary.
  const [closing, setClosing] = useState(false);
  const [feel, setFeel] = useState<number | null>(null);

  // Load the in-progress row's already-logged sets into the draft exactly
  // once per workout shown — keyed on the row's id, not the session name —
  // so mid-tap editing isn't clobbered by the live query re-running.
  if (data?.inProgress && loadedFor !== data.inProgress.id) {
    if (shouldAdoptRow(data.inProgress.id, loadedFor, startPromiseRef.current !== null)) {
      setDraft(draftFromExercises(data.inProgress.exercises));
      setNotes(data.inProgress.notes ?? '');
    }
    setLoadedFor(data.inProgress.id ?? null);
  }

  // Walking back into a session whose last set was hours ago: the same
  // question as a late finish, asked before more sets pile on top of a
  // duration that's already wrong.
  if (
    data?.inProgress &&
    stalePrompt === null &&
    !staleAcknowledged &&
    isStale(data.inProgress.lastSetAt, Date.now())
  ) {
    setStalePrompt('resume');
  }

  if (!data) return null;
  const { state, plans, workouts, session, inProgress, orderOverrides } = data;
  const paused = Boolean(state.pause);
  // The session actually being trained is whichever row is already open
  // today, if any — its own type, not necessarily today's freshly computed
  // slot, so resuming after a reload always lands back on the right one.
  // Bonus has no slot in the split, so its own marker stands in.
  const activeSession =
    inProgress?.sessionType ?? (data.bonusToday ? BONUS_SESSION : session);
  const bonus = isBonus(activeSession);

  const library = exerciseLibrary(plans);
  // A bonus session has no stored plan and never gets one: it's a list
  // assembled for today, from the picks, and it dies with the day. Writing
  // it into exercisePlans would turn one afternoon's choice into a
  // permanent session type.
  const plan = bonus ? resolveDefs(data.bonusPicks, library) : plans[activeSession] ?? [];
  const lastSession = bonus ? undefined : lastCompletedOf(workouts, activeSession);
  // `plan` is the stored default order; `order` is what's rendered, with
  // anything skipped last time brought to the front. They are kept apart on
  // purpose: renaming or removing an exercise must write the plan back in
  // its own order, or the promotion would quietly become the new default.
  const { order, promoted } = orderForSession(
    plan,
    lastSession,
    orderOverrides[activeSession],
    lastSession ? doneInBonusSince(workouts, lastSession.date) : undefined,
  );
  // On a bonus session "last time" has to look past the session type: the
  // point of a curl here is that it's the same curl as on back day, and
  // showing "first time" for a lift with months of history would be wrong.
  const last = bonus
    ? lastTimeFor(workouts, null, inProgress ? today : undefined)
    : lastTimeFor(workouts, activeSession, inProgress ? today : undefined);

  // ── Ramp phase ─────────────────────────────────────────────────────────
  // Which week it is, and therefore what percentage, is derived from the
  // start date against today — there is no counter to advance or get stuck.
  // Bonus sessions are outside the program, so they take no percentage.
  const hasSets = Object.values(draft).some((sets) =>
    sets.some((x) => x !== null),
  );
  const rampWeek =
    data.liftRamp && !bonus ? rampWeekFor(data.liftRamp.startDate, today) : null;
  const planLabel =
    rampWeek === null
      ? undefined
      : `week ${rampWeek} · ${Math.round(percentForWeek(rampWeek) * 100)}%`;

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
    // Stamping the write is what starts the session clock: the first set
    // becomes startedAt, every set moves lastSetAt.
    await updateWorkout(await ensureWorkoutId(), done, done.length > 0 ? Date.now() : undefined);
  }

  /** Notes save on every keystroke — same rule as sets. */
  function updateNotes(text: string) {
    setNotes(text);
    const id = inProgress?.id;
    if (id !== undefined) void saveSessionMeta(id, { notes: text });
  }

  function updateDraft(name: string, sets: (WorkoutSet | null)[]) {
    setDraft((d) => {
      const next = { ...d, [name]: sets };
      void persist(next);
      return next;
    });
  }

  async function closeOut(endedAt?: number) {
    setFinishing(true);
    try {
      // Nothing logged means there is no session to finish: no row was ever
      // created, so there is nothing to discard and the queue stays put.
      // finishTrainingSession applies the same rule to a row that exists but
      // is empty, so both routes leave the pointer alone.
      const id = inProgress?.id ?? (await startPromiseRef.current) ?? null;
      if (id !== null) await finishTrainingSession(id, today, endedAt);
      // Leaving a bonus session — logged or abandoned without a set — puts
      // the queue back on screen. finishTrainingSession clears the marker
      // for a session that had something in it; this covers the one that
      // never got a row at all.
      if (bonus) await setBonusDay(null);
      nav.pop();
    } finally {
      setFinishing(false);
      setStalePrompt(null);
    }
  }

  function finish() {
    // A finish tapped long after the last set is almost always a finish
    // that was forgotten, not a set that took an hour. Ask rather than
    // record a duration that never happened.
    if (isStale(inProgress?.lastSetAt, Date.now())) setStalePrompt('finish');
    // Nothing logged means there's no session to rate or summarise.
    else if (inProgress?.id !== undefined && hasSets) setClosing(true);
    else void closeOut();
  }

  /** Store the rating (and this session's ramp week) before closing out. */
  async function closeWithFeel(rating: number | null) {
    const id = inProgress?.id;
    if (id !== undefined) {
      await saveSessionMeta(id, {
        ...(rating !== null ? { feelRating: rating } : {}),
        ...(rampWeek !== null ? { rampWeek } : {}),
        notes: notes || undefined,
      });
    }
    await closeOut();
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

  /**
   * Where an edit to the exercise list goes. A regular session writes its
   * stored plan; a bonus session writes only today's picks, so adding a
   * lift for one afternoon never becomes a permanent part of any session
   * type.
   */
  function setExercises(next: ExerciseDef[]) {
    if (bonus) void saveBonusPicks(next.map((e) => e.name));
    else void saveExercisePlans({ ...plans, [activeSession]: next });
  }

  /**
   * Move an exercise within the visible order and make that the new stored
   * default, per "a manual reorder becomes the new default for that session
   * type". Also records that this session's promotion has been overruled —
   * without it the derived order would put the exercise straight back and
   * the move would look like it did nothing.
   */
  function reorder(from: number, to: number) {
    const next = [...order];
    [next[from], next[to]] = [next[to] as ExerciseDef, next[from] as ExerciseDef];
    setExercises(next);
    if (lastSession?.id !== undefined) {
      void saveOrderOverride(activeSession, lastSession.id);
    }
  }

  // Bonus is offered alongside the split's own types but is not one of
  // them — it consumes no slot and moves nothing when picked.
  const slotTypes = [...new Set([...state.split, BONUS_SESSION])];

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
        <div className="-mt-3 flex items-baseline justify-between gap-3">
          <p className="annot text-[var(--success)]">✓ every set saves as you log it</p>
          {inProgress.startedAt !== undefined && (
            <SessionClock startedAt={inProgress.startedAt} />
          )}
        </div>
      )}

      {/* Late finish, or walking back in hours later. Ending at the last set
          is the default because it's the one that's almost always true. */}
      {stalePrompt && inProgress?.lastSetAt !== undefined && (
        <SketchCard filter="rough2" className="px-4 py-3">
          <p className="text-[14px] leading-snug">
            {stalePrompt === 'resume'
              ? 'This session has been open since your last set at '
              : 'Your last set was at '}
            <span className="tnum font-semibold">{formatClock(inProgress.lastSetAt)}</span>.
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              className="flex-1 text-[14px]"
              disabled={finishing}
              onClick={() => closeOut(inProgress.lastSetAt)}
            >
              End at {formatClock(inProgress.lastSetAt)}
            </Button>
            <Button
              variant="secondary"
              className="flex-1 text-[14px]"
              disabled={finishing}
              onClick={() => {
                if (stalePrompt === 'finish') void closeOut();
                else {
                  // Still training. Don't ask again this visit.
                  setStalePrompt(null);
                  setStaleAcknowledged(true);
                }
              }}
            >
              {stalePrompt === 'finish' ? 'Finish now' : 'Keep going'}
            </Button>
          </div>
        </SketchCard>
      )}

      {!paused && !closing && (
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

      {!paused && !closing && activeSession === 'rest' && (
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

      {/* A confirmed set that beats everything before it. During the ramp
          this should never appear — 60% of a working weight is not a PR —
          so it says what happened and gets out of the way. */}
      {prLift && (
        <SketchCard filter="rough2" className="px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="hand text-[24px]" style={{ color: 'var(--success)' }}>
                best yet
              </p>
              <p className="caption mt-0.5">{prLift} — heavier than any set on record.</p>
            </div>
            <button
              onClick={() => setPrLift(null)}
              aria-label="dismiss"
              className="shrink-0 text-[16px] text-[var(--ink-muted)]"
            >
              ×
            </button>
          </div>
        </SketchCard>
      )}

      {closing && (
        <SessionClose
          summary={summarise({
            exercises: Object.entries(draft).map(([name, sets]) => ({
              name,
              sets: sets.filter((x): x is WorkoutSet => x !== null),
            })),
          })}
          feel={feel}
          onFeel={setFeel}
          busy={finishing}
          onDone={() => void closeWithFeel(feel)}
        />
      )}

      {!paused && !closing && bonus && (
        <BonusPicker
          suggestions={recentlySkipped(plans, workouts, today)}
          library={library}
          picked={new Set(plan.map((e) => e.name))}
          onPick={(def) => setExercises([...plan, def])}
        />
      )}

      {/* While the summary is up it IS the screen: it appears after a tap
          at the bottom of a long list, and leaving the list under it means
          the thing you just asked for is off-screen above you. */}
      {!paused && !closing && activeSession !== 'rest' && (
        <>
          {order.map((def, i) => (
            <ExerciseCard
              key={def.name}
              def={def}
              last={last.get(def.name)}
              promoted={promoted.has(def.name)}
              expected={
                rampWeek === null ? null : expectedWeight(workouts, def.name, rampWeek)
              }
              planLabel={planLabel}
              onPersonalRecord={(weight) => {
                if (isPersonalRecord(workouts, def.name, weight, inProgress?.id)) {
                  setPrLift(def.name);
                }
              }}
              sets={draft[def.name] ?? Array(def.sets ?? 4).fill(null)}
              onChange={(sets) => updateDraft(def.name, sets)}
              onSetLogged={(d) => restTimer.start(d.name, d.restSec)}
              manage={{
                // Rename / remove / rest all edit the STORED plan, matched
                // by name, so they leave its order alone. Writing the
                // displayed order back here would silently make a one-off
                // promotion the permanent default.
                onRename: (name) => {
                  setExercises(plan.map((e) => (e.name === def.name ? { ...e, name } : e)));
                  setDraft((d) => {
                    const { [def.name]: sets, ...rest } = d;
                    const nextDraft = sets ? { ...rest, [name]: sets } : d;
                    void persist(nextDraft);
                    return nextDraft;
                  });
                },
                onRemove: () => setExercises(plan.filter((e) => e.name !== def.name)),
                onEditRest: (restSec) => {
                  setExercises(
                    plan.map((e) => (e.name === def.name ? { ...e, restSec } : e)),
                  );
                },
                // Moving, by contrast, is a deliberate statement about
                // order — so it saves what's on screen and overrules the
                // promotion, which would otherwise re-hoist on next render.
                onMoveUp: i > 0 ? () => reorder(i, i - 1) : undefined,
                onMoveDown: i < order.length - 1 ? () => reorder(i, i + 1) : undefined,
              }}
            />
          ))}

          <AddExercisePanel onAdd={(def) => setExercises([...plan, def])} />

          {/* Skipping is just not logging: an exercise with no sets costs
              nothing, counts as nothing, and is never mentioned again. */}
          <p className="caption text-center">
            Leave anything you don't feel like doing — a skipped exercise
            costs nothing.
          </p>

          <div className="flex flex-col gap-2">
            <label htmlFor="session-notes" className="hand text-[20px]">
              notes
            </label>
            <div className="relative flex min-h-[56px] items-center bg-[var(--paper)] px-4 [--field-stroke:var(--ink)] focus-within:[--field-stroke:var(--accent)]">
              <SketchBorder filter="rough2" radius={4} strokeWidth={2.2} stroke="var(--field-stroke)" />
              <input
                id="session-notes"
                type="text"
                value={notes}
                onChange={(e) => updateNotes(e.target.value)}
                placeholder="How it went, what to change"
                className="relative w-full bg-transparent text-base outline-none placeholder:text-[var(--ink-faint)]"
              />
            </div>
          </div>

          <Button onClick={finish} disabled={finishing} className="mt-1">
            {finishing ? 'Saving…' : 'Finish session'}
          </Button>
        </>
      )}

      <RestBar restTimer={restTimer} />
    </div>
  );
}

/**
 * The end of a session: what you did, and how it felt.
 *
 * The summary is descriptive and stops there — no target, no comparison
 * with last time, nothing that turns a light day into a verdict. The
 * rating is optional and answers one question, energy, which is the thing
 * a ramp phase is actually testing.
 */
function SessionClose({
  summary,
  feel,
  onFeel,
  busy,
  onDone,
}: {
  summary: { exercises: number; sets: number; volume: number };
  feel: number | null;
  onFeel: (n: number) => void;
  busy: boolean;
  onDone: () => void;
}) {
  return (
    <SketchCard className="px-5 pt-4 pb-5">
      <span className="hand text-[26px]">that's the session</span>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {[
          { label: 'exercises', value: String(summary.exercises) },
          { label: 'sets', value: String(summary.sets) },
          { label: 'volume', value: Math.round(summary.volume).toLocaleString() },
        ].map((s) => (
          <div key={s.label}>
            <p className="tnum text-[26px] leading-none font-semibold">{s.value}</p>
            <span className="annot">{s.label}</span>
          </div>
        ))}
      </div>

      <p className="caption mt-4">How did that feel?</p>
      <div className="mt-2 flex gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => onFeel(n)}
            className="tnum relative h-[46px] flex-1 text-[16px] font-semibold"
            style={
              feel === n
                ? { background: 'var(--btn-fill)', color: 'var(--btn-text)', borderRadius: 5 }
                : { color: 'var(--ink)' }
            }
          >
            {feel !== n && <SketchBorder radius={5} strokeWidth={1.8} stroke="var(--rule)" />}
            <span className="relative">{n}</span>
          </button>
        ))}
      </div>
      <p className="annot mt-1">1 flat · 5 strong</p>

      <Button onClick={onDone} disabled={busy} className="mt-4 w-full">
        {busy ? 'Saving…' : feel === null ? 'Done' : 'Done'}
      </Button>
    </SketchCard>
  );
}

/**
 * Elapsed since the first set. Deliberately quiet — muted, small, tucked
 * against the save note. It's there so you know how long you've been in the
 * gym, not to hurry you: nothing here turns a colour or comments on the
 * number, however large or small it gets.
 *
 * Reads the wall clock every second rather than accumulating ticks, so
 * backgrounding the app between sets can't drift it.
 */
function SessionClock({ startedAt }: { startedAt: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    const onWake = () => tick((n) => n + 1);
    document.addEventListener('visibilitychange', onWake);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, []);
  return (
    <span className="tnum shrink-0 text-[13px] font-medium text-[var(--ink-muted)]">
      {formatElapsed(Date.now() - startedAt)}
    </span>
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
