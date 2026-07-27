import type { Section } from '../domain/commitments';
import { Icon } from './Icon';

/**
 * Status ring, from Asset Library section 02.
 *
 * Track: pencil dots 1.5/5.5. Arc: 4.6px section colour with a thinner
 * overdraw offset +2° — the double stroke of a pen going round twice.
 * Not-started: thinner dots and a hollow centre dot — never grey-red,
 * never a failure state.
 */

export const SECTION_COLOR: Record<Section, string> = {
  body: 'var(--accent)',
  work: '#2B5F8E',
  craft: '#4F7A34',
  life: '#A85F1B',
};

const R = 26;
const CIRC = 2 * Math.PI * R; // ≈163.4

interface Props {
  section: Section;
  /** 0..1, or null when no active commitments (renders greyed). */
  fraction: number | null;
  size?: number;
  label?: string;
  sub?: string;
}

export function Ring({ section, fraction, size = 84, label, sub }: Props) {
  const color = SECTION_COLOR[section];
  const complete = fraction !== null && fraction >= 1;
  const arc = fraction === null ? 0 : Math.max(0, Math.min(1, fraction)) * CIRC;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg
        width={size}
        height={size}
        viewBox="0 0 72 72"
        fill="none"
        filter="url(#roughSoft)"
        role="img"
        aria-label={
          fraction === null
            ? `${label ?? section}: nothing scheduled`
            : `${label ?? section}: ${Math.round(fraction * 100)}% of today`
        }
      >
        {fraction === null ? (
          <>
            <circle
              cx="36" cy="36" r={R}
              stroke="var(--rule)" strokeWidth="2.6"
              strokeDasharray="1.5 6.5" strokeLinecap="round" opacity=".8"
            />
            <circle cx="36" cy="36" r="3.2" fill="none" stroke="var(--rule)" strokeWidth="2.4" />
          </>
        ) : (
          <>
            <circle
              cx="36" cy="36" r={R}
              stroke="var(--rule)" strokeWidth="3"
              strokeDasharray="1.5 5.5" strokeLinecap="round"
            />
            {arc > 0 && (
              <>
                <circle
                  cx="36" cy="36" r={R}
                  stroke={color} strokeWidth="4.6" strokeLinecap="round"
                  strokeDasharray={complete ? undefined : `${arc} ${CIRC}`}
                  transform="rotate(-90 36 36)"
                />
                <circle
                  cx="36" cy="36" r={R}
                  stroke={color} strokeWidth="2.2" strokeLinecap="round"
                  strokeDasharray={`${Math.max(4, arc - 6)} ${CIRC}`}
                  opacity=".55"
                  transform="rotate(-88 36 36)"
                />
              </>
            )}
            {complete && (
              <path
                d="M26.5 36.8 33 43.4 46 29.6"
                stroke={color} strokeWidth="3.4"
                strokeLinecap="round" strokeLinejoin="round"
              />
            )}
          </>
        )}
      </svg>
      {label && (
        <span
          className="hand text-[20px]"
          style={{ color: fraction === null ? 'var(--ink-muted)' : 'var(--ink)' }}
        >
          {label}
        </span>
      )}
      {sub && <span className="annot tnum text-[10px]">{sub}</span>}
    </div>
  );
}

/** Countdown ring for rest and focus timers — same pen, bigger face. */
export function TimerRing({
  fraction,
  color,
  children,
  size = 214,
}: {
  fraction: number;
  color: string;
  children: React.ReactNode;
  size?: number;
}) {
  const r = 52;
  const circ = 2 * Math.PI * r;
  const arc = Math.max(0, Math.min(1, fraction)) * circ;
  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 120 120"
        className="absolute inset-0 h-full w-full"
        fill="none"
        filter="url(#roughSoft)"
        aria-hidden="true"
      >
        <circle
          cx="60" cy="60" r={r}
          stroke="var(--rule)" strokeWidth="2.6"
          strokeDasharray="1.5 6" strokeLinecap="round"
        />
        {arc > 0 && (
          <>
            <circle
              cx="60" cy="60" r={r}
              stroke={color} strokeWidth="5" strokeLinecap="round"
              strokeDasharray={fraction >= 1 ? undefined : `${arc} ${circ}`}
              transform="rotate(-90 60 60)"
            />
            <circle
              cx="60" cy="60" r={r}
              stroke={color} strokeWidth="2" strokeLinecap="round"
              strokeDasharray={`${Math.max(4, arc - 6)} ${circ}`}
              opacity=".5"
              transform="rotate(-87 60 60)"
            />
          </>
        )}
      </svg>
      <div className="relative flex flex-col items-center">{children}</div>
    </div>
  );
}

/** Small ring row variant for headers. */
export function MiniRing({ section, fraction }: { section: Section; fraction: number | null }) {
  return <Ring section={section} fraction={fraction} size={46} />;
}

export function sectionIcon(section: Section) {
  return <Icon name={section} />;
}
