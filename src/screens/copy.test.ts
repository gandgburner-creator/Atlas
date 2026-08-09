import { describe, expect, it } from 'vitest';

/**
 * The app's vocabulary, enforced.
 *
 * Nothing here is cosmetic. "Two sessions behind" and "a session available
 * if you want it" describe the same history and produce completely
 * different relationships with training, and the second one is the whole
 * design. A word that turns a record into a reckoning is a bug in this app
 * regardless of how it got there, so it is checked rather than remembered.
 *
 * Scoped to text the user can actually read — string and JSX literals in
 * the screens and components. Comments are exempt on purpose: the rule
 * itself has to be statable, and several modules state it.
 *
 * Sources come from Vite's raw glob rather than node:fs, so this file
 * type-checks under the app project, which has no Node types by design.
 */

const FORBIDDEN = ['owed', 'missed', 'behind', 'outstanding', 'debt'];

/**
 * The only sanctioned appearances, quoted exactly.
 *
 * Two kinds, and nothing else qualifies. The first denies the frame rather
 * than using it — "excluded, not missed" exists precisely to say the app
 * does not keep that kind of score, and deleting the word would delete the
 * reassurance with it. The second is the ordinary spatial sense, which has
 * nothing to do with training at all.
 *
 * Anything not on this list fails. Adding to it is a deliberate act, which
 * is the point: a new line saying "two sessions behind" has to be argued
 * for in a diff rather than slipping in.
 */
const ALLOWED = [
  'excluded, not missed',
  'A missed week is not a gap in anything.',
  'A missed day is simply a gap',
  'plan behind the wake-time screen',
];

const RAW = {
  ...import.meta.glob('./*.tsx', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('./*.ts', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../components/*.tsx', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../components/*.ts', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>;

const SOURCES = Object.entries(RAW)
  .filter(([path]) => !path.includes('.test.'))
  .map(([path, text]) => ({ path, text }));

/** Everything outside comments — near enough for prose, and it never
 * silently passes something it should have caught. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
}

function readable(src: string): string {
  let text = stripComments(src);
  for (const phrase of ALLOWED) text = text.split(phrase).join(' ');
  return text;
}

function source(name: string): string {
  const found = SOURCES.find((f) => f.path.endsWith(name));
  if (!found) throw new Error(`no source for ${name}`);
  return found.text;
}

describe('the words the app does not use', () => {
  it.each(FORBIDDEN)('never shows "%s" to the user', (word) => {
    // Word boundaries, so "behindhand" would be caught but "beforehand"
    // and CSS class names containing the letters are not.
    const pattern = new RegExp(`\\b${word}\\b`, 'i');
    const offenders = SOURCES.filter((f) => pattern.test(readable(f.text))).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('checks a real set of files, so a passing run means something', () => {
    // Guards the guard: a bad glob or filter would make every case above
    // pass by looking at nothing at all.
    expect(SOURCES.length).toBeGreaterThan(15);
    expect(SOURCES.some((f) => f.path.includes('TrainingBonus'))).toBe(true);
    expect(SOURCES.every((f) => f.text.length > 0)).toBe(true);
  });

  it('would catch the word if it were there', () => {
    expect(stripComments('const s = "two sessions behind";')).toMatch(/\bbehind\b/i);
    // ...and would not be fooled by a comment stating the rule.
    expect(stripComments('// never say behind\nconst s = "fine";')).not.toMatch(/\bbehind\b/i);
  });

  it('says nothing of the sort anywhere on the bonus screen, with no exceptions', () => {
    // The feature the rule was written for gets the unqualified version:
    // no allowlist, comments included.
    const text = source('TrainingBonus.tsx');
    for (const word of FORBIDDEN) {
      expect(text).not.toMatch(new RegExp(`\\b${word}\\b`, 'i'));
    }
  });

  it('frames the bonus screen as an offer', () => {
    expect(source('TrainingBonus.tsx')).toContain('available if you want it');
  });

  it('never puts a number on what is available', () => {
    // No count of exercises, no total of sets, nothing to watch grow. The
    // screen offers a list and says nothing about how long it is.
    //
    // Testing for a length rendered as a child — `{xs.length}` — rather
    // than banning `.length` outright, because deciding whether a list is
    // empty is exactly how the screen avoids needing a count.
    const text = stripComments(source('TrainingBonus.tsx'));
    expect(text).not.toMatch(/\.length\s*\}/);
    expect(text).not.toMatch(/\.size\s*\}/);
  });
});
