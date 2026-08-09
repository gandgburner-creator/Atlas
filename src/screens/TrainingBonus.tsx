import { useState } from 'react';
import { DashedRule, SketchBorder, SketchCard } from '../components/Sketch';
import type { ExerciseDef } from '../db/config';
import type { GroupSuggestion, LibraryEntry } from '../domain/bonus';

/**
 * The bonus session's menu.
 *
 * Two lists: what was scheduled in the last week and didn't happen, grouped
 * so a coherent session is visible at a glance, and the whole library
 * underneath. Nothing arrives selected. Nothing is required. Neither list
 * shows a number, and the suggestions never appear anywhere else in the app
 * — you see this only because you came looking.
 *
 * A completely empty suggestion list is a normal week, not a blank state to
 * apologise for: the picker below it is the real screen either way.
 */

interface Props {
  suggestions: GroupSuggestion[];
  library: LibraryEntry[];
  /** Names already on the session below. */
  picked: Set<string>;
  onPick: (def: ExerciseDef) => void;
}

export function BonusPicker({ suggestions, library, picked, onPick }: Props) {
  const [browsing, setBrowsing] = useState(false);
  const [query, setQuery] = useState('');

  const available = suggestions
    .map((g) => ({ ...g, exercises: g.exercises.filter((e) => !picked.has(e.name)) }))
    .filter((g) => g.exercises.length > 0);

  const q = query.trim().toLowerCase();
  const matches = library.filter(
    (e) => !picked.has(e.def.name) && (q === '' || e.def.name.toLowerCase().includes(q)),
  );

  return (
    <SketchCard className="px-4 pt-4 pb-4">
      <span className="hand text-[26px]">available if you want it</span>

      {available.length > 0 ? (
        <>
          <p className="caption mt-0.5">
            Scheduled in the last week and not done. Pick anything, or
            nothing.
          </p>
          <div className="mt-3 flex flex-col gap-3">
            {available.map((g) => (
              <div key={g.group}>
                <span className="annot">{g.group}</span>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {g.exercises.map((def) => (
                    <Chip key={def.name} label={def.name} onClick={() => onPick(def)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="caption mt-0.5">
          Nothing from the last week is waiting. Pick whatever you feel like
          doing.
        </p>
      )}

      <DashedRule className="mt-4 pt-3" />

      {browsing ? (
        <>
          <div className="relative flex h-[48px] items-center bg-[var(--paper)] px-4 [--field-stroke:var(--ink)] focus-within:[--field-stroke:var(--accent)]">
            <SketchBorder filter="rough2" radius={4} strokeWidth={2} stroke="var(--field-stroke)" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search exercises"
              autoFocus
              className="relative w-full bg-transparent text-[16px] font-medium outline-none placeholder:text-[var(--ink-faint)]"
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {matches.map((e) => (
              <Chip key={e.def.name} label={e.def.name} onClick={() => onPick(e.def)} />
            ))}
          </div>
          {matches.length === 0 && (
            <p className="caption mt-3">
              Nothing by that name. Add it as a new exercise below.
            </p>
          )}
          <button
            onClick={() => {
              setBrowsing(false);
              setQuery('');
            }}
            className="hand mt-3 text-[17px] text-[var(--ink-muted)]"
          >
            done browsing
          </button>
        </>
      ) : (
        <button
          onClick={() => setBrowsing(true)}
          className="hand w-full py-1 text-left text-[19px] text-[var(--accent)]"
        >
          browse the whole library
        </button>
      )}
    </SketchCard>
  );
}

function Chip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="relative px-3.5 py-2.5 text-[14px] font-semibold text-[var(--ink)]"
    >
      <SketchBorder radius={999} strokeWidth={1.8} stroke="var(--rule)" />
      <span className="relative">{label}</span>
    </button>
  );
}
