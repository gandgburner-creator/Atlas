import { useId } from 'react';
import { RoughUnderline } from './Rough';

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  optional?: boolean;
  hint?: string;
}

/**
 * A native time input. Native on purpose: iOS gives a wheel picker that's
 * faster to nudge than anything custom, and it's already in the user's
 * locale and their muscle memory.
 */
export function TimeField({ label, value, onChange, optional, hint }: Props) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="annot block">
        {label}
        {optional && <span className="ml-1 lowercase tracking-normal font-normal">— optional</span>}
      </label>
      <input
        id={id}
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="tnum mt-1 w-full bg-transparent py-2 text-3xl outline-none"
      />
      <RoughUnderline seed={label.length * 3} />
      {hint && <p className="mt-1 text-xs text-ink-soft">{hint}</p>}
    </div>
  );
}
