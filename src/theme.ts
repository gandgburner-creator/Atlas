/**
 * Light / dark / follow the phone. Stored per device (a phone's screen
 * preference isn't data worth syncing) and applied as a data-theme attribute
 * on <html>, which the stylesheet reads. 'auto' removes the attribute so the
 * system setting decides, exactly as before.
 */
export type ThemeChoice = 'auto' | 'light' | 'dark';

const KEY = 'atlas.theme';

export function getTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

/** Whether the screen is dark right now, whichever way that was decided. */
export function isNight(): boolean {
  const t = getTheme();
  if (t !== 'auto') return t === 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyTheme(t: ThemeChoice = getTheme()): void {
  const root = document.documentElement;
  if (t === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
  // Keep the phone's status bar in step with the page.
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = isNight() ? '#211b15' : '#ede5d6';
  document.head.appendChild(meta);
  window.dispatchEvent(new Event('atlas-theme'));
}

export function setTheme(t: ThemeChoice): void {
  try {
    if (t === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {
    /* private mode: applies for this visit only */
  }
  applyTheme(t);
}
