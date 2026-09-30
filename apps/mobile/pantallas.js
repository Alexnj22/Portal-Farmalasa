import { router } from 'expo-router';

// Qué pantallas del portal ya son NATIVAS en la app, por su ruta del portal.
// Las demás se abren como el portal dentro de la app, con la misma sesión
// (estrategia mixta, decisión del usuario del 2026-09-28): todas abren desde
// el primer día y cada pantalla nativa que se agrega acá reemplaza a la web.
// El orden sale de cuánta gente distinta usa cada una (bitácora de acciones,
// 30 días al 2026-09-28): bitácoras 34, traslados 36, efectivo 34, pedidos 23.
export const PANTALLAS_DE_LA_APP = {
  '/bitacoras': true,
  '/traslados': true,
  '/ventas-hoy': true,   // no existe en el portal: es la pantalla nativa de «Ventas de hoy»
  '/solicitudes': true,
  '/facturas-sala': true,
  // Los dos ámbitos del portal son una sola bandeja en la app.
  '/solicitudes-personales': '/solicitudes',
};

// La pantalla nativa de una ruta del portal: la misma ruta, otra, o ninguna.
const nativaDe = (ruta) => {
  const v = PANTALLAS_DE_LA_APP[ruta];
  return v === true ? ruta : (v || null);
};

// Abrir un módulo del menú: su pantalla nativa si ya la tiene, o el portal
// dentro de la app si todavía no.
export function abrirModulo(m) {
  router.push(nativaDe(m.path) ?? { pathname: '/portal', params: { ruta: m.path, nombre: m.label } });
}

// Abrir una dirección del portal (la de un aviso, con su `?solicitud=…`): la
// pantalla nativa si la ruta ya la tiene, si no el portal en esa dirección
// exacta, que ya sabe abrir la solicitud que nombra.
export function abrirRuta(url) {
  const ruta = '/' + (url.split(/[?#]/)[0].split('/')[1] || '');
  // `/solicitudes?solicitud=…` nombra UNA: se abre ésa, no la bandeja.
  const una = ruta.startsWith('/solicitudes') ? url.match(/[?&]solicitud=([^&#]+)/) : null;
  if (una) return abrirSolicitud(decodeURIComponent(una[1]));
  // La pantalla nativa recibe la misma dirección con sus parámetros
  // (`/ventas-hoy?sala=3` abre esa sala).
  const nativa = nativaDe(ruta);
  router.push(nativa ? nativa + url.slice(ruta.length) : { pathname: '/portal', params: { ruta: url } });
}

// Una solicitud nombrada por un aviso: la pantalla nativa donde se decide.
export function abrirSolicitud(id) {
  router.push({ pathname: '/solicitud/[id]', params: { id: String(id) } });
}
