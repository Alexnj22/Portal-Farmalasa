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
// El QR **lleva el código adentro**: `…/mis-puntos?codigo=K7MP4XN`. Quien lo
// escanea entra ya con su saldo en pantalla, sin teclear nada. Y el código
// igual va escrito grande abajo, porque los dos casos que este papel existe
// para cubrir son gente sin teléfono con cámara o sin datos en ese momento: el
// QR es el atajo, el código escrito es el que nunca falla.
//
// ── El código se parte en dos grupos ────────────────────────────────────────
// `K7M - P4XN`. Son siete caracteres de un alfabeto sin parecidos, y partirlos
// es lo que permite dictarlos por teléfono sin equivocarse. La partición es
// SÓLO de presentación: la pantalla acepta el código con guiones, con espacios
// o pegado, porque limpia todo lo que no sea letra o dígito antes de buscar.
import { imprimirDocumento, fechaHora } from './ticketPrint';

/** A dónde lleva el QR del papel. Es la misma que el afiche de la vitrina. */
export const URL_MIS_PUNTOS = 'https://portal.farmasalud.lat/mis-puntos';

/** La misma pantalla, pero ya con el código puesto. */
export const urlConCodigo = (codigo) => {
    const c = String(codigo ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    return c ? `${URL_MIS_PUNTOS}?codigo=${c}` : URL_MIS_PUNTOS;
};

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
        // **Sin `titulo`, a propósito**: el encabezado ya dice PUNTOS SALUD en
        // grande, y `titulo` se imprime OTRA VEZ unos renglones más abajo. Un
        // renglón que repite al de arriba no informa, gasta rollo — es la misma
        // decisión que el ticket de traslado. El nombre para la lista de la caja
        // va aparte, en `tituloDeCola`.
        titulo: '',
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
            // Doble alto y doble ancho. Es el dato que alguien va a teclear en
            // un teléfono parado en la caja, muchas veces sin los lentes
            // puestos: si no se lee de un vistazo, el papel no sirve.
            destacado: true,
        }],
        datos: [
            ['Impreso', fechaHora(ahora)],
            ...(emitidoPor ? [['Lo entrego', emitidoPor]] : []),
        ],
        // La impresora lo dibuja por la cola (`GS ( k`) y el programa de la caja
        // lo recibe como URL. Los dos salen de acá, así que no pueden divergir.
        qr: urlConCodigo(codigo),
        // Cuatro renglones de instrucciones era un instructivo, y un instructivo
        // en un papel de caja no lo lee nadie. El QR ya no necesita explicación
        // —abre la pantalla con el saldo puesto—, así que lo único que queda por
        // decir es lo que el papel NO puede hacer solo: sobrevivir.
        pie: [
            'Guarda este papel o copia tu codigo',
            'en un lugar seguro para poder entrar.',
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
    return imprimirDocumento(construirTicketDeCodigo(datos), {
        sala,
        // Sin `titulo` el nombre en la lista de la caja saldría «Documento».
        // Ahí sí hace falta distinguir un trabajo de otro.
        tituloDeCola: 'Codigo de acceso a Mis puntos',
    });
}
