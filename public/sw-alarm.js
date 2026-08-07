/* eslint-disable no-undef */
/**
 * Rest-timer notifications, inside the service worker.
 *
 * Imported into the generated Workbox worker (see vite.config.ts). Lives in
 * public/ rather than src/ because it has to be a standalone script the
 * worker can importScripts() — it is never bundled.
 *
 * The point of scheduling from here rather than from the page is that the
 * page will very likely be backgrounded — or the screen locked — by the time
 * a three-minute rest is up, and a backgrounded page cannot reliably run
 * anything. Three mechanisms are tried, best first:
 *
 *   1. Notification Triggers (showTrigger/TimestampTrigger). A genuine
 *      hand-off to the OS: fires whatever happens to the page or the worker.
 *      Chromium only — Safari has never shipped it, so it does nothing on
 *      the iPhone this app is actually used on.
 *
 *   2. setTimeout in the worker, with the firing promise handed to
 *      waitUntil so the browser is asked to keep the worker alive until the
 *      deadline. Best-effort: iOS terminates idle workers aggressively, so
 *      this wins for short rests and often loses for long ones.
 *
 *   3. Failing both, the page fires the notification itself the moment it
 *      next becomes visible (see src/notify.ts). Guaranteed, but only when
 *      you're looking at the phone.
 *
 * All three use the same notification tag, so if more than one lands the
 * later ones replace the first rather than stacking up.
 */

const scheduled = new Map();

function clearScheduled(tag) {
  const handle = scheduled.get(tag);
  if (handle !== undefined) {
    clearTimeout(handle);
    scheduled.delete(tag);
  }
}

function notificationOptions(body, tag) {
  return {
    body,
    tag,
    renotify: true,
    // Rest is over whether or not it's acknowledged; making this sticky
    // would just leave notifications to clear later.
    requireInteraction: false,
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    data: { atlas: 'rest' },
  };
}

function supportsTriggers() {
  return typeof Notification !== 'undefined' && 'showTrigger' in Notification.prototype;
}

self.addEventListener('message', (event) => {
  const data = event.data || {};

  if (data.type === 'ATLAS_SCHEDULE_REST') {
    const { tag, title, body, at } = data;
    clearScheduled(tag);
    const delay = at - Date.now();

    if (delay <= 0) {
      event.waitUntil(self.registration.showNotification(title, notificationOptions(body, tag)));
      return;
    }

    // 1. Hand it to the OS where that's possible.
    if (supportsTriggers()) {
      event.waitUntil(
        self.registration
          .showNotification(title, {
            ...notificationOptions(body, tag),
            showTrigger: new TimestampTrigger(at),
          })
          .catch(() => undefined),
      );
      return;
    }

    // 2. Otherwise hold the worker open and fire it ourselves.
    event.waitUntil(
      new Promise((resolve) => {
        const handle = setTimeout(() => {
          scheduled.delete(tag);
          self.registration
            .showNotification(title, notificationOptions(body, tag))
            .catch(() => undefined)
            .then(resolve, resolve);
        }, delay);
        scheduled.set(tag, handle);
      }),
    );
    return;
  }

  if (data.type === 'ATLAS_CANCEL_REST') {
    const { tag } = data;
    clearScheduled(tag);
    event.waitUntil(
      self.registration
        .getNotifications({ tag, includeTriggered: true })
        .then((list) => list.forEach((n) => n.close()))
        .catch(() => undefined),
    );
  }
});

/** Tapping the alarm should land back in the app, not open a second copy. */
self.addEventListener('notificationclick', (event) => {
  if (event.notification?.data?.atlas !== 'rest') return;
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if ('focus' in client) return client.focus();
        }
        return self.clients.openWindow ? self.clients.openWindow('.') : undefined;
      })
      .catch(() => undefined),
  );
});
