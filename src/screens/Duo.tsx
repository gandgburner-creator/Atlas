import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '../components/Button';
import { NumberField, parseNum } from '../components/Chrome';
import { DashedRule, SketchBorder, SketchCard } from '../components/Sketch';
import {
  bodyweightOn,
  confirmDuoSet,
  finishDuoSession,
  getDeloadWeeks,
  getPrefs,
  getSeasonStart,
  logBodyweight,
  setDuoNote,
  setSeasonStart,
  startDuoSession,
  toggleDeload,
  updatePrefs,
  weightSeries,
} from '../db/duo';
import { db, type DuoSession, type DuoSet } from '../db/schema';
import {
  bestE1rm,
  buildHistory,
  buildSeason,
  DAY_KEYS,
  DAY_LABEL,
  dayKeyFor,
  dayPlannedSets,
  DUO_PROGRAM,
  EMPTY_PREFS,
  epley,
  isPr,
  lastTime,
  nextSeasonStart,
  PROFILE_NAME,
  PROFILES,
  resolveSlot,
  SESSION_TARGET_MIN,
  SESSION_WARN_MIN,
  sessionPrCount,
  sessionStats,
  targetFor,
  weekScore,
  weekStartFor,
  type DayKey,
  type DuoPrefs,
  type HistEntry,
  type Profile,
  type ResolvedSlot,
} from '../domain/duo';
import { formatDayLabel } from '../domain/time';
import { RestBar, useRestTimer } from './TrainingShared';

type View = 'train' | 'challenge' | 'progress';

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString();

/** Profile colours come from Atlas's own palette: Ghaith the accent, Gaby the green. */
const COLOR: Record<Profile, string> = { ghaith: 'var(--p-ghaith)', gaby: 'var(--p-gaby)' };

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="relative px-3 py-2 text-[14px] font-semibold"
      style={on ? { background: 'var(--btn-fill)', color: 'var(--btn-text)', borderRadius: 999 } : { color: 'var(--ink)' }}
    >
      {!on && <SketchBorder radius={999} strokeWidth={1.8} stroke="var(--rule)" />}
      <span className="relative">{children}</span>
    </button>
  );
}

// ── Charts (plain SVG in the app's pencil style) ──────────────────────────

function LineChart({
  series,
  labels,
}: {
  series: { color: string; pts: (number | null)[] }[];
  labels?: string[];
}) {
  const all = series.flatMap((s) => s.pts.filter((p): p is number => p !== null));
  const n = Math.max(1, ...series.map((s) => s.pts.length));
  if (all.length === 0) return <p className="caption">Nothing to plot yet.</p>;
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || 1;
  const W = 300;
  const H = 110;
  const x = (i: number) => (n === 1 ? W / 2 : 8 + (i * (W - 16)) / (n - 1));
  const y = (v: number) => H - 10 - ((v - lo) / span) * (H - 24);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="chart">
        <line x1="0" y1={H - 4} x2={W} y2={H - 4} stroke="var(--rule)" strokeWidth="1.5" strokeDasharray="4 4" />
        {series.map((s, si) => {
          const pts = s.pts
            .map((p, i) => (p === null ? null : `${x(i)},${y(p)}`))
            .filter((p): p is string => p !== null);
          return (
            <g key={si} filter="url(#roughSoft)">
              <polyline points={pts.join(' ')} fill="none" stroke={s.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              {s.pts.map((p, i) => (p === null ? null : <circle key={i} cx={x(i)} cy={y(p)} r="3.2" fill={s.color} />))}
            </g>
          );
        })}
      </svg>
      <div className="tnum caption flex justify-between">
        <span>{labels?.[0] ?? ''}</span>
        <span>
          {fmt(lo)} to {fmt(hi)}
        </span>
        <span>{labels && labels.length > 1 ? labels[labels.length - 1] : ''}</span>
      </div>
    </div>
  );
}

// ── Set row ───────────────────────────────────────────────────────────────

