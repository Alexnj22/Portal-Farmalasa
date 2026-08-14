// El papel que respalda la resolución de una diferencia de caja.
//
// Qué pidió el usuario (2026-08-14): «al darle, imprime un ticket como ingreso
// de dinero por faltante del día tal, para anexarlo en el corte o por si ya se
// encontró causa. Quién, cuándo y a qué horas.»
//
// Es el PRIMER documento del portal que va al rollo — hasta hoy la ticketera
// sólo tenía su prueba de impresión. Por eso las reglas de §5 de
// `docs/IMPRESION-EN-TICKETERA-2026-08-13.md` se aplican acá por primera vez de
// verdad, y son las que se rompen solas:
//
//   · **Sólo ASCII.** El rollo no lee UTF-8: «REPOSICIÓN» sale `REPOSICIÆN`. Por
//     eso todos los rótulos de este archivo están escritos SIN TILDE a
//     propósito. No es un descuido de ortografía: es el formato del papel.
//   · **54 columnas** en letra chica. Los nombres largos se recortan acá y no en
//     la impresora, que parte donde se le acaba el ancho.
//   · **El papel no tiene tema**: ni colores, ni fondos, ni bordes.
//   · **El ancho NO se pasa** — es un ajuste de la computadora que tiene la
//     ticketera enchufada (`leerAjustesDeImpresion`).
//
// Y una que es de este documento: el comprobante NO lleva el saldo del día ni el
// acumulado. Dice UNA cifra —la que se repone o se retira— porque es el papel
// que alguien firma al entregar dinero. Dos números en un recibo es una
// invitación a firmar el que no era.

import { EMPRESA } from '../constants/empresa';
import { formatMoney } from './formatNumber';

/** El ancho útil del rollo en letra chica. Ver COLUMNAS_TICKET. */
const COLUMNAS = 54;

/**
 * Sin tildes ni eñes: el rollo es ASCII. Se hace acá además de en el envío
 * directo porque los nombres de las personas vienen de la base y nadie los
 * escribió pensando en papel térmico — «NUÑEZ» salió `NUÆEZ` la primera vez.
 */
export const soloAscii = (s) => String(s ?? '')
    // La eñe ANTES de descomponer: `NFD` la parte en `n` + tilde y el barrido de
    // diacríticos la dejaría en `n` igual, pero así el paso es explícito y no
    // depende del orden de dos reglas que parecen independientes.
    .replace(/ñ/g, 'n').replace(/Ñ/g, 'N')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '');

const recortar = (s, max) => {
    const t = soloAscii(s).trim();
    return t.length > max ? `${t.slice(0, max - 1)}.` : t;
};

const TITULO = {
    REPONE:    'COMPROBANTE DE REPOSICION',
    RETIRA:    'COMPROBANTE DE RETIRO',
    JUSTIFICA: 'DIFERENCIA JUSTIFICADA',
};

// Qué dice la línea del monto. En un recibo importa la dirección del dinero, no
// el signo: «ENTRA» y «SALE» no se leen al revés por descuido, un «-1.25» sí.
const CONCEPTO = {
    REPONE:    'ENTRA A CAJA',
    RETIRA:    'SALE DE CAJA',
    JUSTIFICA: 'NO MUEVE DINERO',
};

const hhmm = (hora) => String(hora || '').slice(0, 5);

/** dd/mm/aaaa de una fecha `YYYY-MM-DD`, sin que el huso la corra un día. */
const fechaCorta = (fecha) => {
    if (!fecha) return '';
    const [a, m, d] = String(fecha).split('-');
    return `${d}/${m}/${a}`;
};

/** Cuándo se firmó, en hora de la sala. */
const selloDeTiempo = (iso) => (iso
    ? soloAscii(new Date(iso).toLocaleString('es-SV', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true,
        timeZone: 'America/El_Salvador',
    }))
    : '');

/**
 * El comprobante del MOVIMIENTO ACUMULADO — el ingreso o el vale único.
 *
 * Es el otro papel, y hace falta por lo mismo que el primero: en el sistema
 * queda un ingreso de $X y nada dice de qué está hecho. Este se anexa a ESE
 * documento y lo desarma diferencia por diferencia, con la fecha y la hora del
 * corte de cada una — una sala puede cortar tres veces el mismo día, así que sin
 * la hora la línea no identifica cuál.
 *
 * No reemplaza al de la reposición: aquél lo firma quien entrega el dinero, y
 * éste respalda el asiento. Uno es del bolsillo de alguien, el otro de la caja.
 *
 * Usa las CUATRO columnas del ticket a propósito. La geometría de cuatro está
 * medida contra un ticket real (concepto 29, después 7, 8 y 8) y la de dos
 * colapsa a «primera … última», que perdería la fecha y la hora en el medio.
 *
 * @param {string}  sala        nombre de la sucursal
 * @param {boolean} entra       true = ingreso (faltantes), false = vale (sobrantes)
 * @param {string}  referencia  con qué número quedó el documento en el sistema
 * @param {Array}   filas       las diferencias que cubre
 * @param {string}  registradoPor  quién lo marcó
 * @param {string}  cuando      ISO del momento en que se registró
 */
