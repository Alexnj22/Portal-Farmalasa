// La constancia de una reserva hecha en la sucursal (2026-10-07).
//
// Se le entrega al cliente que deja un anticipo: dice qué apartó, cuánto dejó,
// cuánto le falta y hasta cuándo puede retirarlo (7 días). Lleva el código de
// la reserva en barras para que la caja la encuentre escaneándolo — sin el
// número escrito debajo, igual que el resto de papeles del portal.
import { imprimirDocumento, fechaHora } from './ticketPrint';
import { formatMoney } from './formatNumber';

// El plazo del saldo a favor es el de `public.saldo_favor_dias()` (60 desde el
// 2026-10-20). El papel decía 30: se le prometía al cliente la mitad del plazo.
export const DIAS_SALDO_A_FAVOR = 60;

const recortar = (t, n) => (String(t ?? '').length > n ? `${String(t).slice(0, n - 1)}.` : String(t ?? ''));

// Compacta (2026-10-20, «no dice en qué sucursal, hay mucho texto»): el código
// en el título, DÓNDE se retira y hasta cuándo arriba, el producto en una
// línea, los montos como totales y el pie en dos renglones. Sin tabla de
// productos —es uno solo— ni el código repetido en grande.
export function construirConstanciaDeReserva({ codigo, cliente, producto, cantidad, precio, anticipo, metodo, venceAt, sala, atendio, ahora = new Date() }) {
    const total = Math.round(Number(precio) * Number(cantidad) * 100) / 100;
    const saldo = Math.round((total - Number(anticipo)) * 100) / 100;
    return {
        titulo: '',
        encabezado: {
            titulo: `RESERVA ${codigo}`,
            lineas: [sala ? `Retira en ${String(sala).toUpperCase()}` : null, `Hasta el ${fechaHora(new Date(venceAt))}`].filter(Boolean),
        },
        bloques: [{ texto: `${cantidad} x ${recortar(producto, 80)}` }],
        datos: [
            ...(cliente ? [['Cliente', cliente]] : []),
            ['Impreso', fechaHora(ahora)],
            ...(atendio ? [['Atendio', atendio]] : []),
        ],
        // Sin destacado (2026-10-21, «hay textos muy grandes como falta
        // pagar»): en el rollo el destacado es doble alto y en negrita, y
        // «Falta pagar» salía más grande que el propio código de la reserva.
        totales: [
            ['Total', formatMoney(total)],
            [`Anticipo (${metodo})`, formatMoney(Number(anticipo))],
            ['Falta pagar', formatMoney(saldo)],
        ],
        codigos: [{ valor: codigo, simbologia: 'CODE128' }],
        // «Si no la retiras: 60 dias a tu favor» no se entendía: lo que queda
        // a favor es el ANTICIPO, como saldo para otra compra.
        pie: [
            'Trae este papel para retirar.',
            // Partido a mano: el pie viaja tal cual y el rollo cortaría a
            // mitad de palabra en la columna 54.
            'Si no la retiras a tiempo, tu anticipo no se pierde:',
            `queda como saldo a favor por ${DIAS_SALDO_A_FAVOR} dias.`,
        ],
    };
}

export function imprimirConstanciaDeReserva(datos, { sala = null } = {}) {
    return imprimirDocumento(construirConstanciaDeReserva(datos), { sala, tituloDeCola: `Reserva ${datos.codigo}` });
}
