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
import { useElementWidth } from '../components/Sketch';
import { chart as C, roughChart } from '../design/tokens';

const HEIGHT = 240;
const PAD = { top: 14, right: 10, bottom: 30, left: 44 };
const SVG_NS = 'http://www.w3.org/2000/svg';

interface Props {
  ramp: RampConfig;
  logs: SleepLog[];
  today: string;
}

/** Resolves a CSS custom property to a concrete colour for Rough.js. */
function cssVar(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim() || '#17130E';
}

function text(
  x: number,
  y: number,
  content: string,
  opts: { anchor?: string; fill: string; size?: number; weight?: number } = {
    fill: '#5A4E3E',
  },
): SVGTextElement {
  const el = document.createElementNS(SVG_NS, 'text');
  el.setAttribute('x', String(x));
  el.setAttribute('y', String(y));
  el.setAttribute('text-anchor', opts.anchor ?? 'middle');
  el.setAttribute('fill', opts.fill);
  el.setAttribute('font-size', String(opts.size ?? C.tickSize));
  el.setAttribute('font-weight', String(opts.weight ?? 500));
  el.setAttribute('font-family', 'Outfit, sans-serif');
  // All tick labels are Outfit tabular — no handwriting near a value.
  el.setAttribute('font-variant-numeric', 'tabular-nums');
  el.textContent = content;
  return el;
}

/**
 * The ramp, drawn.
 *
 * A dashed descending target line with logged wake times plotted against it.
 * Missed days are simply absent — no marker, no interpolation across the gap,
 * nothing that reads as a penalty. The plotted line breaks wherever a day
 * wasn't logged and picks up on the next one.
 *
 * Follows the sheet's chart rules: gridlines at 1.4px, axes as two
 * overlapping strokes that don't quite meet at the origin, history as hollow
 * paper-filled points and the latest reading filled in accent.
 */
