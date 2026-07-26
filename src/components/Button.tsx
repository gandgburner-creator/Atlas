import { useEffect, useRef, type ButtonHTMLAttributes } from 'react';
import rough from 'roughjs';
import { actual, ink, paper, roughDefaults } from '../design/tokens';

type Variant = 'primary' | 'quiet';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  seed?: number;
}

/**
 * Hand-drawn button. 48px minimum height — this gets tapped half-awake, in
 * the dark, one-handed.
 */
export function Button({
  variant = 'primary',
  seed = 12,
  className = '',
  children,
  ...rest
}: Props) {
  const hostRef = useRef<HTMLButtonElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const svg = svgRef.current;
    if (!host || !svg) return;

    const draw = () => {
      const { width: w, height: h } = host.getBoundingClientRect();
      if (w < 4 || h < 4) return;
      svg.setAttribute('width', String(w));
      svg.setAttribute('height', String(h));
      svg.replaceChildren();
      const rc = rough.svg(svg);
      svg.appendChild(
        rc.rectangle(2, 2, w - 4, h - 4, {
          ...roughDefaults,
          seed,
          // Enough wobble to read as drawn, not so much that a small button
          // looks knocked askew.
          roughness: 0.9,
          bowing: 0.7,
          stroke: variant === 'primary' ? actual : ink,
          strokeWidth: variant === 'primary' ? 2 : 1.3,
          fill: variant === 'primary' ? actual : undefined,
          fillStyle: 'solid',
        }),
      );
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(host);
    return () => ro.disconnect();
  }, [variant, seed]);

  return (
    <button
      ref={hostRef}
      className={`relative min-h-12 px-5 py-3 font-medium transition-opacity active:opacity-60 disabled:opacity-35 ${className}`}
      style={{ color: variant === 'primary' ? paper : ink }}
      {...rest}
    >
      <svg
        ref={svgRef}
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
      />
      <span className="relative">{children}</span>
    </button>
  );
}
