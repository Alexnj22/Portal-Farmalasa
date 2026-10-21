// Reservas de la app de clientes vistas desde la sala — lo que decide el
// widget del portal (`WidgetReservas`) y la pantalla de la app, escrito UNA
// vez: buscar por el código que el cliente muestra (R-000123 o el pedido del
// carrito P-XXXXXX, que el lector escribe como un teclado) y sumar el pedido.
import { codigoDeReserva } from '../data/reservas';
import { fechaTexto } from './fecha';

const ABIERTAS = ['en_revision', 'pendiente', 'lista'];

/**
 * Las reservas ABIERTAS: en revisión de receta, pendientes y listas. Lo
 * cerrado (vencido o cancelado) sólo viaja si dejó un saldo a favor, y ése va
 * aparte — `saldosAFavor`. Igual que el widget del portal.
 *
 * (2026-10-19) Antes era «todo lo que no está vencido»: desde que lo pagado en
 * línea y cancelado también queda a favor, una CANCELADA con saldo habría
 * aparecido como reserva abierta, con sus botones de apartar y retirar.
 */
export const reservasAbiertas = (filas) => (filas || []).filter((r) => ABIERTAS.includes(r.estado));

/**
 * Los saldos a favor vigentes: el anticipo de una reserva de sala vencida, y
 * desde el 2026-10-19 también lo pagado en línea que no se entregó (la sala
 * canceló, venció, o el pago llegó tarde). Ni usados ni devueltos en dinero.
 */
export const saldosAFavor = (filas) => (filas || []).filter((r) => !ABIERTAS.includes(r.estado)
    && Number(r.saldo_favor) > 0 && !r.saldo_favor_usado_at && !r.saldo_favor_devuelto_at);

/** De dónde salió un saldo a favor, en palabras de la sala. */
export const origenDelSaldo = (r) => ({
    anticipo: 'anticipo de una reserva vencida',
    pago_en_linea: 'pagado en línea y no entregado',
    pago_tardio: 'pago que llegó con la reserva ya cerrada',
    pago_duplicado: 'pago en línea de más',
}[r?.saldo_favor_origen] ?? 'anticipo de una reserva vencida');

/** Un cobro en línea de PRUEBA no es dinero: la sala lo cobra en caja. */
export const esPagoDePrueba = (r) => r?.pago_estado === 'pagado' && r?.pago_metodo === 'en_linea' && r?.pago_prueba === true;

export const reservasPendientes = (filas) => reservasAbiertas(filas).filter((r) => r.estado === 'pendiente').length;

// El código se compara SÓLO por letras y dígitos (2026-10-20). Las barras
// —la constancia impresa y la tarjeta de la app— llevan `R001234`, sin guion
// (`limpiarValorDeBarras`), y un lector con la distribución de teclado cambiada
// escribe el guion como otro signo. Comparando tal cual, escanear el papel no
// encontraba la reserva.
export const codigoLimpio = (t) => String(t ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** ¿La fila es la del código escrito o escaneado (con o sin guion)? */
export const coincideCodigo = (r, codigo) => {
    const buscado = codigoLimpio(codigo);
    return !!buscado && (codigoLimpio(codigoDeReserva(r.id)).includes(buscado) || codigoLimpio(r.pedido).includes(buscado));
};

/** Las que coinciden con el código escrito; sin código, todas (o las primeras `max`). */
export function reservasPorCodigo(filas, codigo, max = null) {
    const abiertas = reservasAbiertas(filas);
    if (!codigoLimpio(codigo)) return max == null ? abiertas : abiertas.slice(0, max);
    return abiertas.filter((r) => coincideCodigo(r, codigo));
}

/** Los renglones del pedido del carrito cuyo código es exactamente el buscado. */
export function renglonesDelPedido(visibles, codigo) {
    const buscado = codigoLimpio(codigo);
    if (!buscado.startsWith('P')) return [];
    return (visibles || []).filter((r) => r.pedido && codigoLimpio(r.pedido) === buscado);
}

/** Si el código es de un pedido del carrito: sus renglones, el total y si se pagó en línea. */
export function resumenDelPedido(visibles, codigo) {
    const renglones = renglonesDelPedido(visibles, codigo);
    return {
        pedido: renglones[0]?.pedido ?? String(codigo ?? '').trim().toUpperCase(), renglones,
        total: renglones.reduce((t, r) => t + Number(r.precio ?? 0) * Number(r.cantidad ?? 1), 0),
        pagado: renglones.length > 0 && renglones.every((r) => r.pago_estado === 'pagado' && !esPagoDePrueba(r)),
        prueba: renglones.some(esPagoDePrueba),
        fiscal: renglones[0]?.documento === 'credito_fiscal' ? (renglones[0]?.datos_fiscales ?? null) : null,
    };
}

/** El nombre de pila del cliente, como lo muestra la lista. */
export const pilaDelCliente = (r) => String(r.cliente ?? '').split(/\s+/)[0] ?? '';

/**
 * Hasta cuándo se retira una reserva lista: un DÍA, nunca una hora (2026-10-20,
 * regla del dueño: «la hora no, cuenta todo el día»). `reservas_vencer` la
 * vence cuando termina ese día en El Salvador.
 */
export const plazoDeRetiro = (r) => `retira hasta el ${fechaTexto(r.vence_at, { weekday: 'short', day: 'numeric', month: 'short' })}`;
