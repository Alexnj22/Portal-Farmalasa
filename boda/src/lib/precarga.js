import { lazy } from 'react';

/*
 * Las pantallas que se bajan aparte, en UN solo lugar: las usa el enrutador
 * (lazy) y las pestañas para precargarlas. Un import() dinámico se pide una
 * sola vez: precargar y después navegar no baja nada dos veces.
 */
export const CARGAS = {
  '/evento': () => import('../pages/app/Evento'),
  '/confirmar': () => import('../pages/app/Confirmar'),
  '/mensajes': () => import('../pages/app/Mensajes'),
  '/hoy': () => import('../pages/app/Hoy'),
  '/mas': () => import('../pages/app/Mas'),
  '/album': () => import('../pages/Album'),
  '/canciones': () => import('../pages/Canciones'),
  '/juego': () => import('../pages/juegos/Juegos'),
  '/juego/trivia': () => import('../pages/juegos/Trivia'),
  '/juego/bingo': () => import('../pages/juegos/Bingo'),
  '/juego/retos': () => import('../pages/juegos/Retos'),
  '/pantalla': () => import('../pages/Pantalla'),
  '/dj': () => import('../pages/Dj'),
  '/admin': () => import('../pages/admin/Admin'),
};

const componentes = {};
/** El componente perezoso de una ruta (siempre el mismo objeto). */
export function pantalla(ruta) {
  if (!componentes[ruta]) componentes[ruta] = lazy(CARGAS[ruta]);
  return componentes[ruta];
}

const pedidas = new Set();
/** Baja el código de una pestaña sin mostrarla (al pasar el dedo o el ratón, o en un rato libre). */
export function precargar(ruta) {
  const f = CARGAS[ruta];
  if (!f || pedidas.has(ruta)) return;
  pedidas.add(ruta);
  f().catch((e) => { pedidas.delete(ruta); console.warn('No se pudo precargar', ruta, e); });
}

/** Cuando el teléfono no esté haciendo nada. */
export function enRatoLibre(fn, plazo = 2500) {
  if (typeof window === 'undefined') return () => {};
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(fn, { timeout: plazo });
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 1200);
  return () => clearTimeout(id);
}
