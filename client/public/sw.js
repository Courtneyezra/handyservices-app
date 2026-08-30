// Service worker for PWA installability + Web Push notifications

const CACHE_NAME = 'switchboard-v5';
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
  const url = data.url || '/';
  const options = {
    body: data.body || 'New notification',
    // icon-512 is the square brand mark; logo.png is 940x788 and crops badly
    icon: '/icon-512.png',
    badge: '/icon-512.png',
    // Keep the notification on screen until dismissed/clicked (Chrome desktop;
    // ignored on iOS and on Android where notifications persist anyway).
    requireInteraction: true,
    // Unique tag per push so every notification stacks — same-tag replacement
    // silently swallows alerts on macOS (verified live: two same-url tests
    // collapsed and the second never alerted despite renotify). Call sites can
    // pass an explicit data.tag when they WANT dedup/replacement.
    tag: data.tag || `${url}#${Date.now()}`,
    renotify: true,
    data: { url },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Tap notification → navigate-or-open by exact target url
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  const targetUrl = new URL(url, self.location.origin);
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // 1) A window already on the target path → just focus it
      for (const client of windowClients) {
        const clientUrl = new URL(client.url);
        if (clientUrl.pathname === targetUrl.pathname && 'focus' in client) {
          return client.focus();
        }
      }
      // 2) Any same-origin window we can navigate → send it to the target
      for (const client of windowClients) {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin === self.location.origin && 'navigate' in client) {
          return client.navigate(targetUrl.href).then((navigated) =>
            navigated && 'focus' in navigated ? navigated.focus() : navigated
          );
        }
      }
      // 3) No usable window → open a new one
      return clients.openWindow(targetUrl.href);
    })
  );
});
