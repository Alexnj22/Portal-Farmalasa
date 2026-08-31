// El papel del corte de caja hecho desde el portal.
//
// Por qué existe (pregunta del usuario, 2026-08-31): «al confirmarse desde el
// portal, se imprime el corte del erp en la ticketera? o debemos crear uno
// nosotros? si es asi, se corrige ahi».
//
// No se imprime nada. El corte viaja por HTTP al sistema de la caja, y el
// tiquete que ese sistema arma **sólo sale cuando alguien aprieta Imprimir en
// SU pantalla** — que es justamente la pantalla de la que las salas salieron el
// 31 de agosto. O sea que cortar desde el portal dejaba a la sala sin el papel
// que se anexa al corte del día.
//
// ── Y por eso este papel dice la diferencia BIEN ────────────────────────────
//
// El documento del otro lado imprime la diferencia que se le manda, **sin
// recalcularla**, y lo que el portal calculaba estaba mal: en el primer corte
// real (Salud 3, 14319) mandó -411.55 sobre un corte cuya propia cuenta da
// -9.75. `total_corte` del formulario no es el efectivo esperado — sale de
// `ventas - vales` y no incluye los cobros de crédito.
//
// Acá lo esperado sale de las LÍNEAS del tiquete, que es donde la caja de
// verdad lo dice, y el papel las imprime todas: quien lo lea puede rehacer la
// suma. Un comprobante que dijera sólo «faltan 9.75» pediría creerle, y este
// módulo ya demostró que el número puede venir mal.
//
// ── Lo que se rompe solo (§5 de docs/IMPRESION-EN-TICKETERA-2026-08-13.md) ──
// Sólo ASCII —por eso los rótulos de acá van SIN TILDE a propósito, no es un
// descuido—, 54 columnas en letra chica, y el papel no tiene tema: ni colores,
// ni fondos, ni bordes. El ancho NO se pasa: es un ajuste de la computadora que
// tiene la ticketera enchufada.

import { EMPRESA } from '../constants/empresa';
import { formatMoney } from './formatNumber';
import { recortar, selloCorto, soloAscii } from './ticketCampos';

/** El ancho del rótulo en la tabla de dos columnas de la cuenta. */
const ANCHO_ROTULO = 30;

/**
 * Un importe para la ULTIMA columna, que mide 8.
 *
 * Mismo motivo que en `bolsaComprobante`: el relleno del rollo recorta por la
 * IZQUIERDA lo que no entra, así que `-1,234.56` saldria `1,234.56` — el
 * faltante impreso como sobrante. La direccion la dice el rotulo de la linea,
 * asi que aca va sin signo y sin separador cuando con el no entraria.
 */
const importe = (valor) => {
    const n = Math.abs(Number(valor ?? 0));
    const conSeparador = formatMoney(n, { signo: false });
    return conSeparador.length <= 8 ? conSeparador : n.toFixed(2);
};

/**
 * El comprobante del corte.
 *
 * `resultado` es lo que devolvió `hacerCorte`: ya trae la cuenta leída del
 * tiquete del origen (`del_tiquete`) o, si no se pudo leer, la del portal. Esa
 * distincion se IMPRIME —no se esconde— porque son dos cosas distintas y el
 * papel es lo unico que va a quedar sobre la mesa.
 */
export function construirComprobanteDeCorte({ resultado, sala, hechoPor, hechoAt }) {
    const t = resultado?.tiquete || {};
    const dif = Number(resultado?.diferencia ?? 0);
    const cuadra = Math.abs(dif) < 0.005;

    const datos = [
        ['Sala', recortar(sala || '', 34)],
        ['No. de corte', recortar(String(resultado?.id_corte ?? 'sin numero'), 24)],
    ];
    if (t.caja) datos.push(['Caja', recortar(`${t.caja}${t.turno ? `  Turno ${t.turno}` : ''}`, 24)]);
    if (t.empleado) datos.push(['Caja a nombre de', recortar(t.empleado, 30)]);

    // La cuenta, linea por linea y en el orden del tiquete. Sin ella el papel
    // afirmaria una diferencia sin mostrar de donde sale.
    const filas = (t.lineas || []).map((l) => [
        recortar(l.rotulo, ANCHO_ROTULO), importe(l.monto),
    ]);

    const totales = [
        ['LO QUE DEBIA HABER', formatMoney(resultado?.esperado)],
        ['CONTADO', formatMoney(resultado?.contado)],
        [cuadra ? 'CUADRA' : dif > 0 ? 'SOBRA' : 'FALTA', formatMoney(Math.abs(dif)), true],
    ];

    const bloques = [];
    if (resultado?.vale) {
        bloques.push({
            titulo: 'VALE DE CAJA',
            texto: `Antes del corte se anoto un vale de caja de ${formatMoney(resultado.vale.monto)}`
                 + ' con las salidas del dia.',
        });
    }
    /* Cuando la cuenta NO salio del tiquete hay que decirlo en el papel.
     *
     * Es la diferencia entre «la caja dice que faltan 9.75» y «el portal
     * calculo que faltan 9.75», y despues de lo que paso con el corte 14319 no
     * es un matiz: el numero calculado por el portal ya salio mal una vez. Un
     * papel que no distingue las dos cosas invita a perseguir un faltante que
     * quiza no existe. */
    if (!resultado?.del_tiquete) {
        bloques.push({
            titulo: 'ATENCION',
            texto: 'Esta cuenta la calculo el portal: no se pudo leer el tiquete de la caja.'
                 + ' Hay que cotejarla contra el corte antes de darla por buena.',
        });
    }

    return {
        titulo: 'CORTE DE CAJA',
        encabezado: { titulo: soloAscii(EMPRESA.razonSocial) },
        datos,
        items: filas.length
            ? { columnas: [{ label: 'LA CUENTA DE LA CAJA' }, { label: 'MONTO', alinear: 'der' }], filas }
            : undefined,
        totales,
        bloques: bloques.length ? bloques : undefined,
        /* Sin renglon de firma, por lo mismo que el vale de bolsa: quien hizo el
         * corte no lo escribio nadie en el papel, lo puso el portal despues de
         * comprobar su sesion. Una raya para firmar al lado de eso pide a mano
         * una prueba que el registro ya tiene mejor. */
        pie: [`Corte hecho desde el portal por ${recortar(hechoPor || 'sin identificar', 34)}`,
              selloCorto(hechoAt)],
    };
}
