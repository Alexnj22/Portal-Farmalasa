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
// ── La firma sólo aparece cuando NO se pudo identificar a nadie ───────────
//
// Pregunta del usuario (1-sep): «¿por qué raya de firma y no escanear el carné
// o poner usuario y contraseña?». La primera versión de este papel llevaba raya
// siempre, y estaba mal: el portal ya sabe identificar —lector de carné con
// escotilla de usuario y contraseña, `IdentidadDeQuienRetira`, desde el
// 19-ago— y una raya prueba que alguien escribió algo, mientras que el carné
// prueba QUIÉN, lo resuelve el servidor y deja un vale de un solo uso.
//
// Pero no todo el que recibe es de la casa, y ahí la raya sí es lo único que
// hay. Lo decide el tipo (`identifica_receptor`):
//
//   se identificó   se imprime el nombre y CÓMO se comprobó. Sin raya: el
//                   registro ya lo prueba mejor que una firma.
//   nombre escrito  raya de firma **con el nombre debajo**, para que se sepa
//                   quién está firmando (pedido del usuario: «si el vale lo
//                   firma un tercero, que diga otro, se pone el nombre y sale
//                   la raya de firma con el nombre abajo»).
//
// El ingreso nunca lleva raya: quien entrega es el cliente y el papel es SUYO —
// pedirle que firme el comprobante que se lleva no prueba nada.
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
 * @param {string} comoSeComprobo  'CARNE' | 'CLAVE' | null — null es «se escribió»
 * @param {string} sala        nombre de la sucursal
 * @param {string} hechoPor    quién lo anotó
 * @param {string} hechoAt     ISO del momento
 */
export function construirComprobanteDeMovimiento({
    movimiento, etiqueta, detalle, persona, comoSeComprobo = null, sala, hechoPor, hechoAt,
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

    /* Quién, y CÓMO se supo. «Comprobado con carné» no es un adorno: es la
     * diferencia entre un nombre que alguien tecleó y una identidad que el
     * servidor resolvió, y es lo que hace que la raya de firma sobre. */
    const nombreCorto = recortar(soloAscii(persona || ''), 40);
    if (persona) {
        bloques.push({
            titulo: entra ? 'Lo entrego' : 'Lo recibio',
            /* En UNA línea: el rollo re-acomoda el texto por palabras, así que
             * un salto de línea acá no sobrevive — sale «Katlin Molina
             * Comprobado con carne», que se lee como si «Comprobado» fuera
             * parte del nombre. */
            texto: comoSeComprobo
                ? `${nombreCorto} - comprobado con ${comoSeComprobo === 'CARNE' ? 'carne' : 'usuario y clave'}`
                : nombreCorto,
        });
    }

    const pie = [];
    // La raya SÓLO cuando no hubo identidad comprobada. Con carné el registro
    // ya prueba quién se llevó el dinero; una raya al lado pediría a mano una
    // prueba que el registro tiene mejor. Sin carné es lo único que queda, y
    // lleva el nombre debajo para que se sepa quién firma.
    if (!entra && !comoSeComprobo) {
        // Renglón en blanco arriba: sobre papel térmico una raya pegada al
        // renglón anterior no deja lugar para la mano.
        pie.push('', '_______________________________');
        pie.push(nombreCorto ? `Firma de ${nombreCorto}` : 'Firma de quien recibe');
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
