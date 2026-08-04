/**
 * Rest-timer notifications, page side.
 *
 * Permission is requested on the FIRST rest timer, never on launch — asking
 * before the app has done anything is how you get denied, and a denial is
 * permanent until the user digs through OS settings.
 *
 * See public/sw-alarm.js for what happens in the worker and why scheduling
 * ahead is only partly achievable on iOS.
 */

export type NotifyPermission = 'unsupported' | 'default' | 'granted' | 'denied';

/** Shared by page and worker so duplicates replace rather than stack. */
export const REST_TAG = 'atlas-rest';

export function notifyPermission(): NotifyPermission {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission as NotifyPermission;
}

/**
 * Trigger the system prompt. Only meaningful from 'default' — once denied,
 * the browser refuses to ask again and the user has to re-enable it from OS
 * settings, which is what the Settings screen explains.
 */
export async function requestNotifyPermission(): Promise<NotifyPermission> {
  if (typeof Notification === 'undefined') return 'unsupported';
  try {
    return (await Notification.requestPermission()) as NotifyPermission;
  } catch {
    return notifyPermission();
  }
}

async function worker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

/**
 * Ask the worker to deliver "rest is over" at `at`, set up the moment the
 * timer starts rather than when it finishes — by then the app may well be
 * backgrounded and unable to do anything at all.
 */
export async function scheduleRestNotification(
  exercise: string,
  at: number,
): Promise<void> {
  if (notifyPermission() !== 'granted') return;
  const reg = await worker();
  reg?.active?.postMessage({
    type: 'ATLAS_SCHEDULE_REST',
    tag: REST_TAG,
    title: `${exercise} — rest is over`,
    body: 'Next set.',
    at,
  });
}

/** Skipping or clearing the timer retracts the pending alarm, and closes it
 * if it already landed. */
export async function cancelRestNotification(): Promise<void> {
  const reg = await worker();
  reg?.active?.postMessage({ type: 'ATLAS_CANCEL_REST', tag: REST_TAG });
  try {
    const shown = await reg?.getNotifications({ tag: REST_TAG });
    shown?.forEach((n) => n.close());
  } catch {
    /* Nothing showing, or unsupported. */
  }
}

/**
 * Fire the notification from the page, for when the scheduled one couldn't
 * be relied on — the worker was terminated, or triggers aren't supported.
 * Shares the tag with the scheduled one, so whichever arrives second simply
 * replaces the first instead of buzzing twice.
 */
export async function showRestNotificationNow(exercise: string): Promise<void> {
  if (notifyPermission() !== 'granted') return;
  const reg = await worker();
  const title = `${exercise} — rest is over`;
  const options: NotificationOptions = {
    body: 'Next set.',
    tag: REST_TAG,
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    data: { atlas: 'rest' },
  };
  if (reg) {
    try {
      await reg.showNotification(title, options);
      return;
    } catch {
      /* Fall through to the constructor. */
    }
  }
  try {
    // iOS doesn't support the constructor at all; the registration path
    // above is the one that works there, so this is a desktop fallback.
    new Notification(title, options);
  } catch {
    /* Sound, vibration and the bar itself still fired. */
  }
}
