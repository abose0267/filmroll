/* FilmRoll push notifications. Registered at <base>/fcm/ scope, separate from the app-shell
   service worker. Messages are data-only; this worker shows them and opens the link on tap. */
const BASE = self.registration.scope.replace(/fcm\/$/, '');

self.addEventListener('push', (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    msg = {};
  }
  const d = msg.data || msg;
  const link = String(d.link || '/').replace(/^\//, '');
  event.waitUntil(
    self.registration.showNotification(d.title || 'FilmRoll', {
      body: d.body || '',
      icon: BASE + 'icons/icon-192.png',
      badge: BASE + 'icons/icon-192.png',
      tag: d.tag || undefined,
      data: { url: BASE + link },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || BASE;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(BASE) && 'focus' in c) {
          if ('navigate' in c) c.navigate(url).catch(() => undefined);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
