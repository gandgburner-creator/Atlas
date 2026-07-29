import { useLiveQuery } from 'dexie-react-hooks';
import { TabHeader } from '../components/Chrome';
import { SessionTimer } from '../components/SessionTimer';
import { SketchCard } from '../components/Sketch';
import { getFocusGoalMin } from '../db/config';
import { db } from '../db/schema';
import { formatHours } from '../domain/today';
import { fromISODate } from '../domain/time';

const WORK_TAGS = ['deep', 'shipping', 'admin', 'learning'];

export function WorkScreen({ today }: { today: string }) {
  const data = useLiveQuery(async () => {
    const t0 = fromISODate(today).getTime();
    const sessions = await db.focusSessions
      .where('start')
      .between(t0, t0 + 86_400_000)
      .toArray();
    const goal = await getFocusGoalMin();
    return {
      sessions: sessions.filter((s) => (s.area ?? 'work') === 'work'),
      goal,
    };
  }, [today]);

  // completed is only ever set once a session ends, so it implies end/satisfaction are set too.
  const done = data?.sessions.filter((s) => s.completed) ?? [];
  const minutes = done.reduce((sum, s) => sum + (s.end! - s.start) / 60000, 0);
  // The still-running session (if any) shows via SessionTimer above; this
  // list is the finished log for today.
  const ended = data?.sessions.filter((s) => s.end !== undefined) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <TabHeader title="Work" annot="focus hours" />

      <SessionTimer area="work" color="#2B5F8E" tags={WORK_TAGS} />

      <div className="grid grid-cols-2 gap-3.5">
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
        <SketchCard className="px-4 pt-3 pb-4">
          <span className="hand text-[21px] text-[var(--ink-muted)]">felt</span>
          <p className="tnum text-[34px] font-semibold leading-tight tracking-[-0.02em]">
            {done.length
              ? (done.reduce((s, x) => s + x.satisfaction!, 0) / done.length).toFixed(1)
              : '—'}
          </p>
          <span className="caption">flat 1 → 5 strong</span>
        </SketchCard>
      </div>

      {ended.length > 0 && (
        <SketchCard className="px-5 py-4">
          <span className="hand text-[24px]">today's sessions</span>
          <div className="mt-2 flex flex-col">
            {ended.map((s) => (
              <div
                key={s.id}
                className="flex items-baseline justify-between border-b-[1.5px] border-dashed border-[var(--rule)] py-2 last:border-0"
              >
                <span className="flex-1 truncate text-[15px] font-medium">
                  {s.intent || s.tag}
                </span>
                <span className="tnum caption ml-3 shrink-0">
                  {formatHours(Math.round((s.end! - s.start) / 60000))} ·{' '}
                  {s.completed ? `felt ${s.satisfaction}` : 'stopped'}
                </span>
              </div>
            ))}
          </div>
        </SketchCard>
      )}

      {data && ended.length === 0 && (
        <p className="caption px-1">
          Nothing logged yet today. The first session starts the line.
        </p>
      )}
    </div>
  );
}
