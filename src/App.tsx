import { useEffect, useState } from 'react';
import { Icon, type IconName } from './components/Icon';
import { SketchDefs } from './components/Sketch';
import {
  getRamp,
  getTrainingState,
  saveTrainingState,
} from './db/config';
import type { RampConfig } from './domain/ramp';
import { todayISO } from './domain/time';
import { passRestDays } from './domain/training';
import { NavProvider, useNav, type Tab } from './nav';
import { BodyScreen } from './screens/Body';
import { CraftScreen } from './screens/Craft';
import { Home } from './screens/Home';
import { InBodyDetail, InBodyForm } from './screens/InBody';
import { LifeScreen } from './screens/Life';
import { Onboarding } from './screens/Onboarding';
import { Progress } from './screens/Progress';
import { Projection } from './screens/Projection';
import { Settings } from './screens/Settings';
import { Today as SleepToday } from './screens/Today';
import { TrainingLog } from './screens/TrainingLog';
import { WorkScreen } from './screens/Work';
import { PushHeader } from './components/Chrome';

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

const TABS: { id: Tab; icon: IconName; label: string }[] = [
  { id: 'today', icon: 'home', label: 'today' },
  { id: 'body', icon: 'body', label: 'body' },
  { id: 'work', icon: 'work', label: 'work' },
  { id: 'craft', icon: 'craft', label: 'craft' },
  { id: 'life', icon: 'life', label: 'life' },
  { id: 'progress', icon: 'board', label: 'progress' },
];

function Shell({
  ramp,
  today,
  onRampChange,
}: {
  ramp: RampConfig;
  today: string;
  onRampChange: (r: RampConfig) => void;
}) {
  const nav = useNav();

  // Rest days pass at the day boundary; persist the advanced pointer once.
  useEffect(() => {
    let live = true;
    (async () => {
      const s = await getTrainingState();
      const next = passRestDays(s, today);
      if (live && next !== s) await saveTrainingState(next);
    })();
    return () => {
      live = false;
    };
  }, [today]);

  const pushed = nav.top;

  return (
    <div className="mx-auto flex min-h-dvh max-w-[390px] flex-col px-5">
      <main className="pt-safe flex-1 pb-8">
        {pushed ? (
          pushed.name === 'sleep' ? (
            <div>
              <PushHeader title="sleep" />
              <SleepToday ramp={ramp} today={today} onRampChange={onRampChange} />
            </div>
          ) : pushed.name === 'training-log' ? (
            <TrainingLog today={today} />
          ) : pushed.name === 'inbody-form' ? (
            <InBodyForm today={today} />
          ) : pushed.name === 'inbody-detail' ? (
            <InBodyDetail id={pushed.id} />
          ) : pushed.name === 'projection' ? (
            <Projection today={today} />
          ) : (
            <Settings ramp={ramp} today={today} onRampChange={onRampChange} />
          )
        ) : nav.tab === 'today' ? (
          <Home ramp={ramp} today={today} />
        ) : nav.tab === 'body' ? (
          <BodyScreen today={today} />
        ) : nav.tab === 'work' ? (
          <WorkScreen today={today} />
        ) : nav.tab === 'craft' ? (
          <CraftScreen today={today} />
        ) : nav.tab === 'life' ? (
          <LifeScreen today={today} />
        ) : (
          <Progress ramp={ramp} today={today} />
        )}
      </main>

      {/* Bottom nav: the four sections plus progress, home on the left. */}
      {!pushed && (
        <nav className="pb-safe sticky bottom-0 flex bg-[var(--board)] pt-2">
          {TABS.map((t) => {
            const on = nav.tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => nav.setTab(t.id)}
                aria-current={on ? 'page' : undefined}
                aria-label={t.label}
                className="flex flex-1 flex-col items-center gap-0.5 py-1.5"
                style={{ color: on ? 'var(--ink)' : 'var(--ink-faint)' }}
              >
                <Icon name={t.icon} size={23} strokeWidth={on ? 2.7 : 2.2} />
                <span className="hand text-[15px] leading-none">{t.label}</span>
                <svg width="26" height="5" viewBox="0 0 26 5" aria-hidden="true">
                  {on && (
                    <path
                      d="M2 3.2 Q9 1 14 2.6 T24 2.4"
                      stroke="var(--accent)"
                      strokeWidth="2.2"
                      fill="none"
                      strokeLinecap="round"
                    />
                  )}
                </svg>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}

export default function App() {
  const [ramp, setRamp] = useState<RampConfig | null>(null);
  const [loaded, setLoaded] = useState(false);
  const today = useToday();

  useEffect(() => {
    getRamp()
      .then((r) => setRamp(r ?? null))
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) return null;

  return (
    <NavProvider>
      <SketchDefs />
      {!ramp ? (
        <div className="mx-auto flex min-h-dvh max-w-[390px] flex-col px-5">
          <main className="pt-safe flex-1 pb-8">
            <Onboarding onReady={setRamp} />
          </main>
        </div>
      ) : (
        <Shell ramp={ramp} today={today} onRampChange={setRamp} />
      )}
    </NavProvider>
  );
}