function SetRow({
  index,
  set,
  prefill,
  placeholderReps,
  bodyweightMove,
  pr,
  onConfirm,
}: {
  index: number;
  set: DuoSet | null;
  prefill: string;
  placeholderReps: number;
  bodyweightMove: boolean;
  pr: boolean;
  onConfirm: (weight: number, reps: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [w, setW] = useState(prefill);
  const [r, setR] = useState('');
  // Until the user has typed, keep following the suggested weight.
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched && !set) setW(prefill);
  }, [prefill, touched, set]);

  if (set && !editing) {
    return (
      <button
        onClick={() => {
          setW(String(set.weight));
          setR(String(set.reps));
          setTouched(true);
          setEditing(true);
        }}
        className="relative flex h-[52px] items-center justify-between px-4"
        style={{ background: 'var(--sunk)' }}
        aria-label={`set ${index + 1} locked, tap to edit`}
      >
        <SketchBorder filter="rough2" radius={5} strokeWidth={2.6} stroke="var(--success)" />
        <span className="annot relative">set {index + 1}</span>
        <span className="tnum relative flex items-center gap-2 text-[19px] font-semibold">
          {pr && (
            <span className="annot" style={{ color: 'var(--accent)' }}>
              PR
            </span>
          )}
          {bodyweightMove && set.weight > 0 ? '+' : ''}
          {set.weight} kg × {set.reps}
        </span>
      </button>
    );
  }

  const weight = parseNum(w);
  const reps = parseNum(r);
  const ok = weight !== null && reps !== null && reps > 0;
  return (
    <div className="flex items-center gap-2">
      <span className="annot w-9 shrink-0">set {index + 1}</span>
      <div className="relative flex h-[52px] min-w-0 flex-1 items-center gap-1 bg-[var(--paper)] px-2 [--field-stroke:var(--ink)] focus-within:[--field-stroke:var(--accent)]">
        <SketchBorder filter="rough2" radius={4} strokeWidth={2} stroke="var(--field-stroke)" />
        {bodyweightMove && (
          <button
            onClick={() => {
              setTouched(true);
              setW((v) => (v.startsWith('-') ? v.slice(1) : `-${v || '0'}`));
            }}
            className="hand relative px-1 text-[18px] text-[var(--ink-muted)]"
            aria-label="toggle assist"
          >
            ±
          </button>
        )}
        <input
          aria-label="weight"
          inputMode="decimal"
          value={w}
          placeholder="kg"
          onChange={(e) => {
            setTouched(true);
            setW(e.target.value.replace(',', '.'));
          }}
          className="tnum relative w-full bg-transparent text-[20px] font-semibold outline-none"
        />
      </div>
      <div className="relative flex h-[52px] w-[70px] shrink-0 items-center bg-[var(--paper)] px-2 [--field-stroke:var(--ink)] focus-within:[--field-stroke:var(--accent)]">
        <SketchBorder filter="rough2" radius={4} strokeWidth={2} stroke="var(--field-stroke)" />
        <input
          aria-label="reps"
          inputMode="numeric"
          value={r}
          placeholder={String(placeholderReps)}
          onChange={(e) => setR(e.target.value.replace(/\D/g, ''))}
          className="tnum relative w-full bg-transparent text-[20px] font-semibold outline-none placeholder:text-[var(--ink-faint)]"
        />
      </div>
      <Button
        className="shrink-0 px-3 text-[15px]"
        disabled={!ok}
        onClick={() => {
          if (!ok) return;
          onConfirm(weight, Math.round(reps));
          setEditing(false);
        }}
      >
        {set ? 'Save' : 'Confirm'}
      </Button>
    </div>
  );
}

// ── One exercise ──────────────────────────────────────────────────────────

