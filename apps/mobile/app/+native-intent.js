// Un enlace del portal abierto en el teléfono (2026-11-18). En Android la app
// abre TODO `portal.farmasalud.lat` (el filtro va en el binario: ampliarlo
// después exigiría otra compilación); en iPhone, lo que liste el
// `apple-app-site-association` del portal, que se cambia sin compilar.
// Cada dirección va a su pantalla nativa o, si todavía no la tiene, al portal
// dentro de la app en esa misma dirección (`destinoDeRuta`, lo mismo que abre
// un aviso). `/foto/…` y la raíz conservan su ruta propia. Lo que no es del
// portal (el esquema de la app, otro dominio) pasa tal cual.
//
// Sin `URL`: en React Native `hostname` no siempre está implementado.
import { destinoComoTexto, destinoDeRuta } from '../pantallas';

const PORTAL = /^https?:\/\/portal\.farmasalud\.lat(?::\d+)?(\/[^]*)?$/i;

export function redirectSystemPath({ path }) {
  try {
    const m = typeof path === 'string' ? path.match(PORTAL) : null;
    if (!m) return path;
    const dir = m[1] || '/';
    const camino = dir.split(/[?#]/)[0];
    if (camino === '/' || camino === '') return '/';
    if (camino.startsWith('/foto/')) return dir;
    return destinoComoTexto(destinoDeRuta(dir));
  } catch {
    return path;
  }
}
