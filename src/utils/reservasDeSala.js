// Reservas de la app de clientes vistas desde la sala — lo que decide el
// widget del portal (`WidgetReservas`) y la pantalla de la app, escrito UNA
// vez: buscar por el código que el cliente muestra (R-000123 o el pedido del
// carrito P-XXXXXX, que el lector escribe como un teclado) y sumar el pedido.
import { codigoDeReserva } from '../data/reservas';

/**
 * Las reservas ABIERTAS: las vencidas no lo son (su anticipo, si lo hubo, es un
 * saldo a favor y va aparte — `saldosAFavor`). Igual que el widget del portal.
 */
export const reservasAbiertas = (filas) => (filas || []).filter((r) => r.estado !== 'vencida');

/** Los anticipos de reservas vencidas que quedaron como saldo a favor del cliente. */
export const saldosAFavor = (filas) => (filas || []).filter((r) => r.estado === 'vencida' && Number(r.saldo_favor) > 0);

export const reservasPendientes = (filas) => reservasAbiertas(filas).filter((r) => r.estado === 'pendiente').length;

/** Las que coinciden con el código escrito; sin código, todas (o las primeras `max`). */
export function reservasPorCodigo(filas, codigo, max = null) {
    const abiertas = reservasAbiertas(filas);
    const buscado = String(codigo ?? '').trim().toUpperCase();
    if (!buscado) return max == null ? abiertas : abiertas.slice(0, max);
    return abiertas.filter((r) => codigoDeReserva(r.id).includes(buscado) || String(r.pedido ?? '').includes(buscado));
}

/** Si el código es de un pedido del carrito: sus renglones, el total y si se pagó en línea. */
export function resumenDelPedido(visibles, codigo) {
    const buscado = String(codigo ?? '').trim().toUpperCase();
    const renglones = buscado.startsWith('P-') ? (visibles || []).filter((r) => r.pedido === buscado) : [];
    return {
        pedido: buscado, renglones,
        total: renglones.reduce((t, r) => t + Number(r.precio ?? 0) * Number(r.cantidad ?? 1), 0),
        pagado: renglones.length > 0 && renglones.every((r) => r.pago_estado === 'pagado'),
        fiscal: renglones[0]?.documento === 'credito_fiscal' ? (renglones[0]?.datos_fiscales ?? null) : null,
    };
}

/** El nombre de pila del cliente, como lo muestra la lista. */
export const pilaDelCliente = (r) => String(r.cliente ?? '').split(/\s+/)[0] ?? '';
