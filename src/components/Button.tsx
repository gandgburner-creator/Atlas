import type { ButtonHTMLAttributes } from 'react';
import { SketchBorder } from './Sketch';

type Variant = 'primary' | 'secondary';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** Fills with the success colour and reads as done rather than actionable. */
  done?: boolean;
}

/**
 * Buttons, per the sheet: 52px tall, radius 5, hard offset shadow, and a
 * press that travels into its own shadow.
 *
 * Primary is a solid ink fill. Secondary is paper with a filtered ink border
 * and sinks to `paper sunk` when held.
 */
export function Button({
  variant = 'primary',
  done = false,
  className = '',
  children,
  ...rest
}: Props) {
  const base =
    'press relative flex min-h-[52px] items-center justify-center gap-2 px-6 text-base font-semibold transition-[transform,box-shadow,background] duration-75 disabled:pointer-events-none disabled:opacity-40';

  if (variant === 'primary') {
    return (
      <button
        className={`lift-btn rounded-[5px] ${base} ${className}`}
        style={{
          background: done ? 'var(--success)' : 'var(--btn-fill)',
          color: done ? 'var(--color-ink-on-dark)' : 'var(--btn-text)',
        }}
        {...rest}
      >
        {children}
      </button>
    );
  }

  return (
    <button
      className={`${base} bg-[var(--paper)] active:bg-[var(--sunk)] ${className}`}
      style={{ borderRadius: 5, color: 'var(--ink)' }}
      {...rest}
    >
      <SketchBorder radius={5} strokeWidth={2.4} />
      <span className="relative">{children}</span>
    </button>
  );
}
