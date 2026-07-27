import { useEffect, useRef } from 'react';
import rough from 'roughjs';
import type { WeightPlan } from '../db/config';
import type { ISODate } from '../db/schema';
import { chart as C, roughChart } from '../design/tokens';
import { daysBetween } from '../domain/time';
import { targetLineAt, milestoneDates } from '../domain/weight';
import { DashedRule, SketchCard, useElementWidth } from '../components/Sketch';

const HEIGHT = 230;
const PAD = { top: 14, right: 12, bottom: 26, left: 40 };
const SVG_NS = 'http://www.w3.org/2000/svg';

interface Props {
  series: { date: ISODate; kg: number; avg: number }[];
  plan: WeightPlan;
  today: ISODate;
}

function cssVar(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim() || '#17130E';
}

function text(
  x: number,
  y: number,
  content: string,
  fill: string,
  opts: { anchor?: string; size?: number; weight?: number } = {},
): SVGTextElement {
  const el = document.createElementNS(SVG_NS, 'text');
  el.setAttribute('x', String(x));
  el.setAttribute('y', String(y));
  el.setAttribute('text-anchor', opts.anchor ?? 'middle');
  el.setAttribute('fill', fill);
  el.setAttribute('font-size', String(opts.size ?? 11.5));
  el.setAttribute('font-weight', String(opts.weight ?? 500));
  el.setAttribute('font-family', 'Outfit, sans-serif');
  el.setAttribute('font-variant-numeric', 'tabular-nums');
  el.textContent = content;
  return el;
}

/**
 * Rolling average against the plan's dashed target line, with milestone
 * ticks at the plan's marker weights. Daily weights are not plotted at all —
 * the average IS the line; the noise stays in the table.
 */
export function WeightChart({ series, plan, today }: Props) {
  const { ref: hostRef, width } = useElementWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    const host = hostRef.current;
    if (!svg || !host || width < 80 || series.length < 2) return;

    const ink = cssVar(host, '--ink');
    const inkMuted = cssVar(host, '--ink-muted');
    const grid = cssVar(host, '--grid');
    const accent = cssVar(host, '--accent');
    const paper = cssVar(host, '--paper');

    svg.replaceChildren();
    const rc = rough.svg(svg);
    const opts = { ...roughChart };

    const first = series[0]!;
    const anchorDate = first.date;
    const anchorKg = first.avg;

    const d0 = 0;
    const d1 = Math.max(daysBetween(anchorDate, today), 14);
    const x = (date: ISODate) =>
      PAD.left +
      (Math.min(d1, Math.max(d0, daysBetween(anchorDate, date))) / d1) *
        (width - PAD.left - PAD.right);

    const targetStart = targetLineAt(plan, anchorDate, anchorKg, anchorDate);
    const targetEnd = targetLineAt(plan, anchorDate, anchorKg, today);
    const lo = Math.min(...series.map((p) => p.avg), targetEnd) - 0.6;
    const hi = Math.max(...series.map((p) => p.avg), targetStart) + 0.6;
    const y = (kg: number) =>
      PAD.top + ((hi - kg) / (hi - lo)) * (HEIGHT - PAD.top - PAD.bottom);

    // Gridlines per whole kg (cap at 8 lines for tight ranges).
    const step = hi - lo > 8 ? 2 : 1;
    for (let kg = Math.ceil(lo); kg <= Math.floor(hi); kg += step) {
      svg.appendChild(
        rc.line(PAD.left, y(kg), width - PAD.right, y(kg), {
          ...opts, roughness: 0.6, seed: 3 + kg, stroke: grid, strokeWidth: C.gridStroke,
        }),
      );
      svg.appendChild(text(PAD.left - 8, y(kg) + 4, String(kg), inkMuted, { anchor: 'end', size: 11 }));
    }

    // Axes: two strokes that don't quite meet.
    const baseline = HEIGHT - PAD.bottom;
    svg.appendChild(rc.line(PAD.left, PAD.top - 2, PAD.left, baseline + 2, {
      ...opts, seed: 11, stroke: ink, strokeWidth: C.axisStroke,
    }));
    svg.appendChild(rc.line(PAD.left - 2, baseline, width - PAD.right, baseline - 1, {
      ...opts, seed: 12, stroke: ink, strokeWidth: C.axisStroke,
    }));

    // Dashed plan line with milestone ticks.
    svg.appendChild(
      rc.line(x(anchorDate), y(targetStart), x(today), y(targetEnd), {
        ...opts, roughness: 0.7, seed: 21, stroke: accent,
        strokeWidth: C.targetStroke, strokeLineDash: [...C.targetDash],
      }),
    );
    for (const m of milestoneDates(plan, anchorDate, anchorKg)) {
      if (daysBetween(anchorDate, m.date) > d1) continue;
      svg.appendChild(
        rc.line(x(m.date), y(m.kg) - 6, x(m.date), y(m.kg) + 6, {
          ...opts, seed: 30 + m.kg, stroke: accent, strokeWidth: 2,
        }),
      );
      svg.appendChild(text(x(m.date), y(m.kg) - 9, String(m.kg), accent, { size: 10.5, weight: 600 }));
    }

    // The rolling average line, gap-free by construction (it exists only on
    // logged days and joins them — an average is continuous information).
    const pts: [number, number][] = series.map((p) => [x(p.date), y(p.avg)]);
    if (pts.length > 1) {
      svg.appendChild(
        rc.linearPath(pts, { ...opts, seed: 51, stroke: ink, strokeWidth: C.lineStroke }),
      );
    }

    // Weekly points, hollow; the latest filled in accent.
    const weekly = series.filter(
      (_, i) => i === series.length - 1 || i % 7 === 0,
    );
    weekly.forEach((p, i) => {
      const isLast = i === weekly.length - 1;
      svg.appendChild(
        rc.circle(x(p.date), y(p.avg), (isLast ? C.latestRadius : C.pointRadius) * 2, {
          ...opts, roughness: 0.6, seed: 90 + i, stroke: ink,
          strokeWidth: isLast ? C.latestStroke : C.pointStroke,
          fill: isLast ? accent : paper, fillStyle: 'solid',
        }),
      );
    });
  }, [width, series, plan, today, hostRef]);

  return (
    <SketchCard className="px-4 pt-4 pb-3">
      <div className="flex items-baseline justify-between">
        <span className="hand text-[24px]">bodyweight</span>
        <span className="tnum caption font-semibold">
          target {plan.targetKg.toFixed(1)}
        </span>
      </div>
      <div ref={hostRef} className="mt-2 w-full">
        <svg
          ref={svgRef}
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          className="block"
          role="img"
          aria-label="Rolling average bodyweight against the plan line"
        />
      </div>
      <DashedRule className="mt-1 pt-2" />
      <div className="flex items-center gap-4 pt-1">
        <span className="caption flex items-center gap-2">
          <svg width="22" height="8" aria-hidden="true">
            <path d="M1 5 Q7 1 12 5 T21 4" stroke="var(--ink)" strokeWidth="2.6" fill="none" strokeLinecap="round" />
          </svg>
          7-day avg
        </span>
        <span className="caption flex items-center gap-2">
          <svg width="22" height="8" aria-hidden="true">
            <path d="M1 4h20" stroke="var(--accent)" strokeWidth="2.2" strokeDasharray="6 5" strokeLinecap="round" />
          </svg>
          plan
        </span>
      </div>
    </SketchCard>
  );
}
