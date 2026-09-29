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
