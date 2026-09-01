// El papel del código de acceso a «Mis puntos».
//
// Lo entrega la caja cuando alguien quiere consultar sus puntos y su documento
// no alcanza: no lo tiene cargado en la ficha, o es extranjero y su teléfono no
// sirve de llave —el circuito de Hacienda exige ocho dígitos exactos y
// reemplaza lo que no cumple por el de la farmacia—.
//
// ── Lo que lleva, y por qué el código SÍ va escrito ─────────────────────────
// Al revés que el carné del día, donde el valor de las barras jamás se imprime.
// Y no es una excepción caprichosa: el carné **abre el portal** —es una
// credencial de un empleado— mientras que esto sólo deja MIRAR un saldo. El
// cliente tiene que poder teclearlo en su teléfono, así que tiene que verlo.
//
// El QR va a `/mis-puntos` y el código escrito abajo. Los dos hacen falta: el
// QR lleva a la pantalla, el código es lo que se escribe una vez adentro.
//
// ── El código se parte en dos grupos ────────────────────────────────────────
// `K7M - P4XN`. Son siete caracteres de un alfabeto sin parecidos, y partirlos
// es lo que permite dictarlos por teléfono sin equivocarse. La partición es
// SÓLO de presentación: la pantalla acepta el código con guiones, con espacios
// o pegado, porque limpia todo lo que no sea letra o dígito antes de buscar.
import { imprimirDocumento, fechaHora } from './ticketPrint';

/** A dónde lleva el QR del papel. Es la misma que el afiche de la vitrina. */
export const URL_MIS_PUNTOS = 'https://portal.farmasalud.lat/mis-puntos';

/** `K7MP4XN` → `K7M - P4XN`, sólo para leerlo. */
export const codigoLegible = (codigo) => {
    const c = String(codigo ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    return c.length === 7 ? `${c.slice(0, 3)} - ${c.slice(3)}` : c;
};

/**
 * El documento del papel del código.
 *
 * @param {object} datos
 * @param {string} datos.nombre   a quién se le entrega
 * @param {string} datos.codigo   los siete caracteres
 * @param {string} [datos.emitidoPor]
 */
export function construirTicketDeCodigo({ nombre, codigo, emitidoPor = '', ahora = new Date() }) {
    return {
        titulo: 'Puntos Salud',
        encabezado: {
            titulo: 'PUNTOS SALUD',
            lineas: [nombre || 'Cliente'].filter(Boolean),
        },
        bloques: [{
            titulo: 'Tu codigo de acceso',
            // Solo, en su propio bloque y sin nada al lado. Es el dato por el
            // que existe el papel: compartir renglón con cualquier otra cosa lo
            // volvería un dato más de una lista.
            texto: codigoLegible(codigo),
        }],
        datos: [
            ['Impreso', fechaHora(ahora)],
            ...(emitidoPor ? [['Lo entrego', emitidoPor]] : []),
        ],
        // La impresora lo dibuja por la cola (`GS ( k`) y el programa de la caja
        // lo recibe como URL. Los dos salen de acá, así que no pueden divergir.
        qr: URL_MIS_PUNTOS,
        pie: [
            'Escanea el codigo y escribe el de arriba',
            'para ver tus puntos y cuando vencen.',
            'Guardalo: sirve mientras no pidas otro.',
            'Si lo pierdes, pide uno nuevo en caja.',
        ],
    };
}

/**
 * Lo manda al rollo.
 *
 * `sala` es la de QUIEN IMPRIME, no la del cliente: el papel se le entrega en
 * mano a alguien que está parado ahí. Misma regla que el carné del día.
 */
export function imprimirTicketDeCodigo(datos, { sala = null } = {}) {
    return imprimirDocumento(construirTicketDeCodigo(datos), { sala });
}
