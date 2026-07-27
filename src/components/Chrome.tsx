import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { SketchBorder } from './Sketch';
import { useNav } from '../nav';

/** Header for pushed screens: back chevron + handwritten title. */
export function PushHeader({ title, right }: { title: string; right?: ReactNode }) {
  const nav = useNav();
  return (
    <header className="flex items-center gap-2 pb-4">
      <button
        onClick={() => nav.pop()}
        aria-label="Back"
        className="-ml-2 flex h-12 w-12 shrink-0 items-center justify-center"
      >
        <Icon name="back" size={24} strokeWidth={2.6} />
      </button>
      <h1 className="hand flex-1 truncate text-[34px]">{title}</h1>
      {right}
    </header>
  );
}

/** Section screen header: handwritten name + margin annotation. */
export function TabHeader({ title, annot }: { title: string; annot?: string }) {
  return (
    <header className="flex items-baseline justify-between gap-3">
      <h1 className="hand text-[40px]">{title}</h1>
      {annot && <span className="annot shrink-0">{annot}</span>}
    </header>
  );
}

interface NumberFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  unit?: string;
  placeholder?: string;
  /** Decimal keypad by default. */
  integer?: boolean;
  autoFocus?: boolean;
  optional?: boolean;
}

/**
 * Numeric input in the sheet's field: 56px, radius 4, wobble 2.2, accent
 * border while focused. Text inputs use inputMode so iOS opens the number
 * pad without the quirks of type=number.
 */
export function NumberField({
  label,
  value,
  onChange,
  unit,
  placeholder = '0',
  integer = false,
  autoFocus = false,
  optional = false,
}: NumberFieldProps) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="hand text-[21px] text-[var(--ink-muted)]">
        {label}
        {optional && <span className="caption ml-2 font-normal">optional</span>}
      </span>
      <div className="relative flex h-[56px] items-center gap-2 bg-[var(--paper)] px-4 [--field-stroke:var(--ink)] focus-within:[--field-stroke:var(--accent)]">
        <SketchBorder filter="rough2" radius={4} strokeWidth={2.2} stroke="var(--field-stroke)" />
        <input
          type="text"
          inputMode={integer ? 'numeric' : 'decimal'}
          value={value}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value.replace(',', '.'))}
          className="tnum relative w-full bg-transparent text-[22px] font-semibold outline-none placeholder:text-[var(--ink-faint)]"
        />
        {unit && (
          <span className="relative shrink-0 text-[15px] font-medium text-[var(--ink-muted)]">
            {unit}
          </span>
        )}
      </div>
    </label>
  );
}

export function parseNum(v: string): number | null {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/** Yes/no toggle from the sheet — filled ink when on. */
export function YesNo({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex h-[52px] overflow-hidden rounded-[5px]">
      {([true, false] as const).map((v) => {
        const on = value === v;
        return (
          <button
            key={String(v)}
            onClick={() => onChange(v)}
            className="relative flex w-[76px] items-center justify-center font-semibold"
            style={
              on
                ? { background: 'var(--btn-fill)', color: 'var(--btn-text)' }
                : { color: 'var(--ink-muted)' }
            }
          >
            {!on && <SketchBorder filter="rough2" radius={5} strokeWidth={2.2} />}
            <span className="relative">{v ? 'Yes' : 'No'}</span>
          </button>
        );
      })}
    </div>
  );
}
