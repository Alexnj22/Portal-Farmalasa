// Service worker de Puntos Salud en el navegador (app.farmasalud.lat, 2026-11-14).
//
// Sólo hace una cosa: mostrar los avisos que manda el servidor por Web Push
// (supabase/functions/_shared/pushClientes.ts) y, al tocarlos, abrir la app en
// la pantalla del aviso. No guarda nada en caché: la app se sirve siempre
// fresca (index.html sin caché, el resto con huella en el nombre).
//
// En el iPhone, Safari sólo entrega avisos a una app agregada a la pantalla
// de inicio (iOS 16.4 o más nuevo).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { cuerpo: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Puntos Salud', {
    body: d.cuerpo || '',
    icon: '/apple-touch-icon.png',
    badge: '/apple-touch-icon.png',
    tag: d.tipo || undefined,
    data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const abiertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of abiertas) {
      if (new URL(c.url).origin === self.location.origin) {
        await c.focus();
        if ('navigate' in c) await c.navigate(url).catch(() => {});
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
