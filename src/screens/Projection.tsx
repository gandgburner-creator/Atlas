import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '../components/Button';
import { NumberField, parseNum, PushHeader } from '../components/Chrome';
import { Figure } from '../components/Figure';
import { DashedRule, SketchCard } from '../components/Sketch';
import {
  getLeanMassKg,
  getPinnedProjection,
  getWeightPlan,
  savePinnedProjection,
} from '../db/config';
import { db } from '../db/schema';
import {
  bfPercent,
  clampBf,
  formatTimeline,
  STAGE_MAX,
  STAGE_MIN,
  stageFor,
  timelineToTarget,
  weightAtBf,
} from '../domain/composition';
import { latestRollingAvg, observedRate } from '../domain/weight';
import { useNav } from '../nav';

/**
 * "What would I look like at X, and when would I get there."
 *
 * Two figures at the same scale on the same baseline: current fixed on the
 * left, projected on the right. One slider spans exactly the drawn range —
 * 25% down to 14% — with weight and bf% fields kept in sync through the one
 * shared leanMassKg. Nothing extrapolates past the assets.
 *
 * Exploratory by rule: this screen renders figures and a date. It never
 * nags, congratulates, or compares you to the projection.
 */
export function Projection({ today }: { today: string }) {
  const nav = useNav();

  const data = useLiveQuery(async () => {
    const [weights, lean, plan, pinned] = await Promise.all([
      db.weightLogs.toArray(),
      getLeanMassKg(),
      getWeightPlan(),
      getPinnedProjection(),
    ]);
    return { weights, lean, plan, pinned };
  }, [today]);

  const [bfInput, setBfInput] = useState<string | null>(null);
  const [kgInput, setKgInput] = useState<string | null>(null);
  const [bf, setBf] = useState<number | null>(null);

  const lean = data?.lean;
  const avg = data ? latestRollingAvg(data.weights) : null;
  const currentBf =
    avg !== null && lean !== undefined ? clampBf(bfPercent(avg, lean)) : null;

  /**
   * Observed rate, computed from the logs on hand.
   *
   * This used to be cached in config, keyed on the calendar day. That made
   * a correction logged later the same day invisible until tomorrow: the
   * cache was written the first time the screen was opened and only the
   * date could invalidate it. A least-squares fit over at most a month of
   * daily points costs nothing, so there is no cache to go stale.
   */
  const rate = useMemo(
    () => (data ? observedRate(data.weights, today) : undefined),
    [data, today],
  );

  // Default target: one stage down from current.
  useEffect(() => {
    if (bf === null && currentBf !== null) {
      setBf(Math.max(STAGE_MIN, stageFor(currentBf) - 1));
    }
  }, [bf, currentBf]);

  const targetWeight = useMemo(
    () => (bf !== null && lean !== undefined ? weightAtBf(bf, lean) : null),
    [bf, lean],
  );

  if (!data || currentBf === null || avg === null || lean === undefined) {
    return (
      <div>
        <PushHeader title="projection" />
        <SketchCard className="px-5 py-6">
          <p className="hand text-[24px] text-[var(--ink-muted)]">no baseline yet</p>
          <p className="caption mt-1">
            The projection starts from the 7-day average. Log a few weights
            first.
          </p>
        </SketchCard>
      </div>
    );
  }

  const shownBf = bf ?? currentBf;

  function setFromBf(next: number) {
    const c = Math.min(STAGE_MAX, Math.max(STAGE_MIN, next));
    setBf(c);
    setBfInput(null);
    setKgInput(null);
  }

  const timeline =
    targetWeight !== null
      ? timelineToTarget(avg, targetWeight, today, rate ?? null, data.plan.planRateKgPerWeek)
      : null;

  const yearEndBf = 14;
  const halfwayBf = currentBf - (currentBf - yearEndBf) / 2;
  const nextStageBf = Math.max(STAGE_MIN, stageFor(currentBf) - 1);

  const pinnedHere =
    data.pinned &&
    Math.abs(data.pinned.bfPercent - shownBf) < 0.05;

  return (
    <div className="flex flex-col gap-5">
      <PushHeader title="projection" />

      {/* Two figures, same scale, same baseline. */}
      <SketchCard className="px-4 pt-4 pb-3">
        <div className="flex items-end justify-center gap-2">
          <figure className="m-0 flex w-[44%] flex-col items-center gap-1">
            <Figure bfPercent={currentBf} alt={`Current, about ${currentBf.toFixed(1)} percent`} />
            <figcaption className="annot">now</figcaption>
            <span className="tnum text-[15px] font-semibold">
              {avg.toFixed(1)} kg · {currentBf.toFixed(1)}%
            </span>
          </figure>
          <figure className="m-0 flex w-[44%] flex-col items-center gap-1">
            <Figure bfPercent={shownBf} alt={`Projected, ${shownBf.toFixed(1)} percent`} />
            <figcaption className="annot" style={{ color: 'var(--accent)' }}>
              projected
            </figcaption>
            <span className="tnum text-[15px] font-semibold">
              {targetWeight?.toFixed(1)} kg · {shownBf.toFixed(1)}%
            </span>
          </figure>
        </div>
      </SketchCard>

      {/* Presets */}
      <div className="flex gap-2">
        {[
          { label: 'next stage', bf: nextStageBf },
          { label: 'year-end', bf: yearEndBf },
          { label: 'halfway', bf: halfwayBf },
        ].map((p) => (
          <Button
            key={p.label}
            variant="secondary"
            className="flex-1 text-[14px]"
            onClick={() => setFromBf(p.bf)}
          >
            {p.label}
          </Button>
        ))}
      </div>

      {/* One control, two units, always in sync. */}
      <SketchCard filter="rough2" className="px-5 pt-4 pb-5">
        <input
          type="range"
          min={STAGE_MIN}
          max={STAGE_MAX}
          step={0.1}
          value={STAGE_MAX + STAGE_MIN - shownBf}
          onChange={(e) => setFromBf(STAGE_MAX + STAGE_MIN - Number(e.target.value))}
          className="w-full accent-[var(--accent)]"
          aria-label="Target body fat percentage"
        />
        <div className="tnum caption flex justify-between">
          <span>{STAGE_MAX}%</span>
          <span>{STAGE_MIN}%</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <NumberField
            label="target weight"
            unit="kg"
            value={kgInput ?? (targetWeight?.toFixed(1) ?? '')}
            onChange={(v) => {
              setKgInput(v);
              const n = parseNum(v);
              if (n && n > lean) {
                setBf(clampBf(bfPercent(n, lean)));
                setBfInput(null);
              }
            }}
          />
          <NumberField
            label="target bf"
            unit="%"
            value={bfInput ?? shownBf.toFixed(1)}
            onChange={(v) => {
              setBfInput(v);
              const n = parseNum(v);
              if (n !== null) {
                setBf(clampBf(n));
                setKgInput(null);
              }
            }}
          />
        </div>
        <p className="tnum caption mt-2">
          figure snaps to {stageFor(shownBf)}% · numbers stay exact
        </p>
      </SketchCard>

      {/* Timeline — the valuable half. */}
      {timeline ? (
        <SketchCard className="px-5 py-4">
          <span className="hand text-[24px]">when</span>
          <p className="tnum mt-1 text-[26px] font-semibold leading-tight">
            {formatTimeline(timeline)}
          </p>
          <p className="tnum caption mt-1">
            {timeline.kind === 'observed'
              ? `at your observed ${timeline.rate.toFixed(2)} kg/week`
              : `at the planned ${timeline.rate.toFixed(2)} kg/week — ${timeline.note}`}
          </p>
          <DashedRule className="mt-3 pt-2" />
          <p className="caption">estimates assume lean mass stays constant</p>
        </SketchCard>
      ) : (
        <p className="caption px-1">
          target is at or above the current average — nothing to schedule
        </p>
      )}

      {/* Pin */}
      <Button
        variant="secondary"
        onClick={async () => {
          if (pinnedHere) await savePinnedProjection(null);
          else if (targetWeight !== null)
            await savePinnedProjection({
              bfPercent: shownBf,
              weightKg: targetWeight,
              pinnedOn: today,
            });
          nav.pop();
        }}
      >
        {pinnedHere ? 'Clear the pin' : 'Pin this target'}
      </Button>
      <p className="caption pb-2 text-center">
        a pin is a quiet ghost on the body screen, nothing more
      </p>
    </div>
  );
}
