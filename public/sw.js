/* Service Worker — Web Push + minimal offline fallback for Farmalasa Portal */

// Bloque 5.5: solo cachea la página estática de "sin conexión" (y su ícono),
// NUNCA index.html/JS/CSS del build — evitar el riesgo clásico de PWA de
// servir un bundle viejo tras un deploy (ver la nota de vite:preloadError en
// src/main.jsx, ya existía un problema real de chunks stale sin esto).
// Bump este nombre solo si offline.html cambia de forma que requiera
// invalidar la caché vieja.
const OFFLINE_CACHE = 'farmalasa-offline-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(OFFLINE_CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL, '/Logo192.png']))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((n) => n !== OFFLINE_CACHE).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

// Solo intercepta navegaciones (carga de página completa) y el logo que usa
// la propia pantalla de offline — todo lo demás (JS, CSS, API de Supabase,
// resto de imágenes) sigue yendo directo a la red, sin pasar por el service
// worker, exactamente como antes de este cambio.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  if (url.pathname === '/Logo192.png') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/Logo192.png'))
    );
  }
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { payload = { title: 'Farmalasa', body: event.data.text() }; }

  const { title = 'Farmalasa', body = '', url = '/my-announcements', tag, urgent } = payload;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // If any window is focused the in-app toast already handles it — skip OS notification
      const appFocused = list.some(c => c.focused);
      if (appFocused) return;

      return self.registration.showNotification(title, {
        body,
        icon: '/Logo192.png',
        badge: '/Logo192.png',
        tag: tag || 'farmalasa-notif',
        data: { url },
        vibrate: urgent ? [200, 100, 200] : [100],
        requireInteraction: !!urgent,
      });
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/my-announcements';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return clients.openWindow(target);
    })
  );
});
