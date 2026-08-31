// El papel del corte de caja hecho desde el portal.
//
// Por qué existe (pregunta del usuario, 2026-08-31): «al confirmarse desde el
// portal, se imprime el corte del erp en la ticketera? o debemos crear uno
// nosotros? si es asi, se corrige ahi».
//
// No se imprime nada, y no es que el portal se lo salte: en el sistema de la
// caja el papel no lo saca el servidor, lo saca **el JavaScript de su propia
// pantalla**, que después del corte le manda el tiquete a un programa instalado
// en esa misma computadora (`localhost/impresion_dte/`). El portal corta de
// servidor a servidor: no hay navegador, no hay `localhost`, y un servidor en la
// nube no alcanza la impresora de la sala. Así que el corte quedaba bien
// registrado y sin papel — justo cuando las salas dejaron esa pantalla.
//
// ── Y este papel dice la diferencia BIEN ────────────────────────────────────
//
// El documento del otro lado imprime la diferencia que se le manda, **sin
// recalcularla**, y la que se le manda arrastra un defecto ya medido del origen:
// `total_corte` cuenta los cobros de crédito un número entero de veces de más.
// En el corte 14319 de Salud 3 fueron cuatro veces $100.45 — un faltante de
// $411.55 que no existe, contra los $9.75 reales.
//
// Acá lo esperado sale de las LÍNEAS del tiquete, que es donde la caja de verdad
// lo dice, y el papel las imprime todas: quien lo lea puede rehacer la suma. Un
// comprobante que dijera sólo «faltan 9.75» pediría creerle, y este módulo ya
// demostró que el número puede venir mal.
//
// ── Por qué es MÁS CORTO que el del origen (usuario, 2026-08-31) ────────────
//
// El tiquete del sistema mide **38 renglones con texto** (medido sobre el corte
// 14323) y tres cosas no dicen nada:
//
//   · **Los correlativos van todos en cero.** TIQUETES, FACTURAS y FISCALES,
//     dos columnas cada uno, seis renglones de `0`.
//   · **Tarjeta y crédito se listan transacción por transacción**, y cada
//     renglón dice «COF» y un monto: el mismo rótulo repetido, que no distingue
//     una de otra. Lo único que informa es el TOTAL.
//   · **Las líneas en cero** —saldo inicial, caja chica, retención,
//     devoluciones— se imprimen igual aunque no haya nada.
//
// Sacando eso el papel baja a **21** y no se pierde un dato. Las líneas que sí
// tienen monto se imprimen TODAS: el corte es una suma, y una suma con un
// sumando escondido no se puede comprobar. El tope lo vigila
// `tests/unit/corteTicket.test.js` con el número medido, no con uno holgado.
//
// ── Lo que se rompe solo (§5 de docs/IMPRESION-EN-TICKETERA-2026-08-13.md) ──
// Sólo ASCII —por eso los rótulos de acá van SIN TILDE a propósito, no es un
// descuido—, 54 columnas en letra chica, y el papel no tiene tema: ni colores,
// ni fondos, ni bordes. El ancho NO se pasa: es un ajuste de la computadora que
// tiene la ticketera enchufada.

import { EMPRESA } from '../constants/empresa';
import { formatMoney } from './formatNumber';
import { juntarSiEntra, recortar, selloCorto, soloAscii } from './ticketCampos';

/**
 * El comprobante del corte.
 *
 * `resultado` es lo que devolvió `hacerCorte` **ya pasado por
 * `diferenciaDelCorte`** —la misma función con la que se lee la tabla de cortes
 * desde el 13-ago—, así que `esperado` y `diferencia` son los que manda el
 * portal y no los que calculó el formulario del origen.
 *
 * Cuando las dos cuentas no coinciden viene además `nota`, y **se imprime**: el
 * otro papel dice otro número y alguien los va a comparar. Un comprobante que
 * contradice al de al lado sin decir por qué se lee como un error nuestro.
 */
