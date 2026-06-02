/* Service Worker — Web Push for Farmalasa Portal */

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { payload = { title: 'Farmalasa', body: event.data.text() }; }

  const { title = 'Farmalasa', body = '', url = '/my-announcements', tag, urgent } = payload;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/Logo192.png',
      badge: '/Logo192.png',
      tag: tag || 'farmalasa-notif',
      data: { url },
      vibrate: urgent ? [200, 100, 200] : [100],
      requireInteraction: !!urgent,
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
