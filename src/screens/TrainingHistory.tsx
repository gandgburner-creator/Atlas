import { useLiveQuery } from 'dexie-react-hooks';
import { PushHeader } from '../components/Chrome';
import { SketchCard } from '../components/Sketch';
import { db } from '../db/schema';
import { formatDayLabel } from '../domain/time';
import { useNav } from '../nav';

/** Every past session, newest first. Tap one to edit its sets or delete it. */
export function TrainingHistory() {
  const nav = useNav();
  const sessions = useLiveQuery(
    () => db.workouts.orderBy('date').reverse().toArray(),
    [],
  );

  return (
    <div className="flex flex-col gap-3">
      <PushHeader title="history" />

      {sessions && sessions.length === 0 && (
        <SketchCard className="px-5 py-6">
          <p className="hand text-[24px] text-[var(--ink-muted)]">nothing logged yet</p>
          <p className="caption mt-1">Finished sessions show up here, newest first.</p>
        </SketchCard>
      )}

      {sessions?.map((w) => {
        const setCount = w.exercises.reduce((n, e) => n + e.sets.length, 0);
        return (
          <button
            key={w.id}
            onClick={() => nav.push({ name: 'training-session', id: w.id as number })}
            className="text-left"
          >
            <SketchCard filter="rough2" className="px-4 py-3">
              <div className="flex items-baseline justify-between">
                <span className="hand text-[24px]">{w.sessionType}</span>
                <span className="tnum caption">{formatDayLabel(w.date)}</span>
              </div>
              <p className="caption mt-0.5">
                {w.exercises.length === 0
                  ? 'no sets logged'
                  : `${w.exercises.length} ${w.exercises.length === 1 ? 'exercise' : 'exercises'} · ${setCount} ${setCount === 1 ? 'set' : 'sets'}`}
              </p>
            </SketchCard>
          </button>
        );
      })}
    </div>
  );
}
