// ¿Hay alguien ya escribiendo la posición del conductor? — la versión del
// TELÉFONO. Mismos nombres y contrato que `src/plataforma/rastreoRuta.js`.
//
// Faltaba (2026-10-09): `src/data/pedidos.js` lo importa desde que el rastreo
// de fondo y el mapa dejaron de escribir los dos la misma fila, y sin este
// archivo la app NO compilaba («Unable to resolve module
// @plataforma/rastreoRuta»). En el teléfono quien escribe la posición es
// `rastreoDeFondo.js` (la tarea del sistema); este estado es de la memoria del
// proceso, igual que en la web, y sólo lo consulta el núcleo al escribir.

/** rutaId → cantidad de rastreos activos (por si se marca dos veces). */
const activos = new Map();
const SIN_RUTA = '__sin_ruta__';

/**
 * Avisa que el rastreo de fondo empezó (`true`) o terminó (`false`).
 * @param {boolean} activo
 * @param {string} [rutaId]
 */
export function marcarRastreoDeFondo(activo, rutaId) {
  const clave = rutaId ?? SIN_RUTA;
  const n = activos.get(clave) ?? 0;
  if (activo) activos.set(clave, n + 1);
  else if (n <= 1) activos.delete(clave);
  else activos.set(clave, n - 1);
}

/**
 * ¿Hay un rastreo de fondo escribiendo la posición?
 * @param {string} [rutaId]
 * @returns {boolean}
 */
export function hayRastreoDeFondo(rutaId) {
  if (activos.has(SIN_RUTA)) return true;
  if (rutaId == null) return activos.size > 0;
  return activos.has(rutaId);
}

/** Sólo para pruebas: deja el estado como al abrir la app. */
export function _reiniciarRastreoDeFondo() {
  activos.clear();
}
