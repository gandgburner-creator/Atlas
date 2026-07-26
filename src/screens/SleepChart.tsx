import { useEffect, useRef } from 'react';
import rough from 'roughjs';
import type { SleepLog } from '../db/schema';
import {
  effectiveStepIndex,
  rampLengthDays,
  targetMinutesFor,
  type RampConfig,
} from '../domain/ramp';
import { addDays, daysBetween, toClock, toMinutes } from '../domain/time';
import { useElementWidth } from '../components/Rough';
import {
  actual as actualColor,
  inkFaint,
  inkSoft,
  paper,
  roughDefaults,
  target as targetColor,
} from '../design/tokens';

const HEIGHT = 250;
const PAD = { top: 16, right: 14, bottom: 30, left: 46 };
const SVG_NS = 'http://www.w3.org/2000/svg';

interface Props {
  ramp: RampConfig;
  logs: SleepLog[];
  today: string;
}

function text(
  x: number,
  y: number,
  content: string,
  opts: { anchor?: string; fill?: string; size?: number } = {},
): SVGTextElement {
  const el = document.createElementNS(SVG_NS, 'text');
  el.setAttribute('x', String(x));
  el.setAttribute('y', String(y));
  el.setAttribute('text-anchor', opts.anchor ?? 'middle');
  el.setAttribute('fill', opts.fill ?? inkSoft);
  el.setAttribute('font-size', String(opts.size ?? 11));
  // Digits stay tabular here too — the axis is a column of times.
  el.setAttribute('font-variant-numeric', 'tabular-nums lining-nums');
  el.setAttribute('font-family', 'inherit');
  el.textContent = content;
  return el;
}

/**
 * The ramp, drawn.
 *
 * A dashed descending target line with logged wake times plotted against it.
 * Missed days are simply absent — no marker, no interpolation across the gap,
 * nothing that reads as a penalty. The actual-wake line breaks wherever a day
 * wasn't logged and picks up again on the next one.
 */
