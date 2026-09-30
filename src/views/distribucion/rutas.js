// Las direcciones de la distribuidora, en UN solo sitio.
//
// Desde el 2026-09-28 la distribuidora tiene su propia entrada dentro del
// portal —`/torogoz`, con su login, su menú y su marca— y deja de ser un módulo
// del menú de las farmacias (decisión del usuario: «parecen independientes, así
// que debe haber una URL aparte»). Es la misma base y las mismas cuentas: lo
// que decide quién entra es el permiso `distribucion`.
//
// Escritas a mano en cada pantalla, el día que la ruta cambie una se queda
// apuntando al sitio viejo sin dar error. Por eso todas salen de acá.

export const BASE_TOROGOZ = '/torogoz';

/** Las secciones del menú, en el orden del trabajo del día. */
export const SECCIONES = ['inicio', 'pedidos', 'documentos', 'cobros', 'clientes', 'catalogo', 'compras', 'inventario', 'perdidas', 'solicitudes', 'emisor'];

export const rutaLogin = () => `${BASE_TOROGOZ}/login`;
export const rutaInicio = () => `${BASE_TOROGOZ}/pedidos`;
export const rutaSeccion = (seccion, query = '') => `${BASE_TOROGOZ}/${seccion}${query ? `?${query}` : ''}`;
export const rutaVenta = (pedidoId = null) => (pedidoId ? `${BASE_TOROGOZ}/venta/${pedidoId}` : `${BASE_TOROGOZ}/venta`);
/** Abre el documento en Pedidos, con su ticket y su PDF; `imprimir` saca el ticket solo. */
export const rutaDocumento = (dteId, { imprimir = false } = {}) =>
    rutaSeccion('pedidos', `documento=${dteId}${imprimir ? '&imprimir=1' : ''}`);
export const rutaSolicitud = (id) => rutaSeccion('solicitudes', `solicitud=${id}`);
/** Una venta NUEVA con el cliente y los productos de otra («Volver a vender»). */
/** Una venta NUEVA con ese cliente ya elegido (desde el tablero: «Vender»). */
export const rutaVentaA = (clienteId) => `${BASE_TOROGOZ}/venta?cliente=${clienteId}`;
export const rutaVolverAVender = (pedidoId) => `${BASE_TOROGOZ}/venta?desde=${pedidoId}`;
