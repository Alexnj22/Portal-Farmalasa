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
};

// Abrir un módulo del menú: su pantalla nativa si ya la tiene, o el portal
// dentro de la app si todavía no.
export function abrirModulo(m) {
  router.push(PANTALLAS_DE_LA_APP[m.path] ? m.path : { pathname: '/portal', params: { ruta: m.path, nombre: m.label } });
}

// Abrir una dirección del portal (la de un aviso, con su `?solicitud=…`): la
// pantalla nativa si la ruta ya la tiene, si no el portal en esa dirección
// exacta, que ya sabe abrir la solicitud que nombra.
export function abrirRuta(url) {
  const ruta = '/' + (url.split(/[?#]/)[0].split('/')[1] || '');
  router.push(PANTALLAS_DE_LA_APP[ruta] ? ruta : { pathname: '/portal', params: { ruta: url } });
}

// Una solicitud nombrada por un aviso: la pantalla nativa donde se decide.
export function abrirSolicitud(id) {
  router.push({ pathname: '/solicitud/[id]', params: { id: String(id) } });
}
