import { useState, type ReactNode } from 'react';
import { Button } from '../components/Button';
import { Icon, type IconName } from '../components/Icon';
import { Ring } from '../components/Ring';
import { DashedRule, SketchCard } from '../components/Sketch';
import { SECTIONS } from '../domain/commitments';

/**
 * First run, before anything is configured.
 *
 * Four cards, plain words, no jargon — someone who has never seen the app
 * should understand it without being taught. It shows only when there is no
 * ramp yet, so anyone already using Atlas never meets it, and it can be
 * replayed from Settings.
 *
 * The third card is the one that matters. Everything else here is orientation;
 * "nothing breaks" is the actual promise the app makes, so it gets its own
 * card rather than a footnote.
 */

interface Slide {
  title: string;
  body: string;
  art: ReactNode;
}

function FourSections() {
  const icons: IconName[] = ['body', 'work', 'craft', 'life'];
  return (
    <div className="flex items-end justify-center gap-5 py-2">
      {SECTIONS.map((s, i) => (
        <div key={s.id} className="flex flex-col items-center gap-2">
          <Icon name={icons[i] as IconName} size={38} stroke="var(--ink)" />
          <span className="hand text-[20px]">{s.label}</span>
        </div>
      ))}
    </div>
  );
}

function TodayPreview() {
  return (
    <div className="flex flex-col gap-3 py-1">
      <div className="flex justify-center gap-3">
        <Ring section="body" fraction={0.66} size={56} />
        <Ring section="work" fraction={null} size={56} />
        <Ring section="craft" fraction={null} size={56} />
        <Ring section="life" fraction={null} size={56} />
      </div>
      <div className="flex flex-col gap-2">
        <SketchCard stroke="var(--success)" className="px-3 py-2">
          <div className="flex items-center gap-3" style={{ color: 'var(--success)' }}>
            <Icon name="check" size={22} strokeWidth={3} />
            <span className="hand text-[21px]">wake time</span>
          </div>
        </SketchCard>
        <SketchCard filter="rough2" className="px-3 py-2">
          <div className="flex items-center gap-3">
            <Icon name="weigh" size={22} stroke="var(--ink-muted)" />
            <span className="hand text-[21px]">weigh in</span>
          </div>
        </SketchCard>
      </div>
    </div>
  );
}

/** Five days, one of them blank. The gap is drawn as nothing at all. */
function GapArt() {
  return (
    <div className="flex flex-col items-center gap-2 py-3">
      <svg viewBox="0 0 260 34" className="w-full" fill="none" filter="url(#roughSoft)" aria-hidden="true">
        {[0, 1, 3, 4].map((i) => (
          <circle
            key={i}
            cx={26 + i * 52}
            cy="17"
            r="9"
            fill="var(--paper)"
            stroke="var(--ink)"
            strokeWidth="2.6"
          />
        ))}
        {[[26, 78], [182, 234]].map(([a, b]) => (
          <line
            key={a}
            x1={(a as number) + 11} y1="17" x2={(b as number) - 11} y2="17"
            stroke="var(--ink)" strokeWidth="2.4" strokeLinecap="round"
          />
        ))}
      </svg>
      {/* Caption as text, not an SVG label — the roughSoft filter displaces
          glyphs into the marks above it. */}
      <span className="caption">a gap, and nothing else</span>
    </div>
  );
}

function RampArt() {
  const rows = [
    { label: 'sleep · training · weight', when: 'now' },
    { label: 'nutrition', when: 'week 3' },
    { label: 'rest · calls', when: 'week 5' },
    { label: 'focus · craft', when: 'later' },
  ];
  return (
    <div className="flex flex-col gap-1.5 py-1">
      {rows.map((r, i) => (
        <div key={r.label} className="flex items-baseline gap-3">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" filter="url(#roughSoft)">
            <circle
              cx="7" cy="7" r="5"
              fill={i === 0 ? 'var(--accent)' : 'none'}
              stroke={i === 0 ? 'var(--accent)' : 'var(--rule)'}
              strokeWidth="2"
            />
          </svg>
          <span className="flex-1 text-[15px] font-medium" style={{ opacity: i === 0 ? 1 : 0.55 }}>
            {r.label}
          </span>
          <span className="tnum caption">{r.when}</span>
        </div>
      ))}
    </div>
  );
}

const SLIDES: Slide[] = [
  {
    title: 'Atlas',
    body: 'A notebook for four parts of your life. Log a little each day — that is the whole idea. Everything stays on this phone; nothing is uploaded anywhere.',
    art: <FourSections />,
  },
  {
    title: 'one screen',
    body: 'Open the app and today is already there: the rings show how the day is going, the list underneath is what is left. Tap a line to log it. It takes seconds, not minutes.',
    art: <TodayPreview />,
  },
  {
    title: 'nothing breaks',
    body: 'Miss a day and nothing resets. There are no streaks to lose, no red marks, no catching up. A missed day is simply a gap — the app carries on exactly where you left it.',
    art: <GapArt />,
  },
  {
    title: 'it starts small',
    body: 'You do not get everything at once. Sleep, training and weight start now; the rest switches on over the coming weeks so nothing arrives all at the same time. Change any of it later in settings.',
    art: <RampArt />,
  },
];

export function Tutorial({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const slide = SLIDES[i] as Slide;
  const last = i === SLIDES.length - 1;

  return (
    <div className="flex min-h-dvh flex-col gap-5 pb-6">
      <header className="flex items-center justify-between pt-2">
        <span className="annot">
          {last ? 'ready' : `${i + 1} of ${SLIDES.length}`}
        </span>
        {!last && (
          <button onClick={onDone} className="hand px-2 py-2 text-[20px] text-[var(--ink-muted)]">
            skip
          </button>
        )}
      </header>

      <div className="flex flex-1 flex-col justify-center gap-5">
        <h1 className="hand text-[46px] leading-[0.95]">{slide.title}</h1>

        <SketchCard filter={i % 2 === 0 ? 'rough' : 'rough2'} className="px-4 py-4">
          {slide.art}
        </SketchCard>

        <p className="text-[17px] leading-[1.55]">{slide.body}</p>
      </div>

      <DashedRule />

      <div className="flex items-center gap-4">
        {/* Hand-drawn progress dots. */}
        <svg width={SLIDES.length * 18} height="14" aria-hidden="true" filter="url(#roughSoft)">
          {SLIDES.map((s, n) => (
            <circle
              key={s.title}
              cx={7 + n * 18} cy="7" r="4.5"
              fill={n === i ? 'var(--ink)' : 'none'}
              stroke={n === i ? 'var(--ink)' : 'var(--rule)'}
              strokeWidth="2"
            />
          ))}
        </svg>

        {i > 0 && (
          <button
            onClick={() => setI(i - 1)}
            className="hand px-2 py-3 text-[20px] text-[var(--ink-muted)]"
          >
            back
          </button>
        )}

        <Button
          className="ml-auto flex-1"
          onClick={() => (last ? onDone() : setI(i + 1))}
        >
          {last ? 'Set it up' : 'Next'}
        </Button>
      </div>
    </div>
  );
}
