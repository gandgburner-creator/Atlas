import { useLiveQuery } from 'dexie-react-hooks';
import { TabHeader } from '../components/Chrome';
import { Icon, type IconName } from '../components/Icon';
import { SketchCard } from '../components/Sketch';
import { db, type LifeLog } from '../db/schema';

/**
 * Life: three tiles, tap to toggle. A day with none of them is a day, not a
 * lapse — the section text on the sheet reads "No streak to break" and this
 * screen holds it to that.
 */

const TILES: { key: keyof Omit<LifeLog, 'date'>; label: string; icon: IconName; sub: string }[] = [
  { key: 'restBlock', label: 'rest block', icon: 'life', sub: 'an hour that belongs to nothing' },
  { key: 'call', label: 'call someone', icon: 'call', sub: 'family, a friend, anyone' },
  { key: 'social', label: 'social', icon: 'body', sub: 'left the house, saw people' },
];

export function LifeScreen({ today }: { today: string }) {
  const log = useLiveQuery(
    async () => (await db.lifeLogs.get(today)) ?? null,
    [today],
  );

  async function toggle(key: keyof Omit<LifeLog, 'date'>) {
    const current = (await db.lifeLogs.get(today)) ?? {
      date: today,
      restBlock: false,
      call: false,
      social: false,
    };
    await db.lifeLogs.put({ ...current, [key]: !current[key] });
  }

  if (log === undefined) return null;

  return (
    <div className="flex flex-col gap-6">
      <TabHeader title="Life" annot="rest · calls · people" />

      <div className="flex flex-col gap-3">
        {TILES.map((t) => {
          const on = Boolean(log?.[t.key]);
          return (
            <button key={t.key} onClick={() => toggle(t.key)} className="text-left">
              <SketchCard
                stroke={on ? 'var(--success)' : 'var(--ink)'}
                strokeWidth={on ? 3 : 2.4}
                className="px-5 py-4"
              >
                <div
                  className="flex items-center gap-4"
                  style={{ color: on ? 'var(--success)' : 'var(--ink)' }}
                >
                  <Icon name={on ? 'check' : t.icon} size={30} strokeWidth={on ? 3 : 2.4} />
                  <div className="flex-1">
                    <p className="hand text-[26px]">{t.label}</p>
                    <p className="caption">{on ? 'done today' : t.sub}</p>
                  </div>
                </div>
              </SketchCard>
            </button>
          );
        })}
      </div>

      <p className="caption px-1">
        Tap to mark, tap to unmark. This section is here when you want it.
      </p>
    </div>
  );
}
