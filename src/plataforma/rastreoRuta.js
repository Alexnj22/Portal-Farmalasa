// ─────────────────────────────────────────────────────────────────────────────
// ¿Hay alguien ya escribiendo la posición del conductor? — estado en memoria.
// ─────────────────────────────────────────────────────────────────────────────
//
// La posición de una ruta en la calle (`ruta_locations`) tenía DOS escritores
// a la vez en el teléfono del conductor: el rastreo de fondo de
// `usePedidosData` (sigue con la pantalla apagada o el mapa cerrado) y el mapa
// de la ruta (`RutaMapModal`), cada uno con su intervalo de 30 s. Con el mapa
// abierto eran dos `upsert` por medio minuto sobre la misma fila, con dos
// posiciones que podían no coincidir.
//
// Regla: si el rastreo de fondo está corriendo, el mapa SÓLO muestra la
// posición y no la escribe. Si no hay rastreo de fondo (por ejemplo, el mapa
// se abrió desde una pantalla que no monta el hook), el mapa es el único
// escritor y escribe él.
//
// Contrato para el hook (`usePedidosData`):
//   - al arrancar el rastreo de una ruta:  marcarRastreoDeFondo(true, rutaId)
//   - al detenerlo (limpieza del efecto):   marcarRastreoDeFondo(false, rutaId)
//
// Es estado de la PÁGINA (memoria del módulo), no de React: no dispara
// renders. Quien escribe lo consulta en el momento de escribir, que es cuando
// importa.

/** rutaId → cantidad de rastreos activos (por si el efecto se monta dos veces). */
const activos = new Map();
const SIN_RUTA = '__sin_ruta__';

/**
 * Avisa que el rastreo de fondo empezó (`true`) o terminó (`false`).
 * @param {boolean} activo
 * @param {string} [rutaId] la ruta que se está rastreando; sin ella vale para cualquiera.
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
 * @param {string} [rutaId] si se pasa, responde por ESA ruta (o por un rastreo
 *   marcado sin ruta, que vale para todas).
 * @returns {boolean}
 */
export function hayRastreoDeFondo(rutaId) {
    if (activos.has(SIN_RUTA)) return true;
    if (rutaId == null) return activos.size > 0;
    return activos.has(rutaId);
}

/** Sólo para pruebas: deja el estado como al cargar la página. */
export function _reiniciarRastreoDeFondo() {
    activos.clear();
}
