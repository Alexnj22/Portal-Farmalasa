// El papel de lo que entra y sale del CAJÓN.
//
// ── Por qué hacía falta ────────────────────────────────────────────────────
//
// Todo lo demás que mueve efectivo en el portal ya saca papel: el corte, la
// salida de una bolsa, el abono de un cliente. Estos dos no, y son justamente
// los que dejan a alguien con dinero en la mano:
//
//  · una SALIDA es plata que se le entrega a una persona, y sin papel lo único
//    que queda es una fila en una pantalla que esa persona no ve;
//  · un INGRESO es plata que alguien trajo —el pago de un recibo, un abono— y
//    quien la trajo se queda sin nada que lo pruebe.
//
// ── La salida lleva firma; el ingreso no ──────────────────────────────────
//
// No es simetría rota: en la salida hay un RECEPTOR, y su firma es lo que
// convierte el papel en un vale de verdad — es el único dato que ni la sesión
// ni el sistema pueden aportar. En el ingreso quien entrega es el cliente y el
// papel es SUYO: pedirle que firme el comprobante que se lleva no prueba nada.
//
// (Al corte y al vale de bolsa no se les pone raya de firma por otro motivo, y
// está anotado en sus archivos: ahí la persona la puso el portal después de
// comprobar su sesión, y una raya al lado pide a mano una prueba que el
// registro ya tiene mejor. Acá el receptor no está en ningún registro.)
//
// ── Lo que se rompe solo (§5 de docs/IMPRESION-EN-TICKETERA-2026-08-13.md) ──
// Sólo ASCII —por eso los rótulos van SIN TILDE a propósito, no es un
// descuido—, 54 columnas en letra chica, y el papel no tiene tema. El ancho NO
// se pasa: es un ajuste de la computadora que tiene la ticketera enchufada.

import { EMPRESA } from '../constants/empresa';
import { formatMoney } from './formatNumber';
import { fechaCorta, juntarSiEntra, recortar, selloCorto, soloAscii } from './ticketCampos';

/**
 * El comprobante de un ingreso o una salida del cajón.
 *
 * @param {object} movimiento  la fila de `caja_movimientos_portal` como quedó
 * @param {string} etiqueta    el rótulo del tipo («Aplicacion de inyeccion»)
 * @param {string} detalle     lo que la sala escribió («Neurobion 25000»)
 * @param {string} persona     de quién vino, o quién recibe
 * @param {string} sala        nombre de la sucursal
 * @param {string} hechoPor    quién lo anotó
 * @param {string} hechoAt     ISO del momento
 */
export function construirComprobanteDeMovimiento({
    movimiento, etiqueta, detalle, persona, sala, hechoPor, hechoAt,
}) {
    const entra = movimiento?.tipo === 'ENTRADA';
    const monto = Number(movimiento?.monto) || 0;

    const datos = [
        // El número del portal es el mismo que va adelante del concepto en la
        // caja (`P42 …`): es lo único que ata las dos filas cuando alguien mira
        // del otro lado, así que tiene que estar en el papel.
        ['No', `P${movimiento?.id ?? '-'}`],
        ['Fecha', fechaCorta(movimiento?.fecha)],
        ['Sucursal', recortar(soloAscii(sala || '-'), 20)],
    ];
    if (movimiento?.numero_boleta) datos.push(['Boleta', soloAscii(movimiento.numero_boleta)]);

    const bloques = [];
    const concepto = [etiqueta, detalle].filter(Boolean).join(' - ');
    if (concepto) bloques.push({ titulo: entra ? 'Que entro' : 'Que salio', texto: soloAscii(concepto) });

    /* Quién. En la salida es el dato que justifica el papel; en el ingreso es
     * opcional y sólo se imprime si el tipo lo pidió. */
    if (persona) {
        bloques.push({
            titulo: entra ? 'Lo entrego' : 'Lo recibio',
            texto: recortar(soloAscii(persona), 40),
        });
    }

    const pie = [];
    if (!entra) {
        // La raya de firma. Va con renglón en blanco arriba para que quede
        // espacio real donde escribir — sobre papel térmico, una raya pegada al
        // renglón anterior no deja lugar para la mano.
        pie.push('', '_______________________________', 'Firma de quien recibe');
    }
    pie.push(juntarSiEntra(`Anoto: ${recortar(soloAscii(hechoPor || 'sin identificar'), 28)}`,
                           selloCorto(hechoAt)));

    return {
        titulo: entra ? 'INGRESO A CAJA' : 'VALE DE CAJA',
        encabezado: { titulo: soloAscii(EMPRESA.razonSocial) },
        datos,
        bloques,
        // Un solo total y destacado: es la única cifra del papel, y lo que
        // alguien va a contar con las manos.
        totales: [[entra ? 'Entra a la caja' : 'Sale de la caja', formatMoney(monto), true]],
        pie,
    };
}