export function construirComprobanteDeCorte({ resultado, sala, hechoPor, hechoAt }) {
    const t = resultado?.tiquete || {};
    const dif = Number(resultado?.diferencia ?? 0);
    const cuadra = Math.abs(dif) < 0.005;

    /* Cuatro datos y no seis: se emparejan de a dos por renglon, asi que un
     * numero impar deja medio renglon vacio. La caja y el turno van juntos
     * porque son un solo hecho —«caja 4, turno 1»— y separados gastaban dos. */
    const datos = [
        ['Sala', recortar(sala || '', 24)],
        ['No. de corte', recortar(String(resultado?.id_corte ?? 'sin numero'), 20)],
    ];
    if (t.caja) datos.push(['Caja', recortar(`${t.caja}${t.turno ? ` - Turno ${t.turno}` : ''}`, 20)]);
    if (t.empleado) datos.push(['Caja a nombre de', recortar(t.empleado, 24)]);

    /* La cuenta, en un bloque de pares y no en una tabla: la tabla gasta un
     * renglon en su encabezado («LA CUENTA / MONTO») para decir lo que el
     * titulo del bloque ya dice. */
    const bloques = [{
        titulo: 'La cuenta de la caja',
        filas: (t.lineas || []).map((l) => [l.rotulo, formatMoney(l.monto, { signo: false })]),
    }];

    /* Las formas que no pasan por la caja, COMO VENGAN.
     *
     * No entran en la cuenta —ninguna pasa por la caja— pero sin ellas el papel
     * parece que perdio plata: quien lo lee ve una venta de $570 y $490 de
     * efectivo y pregunta por la diferencia.
     *
     * Se pintan las que TRAIGA el tiquete, no dos escritas aca. Con «tarjeta» y
     * «credito» fijas, una forma que el origen empiece a imprimir manana no
     * sale como cero: desaparece sin dejar rastro y el papel sigue cuadrando
     * diciendo de menos. Es la misma regla del desglose del cierre, y ahi ya
     * costo los $2.20 de Salud 2 del 13-ago. */
    if ((t.formas || []).length) {
        bloques.push({
            titulo: 'No pasa por la caja',
            filas: t.formas.map((f) => [
                recortar(f.rotulo, 30), formatMoney(f.monto, { signo: false }),
            ]),
        });
    }

    if (resultado?.vale) {
        bloques.push({
            titulo: 'Vale de caja',
            texto: `Antes del corte se anoto un vale de ${formatMoney(resultado.vale.monto)}`
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
    if (!t.total_caja) {
        bloques.push({
            titulo: 'Atencion',
            texto: 'Esta cuenta la calculo el portal: no se pudo leer el tiquete de la caja.'
                 + ' Hay que cotejarla contra el corte antes de darla por buena.',
        });
    } else if (resultado?.nota) {
        /* Por que este numero y no el otro.
         *
         * El sistema de la caja guarda una diferencia distinta —suma los cobros
         * de credito de mas— y alguien va a comparar los dos papeles. Sin esto
         * el comprobante parece contradecir al de al lado sin decir por que.
         *
         * Va el TITULO de `notaDeCifra` —que es quien decidio la cifra, asi que
         * no puede contradecirla— y la otra cifra en una linea. El detalle
         * completo se queda en la pantalla: en el papel ocupaba cuatro
         * renglones para explicar algo que el titulo ya nombra, y el usuario
         * pidio este comprobante corto. */
        bloques.push({
            titulo: soloAscii(resultado.nota.titulo),
            texto: resultado.segun_el_sistema
                ? `El sistema de la caja guarda `
                  + `${formatMoney(resultado.segun_el_sistema.diferencia)}.`
                : undefined,
        });
    }

    return {
        titulo: 'CORTE DE CAJA',
        encabezado: { titulo: soloAscii(EMPRESA.razonSocial) },
        datos,
        bloques,
        /* Contado y diferencia, y nada mas (decision del usuario, 31-ago).
         * Lo que debia haber es la suma del bloque de arriba, renglon por
         * renglon: repetirlo aca era un tercer numero grande compitiendo con el
         * unico que hay que mirar. */
        totales: [
            ['Contado', formatMoney(resultado?.contado)],
            [cuadra ? 'CUADRA' : dif > 0 ? 'SOBRA' : 'FALTA',
             formatMoney(Math.abs(dif)), true],
        ],
        /* Sin renglon de firma, por lo mismo que el vale de bolsa: quien hizo el
         * corte no lo escribio nadie en el papel, lo puso el portal despues de
         * comprobar su sesion. Una raya para firmar al lado de eso pide a mano
         * una prueba que el registro ya tiene mejor. */
        pie: juntarSiEntra(`Hizo el corte: ${recortar(hechoPor || 'sin identificar', 30)}`,
                           selloCorto(hechoAt)),
    };
}
