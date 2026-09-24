// Sanktuary service worker: shows push notifications and opens the site when one is tapped, and receives
// "Share to Sanktuary" from the phone's share menu. It never caches or changes how pages load: the only
// request it touches is the share (POST /share-target), whose files it keeps in the "sk-share" cache until
// the Share window has put them somewhere.
const SHARE_CACHE = 'sk-share';
self.addEventListener('install', () => self.skipWaiting()); // a new version takes over now, so sharing works on the first try
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.origin !== self.location.origin || url.pathname !== '/share-target') return;
  event.respondWith(
    (async () => {
      const form = await event.request.formData();
      await caches.delete(SHARE_CACHE); // one share at a time: a new one replaces one that was never put anywhere
      const cache = await caches.open(SHARE_CACHE);
      let n = 0;
      for (const f of form.getAll('files'))
        if (typeof f !== 'string' && n < 50)
          await cache.put(
            `/shared/${n++}`,
            new Response(f, { headers: { 'content-type': f.type || 'application/octet-stream', 'x-name': encodeURIComponent(f.name || `shared-${n}`) } }),
          );
      const text = ['title', 'text', 'url'].map((k) => form.get(k)).filter((v) => typeof v === 'string' && v.trim()).join('\n');
      if (text) await cache.put('/shared/text', new Response(text.slice(0, 4000)));
      return Response.redirect(new URL('/?share=1', self.location.origin).href, 303);
    })(),
  );
});

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