export function SleepChart({ ramp, logs, today }: Props) {
  const { ref: hostRef, width } = useElementWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    const host = hostRef.current;
    if (!svg || !host || width < 80) return;

    const ink = cssVar(host, '--ink');
    const inkMuted = cssVar(host, '--ink-muted');
    const grid = cssVar(host, '--grid');
    const accent = cssVar(host, '--accent');
    const paper = cssVar(host, '--paper');

    svg.replaceChildren();
    const rc = rough.svg(svg);
    const opts = { ...roughChart };

    // ── Domain ────────────────────────────────────────────────────────────
    const dayOf = (iso: string) => daysBetween(ramp.startDate, iso);
    const loggedDays = logs.map((l) => dayOf(l.date));
    const dMin = Math.min(0, ...loggedDays);
    const dMax = Math.max(rampLengthDays(ramp) - 1, dayOf(today), ...loggedDays);
    const span = Math.max(1, dMax - dMin);

    const targetsInView: number[] = [];
    for (let d = dMin; d <= dMax; d++) {
      targetsInView.push(targetMinutesFor(ramp, addDays(ramp.startDate, d)));
    }
    const actuals = logs.map((l) => toMinutes(l.actualWake));
    const lo = Math.min(...targetsInView, ...actuals);
    const hi = Math.max(...targetsInView, ...actuals);
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
    const y = (min: number) => PAD.top + ((yMax - min) / (yMax - yMin)) * plotH;

    const baseline = HEIGHT - PAD.bottom;

    // ── Gridlines, one per hour ───────────────────────────────────────────
    const firstHour = Math.ceil(yMin / 60) * 60;
    for (let m = firstHour; m <= yMax; m += 60) {
      svg.appendChild(
        rc.line(PAD.left, y(m), width - PAD.right, y(m), {
          ...opts,
          roughness: 0.6,
          seed: 3 + m,
          stroke: grid,
          strokeWidth: C.gridStroke,
        }),
      );
      svg.appendChild(
        text(PAD.left - 9, y(m) + 4, toClock(m), {
          anchor: 'end',
          fill: inkMuted,
          size: 12,
        }),
      );
    }

    // ── Axes: two strokes that don't quite meet at the origin ─────────────
    svg.appendChild(
      rc.line(PAD.left, PAD.top - 2, PAD.left, baseline + 2, {
        ...opts,
        seed: 11,
        stroke: ink,
        strokeWidth: C.axisStroke,
      }),
    );
    svg.appendChild(
      rc.line(PAD.left - 2, baseline, width - PAD.right, baseline - 1, {
        ...opts,
        seed: 12,
        stroke: ink,
        strokeWidth: C.axisStroke,
      }),
    );

    // ── Week boundaries ───────────────────────────────────────────────────
    for (let d = Math.max(0, dMin); d <= dMax; d += 7) {
      const iso = addDays(ramp.startDate, d);
      const wk = effectiveStepIndex(ramp, iso);
      if (wk < 0) continue;
      svg.appendChild(
        text(x(d), HEIGHT - 10, `W${Math.min(wk, ramp.steps.length - 1) + 1}`, {
          fill: inkMuted,
        }),
      );
    }

    // ── Target: dashed, descending, one square step per week ──────────────
    const targetPts: [number, number][] = [];
    for (let d = dMin; d <= dMax; d++) {
      const m = targetMinutesFor(ramp, addDays(ramp.startDate, d));
      const prev = targetPts[targetPts.length - 1];
      if (prev && prev[1] !== y(m)) targetPts.push([x(d), prev[1]]);
      targetPts.push([x(d), y(m)]);
    }
    if (targetPts.length > 1) {
      svg.appendChild(
        rc.linearPath(targetPts, {
          ...opts,
          roughness: 0.7,
          bowing: 0.5,
          seed: 21,
          stroke: accent,
          strokeWidth: C.targetStroke,
          strokeLineDash: [...C.targetDash],
        }),
      );
    }
    svg.appendChild(
      text(width - PAD.right, PAD.top + 10, 'TARGET', {
        anchor: 'end',
        fill: accent,
        size: 11,
        weight: 700,
      }),
    );

    // ── Today ─────────────────────────────────────────────────────────────
    const todayDay = dayOf(today);
    if (todayDay >= dMin && todayDay <= dMax) {
      svg.appendChild(
        rc.line(x(todayDay), PAD.top, x(todayDay), baseline, {
          ...opts,
          roughness: 0.6,
          seed: 33,
          stroke: grid,
          strokeWidth: 1.4,
          strokeLineDash: [2, 6],
        }),
      );
    }

    // ── Actuals ───────────────────────────────────────────────────────────
    const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date));

    // The sheet's point sizes assume a 14-day chart. Six weeks on a 390px
    // phone leaves ~7px per day, where r4.2 circles merge into a caterpillar,
    // so the marks shrink once the days get tight.
    const pxPerDay = plotW / span;
    const dense = pxPerDay < 11;
    const dotR = dense ? 2.8 : C.pointRadius;
    const dotStroke = dense ? 1.6 : C.pointStroke;
    const lineStroke = dense ? 2 : C.lineStroke;
    const latestR = dense ? 5 : C.latestRadius;

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
            ...opts,
            seed: 50 + i,
            stroke: ink,
            strokeWidth: lineStroke,
          },
        ),
      );
    }

    // History reads as hollow paper-filled points; the most recent reading is
    // filled in accent so today is findable at a glance.
    const last = sorted[sorted.length - 1];
    for (const [i, log] of sorted.entries()) {
      const isLast = log === last;
      svg.appendChild(
        rc.circle(
          x(dayOf(log.date)),
          y(toMinutes(log.actualWake)),
          (isLast ? latestR : dotR) * 2,
          {
            ...opts,
            roughness: 0.6,
            seed: 90 + i,
            stroke: ink,
            strokeWidth: isLast ? C.latestStroke : dotStroke,
            fill: isLast ? accent : paper,
            fillStyle: 'solid',
          },
        ),
      );
    }
  }, [width, ramp, logs, today, hostRef]);

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
        role="img"
        aria-label={summary}
      />
    </div>
  );
}
