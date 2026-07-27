import { useCallback, useEffect, useState } from 'react';
import { Button } from './Button';
import { TimerRing } from './Ring';
import { SketchBorder, SketchCard } from './Sketch';
import { db } from '../db/schema';

/**
 * A count-up session timer for focus and craft hours. The running session
 * lives in localStorage as a start timestamp, so locking the phone or
 * backgrounding the PWA loses nothing — elapsed time recomputes from the
 * clock whenever the app wakes.
 *
 * Ending a session asks two things, straight off the sheet: satisfaction
 * 1–5 ("how did it feel? flat → strong") and whether the intent was
 * completed. Abandoning instead saves nothing and says nothing.
 */

interface Running {
  start: number;
  intent: string;
  tag: string;
  area: 'work' | 'craft';
}

const KEY = 'atlas.sessionTimer';

function load(): Running | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Running) : null;
  } catch {
    return null;
  }
}

export function SessionTimer({
  area,
  color,
  tags,
}: {
  area: 'work' | 'craft';
  color: string;
  tags: string[];
}) {
  const [running, setRunning] = useState<Running | null>(load);
  const [now, setNow] = useState(Date.now());
  const [intent, setIntent] = useState('');
  const [tag, setTag] = useState(tags[0] ?? '');
  const [ending, setEnding] = useState(false);
  const [satisfaction, setSatisfaction] = useState<number | null>(null);
  const [completed, setCompleted] = useState<boolean | null>(null);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    const onVis = () => setNow(Date.now());
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [running]);

  const start = useCallback(() => {
    const r: Running = { start: Date.now(), intent: intent.trim(), tag, area };
    localStorage.setItem(KEY, JSON.stringify(r));
    setRunning(r);
  }, [intent, tag, area]);

  async function finish() {
    if (!running || satisfaction === null || completed === null) return;
    await db.focusSessions.add({
      start: running.start,
      end: Date.now(),
      intent: running.intent,
      tag: running.tag,
      satisfaction,
      completed,
      area: running.area,
    });
    localStorage.removeItem(KEY);
    setRunning(null);
    setEnding(false);
    setSatisfaction(null);
    setCompleted(null);
    setIntent('');
  }

  function abandon() {
    localStorage.removeItem(KEY);
    setRunning(null);
    setEnding(false);
  }

  // A session started on the other screen renders there, not here.
  if (running && running.area !== area) {
    return (
      <SketchCard filter="rough2" className="px-5 py-4">
        <p className="caption">
          a {running.area} session is running — finish it from the {running.area} screen
        </p>
      </SketchCard>
    );
  }

  if (!running) {
    return (
      <SketchCard className="flex flex-col items-center gap-3 px-5 pt-5 pb-6">
        <span className="hand text-[24px] text-[var(--ink-muted)]">
          {area === 'work' ? 'deep work' : 'craft session'}
        </span>
        <div className="relative flex h-[56px] w-full items-center bg-[var(--paper)] px-4 [--field-stroke:var(--ink)] focus-within:[--field-stroke:var(--accent)]">
          <SketchBorder filter="rough2" radius={4} strokeWidth={2.2} stroke="var(--field-stroke)" />
          <input
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            placeholder="intent — one line"
            className="relative w-full bg-transparent text-[17px] font-medium outline-none placeholder:text-[var(--ink-faint)]"
          />
        </div>
        <div className="flex w-full flex-wrap gap-2">
          {tags.map((t) => (
            <button
              key={t}
              onClick={() => setTag(t)}
              className="relative px-4 py-2 text-[13.5px] font-semibold"
              style={
                tag === t
                  ? { background: 'var(--btn-fill)', color: 'var(--btn-text)', borderRadius: 999 }
                  : { color: 'var(--ink-muted)' }
              }
            >
              {tag !== t && <SketchBorder radius={999} strokeWidth={1.8} stroke="var(--rule)" />}
              <span className="relative">{t}</span>
            </button>
          ))}
        </div>
        <Button onClick={start} className="w-full">
          Start
        </Button>
      </SketchCard>
    );
  }

  const elapsed = Math.max(0, now - running.start);
  const mm = Math.floor(elapsed / 60000);
  const hh = Math.floor(mm / 60);
  const clock = `${hh > 0 ? `${hh}:${String(mm % 60).padStart(2, '0')}` : mm}:${String(
    Math.floor((elapsed % 60000) / 1000),
  ).padStart(2, '0')}`;

  if (ending) {
    return (
      <SketchCard className="flex flex-col gap-4 px-5 pt-5 pb-6">
        <span className="hand text-[24px]">how did it feel?</span>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => setSatisfaction(n)}
              className="tnum relative flex h-[56px] flex-1 items-center justify-center text-[19px] font-semibold"
              style={
                satisfaction === n
                  ? { background: 'var(--btn-fill)', color: 'var(--btn-text)', borderRadius: 4 }
                  : undefined
              }
            >
              {satisfaction !== n && <SketchBorder radius={4} strokeWidth={2.2} />}
              <span className="relative">{n}</span>
            </button>
          ))}
        </div>
        <div className="caption flex justify-between">
          <span>flat</span>
          <span>strong</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="hand flex-1 text-[24px]">intent done?</span>
          <div className="flex gap-2">
            {([true, false] as const).map((v) => (
              <button
                key={String(v)}
                onClick={() => setCompleted(v)}
                className="relative w-[76px] py-3.5 text-[15px] font-semibold"
                style={
                  completed === v
                    ? { background: 'var(--btn-fill)', color: 'var(--btn-text)', borderRadius: 5 }
                    : { color: 'var(--ink-muted)' }
                }
              >
                {completed !== v && <SketchBorder radius={5} strokeWidth={2.2} />}
                <span className="relative">{v ? 'Yes' : 'No'}</span>
              </button>
            ))}
          </div>
        </div>
        <Button onClick={finish} disabled={satisfaction === null || completed === null}>
          Log {clock}
        </Button>
        <button onClick={abandon} className="hand text-[19px] text-[var(--ink-muted)]">
          abandon — save nothing
        </button>
      </SketchCard>
    );
  }

  return (
    <SketchCard className="flex flex-col items-center gap-4 px-5 pt-5 pb-6">
      <span className="hand text-[24px]" style={{ color }}>
        {running.intent || (area === 'work' ? 'deep work' : 'craft')}
      </span>
      <TimerRing fraction={(elapsed / 3_600_000) % 1} color={color}>
        <span className="tnum text-[44px] font-semibold leading-none tracking-[-0.02em]">
          {clock}
        </span>
        <span className="caption">{running.tag}</span>
      </TimerRing>
      <Button onClick={() => setEnding(true)} className="w-full">
        End session
      </Button>
    </SketchCard>
  );
}
