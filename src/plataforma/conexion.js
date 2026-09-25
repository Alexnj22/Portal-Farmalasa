// ─────────────────────────────────────────────────────────────────────────────
// ¿Volvió la conexión? — la versión del NAVEGADOR.
// ─────────────────────────────────────────────────────────────────────────────
//
// El kiosco guarda las marcaciones hechas sin red y las manda al volver. En el
// navegador eso lo avisa `window` con `online`; en la app nativa lo avisará
// `NetInfo`, con la misma interfaz en `conexion.native.js`. Ver `almacen.js`.

export const escucharConexion = (fn) => window.addEventListener('online', fn);
export const soltarConexion   = (fn) => window.removeEventListener('online', fn);
