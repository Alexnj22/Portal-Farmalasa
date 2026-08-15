// Los tres papeles de una bolsa de efectivo.
//
// Qué pidió el usuario (2026-08-15): «en las bolsitas normalmente ponen una
// cinta o un papel con la fecha y monto, pero quiero que los tickets sean eso:
// digan fecha, hora, monto, responsables, y enliste si se sacó dinero de ahí,
// con el monto nuevo total sin esos vales».
//
// Son tres y ninguno reemplaza a otro, porque van a tres lugares distintos:
//
//   · `construirEtiquetaDeBolsa`   — se pega AFUERA. Reemplaza la cinta.
//   · `construirValeDeSalida`      — queda ADENTRO. Reemplaza el papel escrito
//                                    a mano cuando se saca dinero.
//   · `construirComprobanteDeEntrega` — lo firman la sala y quien retira.
//
// El diseño completo, en `docs/PLAN-BOLSAS-DE-EFECTIVO-2026-08-15.md`.
//
// ── Lo que se rompe solo (§5 de docs/IMPRESION-EN-TICKETERA-2026-08-13.md) ───
// Sólo ASCII —por eso los rótulos de acá van SIN TILDE a propósito, no es un
// descuido—, 54 columnas en letra chica, y el papel no tiene tema: ni colores,
// ni fondos, ni bordes. El ancho NO se pasa: es un ajuste de la computadora que
// tiene la ticketera enchufada.
//
// ── Y una que es de estos documentos ────────────────────────────────────────
// **La etiqueta se vuelve mentira en cuanto sale plata de la bolsa.** Por eso
// lleva número de impresión y dice que anula a la anterior: sobre la mesa de
// administración, dos etiquetas de la misma bolsa se ven iguales y sólo una
// dice la verdad. Y por eso imprime SIEMPRE el estado de hoy — nunca una foto
// guardada al cerrarla.

import { EMPRESA } from '../constants/empresa';
import { formatMoney } from './formatNumber';
import { soloAscii, recortar, fechaCorta, hhmm, selloDeTiempo } from './ticketCampos';

/** El ancho del primer campo de la tabla de cuatro columnas del rollo. */
const ANCHO_MOTIVO = 28;

/**
 * Un importe para la ULTIMA columna de la tabla de cuatro, que mide 8.
 *
 * Existe porque el relleno del rollo **recorta por la izquierda** lo que no
 * entra (`padStart(8).slice(-8)`), y eso no se ve: `$1,234.56` sale `1,234.56`
 * —bien— pero `-1,234.56` sale `1,234.56`, o sea el faltante impreso como
 * sobrante. Con nueve caracteres se pierde el primero, y el primero es el que
 * dice la dirección.
 *
 * Por eso acá: sin `$` y sin signo —la dirección la declara el encabezado de la
 * columna— y sin separador de miles cuando con él no entraría. Alcanza hasta
 * `99999.99`; una bolsa de una sala anda entre $150 y $1,300.
 */
const importeDeColumna = (valor) => {
    const n = Math.abs(Number(valor ?? 0));
    const conSeparador = formatMoney(n, { signo: false });
    return conSeparador.length <= 8 ? conSeparador : n.toFixed(2);
};

/** «1 bolsa» / «2 bolsas» — un rótulo mal conjugado se lee como un descuido. */
const plural = (n, singular, muchos) => `${n} ${n === 1 ? singular : muchos}`;

const encabezadoDeLaEmpresa = () => ({
    titulo: soloAscii(EMPRESA.razonSocial),
    lineas: [`NIT ${EMPRESA.nit}`],
});

const sumar = (filas, campo = 'monto') => filas
    .reduce((a, f) => a + Math.abs(Number(f?.[campo] ?? 0)), 0);

/** Cómo se comprobó que quien recibe el dinero es quien dice ser. */
const COMO_SE_IDENTIFICO = {
    CLAVE: 'usuario y contrasena',
    CARNE: 'carne escaneado',
};

/**
 * LA ETIQUETA — el papel que va pegado afuera de la bolsa.
 *
 * Reemplaza la cinta escrita a mano, y hace lo que la cinta no puede: listar lo
 * que salió y decir cuánto efectivo debe haber AHORA. Ese último número es el
 * que administración compara contra lo que cuenta.
 *
 * Cuando la bolsa no tiene salidas —el caso normal— no se imprime ni la tabla
 * ni el renglón de vales: una etiqueta de cuatro renglones se lee de un vistazo
 * y gasta menos rollo.
 *
 * @param {object} bolsa      { folio, fecha, hora, caja, monto_inicial, cerrada_at }
 * @param {string} sala       nombre de la sucursal
 * @param {Array}  salidas    [{ fecha, hora, motivo, monto }] — monto en positivo o negativo, da igual
 * @param {string} cerradaPor quién guardó el dinero
 * @param {number} version    cuántas veces se imprimió esta etiqueta, contando ésta
 * @param {string} impresaAt  ISO del momento de imprimir
 */
