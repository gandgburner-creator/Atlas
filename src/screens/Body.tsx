import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '../components/Button';
import { NumberField, parseNum, TabHeader } from '../components/Chrome';
import { Figure } from '../components/Figure';
import { Icon } from '../components/Icon';
import { SketchCard } from '../components/Sketch';
import {
  getLeanMassKg,
  getPinnedProjection,
  getStageDates,
  getTrainingState,
  getWeightPlan,
  saveStageDates,
} from '../db/config';
import { db } from '../db/schema';
import type { ModuleFlags } from '../domain/commitments';
import { bfPercent, clampBf, updateStageDates } from '../domain/composition';
import { formatDayLabel, todayISO } from '../domain/time';
import { passRestDays, sessionFor } from '../domain/training';
import { latestRollingAvg, rollingAverageSeries } from '../domain/weight';
import { useNav } from '../nav';
import { WeightChart } from './WeightChart';

interface Props {
  today: string;
  moduleFlags: ModuleFlags;
}

export function BodyScreen({ today, moduleFlags }: Props) {
  const nav = useNav();
  const [kgInput, setKgInput] = useState('');
  const [savingKg, setSavingKg] = useState(false);

  const data = useLiveQuery(async () => {
    const [weights, lean, plan, pinned, stageDates, training, todayLog, inbodyLatest] =
      await Promise.all([
        db.weightLogs.toArray(),
        getLeanMassKg(),
        getWeightPlan(),
        getPinnedProjection(),
        getStageDates(),
        getTrainingState(),
        db.weightLogs.get(today),
        db.inbody.orderBy('date').last(),
      ]);
    return { weights, lean, plan, pinned, stageDates, training, todayLog, inbodyLatest };
  }, [today]);

  const avgForEffect = data ? latestRollingAvg(data.weights) : null;
  const leanForEffect = data?.lean;

  // Record first-reached stages. An effect, not a render side-effect — and
  // it only ever adds dates; drifting back up neither erases nor comments.
  useEffect(() => {
    if (avgForEffect === null || leanForEffect === undefined) return;
    (async () => {
      const dates = await getStageDates();
      const next = updateStageDates(
        dates,
        clampBf(bfPercent(avgForEffect, leanForEffect)),
        today,
      );
      if (next !== dates) await saveStageDates(next);
    })();
  }, [avgForEffect, leanForEffect, today]);

  if (!data) return null;
  const { weights, lean, plan, pinned, stageDates, training, todayLog } = data;

  const series = rollingAverageSeries(weights);
  const avg = latestRollingAvg(weights);
  const bf = avg !== null ? bfPercent(avg, lean) : null;
  const shownBf = bf !== null ? clampBf(bf) : null;

  const trainingState = passRestDays(training, today);
  const session = sessionFor(trainingState, today);
  const paused = Boolean(trainingState.pause);

  async function logWeight() {
    const kg = parseNum(kgInput);
    if (!kg || kg < 30 || kg > 250) return;
    setSavingKg(true);
    try {
      await db.weightLogs.put({ date: todayISO(), kg });
      setKgInput('');
    } finally {
      setSavingKg(false);
    }
  }

  const reachedStages = Object.entries(stageDates)
    .map(([s, d]) => ({ stage: Number(s), date: d }))
    .sort((a, b) => b.stage - a.stage);

  return (
    <div className="flex flex-col gap-6">
      <TabHeader title="Body" annot="weight · training" />

      {/* ── Composition figure / stage timeline — behind the insight flag,
          since these are projections derived from weight, not weight itself. */}
      {moduleFlags.insight && (
        <>
          {shownBf !== null ? (
            <button onClick={() => nav.push({ name: 'projection' })} className="text-left">
              <SketchCard className="px-5 pt-4 pb-5">
                <div className="flex items-center justify-between">
                  <span className="hand text-[26px]">composition</span>
                  <span className="tnum caption font-semibold">
                    est. {shownBf.toFixed(1)}%
                  </span>
                </div>
                <div className="relative mx-auto mt-2 w-[46%]">
                  {pinned && (
                    <Figure
                      bfPercent={pinned.bfPercent}
                      ghost
                      className="absolute inset-0"
                      alt=""
                    />
                  )}
                  <Figure bfPercent={shownBf} />
                </div>
                {pinned && avg !== null && (
                  <p className="tnum caption mt-2 text-center">
                    pinned {pinned.bfPercent.toFixed(0)}% ·{' '}
                    {Math.max(0, avg - pinned.weightKg).toFixed(1)} kg to go
                  </p>
                )}
                <p className="caption mt-1 text-center">tap to project</p>
              </SketchCard>
            </button>
          ) : (
            <SketchCard className="px-5 py-6">
              <p className="hand text-[24px] text-[var(--ink-muted)]">composition</p>
              <p className="caption mt-1">
                The figure draws from the 7-day average. Log a weight below and it
                appears.
              </p>
            </SketchCard>
          )}

          {reachedStages.length > 0 && (
            <div className="flex flex-col gap-1 px-1">
              {reachedStages.map(({ stage, date }) => (
                <div key={stage} className="flex items-baseline justify-between">
                  <span className="tnum text-[15px] font-semibold">{stage}%</span>
                  <span className="tnum caption">{formatDayLabel(date)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Weight ─────────────────────────────────────────────────────── */}
      <SketchCard filter="rough2" className="px-5 pt-4 pb-5">
        <span className="hand text-[24px] text-[var(--ink-muted)]">rolling avg</span>
        <div className="flex items-baseline gap-2">
          <span className="tnum metric">{avg !== null ? avg.toFixed(1) : '—'}</span>
          <span className="text-[20px] font-medium text-[var(--ink-muted)]">kg</span>
          {series.length >= 2 && (
            <DeltaTag
              delta={(series[series.length - 1]?.avg ?? 0) - (series[series.length - 2]?.avg ?? 0)}
            />
          )}
        </div>
        <span className="tnum caption">
          {todayLog
            ? `today ${todayLog.kg.toFixed(1)} · 7-day window`
            : 'not weighed today'}
        </span>

        <div className="mt-4 flex items-end gap-3">
          <div className="flex-1">
            <NumberField
              label={todayLog ? 'correct today' : 'weigh in'}
              value={kgInput}
              onChange={setKgInput}
              unit="kg"
              placeholder={todayLog ? todayLog.kg.toFixed(1) : '0.0'}
            />
          </div>
          <Button
            onClick={logWeight}
            disabled={savingKg || parseNum(kgInput) === null}
            className="shrink-0"
          >
            Log
          </Button>
        </div>
      </SketchCard>

      {series.length >= 2 ? (
        <WeightChart series={series} plan={plan} today={today} />
      ) : (
        <SketchCard className="px-5 py-6">
          <p className="hand text-[24px] text-[var(--ink-muted)]">
            bodyweight · waiting
          </p>
          <p className="caption mt-1">Two entries and this chart starts drawing.</p>
        </SketchCard>
      )}

      {/* ── Training ───────────────────────────────────────────────────── */}
      <button onClick={() => nav.push({ name: 'training-log' })} className="text-left">
        <SketchCard className="px-5 pt-4 pb-5">
          <div className="flex items-center justify-between">
            <span className="hand text-[26px]">training</span>
            <Icon name="lift" size={24} stroke="var(--ink-muted)" />
          </div>
          <p className="hand mt-1 text-[36px]" style={{ color: paused ? 'var(--ink-muted)' : 'var(--ink)' }}>
            {paused ? 'paused' : session === 'rest' ? 'rest day' : `${session} next`}
          </p>
          <p className="caption mt-1">
            {paused
              ? trainingState.pause?.reason || 'queue frozen — days excluded, not missed'
              : session === 'rest'
                ? 'the queue moves on by itself'
                : 'tap to log — the queue waits for you'}
          </p>
        </SketchCard>
      </button>

      {/* ── InBody ─────────────────────────────────────────────────────── */}
      {moduleFlags.insight && <InBodyCard today={today} />}
    </div>
  );
}

function DeltaTag({ delta }: { delta: number }) {
  // Direction is information, not judgement: same muted colour either way.
  const text = `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)}`;
  return (
    <span className="tnum ml-auto text-[14px] font-semibold text-[var(--ink-muted)]">
      {text}
    </span>
  );
}

function InBodyCard({ today }: { today: string }) {
  const nav = useNav();
  const readings = useLiveQuery(
    () =>
      db.inbody
        .orderBy('date')
        .reverse()
        // A draft still being filled in isn't a reading yet — it has no
        // numbers to show until it's saved.
        .filter((r) => r.status !== 'in_progress')
        .limit(5)
        .toArray(),
    [today],
  );

  return (
    <SketchCard filter="rough2" className="px-5 pt-4 pb-5">
      <div className="flex items-center justify-between">
        <span className="hand text-[26px]">inbody</span>
        <button
          onClick={() => nav.push({ name: 'inbody-form' })}
          className="hand px-2 py-1 text-[20px] text-[var(--accent)]"
        >
          + new reading
        </button>
      </div>
      {readings && readings.length > 0 ? (
        <div className="mt-2 flex flex-col gap-2">
          {readings.map((r) => (
            <button
              key={r.id}
              onClick={() => nav.push({ name: 'inbody-detail', id: r.id as number })}
              className="flex items-baseline justify-between border-b-[1.5px] border-dashed border-[var(--rule)] pb-1.5 text-left last:border-0"
            >
              <span className="tnum text-[15px] font-semibold">
                {r.bodyFatPercent?.toFixed(1)}% · {r.skeletalMuscleMassKg?.toFixed(1)} kg SMM
              </span>
              <span className="tnum caption">{formatDayLabel(r.date)}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="caption mt-1">
          Roughly weekly, never chased. A missed week is not a gap in anything.
        </p>
      )}
    </SketchCard>
  );
}
