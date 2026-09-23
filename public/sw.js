// Sanktuary service worker: shows push notifications and opens the site when one is tapped.
// It deliberately has no fetch handler, so it never caches or changes how pages load.
self.addEventListener('push', (event) => {
  const n = event.data ? event.data.json() : { title: 'Sanktuary', body: '' };
  event.waitUntil(
    self.registration.showNotification(n.title || 'Sanktuary', {
      body: n.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: n.tag, // a newer update about the same project replaces the older one
      data: { url: n.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const open = wins.find((w) => w.url.startsWith(self.location.origin) && !w.url.includes('/s/'));
      return open ? open.focus() : self.clients.openWindow(url);
    }),
  );
});
