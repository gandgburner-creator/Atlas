import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '../components/Button';
import { TabHeader } from '../components/Chrome';
import { SessionTimer } from '../components/SessionTimer';
import { SketchBorder, SketchCard } from '../components/Sketch';
import { getCraftGoalMin } from '../db/config';
import { db, type CraftItem } from '../db/schema';
import { formatHours } from '../domain/today';
import { fromISODate } from '../domain/time';

const CRAFT_TAGS = ['scripting', 'filming', 'editing', 'publishing'];
const STAGES: CraftItem['status'][] = ['idea', 'scripted', 'filmed', 'edited', 'published'];

export function CraftScreen({ today }: { today: string }) {
  const [newTitle, setNewTitle] = useState('');

  const data = useLiveQuery(async () => {
    const t0 = fromISODate(today).getTime();
    const sessions = await db.focusSessions
      .where('start')
      .between(t0, t0 + 86_400_000)
      .toArray();
    const items = await db.craftItems.toArray();
    const goal = await getCraftGoalMin();
    return {
      sessions: sessions.filter((s) => s.area === 'craft'),
      items: items.sort((a, b) => b.updatedAt - a.updatedAt),
      goal,
    };
  }, [today]);

  const done = data?.sessions.filter((s) => s.completed) ?? [];
  const minutes = done.reduce((sum, s) => sum + (s.end - s.start) / 60000, 0);

  async function addItem() {
    if (!newTitle.trim()) return;
    const now = Date.now();
    await db.craftItems.add({
      title: newTitle.trim(),
      status: 'idea',
      createdAt: now,
      updatedAt: now,
    });
    setNewTitle('');
  }

  async function advance(item: CraftItem, dir: 1 | -1) {
    const i = STAGES.indexOf(item.status) + dir;
    if (i < 0 || i >= STAGES.length) return;
    await db.craftItems.update(item.id as number, {
      status: STAGES[i],
      updatedAt: Date.now(),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <TabHeader title="Craft" annot="hours · pipeline" />

      <SessionTimer area="craft" color="#4F7A34" tags={CRAFT_TAGS} />

      <SketchCard filter="rough2" className="px-4 pt-3 pb-4">
        <span className="hand text-[21px] text-[var(--ink-muted)]">today</span>
        <p className="tnum text-[34px] font-semibold leading-tight tracking-[-0.02em]">
          {formatHours(Math.round(minutes))}
        </p>
        <span className="tnum caption">
          of {formatHours(data?.goal ?? 60)} · {done.length}{' '}
          {done.length === 1 ? 'session' : 'sessions'}
        </span>
      </SketchCard>

      {/* Pipeline: Idea › Scripted › Filmed › Edited › Published */}
      <SketchCard className="px-5 pt-4 pb-5">
        <span className="hand text-[26px]">pipeline</span>
        <p className="annot mt-1">idea › scripted › filmed › edited › published</p>

        <div className="mt-3 flex flex-col gap-4">
          {(data?.items ?? []).map((item) => (
            <div key={item.id} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex-1 text-[16px] font-medium leading-snug">
                  {item.title}
                </span>
                <span className="hand shrink-0 text-[19px] text-[var(--ink-muted)]">
                  {item.status}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {/* Five dots, filled up to the current stage. */}
                <svg width="120" height="14" viewBox="0 0 120 14" aria-hidden="true" filter="url(#roughSoft)">
                  {STAGES.map((s, i) => {
                    const reached = STAGES.indexOf(item.status) >= i;
                    return (
                      <g key={s}>
                        {i > 0 && (
                          <line
                            x1={i * 26 - 16} y1="7" x2={i * 26 - 4} y2="7"
                            stroke="var(--rule)" strokeWidth="1.6"
                          />
                        )}
                        <circle
                          cx={i * 26 + 7} cy="7" r="5"
                          fill={reached ? '#4F7A34' : 'none'}
                          stroke={reached ? '#4F7A34' : 'var(--rule)'}
                          strokeWidth="2"
                        />
                      </g>
                    );
                  })}
                </svg>
                <div className="ml-auto flex gap-1">
                  <button
                    onClick={() => advance(item, -1)}
                    disabled={item.status === 'idea'}
                    className="hand px-2 py-1 text-[19px] text-[var(--ink-muted)] disabled:opacity-30"
                  >
                    back
                  </button>
                  <button
                    onClick={() => advance(item, 1)}
                    disabled={item.status === 'published'}
                    className="hand px-2 py-1 text-[19px] text-[var(--accent)] disabled:opacity-30"
                  >
                    advance
                  </button>
                </div>
              </div>
            </div>
          ))}

          {(data?.items ?? []).length === 0 && (
            <p className="caption">Nothing in flight. Ideas go in below.</p>
          )}
        </div>

        <div className="mt-4 flex items-center gap-2">
          <div className="relative flex h-[52px] flex-1 items-center bg-[var(--paper)] px-4 [--field-stroke:var(--ink)] focus-within:[--field-stroke:var(--accent)]">
            <SketchBorder filter="rough2" radius={4} strokeWidth={2} stroke="var(--field-stroke)" />
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="new idea"
              className="relative w-full bg-transparent text-[16px] font-medium outline-none placeholder:text-[var(--ink-faint)]"
            />
          </div>
          <Button variant="secondary" onClick={addItem} disabled={!newTitle.trim()}>
            Add
          </Button>
        </div>
      </SketchCard>
    </div>
  );
}
