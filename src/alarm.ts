/**
 * The rest-timer alarm: sound and vibration.
 *
 * Everything is synthesised with Web Audio rather than shipped as an audio
 * file. A gym is loud and phones are in pockets, so the tones are built to
 * cut through — hard attacks, upper harmonics, and repetition — and being
 * generated means no asset to precache and no decode latency at the moment
 * it has to fire.
 *
 * iOS will not let audio start without a user gesture, and suspends the
 * AudioContext whenever the app is backgrounded. Both are handled here:
 * unlockAudio() is called from the first tap of a session, and the context
 * is resumed again every time the app comes back to the foreground. What
 * this cannot do is play a sound while the app is in the background — no
 * web API can, on iOS. That's what the notification is for.
 */

export type ToneId = 'bell' | 'beeps' | 'rise';

export const TONES: { id: ToneId; label: string; hint: string }[] = [
  { id: 'bell', label: 'bell', hint: 'three struck notes, rings out' },
  { id: 'beeps', label: 'beeps', hint: 'urgent — cuts through headphones' },
  { id: 'rise', label: 'rise', hint: 'sweeping chirps, hard to mistake' },
];

export const DEFAULT_TONE: ToneId = 'bell';

/** Distinct enough not to read as a notification buzz from another app. */
export const VIBRATE_PATTERN = [300, 120, 300, 120, 500];

let ctx: AudioContext | null = null;

type AudioCtor = typeof AudioContext;

function audioCtor(): AudioCtor | null {
  if (typeof window === 'undefined') return null;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext ??
    null
  );
}

/** Created lazily — constructing one before a gesture just yields a
 * suspended context, and on some browsers logs a warning. */
function getCtx(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = audioCtor();
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Satisfy iOS's gesture requirement. Call from a real user gesture — the
 * first tap of a session — long before the alarm needs to sound, so that
 * when the timer finishes there is nothing left to authorise.
 *
 * Resuming alone isn't enough on older iOS: a buffer has to actually play
 * inside the gesture for the context to be considered unlocked, hence the
 * one-sample silent source.
 */
export function unlockAudio(): void {
  const c = getCtx();
  if (!c) return;
  void c.resume().catch(() => undefined);
  try {
    const source = c.createBufferSource();
    source.buffer = c.createBuffer(1, 1, 22050);
    source.connect(c.destination);
    source.start(0);
  } catch {
    /* Nothing to do — playAlarm degrades to silence and the rest of the
       alert (vibration, notification, the bar itself) still fires. */
  }
}

/** iOS suspends the context in the background; bring it back on return. */
export function resumeAudio(): void {
  if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
}

// ── Tone construction ─────────────────────────────────────────────────────

interface Voice {
  type: OscillatorType;
  /** Seconds from the start of the alarm. */
  at: number;
  duration: number;
  freq: number;
  /** Sweeps to this frequency across the voice's duration when set. */
  toFreq?: number;
  gain: number;
}

/** A struck bell: a fundamental plus two inharmonic partials, each decaying
 * at its own rate, which is what stops it sounding like a plain sine beep. */
function strike(at: number, freq: number, gain: number): Voice[] {
  return [
    { type: 'sine', at, duration: 1.1, freq, gain },
    { type: 'sine', at, duration: 0.7, freq: freq * 2.02, gain: gain * 0.55 },
    { type: 'sine', at, duration: 0.4, freq: freq * 3.01, gain: gain * 0.3 },
  ];
}

function voicesFor(tone: ToneId): Voice[] {
  switch (tone) {
    case 'beeps': {
      // Three short square blasts, a beat's rest, then three more. Square
      // waves carry odd harmonics all the way up, which is what survives
      // being muffled by a pocket.
      const out: Voice[] = [];
      [0, 0.7].forEach((group) => {
        [0, 0.17, 0.34].forEach((offset) => {
          out.push({
            type: 'square',
            at: group + offset,
            duration: 0.11,
            freq: 1046,
            gain: 0.22,
          });
        });
      });
      return out;
    }
    case 'rise': {
      // Five rising chirps. A moving pitch reads as deliberate in a way a
      // steady tone doesn't, so it isn't mistaken for gym equipment.
      return [0, 0.34, 0.68, 1.02, 1.36].map((at) => ({
        type: 'sawtooth' as OscillatorType,
        at,
        duration: 0.26,
        freq: 420,
        toFreq: 1250,
        gain: 0.16,
      }));
    }
    case 'bell':
    default:
      return [...strike(0, 880, 0.3), ...strike(0.62, 880, 0.26), ...strike(1.24, 1174, 0.3)];
  }
}

/** Roughly how long each tone runs, for the test button's busy state. */
export const ALARM_MS = 2400;

/**
 * Play the alarm. Returns a stop function so a test preview can be cut off
 * and so dismissing the timer silences it immediately.
 *
 * Silently does nothing when there is no AudioContext or it never got
 * unlocked — the caller has already fired vibration and a notification, and
 * a thrown error here would take those down with it.
 */
export function playAlarm(tone: ToneId = DEFAULT_TONE): () => void {
  const c = getCtx();
  if (!c) return () => undefined;
  void c.resume().catch(() => undefined);

  const master = c.createGain();
  master.gain.value = 1;
  master.connect(c.destination);

  const t0 = c.currentTime + 0.02;
  const nodes: OscillatorNode[] = [];

  for (const v of voicesFor(tone)) {
    try {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = v.type;
      osc.frequency.setValueAtTime(v.freq, t0 + v.at);
      if (v.toFreq !== undefined) {
        osc.frequency.exponentialRampToValueAtTime(v.toFreq, t0 + v.at + v.duration);
      }
      // Fast attack, exponential decay — a struck sound, not a fade-in.
      gain.gain.setValueAtTime(0.0001, t0 + v.at);
      gain.gain.exponentialRampToValueAtTime(v.gain, t0 + v.at + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + v.at + v.duration);
      osc.connect(gain);
      gain.connect(master);
      osc.start(t0 + v.at);
      osc.stop(t0 + v.at + v.duration + 0.02);
      nodes.push(osc);
    } catch {
      /* Skip this voice; the rest of the tone still plays. */
    }
  }

  return () => {
    for (const osc of nodes) {
      try {
        osc.stop();
      } catch {
        /* Already stopped. */
      }
    }
    try {
      master.disconnect();
    } catch {
      /* Already disconnected. */
    }
  };
}

export function vibrate(pattern: number[] = VIBRATE_PATTERN): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* Unsupported (all of iOS Safari today) — the other channels cover it. */
  }
}
