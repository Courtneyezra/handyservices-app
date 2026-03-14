// Service worker for PWA installability + Web Push notifications

const CACHE_NAME = 'switchboard-v2';
const PRECACHE_URLS = ['/admin/live-call'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Network-first strategy — always try live, fall back to cache
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
  }
});

// Web Push — show notification when server sends a push message
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'V6 Switchboard';
  const options = {
    body: data.body || 'New notification',
    icon: '/logo.png',
    badge: '/logo.png',
    tag: 'inbox-notification',
    renotify: true,
    data: { url: data.url || '/admin/follow-ups' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Tap notification → focus or open the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/admin/follow-ups';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes('/admin') && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