export function SleepChart({ ramp, logs, today }: Props) {
  const { ref: hostRef, width } = useElementWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || width < 80) return;

    svg.replaceChildren();
    const rc = rough.svg(svg);

    // ── Domain ────────────────────────────────────────────────────────────
    const dayOf = (iso: string) => daysBetween(ramp.startDate, iso);
    const loggedDays = logs.map((l) => dayOf(l.date));
    const dMin = Math.min(0, ...loggedDays);
    const dMax = Math.max(
      rampLengthDays(ramp) - 1,
      dayOf(today),
      ...loggedDays,
    );
    const span = Math.max(1, dMax - dMin);

    const targetsInView: number[] = [];
    for (let d = dMin; d <= dMax; d++) {
      targetsInView.push(targetMinutesFor(ramp, addDays(ramp.startDate, d)));
    }
    const actuals = logs.map((l) => toMinutes(l.actualWake));
    const lo = Math.min(...targetsInView, ...actuals);
    const hi = Math.max(...targetsInView, ...actuals);
    // Snap out to the enclosing half-hours, then guarantee some breathing room.
    let yMin = Math.floor((lo - 20) / 30) * 30;
    let yMax = Math.ceil((hi + 20) / 30) * 30;
    if (yMax - yMin < 120) {
      const mid = (yMax + yMin) / 2;
      yMin = mid - 60;
      yMax = mid + 60;
    }

    const plotW = width - PAD.left - PAD.right;
    const plotH = HEIGHT - PAD.top - PAD.bottom;
    const x = (day: number) => PAD.left + ((day - dMin) / span) * plotW;
    // Later times sit higher, so the target line visibly descends week on
    // week — the shape of the ramp is the point of the chart.
    const y = (min: number) =>
      PAD.top + ((yMax - min) / (yMax - yMin)) * plotH;

    // ── Horizontal rules, one per hour ────────────────────────────────────
    const firstHour = Math.ceil(yMin / 60) * 60;
    for (let m = firstHour; m <= yMax; m += 60) {
      svg.appendChild(
        rc.line(PAD.left, y(m), width - PAD.right, y(m), {
          ...roughDefaults,
          roughness: 0.6,
          seed: 3 + m,
          stroke: inkFaint,
          strokeWidth: 0.6,
        }),
      );
      svg.appendChild(
        text(PAD.left - 8, y(m) + 4, toClock(m), { anchor: 'end', size: 11 }),
      );
    }

    // ── Week boundaries ───────────────────────────────────────────────────
    for (let d = Math.max(0, dMin); d <= dMax; d += 7) {
      const iso = addDays(ramp.startDate, d);
      const wk = effectiveStepIndex(ramp, iso);
      if (wk < 0) continue;
      const label = `W${Math.min(wk, ramp.steps.length - 1) + 1}`;
      svg.appendChild(
        text(x(d), HEIGHT - 10, label, { size: 10, fill: inkFaint }),
      );
    }

    // ── Target line: dashed, descending, one step per week ────────────────
    const targetPts: [number, number][] = [];
    for (let d = dMin; d <= dMax; d++) {
      const m = targetMinutesFor(ramp, addDays(ramp.startDate, d));
      const prev = targetPts[targetPts.length - 1];
      // Square the step so the weekly drop reads as a drop, not a slope.
      if (prev && prev[1] !== y(m)) targetPts.push([x(d), prev[1]]);
      targetPts.push([x(d), y(m)]);
    }
    if (targetPts.length > 1) {
      svg.appendChild(
        rc.linearPath(targetPts, {
          ...roughDefaults,
          roughness: 0.7,
          bowing: 0.6,
          seed: 21,
          stroke: targetColor,
          strokeWidth: 2,
          strokeLineDash: [7, 5],
        }),
      );
    }

    // ── Today ─────────────────────────────────────────────────────────────
    const todayDay = dayOf(today);
    if (todayDay >= dMin && todayDay <= dMax) {
      svg.appendChild(
        rc.line(x(todayDay), PAD.top, x(todayDay), HEIGHT - PAD.bottom, {
          ...roughDefaults,
          roughness: 0.8,
          seed: 33,
          stroke: inkFaint,
          strokeWidth: 1,
          strokeLineDash: [2, 6],
        }),
      );
    }

    // ── Actuals ───────────────────────────────────────────────────────────
    const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date));

    // Join only genuinely adjacent days. A gap stays a gap: no line is drawn
    // across a day that wasn't logged.
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1] as SleepLog;
      const cur = sorted[i] as SleepLog;
      if (daysBetween(prev.date, cur.date) !== 1) continue;
      svg.appendChild(
        rc.line(
          x(dayOf(prev.date)),
          y(toMinutes(prev.actualWake)),
          x(dayOf(cur.date)),
          y(toMinutes(cur.actualWake)),
          {
            ...roughDefaults,
            roughness: 0.8,
            seed: 50 + i,
            stroke: actualColor,
            strokeWidth: 1.4,
          },
        ),
      );
    }

    for (const [i, log] of sorted.entries()) {
      svg.appendChild(
        rc.circle(x(dayOf(log.date)), y(toMinutes(log.actualWake)), 8, {
          ...roughDefaults,
          roughness: 0.7,
          seed: 90 + i,
          stroke: actualColor,
          strokeWidth: 1.4,
          fill: actualColor,
          fillStyle: 'solid',
        }),
      );
    }
  }, [width, ramp, logs, today]);

  const summary =
    logs.length === 0
      ? 'Target wake times, descending 30 minutes each week. No wake times logged yet.'
      : `Target wake times descending 30 minutes each week, with ${logs.length} logged wake ${
          logs.length === 1 ? 'time' : 'times'
        } plotted against them.`;

  return (
    <div ref={hostRef} className="w-full">
      <svg
        ref={svgRef}
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        className="block"
        style={{ background: paper }}
        role="img"
        aria-label={summary}
      />
      <div className="mt-1 flex items-center gap-4 px-1">
        <span className="flex items-center gap-2">
          <svg width="22" height="8" aria-hidden="true">
            <line
              x1="0"
              y1="4"
              x2="22"
              y2="4"
              stroke={targetColor}
              strokeWidth="2"
              strokeDasharray="6 4"
            />
          </svg>
          <span className="annot">target</span>
        </span>
        <span className="flex items-center gap-2">
          <svg width="10" height="10" aria-hidden="true">
            <circle cx="5" cy="5" r="4" fill={actualColor} />
          </svg>
          <span className="annot">actual</span>
        </span>
      </div>
    </div>
  );
}
