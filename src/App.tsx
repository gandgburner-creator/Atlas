import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Icon, type IconName } from './components/Icon';
import { SketchDefs } from './components/Sketch';
import {
  autoPassRestDays,
  getModuleFlags,
  getRamp,
  getTutorialSeen,
  setTutorialSeen,
} from './db/config';
import { seedFoodDatabase } from './db/foods';
import { DEFAULT_MODULE_FLAGS, type ModuleFlags } from './domain/commitments';
import type { RampConfig } from './domain/ramp';
import { todayISO } from './domain/time';
import { NavProvider, useNav, type Tab } from './nav';
import { BodyScreen } from './screens/Body';
import { CraftScreen } from './screens/Craft';
import { ExportScreen } from './screens/Export';
import { FoodScreen } from './screens/Food';
import { FoodEditorScreen } from './screens/FoodEditor';
import { Home } from './screens/Home';
import { PlateEditorScreen } from './screens/PlateEditor';
import { InBodyDetail, InBodyForm } from './screens/InBody';
import { LifeScreen } from './screens/Life';
import { Onboarding } from './screens/Onboarding';
import { Progress } from './screens/Progress';
import { Projection } from './screens/Projection';
import { Settings } from './screens/Settings';
import { Today as SleepToday } from './screens/Today';
import { Tutorial } from './screens/Tutorial';
import { TrainingHistory } from './screens/TrainingHistory';
import { TrainingLog } from './screens/TrainingLog';
import { TrainingSession } from './screens/TrainingSession';
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

interface TabDef {
  id: Tab;
  icon: IconName;
  label: string;
  /** Which module flag gates this tab out of the bottom nav. Always shown
   * when absent — today/body/food/progress are the fixed four. */
  module?: keyof ModuleFlags;
}

const TABS: TabDef[] = [
  { id: 'today', icon: 'home', label: 'today' },
  { id: 'body', icon: 'body', label: 'body' },
  { id: 'food', icon: 'food', label: 'food' },
  { id: 'work', icon: 'work', label: 'work', module: 'work' },
  { id: 'craft', icon: 'craft', label: 'craft', module: 'craft' },
  { id: 'life', icon: 'life', label: 'life', module: 'life' },
  { id: 'progress', icon: 'board', label: 'progress' },
];

function Shell({
  ramp,
  today,
  onRampChange,
  onReplayTutorial,
}: {
  ramp: RampConfig;
  today: string;
  onRampChange: (r: RampConfig) => void;
  onReplayTutorial: () => void;
}) {
  const nav = useNav();

  // Rest days pass at the day boundary. Routed through the same serialized
  // queue as every other training-state write (see db/config.ts) so this
  // can never race with a "Finish session" tap and compound into more than
  // one step of pointer movement.
  useEffect(() => {
    void autoPassRestDays(today);
  }, [today]);

  // Live so a flag flipped in Settings hides/shows tabs immediately.
  const moduleFlags = useLiveQuery(getModuleFlags, [], DEFAULT_MODULE_FLAGS);
  const visibleTabs = TABS.filter((t) => !t.module || moduleFlags[t.module]);

  // A tab switched off from under the user (Settings, another tab) lands
  // them back on Today rather than showing a bottom nav with no selection.
  useEffect(() => {
    if (!visibleTabs.some((t) => t.id === nav.tab)) nav.setTab('today');
  }, [visibleTabs, nav]);

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
          ) : pushed.name === 'training-history' ? (
            <TrainingHistory />
          ) : pushed.name === 'training-session' ? (
            <TrainingSession id={pushed.id} />
          ) : pushed.name === 'inbody-form' ? (
            <InBodyForm today={today} />
          ) : pushed.name === 'inbody-detail' ? (
            <InBodyDetail id={pushed.id} />
          ) : pushed.name === 'projection' ? (
            <Projection today={today} />
          ) : pushed.name === 'export' ? (
            <ExportScreen today={today} />
          ) : pushed.name === 'food-editor' ? (
            <FoodEditorScreen id={pushed.id} />
          ) : pushed.name === 'plate-editor' ? (
            <PlateEditorScreen id={pushed.id} />
          ) : (
            <Settings
              ramp={ramp}
              today={today}
              onRampChange={onRampChange}
              onReplayTutorial={onReplayTutorial}
            />
          )
        ) : nav.tab === 'today' ? (
          <Home ramp={ramp} today={today} />
        ) : nav.tab === 'body' ? (
          <BodyScreen today={today} moduleFlags={moduleFlags} />
        ) : nav.tab === 'food' ? (
          <FoodScreen today={today} />
        ) : nav.tab === 'work' ? (
          <WorkScreen today={today} />
        ) : nav.tab === 'craft' ? (
          <CraftScreen today={today} />
        ) : nav.tab === 'life' ? (
          <LifeScreen today={today} />
        ) : (
          <Progress ramp={ramp} today={today} moduleFlags={moduleFlags} />
        )}
      </main>

      {/* Bottom nav: active modules only — hidden ones stay off until
          switched back on in settings, never deleted. */}
      {!pushed && (
        <nav className="pb-safe sticky bottom-0 flex bg-[var(--board)] pt-2">
          {visibleTabs.map((t) => {
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
  const [tutorialDone, setTutorialDone] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const today = useToday();

  useEffect(() => {
    Promise.all([getRamp(), getTutorialSeen(), seedFoodDatabase()])
      .then(([r, seen]) => {
        setRamp(r ?? null);
        setTutorialDone(seen);
      })
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) return null;

  async function finishTutorial() {
    await setTutorialSeen(true);
    setTutorialDone(true);
  }

  // First run reads: intro → set the ramp → the app. Replaying the intro from
  // Settings drops back in here and lands on the app, since the ramp exists.
  const screen = !tutorialDone ? (
    <Tutorial onDone={finishTutorial} />
  ) : !ramp ? (
    <Onboarding onReady={setRamp} />
  ) : null;

  return (
    <NavProvider>
      <SketchDefs />
      {screen ? (
        <div className="mx-auto flex min-h-dvh max-w-[390px] flex-col px-5">
          <main className="pt-safe flex-1 pb-8">{screen}</main>
        </div>
      ) : (
        <Shell
          ramp={ramp as RampConfig}
          today={today}
          onRampChange={setRamp}
          onReplayTutorial={() => setTutorialDone(false)}
        />
      )}
    </NavProvider>
  );
}