export function construirEtiquetaDeBolsa({
    bolsa, sala, salidas = [], cerradaPor, version = 1, impresaAt,
}) {
    const inicial = Number(bolsa?.monto_inicial ?? 0);
    const sacado = sumar(salidas);
    const efectivo = Math.round((inicial - sacado) * 100) / 100;
    const hubo = salidas.length > 0;

    return {
        titulo: 'BOLSA DE EFECTIVO',
        encabezado: encabezadoDeLaEmpresa(),
        datos: [
            ['Bolsa', recortar(bolsa?.folio || '', 24)],
            ['Sala', recortar(sala || '', 34)],
            ['Corte del', `${fechaCorta(bolsa?.fecha)}  ${hhmm(bolsa?.hora)}`],
            ['Caja', recortar(bolsa?.caja || '', 34)],
            ['Guardo', recortar(cerradaPor || 'Sin registrar', 34)],
            ['Cerrada', selloDeTiempo(bolsa?.cerrada_at)],
            ['Guardado al cerrar', formatMoney(inicial)],
        ],
        // Las CUATRO columnas son la geometría medida contra un ticket real del
        // sistema de facturación. La de dos colapsa a «primero … ultimo» y acá
        // perdería justo la fecha y la hora de cada salida, que es lo que
        // permite ir a buscar el vale.
        items: hubo ? {
            columnas: [
                { label: 'SE SACO PARA' },
                { label: 'FECHA', alinear: 'der' },
                { label: 'HORA', alinear: 'der' },
                { label: 'SALIO', alinear: 'der' },
            ],
            filas: salidas.map((s) => [
                recortar(s.motivo || 'Sin motivo', ANCHO_MOTIVO),
                fechaCorta(s.fecha).slice(0, 5),
                hhmm(s.hora),
                importeDeColumna(s.monto),
            ]),
        } : undefined,
        totales: hubo
            ? [
                // El destacado es el efectivo y no el total: es la unica cifra
                // que alguien va a contar con las manos.
                ['EFECTIVO QUE DEBE HABER', formatMoney(efectivo), true],
                [`VALES ADENTRO (${salidas.length})`, formatMoney(sacado)],
            ]
            : [['EFECTIVO ADENTRO', formatMoney(inicial), true]],
        pie: [
            version > 1 ? `ETIQUETA #${version} - ANULA LA ANTERIOR` : 'ETIQUETA #1',
            selloDeTiempo(impresaAt),
            '',
            hubo
                ? 'Si sale mas dinero, imprimir otra etiqueta.'
                : 'Si sale dinero de esta bolsa, imprimir otra etiqueta.',
        ].filter((l) => l !== null),
    };
}

/**
 * EL VALE — el papel que queda DENTRO de la bolsa cuando se saca dinero.
 *
 * Reemplaza al papel escrito a mano, y agrega lo que ese papel nunca dijo:
 * **cuánto queda en la bolsa después**. El papel a mano dice cuánto se llevaron,
 * que es la mitad que no sirve para contar.
 *
 * Dos renglones del pie no son decoración:
 *
 *   · «Este vale queda dentro de la bolsa X» — un vale que cambia de bolsa deja
 *     un hueco de un lado y un sobrante del otro, y las dos bolsas quedan
 *     marcadas por algo que no pasó.
 *   · «Parte de la remesa R-… por $500.00» — cuando ninguna bolsa alcanzaba
 *     sola y la operación salió de dos, ninguno de los dos vales puede parecer
 *     la operación entera.
 *
 * @param {object} vale        { folio, monto, saldo_despues }
 * @param {object} operacion   { folio, motivo, banco, numero_boleta, monto, nota }
 * @param {object} bolsa       { folio, fecha, hora }
 * @param {string} sala
 * @param {string} registradoPor
 * @param {object} recibidoPor { nombre, metodo } — quién se llevo el efectivo
 * @param {string} registradoAt ISO
 */
