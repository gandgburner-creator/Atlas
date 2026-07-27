/**
 * The icon set from the Atlas Asset Library, section 03 — hand-drawn 24×24
 * strokes, 2.4px, run through the roughSoft filter. Paths are transcribed
 * verbatim from the sheet.
 */

const PATHS: Record<string, string[]> = {
  body: [
    'M12 2.8a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6z',
    'M7.4 21c-.4-4.2.2-7.4 1.7-8.8-1.7.4-3.1 1.4-4.2 2.9.5-3.6 3.1-6 7.1-6s6.6 2.4 7.1 6c-1.1-1.5-2.5-2.5-4.2-2.9 1.5 1.4 2.1 4.6 1.7 8.8',
  ],
  work: [
    'M12.6 11.4a1.7 1.7 0 1 1 1.6 1.9 3.7 3.7 0 0 1-3.9-3.6 5.6 5.6 0 0 1 5.9-5.1',
    'M16.4 3.9a8.2 8.2 0 1 1-11.6 9',
  ],
  craft: [
    'M6.6 17.6 3.6 21',
    'M6.6 17.6 12 3.4l5.4 14.2-5.4 2.7-5.4-2.7z',
    'M12 9.4v7',
  ],
  life: [
    'M12 21v-7.6',
    'M12 13.4c0-3.6 2.5-6.1 6.3-6.3-.2 3.8-2.7 6.3-6.3 6.3z',
    'M12 15.6c-3.1 0-5.2-2.1-5.4-5.2 3.1.2 5.2 2.3 5.4 5.2z',
  ],
  sleep: ['M17.6 3.4a9 9 0 1 0 3.4 12.3 7.3 7.3 0 0 1-3.4-12.3z'],
  lift: ['M2.6 12h2.2M19.2 12h2.2M6.6 7.6v8.8M17.4 7.6v8.8M6.6 12h10.8'],
  food: [
    'M12 3.6a8.4 8.4 0 1 0 .1 16.8A8.4 8.4 0 0 0 12 3.6z',
    'M7.8 14.2c2.4-2.8 5.6-2.8 8 0',
    'M9.4 9.2c1.6-1 3.4-1 5 0',
  ],
  focus: [
    'M12 21.2a7.7 7.7 0 1 0 0-15.4 7.7 7.7 0 0 0 0 15.4z',
    'M12 9.6v4l2.4 2',
    'M9.6 2.8h4.8M12 2.8v3M18.8 6.2l1.6-1.6',
  ],
  photo: [
    'M3.6 8.6h3.6L9 5.8h6l1.8 2.8h3.6v10.6H3.6z',
    'M12 16.8a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2z',
  ],
  weigh: [
    'M4.2 5.4h15.6v13.2H4.2z',
    'M8 10.6a5.6 5.6 0 0 1 8 0',
    'M12 10.8l1.9 3.4',
  ],
  call: [
    'M5.6 3.4 8.4 4l1.3 3.6-1.9 1.7a11.6 11.6 0 0 0 5.9 5.9l1.7-1.9 3.6 1.3.6 2.8a2.1 2.1 0 0 1-2.3 2.3A16.3 16.3 0 0 1 3.3 5.7a2.1 2.1 0 0 1 2.3-2.3z',
  ],
  board: [
    'M3.4 4.6h17.2v14.8H3.4z',
    'M9.1 4.6v14.8M14.9 4.6v14.8',
    'M5.3 8.2h1.9M11 8.2h2M16.7 8.2h1.9M5.3 11.6h1.9M11 11.6h2',
  ],
  settings: [
    'M3.4 6.8h8.2M15.6 6.8h5M3.4 12h3.8M11.2 12h9.4M3.4 17.2h10.2M17.6 17.2h3',
    'M13.6 4.4v4.8M9.2 9.6v4.8M15.6 14.8v4.8',
  ],
  check: ['M4.5 12.8 9.6 18 20 6.4'],
  back: ['M14.5 4.5 7 12l7.5 7.5'],
  // Not on the sheet: a home mark for the Today tab, drawn in the same
  // 2.4px hand as the rest of the set.
  home: ['M4 11.2 12 3.6l8 7.6', 'M6.2 9.6V20h11.6V9.6', 'M10 20v-6h4v6'],
};

export type IconName = keyof typeof PATHS & string;

interface Props {
  name: IconName;
  size?: number;
  stroke?: string;
  strokeWidth?: number;
  className?: string;
}

export function Icon({
  name,
  size = 24,
  stroke = 'currentColor',
  strokeWidth = 2.4,
  className,
}: Props) {
  const paths = PATHS[name] ?? [];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      filter="url(#roughSoft)"
      className={className}
      aria-hidden="true"
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
