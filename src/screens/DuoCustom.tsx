import { useMemo, useState, type ReactNode } from 'react';
import { Button } from '../components/Button';
import { DashedRule, SketchBorder, SketchCard } from '../components/Sketch';
import { saveTemplate, startCustomSession } from '../db/duo';
import type { DuoCustomSlot } from '../db/schema';
import {
  analyze,
  EQUIPMENT,
  GROUPS,
  LIBRARY,
  LIB_BY_ID,
  type Equip,
  type Group,
} from '../domain/exerciseLibrary';
import { weekStartFor, type Profile } from '../domain/duo';

const fmt = (n: number) => String(Math.round(n * 10) / 10);

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className="relative px-3 py-2 text-[14px] font-semibold"
      style={on ? { background: 'var(--btn-fill)', color: 'var(--btn-text)', borderRadius: 999 } : { color: 'var(--ink)' }}
    >
      {!on && <SketchBorder radius={999} strokeWidth={1.8} stroke="var(--rule)" />}
      <span className="relative">{children}</span>
    </button>
  );
}

/**
 * What a workout covers: muscles (solid = primary sets, faded = the half-credit
 * for supporting work) and the angles of attack, plus what is still missing
 * for each body part in it. Descriptive only: a gap is a prompt, not a fault.
 */