export function construirValeDeSalida({
    vale, operacion = {}, bolsa, sala, registradoPor, recibidoPor, registradoAt,
}) {
    const monto = Math.abs(Number(vale?.monto ?? 0));
    const total = Math.abs(Number(operacion?.monto ?? monto));
    // Parcial cuando el vale no cubre la operacion entera: la remesa salio de
    // mas de una bolsa.
    const parcial = Math.abs(total - monto) >= 0.01;

    const datos = [
        ['Vale', recortar(vale?.folio || '', 24)],
        ['Bolsa', recortar(bolsa?.folio || '', 24)],
        ['Sala', recortar(sala || '', 34)],
        ['Corte del', `${fechaCorta(bolsa?.fecha)}  ${hhmm(bolsa?.hora)}`],
        ['Motivo', recortar(operacion?.motivo || 'Sin motivo', 30)],
    ];
    if (operacion?.banco) datos.push(['Banco', recortar(operacion.banco, 30)]);
    if (operacion?.numero_boleta) datos.push(['No. de boleta', recortar(operacion.numero_boleta, 24)]);

    const identificacion = recibidoPor?.metodo
        ? COMO_SE_IDENTIFICO[recibidoPor.metodo] || 'identificado en el portal'
        : null;

    return {
        titulo: 'VALE DE EFECTIVO',
        encabezado: encabezadoDeLaEmpresa(),
        datos,
        bloques: operacion?.nota
            ? [{ titulo: 'DETALLE', texto: recortar(operacion.nota, 160) }]
            : undefined,
        totales: [
            ['SALE DE LA BOLSA', formatMoney(monto), true],
            ['QUEDA EN LA BOLSA', formatMoney(Number(vale?.saldo_despues ?? 0))],
        ],
        pie: [
            `Registro: ${recortar(registradoPor || 'Sin registrar', 40)}`,
            selloDeTiempo(registradoAt),
            ...(recibidoPor?.nombre
                ? [`Recibe: ${recortar(recibidoPor.nombre, 40)}`,
                   `(${identificacion})`,
                   '',
                   'Firma ______________________']
                : []),
            '',
            `Este vale queda dentro de la bolsa ${recortar(bolsa?.folio || '', 24)}.`,
            ...(parcial
                ? [`Parte de ${recortar(operacion?.folio || '', 24)} por ${formatMoney(total)}.`]
                : []),
        ],
    };
}

/**
 * EL COMPROBANTE DE ENTREGA — lo que firman la sala y quien retira.
 *
 * Cierra con tres cifras y no con una, porque una bolsa puede llegar sin un
 * billete adentro y estar perfecta: lo que se entrega es efectivo MAS boletas
 * del banco, y las dos mitades tienen que viajar declaradas.
 *
 * @param {object} entrega  { folio, entregado_at }
 * @param {string} sala
 * @param {Array}  bolsas   [{ folio, fecha, hora, efectivo, vales }]
 * @param {string} entregadoPor
 * @param {string} recibidoPor  quién retira
 */
export function construirComprobanteDeEntrega({
    entrega, sala, bolsas = [], entregadoPor, recibidoPor,
}) {
    const efectivo = sumar(bolsas, 'efectivo');
    const vales = sumar(bolsas, 'vales');
    const conVales = bolsas.filter((b) => Math.abs(Number(b?.vales ?? 0)) >= 0.01).length;

    return {
        titulo: 'ENTREGA DE BOLSAS',
        encabezado: encabezadoDeLaEmpresa(),
        datos: [
            ['Comprobante', recortar(entrega?.folio || '', 24)],
            ['Sala', recortar(sala || '', 34)],
            ['Fecha', selloDeTiempo(entrega?.entregado_at)],
        ],
        items: {
            columnas: [
                { label: 'BOLSA' },
                { label: 'DEL', alinear: 'der' },
                { label: 'HORA', alinear: 'der' },
                // 'EFECTIVO' mide 8 y el campo mide 8: el encabezado se pegaba
                // a la columna de la izquierda y salia `HORAEFECTIVO`.
                { label: 'MONTO', alinear: 'der' },
            ],
            filas: bolsas.map((b) => [
                recortar(b.folio || '', ANCHO_MOTIVO),
                fechaCorta(b.fecha).slice(0, 5),
                hhmm(b.hora),
                importeDeColumna(b.efectivo),
            ]),
        },
        totales: [
            ['BOLSAS', String(bolsas.length)],
            ['EFECTIVO', formatMoney(efectivo), true],
            ...(vales >= 0.01
                ? [[`VALES (en ${plural(conVales, 'bolsa', 'bolsas')})`, formatMoney(vales)]]
                : []),
            ['TOTAL SEGUN LOS CORTES', formatMoney(efectivo + vales)],
        ],
        pie: [
            `Entrega: ${recortar(entregadoPor || 'Sin registrar', 40)}`,
            'Firma ______________________',
            '',
            `Recibe: ${recortar(recibidoPor || 'Sin registrar', 40)}`,
            'Firma ______________________',
            '',
            'Dos copias: una para la sala, una para quien retira.',
        ],
    };
}
