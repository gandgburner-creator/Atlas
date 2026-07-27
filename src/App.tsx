import { useEffect, useState } from 'react';
import { SketchDefs } from './components/Sketch';
import { getRamp } from './db/config';
import type { RampConfig } from './domain/ramp';
import { todayISO } from './domain/time';
import { Onboarding } from './screens/Onboarding';
import { Progress } from './screens/Progress';
import { Today } from './screens/Today';

type Screen = 'today' | 'progress';

/**
 * Keeps "today" honest across a midnight rollover — the app is likely to be
 * left open overnight on a phone and resumed in the morning, when the date
 * has changed but the React tree hasn't.
 */
function useToday(): string {
  const [date, setDate] = useState(todayISO);

  useEffect(() => {
    const check = () => setDate(todayISO());
    const id = window.setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  return date;
}

export default function App() {
  const [ramp, setRamp] = useState<RampConfig | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [screen, setScreen] = useState<Screen>('today');
  const today = useToday();

  useEffect(() => {
    getRamp()
      .then((r) => setRamp(r ?? null))
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) return null;

  return (
    <div className="mx-auto flex min-h-dvh max-w-[390px] flex-col px-5">
      <SketchDefs />

      <main className="pt-safe flex-1 pb-8">
        {!ramp ? (
          <Onboarding onReady={setRamp} />
        ) : screen === 'today' ? (
          <Today ramp={ramp} today={today} onRampChange={setRamp} />
        ) : (
          <Progress ramp={ramp} today={today} />
        )}
      </main>

      {/*
        Two screens, so two tabs. Not a navigation shell for future sections —
        when there are more sections this gets rethought, not extended.
      */}
      {ramp && (
        <nav className="pb-safe sticky bottom-0 flex gap-6 bg-[var(--board)] pt-3">
          {(['today', 'progress'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setScreen(s)}
              aria-current={screen === s ? 'page' : undefined}
              className="hand relative flex-1 py-2 text-[24px]"
              style={{
                color: screen === s ? 'var(--ink)' : 'var(--ink-faint)',
              }}
            >
              {s}
              {/* The current tab is underscored by hand, not boxed. */}
              {screen === s && (
                <svg
                  className="absolute inset-x-4 -bottom-0.5 h-2"
                  viewBox="0 0 120 8"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <path
                    d="M2 5 Q30 1 60 4 T118 3"
                    stroke="var(--accent)"
                    strokeWidth="2.6"
                    fill="none"
                    strokeLinecap="round"
                    filter="url(#roughSoft)"
                  />
                </svg>
              )}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
