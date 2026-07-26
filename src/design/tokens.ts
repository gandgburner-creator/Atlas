/**
 * Atlas Sketchbook Atoms — local definition.
 *
 * NOTE: the Claude Design project for this app ("Atlas Sketchbook Atoms")
 * could not be read from this environment, so these values are a faithful
 * stand-in, not the imported originals. Everything visual routes through this
 * file and the @theme block in index.css; swapping in the real tokens is an
 * edit to these two places and nothing else.
 *
 * The idea being held: paper and ink, geometry drawn by hand, type that is
 * not. Rough.js supplies the wobble; the letterforms stay a clean sans, and
 * digits are always tabular so a column of times reads as a column.
 */

export const ink = '#23201b';
export const inkSoft = '#6b6459';
export const inkFaint = '#a89f92';
export const paper = '#faf7f0';
export const paperEdge = '#efe9dc';

/** Target line: present, patient, never alarming. No red anywhere in Atlas. */
export const target = '#7d8aa1';
/** Logged actuals. */
export const actual = '#2f5d50';

/**
 * Rough.js defaults. `seed` is fixed so a component redraws identically
 * across renders — hand-drawn should look hand-drawn, not animated.
 */
export const roughDefaults = {
  roughness: 1.15,
  bowing: 1.1,
  seed: 42,
} as const;
