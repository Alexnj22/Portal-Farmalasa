import { router } from 'expo-router';

// Qué pantallas del portal ya son NATIVAS en la app, por su ruta del portal.
// Las demás se abren como el portal dentro de la app, con la misma sesión
// (estrategia mixta, decisión del usuario del 2026-09-28): todas abren desde
// el primer día y cada pantalla nativa que se agrega acá reemplaza a la web.
// El orden sale de cuánta gente distinta usa cada una (bitácora de acciones,
// 30 días al 2026-09-28): bitácoras 34, traslados 36, efectivo 34, pedidos 23.
export const PANTALLAS_DE_LA_APP = {
  '/inicio': true,             // es la pestaña Inicio (los grupos de expo-router no cuentan en la ruta)
  '/mis-avisos': '/avisos',    // es la pestaña de avisos; OJO: `/avisos` del PORTAL es «Gestionar avisos», otra cosa
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
  '/avisos': '/gestionar-avisos', // OJO: la pestaña de la app `/avisos` son MIS avisos; esto es gestionarlos
  '/encuesta': true, // resultados del clima: índice, bloques, preguntas y comentarios
  '/nomina': true, // la quincena por sala y la boleta de cada persona; generar, aprobar e imprimir: portal
  '/auditoria-de-tiempos': true, // día por día: marcas, faltas, tardanza y señales; corregir y aprobar: portal
  '/monitor': true, // quién trabaja, está en pausa o no ha marcado, ahora; y quién llegó tarde
  '/promociones': true, // vigentes y su detalle con lo vendido por sala; crear, descuentos y pagos: portal
  '/cotizaciones': true, // la lista y el detalle con sus totales; crear, editar e imprimir: portal
  '/compras': true, // las compras del mes y su detalle con lote y vencimiento; resumen por producto: portal
  '/sucursales': true, // por tipo: abierta ahora, horario, gente y alertas; editar: portal
  '/proveedores': true, // el directorio y la ficha (con lo que se le debe); clasificar: portal
  '/laboratorios': true, // dónde está cada laboratorio en la sala, y corregirlo; la política de vencimiento: portal
  '/cuentas-por-pagar': true, // lo que se debe por proveedor y los pagos (aprobar/anular); registrar un pago: portal
  '/metas': true, // el tablero del mes por sala; bono, confirmación e histórico: portal
  '/inyecciones': true, // pendientes (marcar aplicadas) y bitácora; por cobrar y ajustes: portal
  '/facturas-compra': true, // los documentos del mes; la ficha con productos y PDF (revisión y vincular: portal)
  '/corte-z': true, // el Gran Z mensual con su cotejo; el PDF, en el portal
  '/puntos': true, // resumen, consulta del saldo y avisos (asignar cuentas y traspasos: portal)
  '/bolsas': true, // el circuito de administración: recibir, contar y confirmar (la sala va a /bolsas-sala)
  '/gestion-stock': true, // sin venta por destino y vendidos sin Min/Max (pedir o aplicar)
  '/ventas-perdidas': true, // ver, marcar listo y reportar desde el mostrador
  '/conteo-inventario': '/conteos', // contar en el teléfono; crear y aprobar siguen en el portal
  '/productos': true,      // el catálogo para consultar; la ficha trae existencias y precios
  '/vacaciones': true,     // el plan del año mes por mes; asignar y aprobar siguen en el portal
  '/horarios': true,       // la semana de la sala día por día; editar la grilla sigue en el portal
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