export function HitChart({ plan }: { plan: DuoCustomSlot[] }) {
  const cov = useMemo(
    () => analyze(plan.map((p) => ({ libId: p.libId ?? '', sets: p.sets }))),
    [plan],
  );
  if (cov.muscles.length === 0) {
    return (
      <SketchCard filter="rough2" className="px-4 py-4">
        <span className="hand text-[24px]">what this hits</span>
        <p className="caption mt-1">Add exercises and the muscles and angles they cover show up here.</p>
      </SketchCard>
    );
  }
  const scale = Math.max(4, ...cov.muscles.map((m) => m.effective));
  const angleScale = Math.max(4, ...cov.angles.map((a) => a.sets));
  let lastGroup = '';
  return (
    <SketchCard className="px-4 pt-4 pb-4">
      <span className="hand text-[26px]">what this hits</span>
      <p className="caption">
        Solid is the main work; faded is what supporting muscles pick up (half credit).
      </p>

      <div className="mt-3 flex flex-col gap-1.5">
        {cov.muscles.map((m) => {
          const head = m.group !== lastGroup;
          lastGroup = m.group;
          return (
            <div key={m.muscle}>
              {head && <span className="annot mt-2 block">{m.group}</span>}
              <div className="flex items-center gap-2">
                <span className="w-[92px] shrink-0 text-[13px] font-medium">{m.muscle}</span>
                <div className="relative flex h-3.5 flex-1 bg-[var(--sunk)]">
                  <div style={{ width: `${Math.min(100, (m.primary / scale) * 100)}%`, background: 'var(--accent)' }} />
                  <div
                    style={{
                      width: `${Math.min(100 - (m.primary / scale) * 100, ((m.secondary * 0.5) / scale) * 100)}%`,
                      background: 'var(--accent)',
                      opacity: 0.35,
                    }}
                  />
                </div>
                <span className="tnum w-9 shrink-0 text-right text-[13px] font-semibold">{fmt(m.effective)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <DashedRule className="mt-3 pt-3" />
      <span className="annot">angles</span>
      <div className="mt-1.5 flex flex-col gap-1.5">
        {cov.angles.map((a) => (
          <div key={a.angle} className="flex items-center gap-2">
            <span className="w-[126px] shrink-0 text-[13px] font-medium">{a.angle}</span>
            <div className="relative h-3.5 flex-1 bg-[var(--sunk)]">
              <div className="h-full" style={{ width: `${Math.min(100, (a.sets / angleScale) * 100)}%`, background: 'var(--success)' }} />
            </div>
            <span className="tnum w-9 shrink-0 text-right text-[13px] font-semibold">{a.sets}</span>
          </div>
        ))}
      </div>

      {cov.gaps.some((g) => g.muscles.length || g.angles.length) && (
        <>
          <DashedRule className="mt-3 pt-3" />
          <span className="annot">not covered yet</span>
          {cov.gaps.map((g) =>
            g.muscles.length || g.angles.length ? (
              <p key={g.group} className="caption mt-1">
                <span className="font-semibold text-[var(--ink)]">{g.group}:</span>{' '}
                {[...g.muscles, ...g.angles].join(', ')}
              </p>
            ) : null,
          )}
        </>
      )}
    </SketchCard>
  );
}

/**
 * Pick body parts, browse everything for them, search, filter by equipment,
 * and add. Shared by the custom workout builder and the in-session "add an
 * exercise", so both list the same library the same way.
 */
export function ExerciseBrowser({
  added,
  onAdd,
  initialGroups = [],
}: {
  added: Set<string>;
  onAdd: (libId: string) => void;
  initialGroups?: Group[];
}) {
  const [groups, setGroups] = useState<Group[]>(initialGroups);
  const [equip, setEquip] = useState<Equip | null>(null);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const results = LIBRARY.filter(
    (e) =>
      (groups.length === 0 || groups.includes(e.group)) &&
      (!equip || e.equip === equip) &&
      (!q || e.name.toLowerCase().includes(q)),
  );
  const browsing = groups.length > 0 || q.length > 0;
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {GROUPS.map((g) => (
          <Pill
            key={g}
            on={groups.includes(g)}
            onClick={() => setGroups(groups.includes(g) ? groups.filter((x) => x !== g) : [...groups, g])}
          >
            {g}
          </Pill>
        ))}
      </div>
      <div className="mt-3 relative flex h-[48px] items-center bg-[var(--paper)] px-3 [--field-stroke:var(--ink)] focus-within:[--field-stroke:var(--accent)]">
        <SketchBorder filter="rough2" radius={4} strokeWidth={2} stroke="var(--field-stroke)" />
        <input
          aria-label="search exercises"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search all exercises"
          className="relative w-full bg-transparent text-[16px] font-medium outline-none placeholder:text-[var(--ink-faint)]"
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Pill on={equip === null} onClick={() => setEquip(null)}>
          any equipment
        </Pill>
        {EQUIPMENT.map((e) => (
          <Pill key={e} on={equip === e} onClick={() => setEquip(equip === e ? null : e)}>
            {e}
          </Pill>
        ))}
      </div>

      {browsing ? (
        <div className="mt-3">
          <span className="annot">
            {results.length} {results.length === 1 ? 'exercise' : 'exercises'}: scroll the list
          </span>
          {/* Its own scroll area, so a long list doesn't push everything else
              thousands of pixels down the page. */}
          <div className="mt-1 flex max-h-[58vh] flex-col gap-2 overflow-y-auto overscroll-contain pr-1" aria-label="exercise list">
            {results.map((e) => (
              <SketchCard key={e.id} filter="rough2" className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="hand block text-[22px] leading-tight">{e.name}</span>
                    <p className="caption">
                      {e.equip} · {e.repLow}–{e.repHigh} reps
                    </p>
                    <p className="text-[13px] leading-snug">
                      <span className="font-semibold">{e.primary.join(', ')}</span>
                      {e.secondary.length > 0 && <span className="text-[var(--ink-muted)]"> + {e.secondary.join(', ')}</span>}
                    </p>
                    <p className="annot mt-1">{e.angles.join(' · ')}</p>
                  </div>
                  <Button
                    variant={added.has(e.id) ? 'secondary' : 'primary'}
                    className="shrink-0 px-4 text-[14px]"
                    disabled={added.has(e.id)}
                    onClick={() => onAdd(e.id)}
                  >
                    {added.has(e.id) ? 'Added' : 'Add'}
                  </Button>
                </div>
              </SketchCard>
            ))}
            {results.length === 0 && <p className="caption">Nothing matches. Try another word or clear a filter.</p>}
          </div>
        </div>
      ) : (
        <p className="caption mt-3">Pick a body part above to see every exercise for it, or search by name.</p>
      )}
    </>
  );
}

/**
 * Build a workout from the library: pick body parts, browse everything for
 * them, choose, and watch the chart fill in as you go. Opens as a normal
 * session (same logging, same last-time, same rest timers).
 */
export function CustomBuilder({
  profile,
  today,
  initial,
  onClose,
  onStart,
}: {
  profile: Profile;
  today: string;
  initial?: { name: string; plan: DuoCustomSlot[] };
  onClose: () => void;
  onStart: (key: string) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [plan, setPlan] = useState<DuoCustomSlot[]>(initial?.plan ?? []);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const added = new Set(plan.map((p) => p.libId).filter((x): x is string => !!x));
  const defaultName = plan.length
    ? [...new Set(plan.map((p) => LIB_BY_ID.get(p.libId ?? '')?.group))]
        .filter(Boolean)
        .map((g) => g![0]!.toUpperCase() + g!.slice(1))
        .join(' + ')
    : 'Custom workout';
  const finalName = name.trim() || defaultName;

  function add(id: string) {
    const e = LIB_BY_ID.get(id);
    if (!e || added.has(id)) return;
    const n = plan.reduce((m, p) => Math.max(m, Number(p.id.slice(1)) || 0), 0) + 1;
    setPlan([
      ...plan,
      { id: `c${n}`, name: e.name, sets: 3, repLow: e.repLow, repHigh: e.repHigh, rest: e.rest, mult: e.mult, bodyweight: e.bodyweight, libId: e.id },
    ]);
    setSaved(false);
  }
  const edit = (id: string, f: (p: DuoCustomSlot) => DuoCustomSlot) => {
    setPlan(plan.map((p) => (p.id === id ? f(p) : p)));
    setSaved(false);
  };
  function move(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= plan.length) return;
    const next = [...plan];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setPlan(next);
  }

  async function start() {
    if (!plan.length || busy) return;
    setBusy(true);
    const s = await startCustomSession(profile, weekStartFor(today), today, finalName, plan);
    onStart(s.key);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <button onClick={onClose} className="hand text-[18px] text-[var(--ink-muted)] underline">
          ← back
        </button>
        <span className="annot">custom workout</span>
      </div>

      <SketchCard className="px-4 pt-4 pb-4">
        <span className="hand text-[22px]">what are we training?</span>
        <div className="mt-2">
          <ExerciseBrowser added={added} onAdd={add} />
        </div>
      </SketchCard>

      <SketchCard className="px-4 pt-4 pb-4">
        <span className="hand text-[26px]">your workout</span>
        {plan.length === 0 ? (
          <p className="caption mt-1">Nothing yet. Tap Add on the exercises you want.</p>
        ) : (
          <div className="mt-2 flex flex-col">
            {plan.map((p, i) => (
              <div key={p.id} className="flex items-center gap-2 border-b-[1.5px] border-dashed border-[var(--rule)] py-2 last:border-0">
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{p.name}</span>
                  <span className="tnum caption">
                    {p.sets} × {p.repLow}–{p.repHigh}
                  </span>
                </div>
                <button aria-label="fewer sets" className="hand px-2 text-[22px]" onClick={() => edit(p.id, (x) => ({ ...x, sets: Math.max(1, x.sets - 1) }))}>−</button>
                <span className="tnum w-5 text-center text-[16px] font-semibold">{p.sets}</span>
                <button aria-label="more sets" className="hand px-2 text-[22px]" onClick={() => edit(p.id, (x) => ({ ...x, sets: Math.min(8, x.sets + 1) }))}>+</button>
                <button aria-label="move up" className="hand px-1 text-[18px] text-[var(--ink-muted)]" onClick={() => move(i, -1)}>↑</button>
                <button aria-label="move down" className="hand px-1 text-[18px] text-[var(--ink-muted)]" onClick={() => move(i, 1)}>↓</button>
                <button aria-label={`remove ${p.name}`} className="hand px-1 text-[20px] text-[var(--ink-muted)]" onClick={() => { setPlan(plan.filter((x) => x.id !== p.id)); setSaved(false); }}>×</button>
              </div>
            ))}
          </div>
        )}
      </SketchCard>

      <HitChart plan={plan} />

      <div className="flex flex-col gap-2">
        <label htmlFor="custom-name" className="hand text-[20px]">
          name it
        </label>
        <div className="relative flex h-[52px] items-center bg-[var(--paper)] px-4 [--field-stroke:var(--ink)] focus-within:[--field-stroke:var(--accent)]">
          <SketchBorder filter="rough2" radius={4} strokeWidth={2.2} stroke="var(--field-stroke)" />
          <input
            id="custom-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={defaultName}
            className="relative w-full bg-transparent text-base outline-none placeholder:text-[var(--ink-faint)]"
          />
        </div>
      </div>

      <div className="flex gap-2">
        <Button
          variant="secondary"
          className="flex-1"
          disabled={!plan.length || saved}
          onClick={() => {
            void saveTemplate(profile, { id: Date.now().toString(36), name: finalName, plan });
            setSaved(true);
          }}
        >
          {saved ? 'Saved' : 'Save to reuse'}
        </Button>
        <Button className="flex-1" disabled={!plan.length || busy} onClick={() => void start()}>
          Start workout
        </Button>
      </div>
      <p className="caption text-center">Custom workouts are extra work: they don't change the weekly score.</p>
    </div>
  );
}
