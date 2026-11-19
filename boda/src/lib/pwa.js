/*
 * El sitio instalable (vite-plugin-pwa). Cuando hay una versión nueva, NO se
 * recarga en la cara del invitado (podría estar escribiendo su confirmación):
 * se activa en la siguiente navegación entre pestañas, que es un momento en
 * que la pantalla cambia de todos modos.
 */
export function registrarServiceWorker(router) {
  if (import.meta.env.DEV || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  let hayNueva = false;
  let actualizar = null;
  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      actualizar = registerSW({
        onNeedRefresh() { hayNueva = true; },
        onRegisterError(e) { console.error('Service worker', e); },
      });
    })
    .catch((e) => console.error('No se pudo registrar el service worker', e));
  let antes = router.state.location.pathname;
  router.subscribe((estado) => {
    const ahora = estado.location.pathname;
    if (estado.navigation.state !== 'idle' || ahora === antes) return;
    antes = ahora;
    if (hayNueva && actualizar) { hayNueva = false; actualizar(true); }
  });
}
