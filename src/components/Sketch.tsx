import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The sketch treatment from Atlas Sketchbook Atoms.
 *
 * The sheet gets its hand-drawn edges from an SVG turbulence filter
 * displacing an ordinary rounded rect — not from a drawing library. That's
 * reproduced verbatim here: same baseFrequency, octaves and seeds, so a card
 * in the app and a card on the sheet wobble identically.
 *
 * Rough.js is still used for the chart, where the line is generated rather
 * than filtered.
 */

/** Turbulence filters, mounted once at the app root. */
export function SketchDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true">
      <defs>
        {/* Cards. */}
        <filter
          id="rough"
          x="-8%"
          y="-8%"
          width="116%"
          height="116%"
          filterUnits="objectBoundingBox"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.028"
            numOctaves="3"
            seed="7"
            result="n"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="n"
            scale="2"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
        {/* Chart work and inputs. */}
        <filter
          id="rough2"
          x="-8%"
          y="-8%"
          width="116%"
          height="116%"
          filterUnits="objectBoundingBox"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.041"
            numOctaves="3"
            seed="23"
            result="n"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="n"
            scale="2"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
        {/* Icons and small marks. */}
        <filter
          id="roughSoft"
          x="-10%"
          y="-10%"
          width="120%"
          height="120%"
          filterUnits="objectBoundingBox"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.05"
            numOctaves="2"
            seed="41"
            result="n"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="n"
            scale="1.3"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );
}

interface SketchBorderProps {
  filter?: 'rough' | 'rough2';
  radius?: number;
  stroke?: string;
  strokeWidth?: number;
  dashed?: boolean;
}

/**
 * The border itself: an absolutely positioned filtered rect. Sized with CSS
 * geometry properties against the border box, so it never affects layout and
 * never needs measuring.
 */
export function SketchBorder({
  filter = 'rough',
  radius = 6,
  stroke = 'var(--ink)',
  strokeWidth = 2.4,
  dashed = false,
}: SketchBorderProps) {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <rect
        style={{
          x: '2px',
          y: '2px',
          width: 'calc(100% - 4px)',
          height: 'calc(100% - 4px)',
        }}
        rx={radius}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={dashed ? '7 5' : undefined}
        filter={`url(#${filter})`}
      />
    </svg>
  );
}

interface SketchCardProps extends SketchBorderProps {
  children: ReactNode;
  className?: string;
}

/**
 * The core container: paper fill, 2.4px ink border, radius 6, lifted off the
 * desk by a hard 3px/4px shadow.
 */
export function SketchCard({
  children,
  className = '',
  ...border
}: SketchCardProps) {
  return (
    <div
      className={`lift relative bg-[var(--paper)] ${className}`}
      style={{ borderRadius: border.radius ?? 6 }}
    >
      <SketchBorder {...border} />
      <div className="relative">{children}</div>
    </div>
  );
}

/** The dashed pencil rule that separates blocks on the sheet. */
export function DashedRule({ className = '' }: { className?: string }) {
  return (
    <div
      className={`w-full border-t-[1.5px] border-dashed border-[var(--rule)] ${className}`}
      aria-hidden="true"
    />
  );
}

/**
 * Measures an element's width. Rough.js draws to fixed pixel geometry, so the
 * chart has to be redrawn whenever its box changes.
 */
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  return { ref, width };
}