export function construirComprobanteDeAsiento({
    sala, entra, referencia, filas = [], registradoPor, cuando,
}) {
    const total = filas.reduce((a, d) => a + Math.abs(Number(d.monto ?? 0)), 0);

    return {
        titulo: entra ? 'INGRESO POR FALTANTES DE CAJA' : 'VALE POR SOBRANTES DE CAJA',
        encabezado: {
            titulo: soloAscii(EMPRESA.razonSocial),
            lineas: [`NIT ${EMPRESA.nit}`],
        },
        datos: [
            ['Sala', recortar(sala || '', 34)],
            [entra ? 'No. de ingreso' : 'No. de vale', recortar(referencia || '', 24)],
            ['Cubre', `${filas.length} ${filas.length === 1 ? 'diferencia' : 'diferencias'}`],
        ],
        items: {
            columnas: [
                { label: 'MOTIVO' },
                { label: 'FECHA', alinear: 'der' },
                { label: 'HORA', alinear: 'der' },
                { label: 'MONTO', alinear: 'der' },
            ],
            filas: filas.map((d) => [
                recortar(d.causa || 'Sin motivo', 28),
                fechaCorta(d.fecha).slice(0, 5),
                hhmm(d.hora),
                formatMoney(Math.abs(Number(d.monto ?? 0))),
            ]),
        },
        totales: [[entra ? 'TOTAL QUE ENTRA' : 'TOTAL QUE SALE', formatMoney(total), true]],
        pie: [
            `Registro: ${recortar(registradoPor || 'Sin registrar', 40)}`,
            selloDeTiempo(cuando),
            '',
            'Firma ______________________',
            '',
            entra
                ? 'Anexar al ingreso de caja.'
                : 'Anexar al vale de caja.',
        ],
    };
}

/**
 * El comprobante de una diferencia resuelta.
 *
 * @param {object}  corte        el corte al que pertenece (fecha, hora, caja)
 * @param {string}  sala         nombre de la sucursal
 * @param {object}  diferencia   la fila de `cortes_caja_diferencias`
 * @param {Array}   personas     [{ nombre, monto }] — quiénes aportan
 * @param {string}  registradoPor nombre de quien resolvió
 * @returns el objeto `ticket` que espera `imprimirDocumento`
 */
export function construirComprobante({ corte, sala, diferencia, personas = [], registradoPor }) {
    const via = diferencia?.via || 'JUSTIFICA';
    const monto = Math.abs(Number(diferencia?.monto ?? 0));

    // La fecha del CORTE y la de la firma son dos cosas distintas y las dos
    // tienen que estar: el usuario pidió «por faltante del dia tal» (la del
    // corte) y «quien, cuando y a que horas» (la de la firma). Un comprobante
    // con una sola fecha no se puede anexar al corte que corresponde.
    const datos = [
        ['Sala', recortar(sala || '', 34)],
        ['Corte del', `${fechaCorta(corte?.fecha)}  ${hhmm(corte?.hora)}`],
        ['Caja', recortar(corte?.empleado_texto || '', 34)],
    ];

    const bloques = [{
        titulo: 'MOTIVO',
        texto: recortar(diferencia?.causa || '', 160),
    }];

    // Quiénes aportan, con su parte. Sólo en una reposición: un sobrante que se
    // retira o que se justifica no lo pone nadie de su bolsillo.
    const items = personas.length ? {
        columnas: [{ label: 'QUIEN REPONE' }, { label: 'MONTO', alinear: 'der' }],
        filas: personas.map((p) => [
            recortar(p.nombre || 'Sin nombre', COLUMNAS - 14),
            formatMoney(Math.abs(Number(p.monto ?? 0))),
        ]),
    } : undefined;

    return {
        titulo: TITULO[via] || TITULO.JUSTIFICA,
        encabezado: {
            titulo: soloAscii(EMPRESA.razonSocial),
            lineas: [`NIT ${EMPRESA.nit}`],
        },
        datos,
        bloques,
        items,
        totales: [[CONCEPTO[via] || '', formatMoney(monto), true]],
        pie: [
            `Registro: ${recortar(registradoPor || 'Sin registrar', 40)}`,
            selloDeTiempo(diferencia?.registrado_at),
            '',
            'Entrega ____________________',
            '',
            'Recibe   ____________________',
            '',
            'Anexar este comprobante al corte.',
        ],
    };
}
