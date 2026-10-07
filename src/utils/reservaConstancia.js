// La constancia de una reserva hecha en la sucursal (2026-10-07).
//
// Se le entrega al cliente que deja un anticipo: dice qué apartó, cuánto dejó,
// cuánto le falta y hasta cuándo puede retirarlo (7 días). Lleva el código de
// la reserva en barras para que la caja la encuentre escaneándolo — sin el
// número escrito debajo, igual que el resto de papeles del portal.
import { imprimirDocumento, fechaHora } from './ticketPrint';
import { formatMoney } from './formatNumber';

const recortar = (t, n) => (String(t ?? '').length > n ? `${String(t).slice(0, n - 1)}.` : String(t ?? ''));

export function construirConstanciaDeReserva({ codigo, cliente, producto, cantidad, precio, anticipo, metodo, venceAt, sala, atendio, ahora = new Date() }) {
    const total = Math.round(Number(precio) * Number(cantidad) * 100) / 100;
    const saldo = Math.round((total - Number(anticipo)) * 100) / 100;
    return {
        titulo: '',
        encabezado: { titulo: 'RESERVA', lineas: [sala, cliente].filter(Boolean) },
        bloques: [{ titulo: 'Codigo', texto: codigo, destacado: true }],
        items: {
            columnas: [{ label: 'PRODUCTO' }, { label: 'CANT', alinear: 'der' }],
            filas: [[recortar(producto, 40), String(cantidad)]],
        },
        datos: [
            ['Total', formatMoney(total)],
            ['Anticipo', `${formatMoney(Number(anticipo))} (${metodo})`],
            ['Saldo al retirar', formatMoney(saldo)],
            ['Retirar antes de', fechaHora(new Date(venceAt))],
            ['Impreso', fechaHora(ahora)],
            ...(atendio ? [['Atendio', atendio]] : []),
        ],
        codigos: [{ valor: codigo, simbologia: 'CODE128' }],
        pie: [
            'Presenta este papel para retirar.',
            'Pasados 7 dias la reserva vence.',
        ],
    };
}

export function imprimirConstanciaDeReserva(datos, { sala = null } = {}) {
    return imprimirDocumento(construirConstanciaDeReserva(datos), { sala, tituloDeCola: `Reserva ${datos.codigo}` });
}
