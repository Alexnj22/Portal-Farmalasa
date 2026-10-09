// El carné de papel del día: el DOCUMENTO, escrito una vez para el portal
// (`src/plataforma/carnePrint.js`, que lo manda al rollo de la computadora o a
// la cola de una sala) y la app (`apps/mobile/plataforma/carnePrint.js`, que
// sólo tiene la cola). Vivía en el adaptador web; es puro y se mudó acá para
// que los dos impriman el mismo papel.
import { fechaHora, limpiarValorDeBarras } from './ticketPrint';

export const SIMBOLOGIA_DEL_CARNE = 'CODE128';

/** La hora de vencimiento, dicha como la diría alguien. */
function hastaCuando(venceEl) {
    const d = new Date(venceEl);
    if (Number.isNaN(d.getTime())) return 'hoy';
    // El vencimiento es la medianoche SIGUIENTE, así que el día que hay que
    // nombrar es el anterior: un papel que dice «vence el 21» cuando se imprimió
    // el 20 se lee como que sirve mañana, y no sirve.
    const dia = new Date(d.getTime() - 60_000);
    return `${String(dia.getDate()).padStart(2, '0')}/${String(dia.getMonth() + 1).padStart(2, '0')}`
        + `/${dia.getFullYear()} a medianoche`;
}

/**
 * El documento del carné de papel.
 *
 * @param {object} datos
 * @param {string} datos.nombre    a quién se le entrega
 * @param {string} datos.secreto   lo que va adentro de las barras
 * @param {string} datos.venceEl   ISO del vencimiento (lo decide el servidor)
 * @param {string} [datos.cargo]
 * @param {string} [datos.sala]
 * @param {string} [datos.emitidoPor]
 */
export function construirCarneDePapel({
    nombre, secreto, venceEl, cargo = '', sala = '', emitidoPor = '', ahora = new Date(),
}) {
    const valor = limpiarValorDeBarras(secreto);
    return {
        titulo: 'Carné del día',
        encabezado: { titulo: nombre || 'Sin nombre', lineas: [cargo, sala].filter(Boolean) },
        datos: [
            ['Vale hasta', hastaCuando(venceEl)],
            ['Impreso', fechaHora(ahora)],
            ...(emitidoPor ? [['Lo entregó', emitidoPor]] : []),
        ],
        codigos: [{ valor, simbologia: SIMBOLOGIA_DEL_CARNE }],
        pie: [
            'Pasa este papel por el lector, igual que un carne.',
            'Deja de servir a la medianoche de hoy.',
            'Si se pierde, pide que lo anulen.',
        ],
    };
}

