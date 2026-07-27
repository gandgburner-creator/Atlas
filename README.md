# Atlas

Personal tracking. Offline-first, local-only, no backend and no auth. Nothing
leaves the phone.

**Slice 1 tracks one thing: wake time.** Wake time is the anchor and bedtime
follows it. The ramp shifts the target 30 minutes earlier each week for six
weeks — 09:30, 09:00, 08:30, 08:00, 07:30, 07:00 — starting from whatever date
you give it on first run.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # ramp and stats derivation
npm run build    # production build into dist/
```

## Deploying

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every
push to `main`, and can also be run by hand from the Actions tab to deploy a
branch before merging. The live app is:

    https://gandgburner-creator.github.io/Atlas/

One-time setup, both in the repo's **Settings**: the repo must be **public**
(Pages is only free for public repos), and **Pages → Source** must be set to
**GitHub Actions**.

**The sub-path matters.** Pages serves a project site from `/<repo>/`, not the
domain root, so the workflow builds with `BASE_PATH=/Atlas/`. That flows into
Vite's `base`, the manifest's `start_url` and `scope`, and the service
worker's `navigateFallback` — if any of them disagreed, iOS would open the
installed app in a browser tab instead of standalone, and the fonts would
404. It's also why the fonts live in `src/fonts` rather than `public/`: Vite
rewrites `url()` in CSS against the base, and a bare `/fonts/…` would resolve
to the domain root.

Any host that serves the app from the **domain root** needs no `BASE_PATH` at
all — the default is `/`.

## Installing it on an iPhone

Open the URL in **Safari** — only Safari can install a PWA on iOS, Chrome
can't — then **Share → Add to Home Screen**.

It launches standalone, with no browser chrome, and works in airplane mode.
Everything is precached; there is nothing to reach for. Your logs live in
IndexedDB on the phone and are never uploaded, which also means **deleting
the app deletes the data** — there's no backup yet.

## The two screens

**Today** — the target wake time, large. Tap the wake field (it defaults to
now), optionally add a sleep-onset estimate and one line about the day, save.
That's the whole interaction. If today is already logged you get the entry
back with an Edit button.

**Progress** — the target line descending week by week, with logged wake times
plotted against it, plus the current week, a 7-day average, and a count of
days logged.

## Repeating a week

Holding a wake time for a second week is a normal choice, not a failure, so
the button sits on the Today screen and toggles both ways. A hold pushes the
rest of the ramp back seven days; nothing before it moves. Press it again to
release.

## What this deliberately doesn't do

- **No streaks.** A missed day is a gap in the chart. Nothing turns red,
  nothing resets, no counter is lost. `daysLogged` only ever counts up.
- **No stored derivations.** Week numbers, targets and averages are computed
  at read time from raw logs and the ramp definition. Change the ramp and the
  entire history — chart included — re-derives. That's why nothing is
  precomputed.
- **No navigation shell for future sections.** Two screens, two tabs. When
  there are more, this gets rethought rather than extended.

## Data

Dexie over IndexedDB. `src/db/schema.ts` declares the whole app's schema —
`sleepLogs`, `weightLogs`, `foodLogs`, `workouts`, `focusSessions`,
`lifeLogs`, `photos`, `config` — but only `sleepLogs` and `config` are read or
written in this slice. The rest are empty on purpose, so adding the next slice
is a feature, not a migration.

`date` is a local calendar day (`YYYY-MM-DD`) and clock times are local
`HH:MM`. Neither is a UTC instant: "I woke at 07:00" should stay 07:00 across
a timezone change. `focusSessions` is the exception — a session is a real
interval, so it stores epoch millis.

## Design

Everything visual comes from the **Atlas Sketchbook Atoms v1** sheet. Tokens
live in `src/design/tokens.ts`, mirrored by the `@theme` block in
`src/index.css`; those two files are the only place a colour or stroke weight
is written down.

**Type is a pairing.** Caveat 700 carries headings and labels — never below
20px, never longer than one line, and **never a numeral**. Outfit carries body
text and every single digit, always with tabular figures, so a column of times
lines up on the colon and a counter never jitters as it ticks. Both fonts are
self-hosted in `public/fonts` and precached: a webfont fetched over the
network is a webfont that doesn't arrive at 07:00 in airplane mode.

**The wobble is a filter, not a library.** Cards, buttons and inputs are
ordinary rounded rects displaced by the sheet's own `feTurbulence` filters
(`src/components/Sketch.tsx`) at the sheet's own frequencies — 0.028 for
cards, 0.041 for chart work and inputs, 0.05 for small marks. Rough.js draws
the chart, where the line is generated rather than filtered.

**Night paper** follows `prefers-color-scheme`: cream ink on a toned board,
not white on black. The palette swaps; the ink weights don't.

One deliberate reading of the brief: the sheet assigns the accent red
`#C4452E` to target lines, and the chart uses it there. Red never marks a
missed day, a late wake time, or anything else you did — the "no red, no
guilt" rule is about judgement, and nothing in Atlas judges.
