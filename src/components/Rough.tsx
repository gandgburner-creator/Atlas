import { useEffect, useRef, useState, type ReactNode } from 'react';
import rough from 'roughjs';
import { inkFaint, paperEdge, roughDefaults } from '../design/tokens';

/**
 * Measures an element and re-reports its width. Rough.js draws to fixed
 * pixel geometry, so anything hand-drawn has to be redrawn when the box
 * resizes (rotation, keyboard, iPad split view).
 */
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  return { ref, width };
}

interface RoughBoxProps {
  children: ReactNode;
  className?: string;
  /** Distinct seeds keep two adjacent boxes from looking stamped. */
  seed?: number;
  stroke?: string;
  fill?: string;
}

/**
 * A hand-drawn rectangle behind arbitrary content. The border is an
 * absolutely positioned SVG rather than a CSS border so the wobble sits
 * outside the content box and never shifts the layout.
 */
export function RoughBox({
  children,
  className = '',
  seed = roughDefaults.seed,
  stroke = inkFaint,
  fill,
}: RoughBoxProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    // offsetWidth/Height, not contentRect: the SVG is positioned inset-0 of
    // the border box, so measuring the content box would draw the frame
    // inside the padding and let content spill over the line.
    const measure = () =>
      setSize({ w: el.offsetWidth, h: el.offsetHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || size.w < 4 || size.h < 4) return;
    svg.replaceChildren();
    const rc = rough.svg(svg);
    // Inset by 2px: the roughness overshoots the path and would clip.
    svg.appendChild(
      rc.rectangle(2, 2, size.w - 4, size.h - 4, {
        ...roughDefaults,
        seed,
        stroke,
        strokeWidth: 1.4,
        fill,
        fillStyle: 'solid',
      }),
    );
  }, [size.w, size.h, seed, stroke, fill]);

  return (
    <div ref={hostRef} className={`relative ${className}`}>
      <svg
        ref={svgRef}
        className="pointer-events-none absolute inset-0 h-full w-full"
        width={size.w}
        height={size.h}
        aria-hidden="true"
      />
      <div className="relative">{children}</div>
    </div>
  );
}

interface RoughUnderlineProps {
  className?: string;
  color?: string;
  seed?: number;
}

/** A single hand-drawn rule. Used instead of `border-b`. */
export function RoughUnderline({
  className = '',
  color = paperEdge,
  seed = 7,
}: RoughUnderlineProps) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || width < 4) return;
    svg.replaceChildren();
    const rc = rough.svg(svg);
    svg.appendChild(
      rc.line(1, 4, width - 1, 4, {
        ...roughDefaults,
        seed,
        stroke: color,
        strokeWidth: 1.4,
      }),
    );
  }, [width, color, seed]);

  return (
    <div ref={ref} className={`w-full ${className}`} aria-hidden="true">
      <svg ref={svgRef} width={width} height={8} className="block" />
    </div>
  );
}
