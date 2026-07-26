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

## Installing it on an iPhone

The service worker needs HTTPS (or `localhost`), so serve `dist/` from
anywhere with a certificate — a tunnel to your laptop, a static host, a Pi on
your LAN with TLS. Then in **Safari** (not Chrome — only Safari can install a
PWA on iOS): **Share → Add to Home Screen**.

It launches standalone, with no browser chrome, and works with the phone in
airplane mode. Everything is precached; there is nothing to reach for.

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

## Type

Numerals are a clean system sans with tabular figures throughout (`.tnum` in
`src/index.css`), so a column of times lines up on the colon. The hand-drawn
quality comes from Rough.js geometry — boxes, rules, the chart — never from
the letterforms.

> **Design tokens:** the Claude Design project *Atlas Sketchbook Atoms* could
> not be reached from the environment this was built in, so the palette and
> stroke values in `src/design/tokens.ts` are a stand-in. Everything visual
> routes through that file and the `@theme` block in `src/index.css` —
> swapping in the real tokens is an edit to those two places.
