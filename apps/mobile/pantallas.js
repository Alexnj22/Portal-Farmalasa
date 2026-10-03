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
  '/pedidos': true,       // lo de la sala (llegada y conteo); Bodega abre el portal desde ahí
  '/clientes': true,      // la lista y la ficha (ver y editar); las fichas las da de alta el punto de venta
  '/minmax': '/minmax-producto', // la ficha de un producto en todas las salas; la revisión de la sala abre el portal
  '/caja': '/efectivo',     // Efectivo: hoy, y desde ahí cortes, diferencias y movimientos
  '/cortes': true,        // confirmar y descartar cortes (y entregar la caja) en el teléfono
  '/bolsas-sala': true,   // no existe en el portal: las bolsas de la sala (el widget); `/bolsas` sigue siendo el módulo completo
  '/monitor-ventas': true, // el «Monitor de ventas» del portal es un modal; en la app, su pantalla
  '/ventas': true,         // la lista de facturas con sus cifras; tocar una abre la venta
  '/cuentas-por-cobrar': true, // la cartera, la ficha de un crédito y el cobro
  '/mis-documentos': true, // el expediente propio y los papeles de las solicitudes
  '/mi-perfil': true,      // la ficha propia: datos, horario, vacaciones, historial y editar contacto
  '/inventario': true,     // lo de una sala producto por producto; tocar uno abre su ficha nativa
  '/personal': true,       // el directorio por sala; la ficha de una persona abre el portal
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
