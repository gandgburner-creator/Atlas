import { useId } from 'react';
import { SketchBorder } from './Sketch';

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  optional?: boolean;
  hint?: string;
  /** 'warn' colours the hint when it's flagging a likely typo. Still just a
   * hint — nothing is blocked and the field is never marked invalid. */
  hintTone?: 'warn';
  /** Native input type — 'time' or 'date'. */
  type?: 'time' | 'date';
}

/**
 * A native time/date input in a sketched field. Native on purpose: iOS gives
 * a wheel picker that's faster to nudge than anything custom, and it's
 * already in the user's locale and their muscle memory.
 *
 * Field height 56, radius 4, border 2.2 with the chart-weight wobble — the
 * sheet's input spec. The border turns accent while focused.
 */
export function TimeField({
  label,
  value,
  onChange,
  optional,
  hint,
  hintTone,
  type = 'time',
}: Props) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="hand text-[22px]">
        {label}
        {optional && (
          <span className="caption ml-2 font-normal">optional</span>
        )}
      </label>
      {/* Focus recolours the border via a variable the SVG stroke reads. */}
      <div className="relative flex h-[56px] items-center bg-[var(--paper)] px-4 [--field-stroke:var(--ink)] focus-within:[--field-stroke:var(--accent)]">
        <SketchBorder
          filter="rough2"
          radius={4}
          strokeWidth={2.2}
          stroke="var(--field-stroke)"
        />
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          // The picker renders in the device's clock format, so this reads
          // 08:52 on a 24h phone and 8:52 AM on a 12h one. That's the native
          // control following a system preference and is left alone; the
          // value is always stored and displayed elsewhere as 24h "HH:MM".
          className="tnum relative w-full bg-transparent text-[22px] font-semibold outline-none"
        />
      </div>
      {hint && (
        <p
          className="caption"
          style={hintTone === 'warn' ? { color: 'var(--accent)' } : undefined}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