function ExerciseBlock({
  profile,
  session,
  r,
  deload,
  hist,
  onLogged,
}: {
  profile: Profile;
  session: DuoSession;
  r: ResolvedSlot;
  deload: boolean;
  hist: HistEntry[];
  onLogged: (name: string, rest: number) => void;
}) {
  const [opts, setOpts] = useState(false);
  const ex = session.exercises.find((e) => e.slotId === r.slotId);
  const sets = ex?.sets ?? [];
  const planned = deload ? Math.ceil(r.sets / 2) : r.sets;
  const last = lastTime(hist, r.name);
  const target = targetFor(last, r);
  const anyDone = sets.some(Boolean);
  const lastLoaded = [...sets].reverse().find(Boolean);
  const prefill = lastLoaded ? String(lastLoaded.weight) : target.weight !== null ? String(target.weight) : '';
  const range = `${r.repLow}–${r.repHigh}${r.perLeg ? ' per leg' : ''}`;

  return (
    <SketchCard className="px-4 pt-4 pb-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="hand block text-[26px] leading-tight">{r.name}</span>
          <p className="caption">
            {planned} × {range} · rest {r.rest}s · ×{r.mult}
          </p>
        </div>
        <button onClick={() => setOpts((v) => !v)} className="hand shrink-0 px-1 py-1 text-[16px] text-[var(--ink-muted)]">
          {opts ? 'done' : 'edit'}
        </button>
      </div>
      {r.cue && <p className="caption mt-1 text-[var(--accent)]">{r.cue}</p>}

      {opts && (
        <div className="mt-3 flex flex-col gap-3 bg-[var(--sunk)] px-3 py-3">
          <div>
            <span className="annot">swap</span>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {[r.baseName, ...r.alts.map((a) => a.name)].map((n) => (
                <Chip
                  key={n}
                  on={n === r.name}
                  onClick={() => {
                    if (anyDone) return;
                    void updatePrefs(profile, (p) => {
                      const swaps = { ...p.swaps };
                      if (n === r.baseName) delete swaps[r.slotId];
                      else swaps[r.slotId] = n;
                      return { ...p, swaps };
                    });
                  }}
                >
                  {n}
                </Chip>
              ))}
            </div>
            {anyDone && <p className="caption mt-1">Swap before the first set; this one is already underway.</p>}
          </div>
          <div className="flex items-center justify-between">
            <span className="annot">rest</span>
            <div className="flex items-center gap-3">
              <button className="hand px-2 text-[22px]" onClick={() => void updatePrefs(profile, (p) => ({ ...p, rests: { ...p.rests, [r.slotId]: Math.max(15, r.rest - 15) } }))}>−</button>
              <span className="tnum text-[17px] font-semibold">{r.rest}s</span>
              <button className="hand px-2 text-[22px]" onClick={() => void updatePrefs(profile, (p) => ({ ...p, rests: { ...p.rests, [r.slotId]: r.rest + 15 } }))}>+</button>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="annot">progression step</span>
            <div className="flex items-center gap-3">
              <button className="hand px-2 text-[22px]" onClick={() => void updatePrefs(profile, (p) => ({ ...p, steps: { ...p.steps, [r.slotId]: Math.max(0.5, r.step - 0.5) } }))}>−</button>
              <span className="tnum text-[17px] font-semibold">+{r.step} kg</span>
              <button className="hand px-2 text-[22px]" onClick={() => void updatePrefs(profile, (p) => ({ ...p, steps: { ...p.steps, [r.slotId]: r.step + 0.5 } }))}>+</button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-2 bg-[var(--sunk)] px-3 py-2">
        <span className="annot">last time</span>
        <p className="tnum mt-0.5 text-[16px] font-semibold leading-snug">
          {last ? last.sets.map((s) => `${s.weight}×${s.reps}`).join('  ·  ') : 'first time'}
        </p>
        <span className="annot mt-1 block">today's target</span>
        <p className="tnum text-[16px] font-semibold">{target.label}</p>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {Array.from({ length: planned }, (_, i) => (
          <SetRow
            key={`${r.name}-${i}`}
            index={i}
            set={sets[i] ?? null}
            prefill={prefill}
            placeholderReps={last?.sets[i]?.reps ?? last?.sets[last.sets.length - 1]?.reps ?? r.repHigh}
            bodyweightMove={r.bodyweight}
            pr={isPr(hist, r.name, sets, i, r.bodyweight, session.bodyweight)}
            onConfirm={(weight, reps) => {
              void confirmDuoSet(session.key, r.slotId, r.name, i, { weight, reps });
              onLogged(r.name, r.rest);
            }}
          />
        ))}
      </div>
    </SketchCard>
  );
}

// ── Session ───────────────────────────────────────────────────────────────

function Clock({ startedAt, running, endedAt }: { startedAt: number; running: boolean; endedAt?: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [running]);
  const secs = Math.max(0, Math.floor(((endedAt ?? Date.now()) - startedAt) / 1000));
  const m = Math.floor(secs / 60);
  const warn = m >= SESSION_WARN_MIN;
  return (
    <span className="tnum text-[15px] font-semibold" style={{ color: warn ? 'var(--p-ghaith)' : 'var(--ink-muted)' }}>
      {String(m).padStart(2, '0')}:{String(secs % 60).padStart(2, '0')} / {SESSION_TARGET_MIN}:00
    </span>
  );
}

/**
 * Train together: flip between the two profiles without leaving the session.
 * The other person's session for the same day is opened (or started), so
 * each keeps their own weights, targets, last-time and score.
 */
function WhoToggle({
  active,
  onPick,
}: {
  active: Profile;
  onPick: (p: Profile) => void;
}) {
  return (
    <div className="flex items-center gap-2" role="group" aria-label="logging for">
      <span className="annot">logging for</span>
      {PROFILES.map((p) => (
        <button
          key={p}
          onClick={() => p !== active && onPick(p)}
          aria-pressed={p === active}
          className="relative px-3.5 py-2 text-[15px] font-semibold"
          style={
            p === active
              ? { background: COLOR[p], color: 'var(--btn-text)', borderRadius: 999 }
              : { color: 'var(--ink)' }
          }
        >
          {p !== active && <SketchBorder radius={999} strokeWidth={1.8} stroke={COLOR[p]} />}
          <span className="relative">{PROFILE_NAME[p]}</span>
        </button>
      ))}
    </div>
  );
}

function SessionView({
  session,
  profile,
  sessions,
  legacy,
  prefs,
  deloadWeeks,
  onBack,
  onLogged,
  onSwitch,
  today,
}: {
  session: DuoSession;
  profile: Profile;
  sessions: DuoSession[];
  legacy: Parameters<typeof buildHistory>[2];
  prefs: DuoPrefs;
  deloadWeeks: string[];
  onBack: () => void;
  onLogged: (name: string, rest: number) => void;
  onSwitch: (p: Profile, key: string) => void;
  today: string;
}) {
  const deload = deloadWeeks.includes(session.weekStart);
  async function switchTo(p: Profile) {
    const other = await startDuoSession(p, session.weekStart, session.day, today, deload);
    onSwitch(p, other.key);
  }
  const hist = useMemo(
    () => buildHistory(profile, sessions, legacy, session.key, session.bodyweight),
    [profile, sessions, legacy, session.key, session.bodyweight],
  );
  const [note, setNote] = useState(session.note ?? '');
  const day = DUO_PROGRAM[session.day];
  const stats = sessionStats(session, deload);
  const finished = session.status === 'complete';

  if (finished) {
    const mine = sessions.filter((s) => s.profile === profile && s.weekStart === session.weekStart);
    const without = mine.filter((s) => s.key !== session.key);
    const pts = weekScore(mine, deload).points - weekScore(without, deload).points;
    const prs = sessionPrCount(session, hist);
    return (
      <div className="flex flex-col gap-4">
        <WhoToggle active={profile} onPick={(p) => void switchTo(p)} />
        <SketchCard className="px-5 pt-4 pb-5">
          <span className="hand text-[28px]">{day.title}: done</span>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Stat label="sets" value={`${stats.done}/${stats.planned}`} />
            <Stat label="volume kg" value={fmt(stats.volume)} />
            <Stat label="points" value={`+${pts}`} />
            <Stat label="PRs" value={String(prs)} />
          </div>
          <p className="mt-3 text-[16px]">
            You moved <span className="tnum font-semibold">{fmt(stats.relVolume)}×</span> your bodyweight.
          </p>
          {session.note && <p className="caption mt-2">“{session.note}”</p>}
        </SketchCard>
        <Button onClick={onBack}>Back to the week</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <button onClick={onBack} className="hand text-[18px] text-[var(--ink-muted)] underline">
          ← week
        </button>
        <Clock startedAt={session.startedAt} running endedAt={undefined} />
      </div>
      <WhoToggle active={profile} onPick={(p) => void switchTo(p)} />
      <div>
        <span className="hand text-[30px] leading-none">{day.title}</span>
        <p className="caption">
          {DAY_LABEL[session.day]} session of the week of {formatDayLabel(session.weekStart)}
          {deload ? ' · deload week' : ''}
        </p>
      </div>

      {day.slots.map((s) => (
        <ExerciseBlock
          key={s.id}
          profile={profile}
          session={session}
          r={resolveSlot(s, prefs, profile)}
          deload={deload}
          hist={hist}
          onLogged={onLogged}
        />
      ))}

      <div className="flex flex-col gap-2">
        <label htmlFor="duo-note" className="hand text-[20px]">
          note
        </label>
        <div className="relative flex min-h-[56px] items-center bg-[var(--paper)] px-4 [--field-stroke:var(--ink)] focus-within:[--field-stroke:var(--accent)]">
          <SketchBorder filter="rough2" radius={4} strokeWidth={2.2} stroke="var(--field-stroke)" />
          <input
            id="duo-note"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              void setDuoNote(session.key, e.target.value);
            }}
            placeholder="Optional"
            className="relative w-full bg-transparent text-base outline-none placeholder:text-[var(--ink-faint)]"
          />
        </div>
      </div>

      <Button onClick={() => void finishDuoSession(session.key)}>
        {stats.complete ? 'Finish' : 'Finish now'}
      </Button>
      {!stats.complete && (
        <p className="caption text-center">Sets you haven't confirmed simply don't score.</p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="tnum text-[28px] leading-none font-semibold">{value}</p>
      <span className="annot">{label}</span>
    </div>
  );
}

// ── Train home ────────────────────────────────────────────────────────────

function TrainHome({
  profile,
  today,
  sessions,
  deloadWeeks,
  onOpen,
}: {
  profile: Profile;
  today: string;
  sessions: DuoSession[];
  deloadWeeks: string[];
  onOpen: (key: string) => void;
}) {
  const weekStart = weekStartFor(today);
  const deload = deloadWeeks.includes(weekStart);
  const todayKey = dayKeyFor(today);
  const weight = useLiveQuery(() => bodyweightOn(profile, today), [profile, today, sessions.length]);
  const [bw, setBw] = useState('');
  const mine = sessions.filter((s) => s.profile === profile && s.weekStart === weekStart);
  const find = (d: DayKey) => mine.find((s) => s.day === d);
  const wk = weekScore(mine, deload);

  async function start(day: DayKey) {
    const s = await startDuoSession(profile, weekStart, day, today, deload);
    onOpen(s.key);
  }

  const row = (d: DayKey) => {
    const s = find(d);
    const st = s ? sessionStats(s, deload) : null;
    const planned = dayPlannedSets(d, deload);
    const label = !s ? 'Start' : s.status === 'in_progress' ? 'Resume' : 'View';
    return (
      <div key={d} className="flex items-center justify-between gap-3 py-2">
        <div className="min-w-0">
          <span className="hand text-[22px] leading-none">
            {DAY_LABEL[d]}: {DUO_PROGRAM[d].title}
          </span>
          <p className="tnum caption">
            {st ? `${st.done}/${st.planned} sets${st.complete ? ' · complete' : ''}` : `${planned} sets`}
            {s && dayKeyFor(s.date) !== d ? ` · done ${formatDayLabel(s.date)}` : ''}
          </p>
        </div>
        <Button
          variant={d === todayKey && !s ? 'primary' : 'secondary'}
          className="shrink-0 px-4 text-[14px]"
          onClick={() => (s ? onOpen(s.key) : void start(d))}
        >
          {label}
        </Button>
      </div>
    );
  };

  const nextUp = todayKey && !find(todayKey)?.status ? todayKey : DAY_KEYS.find((d) => !find(d));

  return (
    <div className="flex flex-col gap-4">
      <SketchCard className="px-5 pt-4 pb-5">
        <span className="annot">{todayKey ? 'today' : 'rest day'}</span>
        {todayKey ? (
          <>
            <p className="hand text-[32px] leading-tight">{DUO_PROGRAM[todayKey].title}</p>
            <Button className="mt-3 w-full" onClick={() => (find(todayKey) ? onOpen(find(todayKey)!.key) : void start(todayKey))}>
              {find(todayKey) ? (find(todayKey)!.status === 'complete' ? 'View today' : 'Resume') : 'Start'}
            </Button>
          </>
        ) : (
          <>
            <p className="hand text-[30px] leading-tight">Rest, or make one up</p>
            <p className="caption mt-1">
              Any of the week's sessions can be done any day and still counts.
              {nextUp ? ` Next up: ${DUO_PROGRAM[nextUp].title}.` : ' Every session this week is started.'}
            </p>
          </>
        )}
      </SketchCard>

      <SketchCard className="px-5 pt-4 pb-3">
        <div className="flex items-baseline justify-between">
          <span className="hand text-[24px]">this week</span>
          <span className="tnum caption font-semibold">
            {wk.sets}/{wk.planned} sets · {wk.points} pts
          </span>
        </div>
        <DashedRule className="mt-2" />
        {DAY_KEYS.map(row)}
        <DashedRule className="mt-1 pt-2" />
        <div className="flex items-center justify-between py-1">
          <span className="text-[15px] font-medium">Deload this week</span>
          <button
            role="switch"
            aria-checked={deload}
            onClick={() => void toggleDeload(weekStart)}
            className="relative px-4 py-2 text-[14px] font-semibold"
            style={deload ? { background: 'var(--btn-fill)', color: 'var(--btn-text)', borderRadius: 999 } : { color: 'var(--ink)' }}
          >
            {!deload && <SketchBorder radius={999} strokeWidth={1.8} stroke="var(--rule)" />}
            <span className="relative">{deload ? 'on' : 'off'}</span>
          </button>
        </div>
        <p className="caption">Half the sets, rounded up, for both of you. Scoring uses the reduced plan.</p>
      </SketchCard>

      <SketchCard filter="rough2" className="px-5 pt-4 pb-4">
        <div className="flex items-baseline justify-between">
          <span className="hand text-[24px]">bodyweight</span>
          <span className="tnum text-[20px] font-semibold">{weight !== undefined ? `${weight} kg` : '…'}</span>
        </div>
        <div className="mt-2 grid grid-cols-[1fr_auto] items-end gap-3">
          <NumberField label="log today" unit="kg" value={bw} onChange={setBw} />
          <Button
            disabled={!parseNum(bw)}
            onClick={() => {
              const kg = parseNum(bw);
              if (kg && kg > 20 && kg < 300) void logBodyweight(profile, today, kg).then(() => setBw(''));
            }}
          >
            Log
          </Button>
        </div>
      </SketchCard>
    </div>
  );
}

// ── Challenge ─────────────────────────────────────────────────────────────

function Challenge({
  today,
  sessions,
  deloadWeeks,
  seasonStart,
}: {
  today: string;
  sessions: DuoSession[];
  deloadWeeks: string[];
  seasonStart: string;
}) {
  const season = useMemo(
    () => buildSeason(sessions, seasonStart, today, deloadWeeks),
    [sessions, seasonStart, today, deloadWeeks],
  );
  const [confirmNew, setConfirmNew] = useState(false);
  const cur = season.weeks[season.weeks.length - 1];
  const weekLabels = season.weeks.map((w) => formatDayLabel(w.weekStart));
  const onlyMine = PROFILES.some((p) => !sessions.some((s) => s.profile === p));

  if (!season.started) {
    return (
      <SketchCard className="px-5 py-5">
        <span className="hand text-[28px]">season 1 starts {formatDayLabel(season.startsOn)}</span>
        <p className="caption mt-1">Anything logged before then counts as practice. Nothing is scored yet.</p>
      </SketchCard>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <SketchCard className="px-5 pt-4 pb-5">
        <span className="annot">season since {formatDayLabel(season.startsOn)}</span>
        <p className="tnum hand mt-1 text-[40px] leading-none">
          {PROFILE_NAME.ghaith} {season.wins.ghaith} – {season.wins.gaby} {PROFILE_NAME.gaby}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {PROFILES.map((p) => (
            <div key={p}>
              <p className="hand text-[24px]" style={{ color: COLOR[p] }}>
                {season.leader === p ? '👑 ' : ''}
                {PROFILE_NAME[p]}
              </p>
              <p className="tnum text-[26px] leading-none font-semibold">{cur?.scores[p].points ?? 0}</p>
              <span className="annot">pts this week</span>
              <p className="tnum caption mt-1">
                perfect-week streak {season.streak[p].current} · best {season.streak[p].best}
              </p>
            </div>
          ))}
        </div>
        {onlyMine && (
          <p className="caption mt-3">Only this phone's logs are here until sync is switched on.</p>
        )}
      </SketchCard>

      <SketchCard className="px-4 pt-4 pb-3">
        <span className="hand text-[24px]">the race</span>
        <p className="caption">Cumulative season points.</p>
        <div className="mt-2">
          <LineChart
            labels={weekLabels}
            series={PROFILES.map((p) => ({ color: COLOR[p], pts: season.cumulative[p] }))}
          />
        </div>
      </SketchCard>

      <SketchCard className="px-4 pt-4 pb-3">
        <span className="hand text-[24px]">weekly completion</span>
        <p className="caption">Sets done ÷ planned.</p>
        <div className="mt-2 flex flex-col gap-2">
          {season.weeks.slice(-8).map((w) => (
            <div key={w.weekStart}>
              <span className="annot">{formatDayLabel(w.weekStart)}</span>
              {PROFILES.map((p) => (
                <div key={p} className="mt-1 flex items-center gap-2">
                  <div className="relative h-3.5 flex-1 bg-[var(--sunk)]">
                    <div
                      className="h-full"
                      style={{ width: `${Math.min(100, w.scores[p].completionPct)}%`, background: COLOR[p] }}
                    />
                  </div>
                  <span className="tnum w-10 text-right text-[13px] font-semibold">{w.scores[p].completionPct}%</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </SketchCard>

      <SketchCard className="px-4 pt-4 pb-3">
        <span className="hand text-[24px]">relative volume</span>
        <p className="caption">Weekly volume ÷ bodyweight.</p>
        <div className="mt-2">
          <LineChart
            labels={weekLabels}
            series={PROFILES.map((p) => ({ color: COLOR[p], pts: season.weeks.map((w) => w.scores[p].relVolume) }))}
          />
        </div>
        <div className="mt-2 flex gap-4">
          {PROFILES.map((p) => (
            <span key={p} className="caption flex items-center gap-1.5">
              <span className="block h-2.5 w-2.5 rounded-full" style={{ background: COLOR[p] }} />
              {PROFILE_NAME[p]}
            </span>
          ))}
        </div>
      </SketchCard>

      <div>
        {!confirmNew ? (
          <button onClick={() => setConfirmNew(true)} className="hand text-[17px] text-[var(--ink-muted)] underline">
            new season
          </button>
        ) : (
          <SketchCard filter="rough2" className="px-4 py-3">
            <p className="text-[14px] leading-snug">
              Reset the scoreboard from {formatDayLabel(nextSeasonStart(today))}. Every session and log is kept.
            </p>
            <div className="mt-2 flex gap-2">
              <Button variant="secondary" className="flex-1 text-[14px]" onClick={() => setConfirmNew(false)}>
                Cancel
              </Button>
              <Button
                className="flex-1 text-[14px]"
                onClick={() => {
                  void setSeasonStart(nextSeasonStart(today));
                  setConfirmNew(false);
                }}
              >
                Start new season
              </Button>
            </div>
          </SketchCard>
        )}
      </div>
    </div>
  );
}

// ── Progress ──────────────────────────────────────────────────────────────

function ProgressView({
  profile,
  today,
  sessions,
  legacy,
}: {
  profile: Profile;
  today: string;
  sessions: DuoSession[];
  legacy: Parameters<typeof buildHistory>[2];
}) {
  const weights = useLiveQuery(() => weightSeries(profile), [profile, sessions.length, today]) ?? [];
  const bw = weights.length ? weights[weights.length - 1]!.kg : 0;
  const hist = useMemo(() => buildHistory(profile, sessions, legacy, undefined, bw), [profile, sessions, legacy, bw]);
  const names = useMemo(() => [...new Set(hist.map((h) => h.name))].sort(), [hist]);
  const [pick, setPick] = useState<string | null>(null);
  const name = pick && names.includes(pick) ? pick : names[0] ?? null;
  const pts = hist
    .filter((h) => h.name === name)
    .map((h) => ({ date: h.date, v: Math.max(...h.sets.map((s) => epley(s.load, s.reps))) }));

  return (
    <div className="flex flex-col gap-4">
      <SketchCard className="px-4 pt-4 pb-3">
        <span className="hand text-[24px]">best e1RM per session</span>
        {names.length === 0 ? (
          <p className="caption mt-1">Log a session and each lift gets a line here.</p>
        ) : (
          <>
            <div className="mt-2 flex flex-wrap gap-2">
              {names.map((n) => (
                <Chip key={n} on={n === name} onClick={() => setPick(n)}>
                  {n}
                </Chip>
              ))}
            </div>
            <div className="mt-3">
              <LineChart
                labels={pts.map((p) => formatDayLabel(p.date))}
                series={[{ color: 'var(--accent)', pts: pts.map((p) => p.v) }]}
              />
            </div>
            {name && <p className="tnum caption mt-1">best ever {fmt(bestE1rm(hist, name))} kg (Epley)</p>}
          </>
        )}
      </SketchCard>

      <SketchCard className="px-4 pt-4 pb-3">
        <span className="hand text-[24px]">bodyweight</span>
        <div className="mt-2">
          <LineChart
            labels={weights.map((w) => formatDayLabel(w.date))}
            series={[{ color: 'var(--accent)', pts: weights.map((w) => w.kg) }]}
          />
        </div>
      </SketchCard>
    </div>
  );
}

// ── The screen ────────────────────────────────────────────────────────────

export function DuoScreen({ today, profile: devProfile }: { today: string; profile: Profile }) {
  // Who is being logged right now. Starts as this phone's profile, and the
  // in-session toggle can move it so both can be logged from one phone.
  const [profile, setProfile] = useState<Profile>(devProfile);
  useEffect(() => setProfile(devProfile), [devProfile]);
  const [view, setView] = useState<View>('train');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const restTimer = useRestTimer();

  const sessions = useLiveQuery(() => db.duoSessions.toArray(), [], [] as DuoSession[]);
  const legacy = useLiveQuery(() => db.workouts.toArray(), [], []);
  const prefs = useLiveQuery(() => getPrefs(profile), [profile], EMPTY_PREFS);
  const deloadWeeks = useLiveQuery(getDeloadWeeks, [], [] as string[]);
  const seasonStart = useLiveQuery(getSeasonStart, [], '2026-10-19');

  const open = openKey ? sessions.find((s) => s.key === openKey) : undefined;

  const scope = { ['--p-ghaith']: 'var(--accent)', ['--p-gaby']: 'var(--success)' } as CSSProperties;
  const mine = { ['--accent']: `var(--p-${profile})` } as CSSProperties;

  return (
    <div style={scope}>
      <div style={mine} className={`flex flex-col gap-5 ${restTimer.timer ? 'pb-28' : 'pb-4'}`}>
        <header className="flex items-baseline justify-between gap-3">
          <h1 className="hand text-[40px]" style={{ color: 'var(--accent)' }}>
            {PROFILE_NAME[profile]}
          </h1>
          <span className="annot shrink-0">train · {formatDayLabel(weekStartFor(today))}</span>
        </header>

        {!open && (
          <div className="flex gap-2">
            {(['train', 'challenge', 'progress'] as View[]).map((v) => (
              <Chip key={v} on={view === v} onClick={() => setView(v)}>
                {v}
              </Chip>
            ))}
          </div>
        )}

        {open ? (
          <SessionView
            session={open}
            profile={profile}
            sessions={sessions}
            legacy={legacy}
            prefs={prefs}
            deloadWeeks={deloadWeeks}
            onBack={() => setOpenKey(null)}
            onLogged={(n, rest) => restTimer.start(n, rest)}
            today={today}
            onSwitch={(p, key) => {
              setProfile(p);
              setOpenKey(key);
            }}
          />
        ) : view === 'train' ? (
          <TrainHome profile={profile} today={today} sessions={sessions} deloadWeeks={deloadWeeks} onOpen={setOpenKey} />
        ) : view === 'challenge' ? (
          <Challenge today={today} sessions={sessions} deloadWeeks={deloadWeeks} seasonStart={seasonStart} />
        ) : (
          <ProgressView profile={profile} today={today} sessions={sessions} legacy={legacy} />
        )}

        <RestBar restTimer={restTimer} />
      </div>
    </div>
  );
}
