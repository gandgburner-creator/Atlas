/**
 * Atlas Sketchbook Atoms v1 — imported from the Claude Design project.
 *
 * Values below are transcribed from `Atlas Sketchbook Atoms.dc.html`
 * (section 08, Tokens) and are the source of truth for the app. The mirror
 * of this file is the `@theme` block in src/index.css; change both together.
 *
 * The sheet's own rule, and the one that governs everything here:
 * handwriting (Caveat) carries labels and headings, and every numeral is set
 * in Outfit with tabular figures. Never a handwritten digit.
 */

// ── Day paper ─────────────────────────────────────────────────────────────
export const desk = '#EDE5D6'; // app background
export const paper = '#FBF6EA'; // card / sheet
export const paperSunk = '#E3D9C6'; // recessed panel, pressed state
export const ink = '#17130E';
export const inkMuted = '#5A4E3E';
export const inkFaint = '#8E7F69'; // small caption labels on the sheet
export const pencilRule = '#B5A68E'; // dashed rules, hairlines
export const gridRule = '#C9BCA4'; // chart gridlines
export const inkOnDark = '#F7F1E2'; // text on an ink-filled button

// ── Accents ───────────────────────────────────────────────────────────────
export const accent = '#C4452E'; // brand accent — targets, section numbers
export const success = '#2F6B3C';
export const successWash = '#E7F0E4';

// ── Night paper ───────────────────────────────────────────────────────────
// "Cream ink on dark board — not white-on-black."
export const nightBoard = '#211B15';
export const nightCard = '#2C251E';
export const creamInk = '#F4EBD9';
export const creamMuted = '#BFAE95';
export const nightRule = '#6B5C48';
export const nightAccent = '#E8674B';
export const nightSuccess = '#8FBF7A';

// ── Stroke weights ────────────────────────────────────────────────────────
export const stroke = {
  hairline: 1.4,
  icon: 2.4,
  cardBorder: 2.4,
  chartLine: 3.0,
  emphasis: 3.2,
} as const;

/**
 * Rough.js settings for the chart.
 *
 * The design sheet gets its wobble from an SVG turbulence filter
 * (baseFrequency 0.041 for chart work). Rough.js reaches the same place by a
 * different route, so these are tuned to match the sheet's chart by eye
 * rather than transcribed: enough movement to read as pen, "not enough to
 * misplace a point".
 *
 * `seed` is fixed so a redraw is identical — hand-drawn, not animated.
 */
export const roughChart = {
  roughness: 0.9,
  bowing: 1.0,
  seed: 41,
} as const;

/** Chart geometry, from the sheet's chart rules. */
export const chart = {
  gridStroke: 1.4,
  axisStroke: 2.6,
  lineStroke: 3.0,
  targetStroke: 2.2,
  targetDash: [9, 7],
  pointRadius: 4.2,
  pointStroke: 2.4,
  latestRadius: 6.4,
  latestStroke: 2.6,
  tickSize: 11.5,
} as const;
