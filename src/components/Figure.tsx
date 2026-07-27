import { useEffect, useState } from 'react';
import { STAGE_MAX, STAGE_MIN, stageFor, stageProgress } from '../domain/composition';

/**
 * The composition figure: twelve ink studies, 210×418, alpha-keyed PNGs cut
 * from one sheet and re-registered — feet aligned, one head-to-foot height —
 * so stacking any two and crossfading holds the stance still. A -night set
 * carries cream ink for night paper.
 *
 * All twelve stages stay mounted in a stack and only opacity moves, with a
 * 600ms ease — so every change is a crossfade by construction, never a hard
 * cut. Between whole percentages the next stage down surfaces underneath
 * from 0 → 0.5 as the estimate approaches it, so something moves most weeks.
 * A rising estimate gets the identical quiet fade and not a word of
 * commentary.
 */

const assets = import.meta.glob('../assets/body/bf-*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

function src(stage: number, night: boolean): string {
  return assets[`../assets/body/bf-${stage}${night ? '-night' : ''}.png`] ?? '';
}

const STAGES = Array.from(
  { length: STAGE_MAX - STAGE_MIN + 1 },
  (_, i) => STAGE_MIN + i,
);

function useNightPaper(): boolean {
  const [night, setNight] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setNight(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return night;
}

interface Props {
  bfPercent: number;
  className?: string;
  /** Render dimmed as a ghost (pinned target / projection overlay). */
  ghost?: boolean;
  alt?: string;
}

export function Figure({ bfPercent, className = '', ghost = false, alt }: Props) {
  const night = useNightPaper();
  const stage = stageFor(bfPercent);
  const toNext = stageProgress(bfPercent);
  const nextStage = Math.max(STAGE_MIN, stage - 1);

  const opacityFor = (s: number): number => {
    if (s === stage) return ghost ? 0.28 : 1;
    if (!ghost && s === nextStage && nextStage !== stage) return 0.5 * toNext;
    return 0;
  };

  return (
    <div
      // w-full: the box is all absolute children, so without an explicit
      // width the aspect-ratio has nothing to work from and collapses to 0.
      className={`relative w-full ${className}`}
      style={{ aspectRatio: '210 / 418' }}
      role="img"
      aria-label={alt ?? `Figure at an estimated ${stage} percent body fat`}
    >
      {STAGES.map((s) => (
        <img
          key={s}
          src={src(s, night)}
          alt=""
          className="absolute inset-0 h-full w-full object-contain transition-opacity duration-[600ms] ease-in-out"
          style={{ opacity: opacityFor(s) }}
          loading={Math.abs(s - stage) <= 1 ? 'eager' : 'lazy'}
          draggable={false}
        />
      ))}
    </div>
  );
}

export const FIGURE_RANGE = { max: STAGE_MAX, min: STAGE_MIN };
