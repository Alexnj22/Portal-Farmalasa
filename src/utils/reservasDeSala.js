// Reservas de la app de clientes vistas desde la sala — lo que decide el
// widget del portal (`WidgetReservas`) y la pantalla de la app, escrito UNA
// vez: buscar por el código que el cliente muestra (R-000123 o el pedido del
// carrito P-XXXXXX, que el lector escribe como un teclado) y sumar el pedido.
import { codigoDeEncargo, codigoDeReserva } from '../data/reservas';
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
    // Vencida, cancelada o ajustada con el cliente (2026-10-22): no sólo vencida.
    anticipo: 'anticipo de una reserva que no se llevó',
    pago_en_linea: 'pagado en línea y no entregado',
    pago_tardio: 'pago que llegó con la reserva ya cerrada',
    pago_duplicado: 'pago en línea de más',
}[r?.saldo_favor_origen] ?? 'anticipo de una reserva que no se llevó');

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

// ── La lista de la sala, como la pinta la pantalla (2026-10-22) ─────────────
// Escrito una vez para `WidgetReservas` y `reservas-sala` de la app.

/** En qué va una reserva que viene de otra sala o de Bodega. `tono`: info, warning o danger. */
export const TRASLADO_DE_RESERVA = {
    pedido: { texto: 'Pedida a otra sala', tono: 'info' },
    enviado: { texto: 'En camino', tono: 'info' },
    parcial: { texto: 'Viene una parte', tono: 'warning' },
    rechazado: { texto: 'No la mandan', tono: 'danger' },
    bodega: { texto: 'Encargada a Bodega', tono: 'info' },
    precio: { texto: 'Bodega: otro precio', tono: 'warning' },
    sin_existencia: { texto: 'No se consigue', tono: 'danger' },
};

/**
 * Un pedido (del carrito de la app, o de varios productos cobrados juntos en
 * caja) es UNA tarjeta con todos sus renglones (`renglones`). Un renglón con
 * receta por revisar va solo: se decide aparte del resto del pedido.
 */
export function agruparPorPedido(visibles) {
    const grupos = [];
    for (const r of visibles || []) {
        const agrupa = r.pedido && r.estado !== 'en_revision';
        const g = agrupa ? grupos.find((x) => x.pedido === r.pedido && x.estado !== 'en_revision') : null;
        if (g) { g.renglones.push(r); continue; }
        grupos.push(agrupa ? { ...r, renglones: [r] } : r);
    }
    return grupos;
}

/** Las cuentas de una tarjeta (una reserva sola o un pedido entero). */
export function cuentasDelGrupo(r) {
    const filas = r?.renglones ?? [r];
    return {
        filas,
        hayPendiente: filas.some((x) => x.estado === 'pendiente'),
        hayLista: filas.some((x) => x.estado === 'lista'),
        anticipo: filas.reduce((t, x) => t + Number(x.anticipo ?? 0), 0),
        total: filas.reduce((t, x) => t + Number(x.precio ?? 0) * Number(x.cantidad ?? 1), 0),
        todoPagado: filas.every((x) => x.pago_estado === 'pagado'),
        // Algún renglón listo que todavía no usó su única prórroga.
        prorrogable: filas.some((x) => x.estado === 'lista' && !x.prorrogada_at),
        // «Ya llegó: apartar» cuando lo pendiente venía por traslado.
        vieneDeTraslado: filas.some((x) => x.estado === 'pendiente' && x.traslado_estado),
    };
}

/** Por preparar: llegan de otra sala, esperan receta o hay que apartarlas. */
export const esPorPreparar = (g) => g.estado === 'en_revision' || (g.renglones ?? [g]).some((x) => x.estado === 'pendiente');

/** La lista partida en lo que hay que hacer y lo que espera al cliente («me pierdo», 2026-10-22). */
export function seccionesDeReservas(grupos) {
    return [
        { clave: 'preparar', titulo: 'Por preparar', ayuda: 'Llegan de otra sala, esperan receta o hay que apartarlas', lista: (grupos || []).filter(esPorPreparar) },
        { clave: 'listas', titulo: 'Listas para retirar', ayuda: 'Apartadas: el cliente ya puede pasar', lista: (grupos || []).filter((g) => !esPorPreparar(g)) },
    ].filter((s) => s.lista.length);
}

/** El carril de la pantalla: cuánto hay que preparar, cuánto espera al cliente y los saldos. */
export function conteoDeReservas(filas) {
    // Cuenta TARJETAS, no renglones: un pedido P- es una sola, igual que en la lista.
    const porTarjeta = new Map();
    for (const r of reservasAbiertas(filas)) {
        const k = r.pedido && r.estado !== 'en_revision' ? `p:${r.pedido}` : `r:${r.id}`;
        porTarjeta.set(k, [...(porTarjeta.get(k) ?? []), r]);
    }
    const tarjetas = [...porTarjeta.values()];
    const preparar = tarjetas.filter((g) => g.some((x) => x.estado === 'en_revision' || x.estado === 'pendiente')).length;
    return { preparar, listas: tarjetas.length - preparar, saldos: saldosAFavor(filas).length };
}

/** El título de la tarjeta: un producto, o el pedido con su total (y el envío). */
export function tituloDelGrupo(r) {
    if (r.renglones && r.renglones.length > 1) {
        const total = r.renglones.reduce((t, x) => t + Number(x.precio ?? 0) * Number(x.cantidad ?? 1), 0) + Number(r.costo_envio ?? 0);
        return { pedido: true, total, texto: `Pedido ${r.pedido} · ${r.renglones.length} productos` };
    }
    return { pedido: false, total: null, texto: `${r.cantidad} × ${r.producto}` };
}

/** Los productos de un pedido en una línea, con lo que todavía viene en camino y lo cobrado a mayoreo. */
export function productosDelPedido(r) {
    if (!(r.renglones && r.renglones.length > 1)) return '';
    const hayLista = r.renglones.some((x) => x.estado === 'lista');
    const mezcla = r.renglones.some((y) => !y.lista_precio);
    return r.renglones.map((x) => `${x.cantidad} × ${x.producto}${x.estado === 'pendiente' && hayLista ? ' (en camino)' : ''}${x.lista_precio && mezcla ? ' (a mayoreo)' : ''}`).join(' · ');
}

/** La lista de precio con que se cobró en la app (mayoreo): en caja se factura con ésa. */
export function listaDePrecioDelGrupo(r) {
    const filas = r?.renglones ?? [r];
    if (!filas.some((x) => x.lista_precio)) return null;
    return filas.some((x) => x.lista_precio === 'mayoreo_plus') ? 'Precio Mayoreo Plus' : 'Precio Mayoreo';
}

/** Un código COMPLETO (R-000123 o P-XXXXXX): puede ser un saldo a favor de otra sala. */
export function codigoCompleto(codigo) {
    const c = String(codigo ?? '').trim().toUpperCase();
    return /^(R-\d{6,}|P-[A-Z0-9]{6})$/.test(c) ? c : '';
}

// ── Encargos (2026-10-07 / 2026-10-22) ──────────────────────────────────────

export const ESTADO_DE_ENCARGO = {
    solicitado: { texto: 'Por responder', tono: 'warning' },
    confirmado: { texto: 'Esperando pago', tono: 'info' },
    aceptado: { texto: 'Pagado · pedir', tono: 'success' },
    pedido: { texto: 'Pedido', tono: 'info' },
    listo: { texto: 'Llegó', tono: 'success' },
};
// El resto de una reserva: lo que decide es el cliente, y ya pagó con la reserva.
const ESTADO_DE_ENCARGO_DE_RESERVA = {
    confirmado: { texto: 'Otro precio · decide el cliente', tono: 'warning' },
    aceptado: { texto: 'Reservado · pedir', tono: 'success' },
};
export const estadoDeEncargo = (e) => (e?.reserva && ESTADO_DE_ENCARGO_DE_RESERVA[e.estado]) || ESTADO_DE_ENCARGO[e?.estado] || { texto: e?.estado ?? '', tono: 'neutral' };

/** Un producto que no tenemos y Bodega todavía no amarró al catálogo: sin eso no se marca «Llegó». */
export const encargoSinVincular = (e) => !!e?.producto_nuevo && !e?.product_id;

/** Llegó y se pasó el plazo de retiro: hay que llamar al cliente. `hoy` en `YYYY-MM-DD`. */
export const encargoVencido = (e, hoy) => e?.estado === 'listo' && !!e?.retirar_hasta && e.retirar_hasta < hoy;

/** Un producto raro y no devolvible pide el visto bueno del gerente antes de confirmarlo. */
export const encargoConRiesgo = (e) => !e?.producto_nuevo && (!e?.devolutivo || !e?.vendido_antes);

/** Lo que se le cuenta a Bodega del producto nuevo: la ficha del SRS, o que no aparece. */
export function fichaDeProductoNuevo(e) {
    const r = e?.srs;
    return r ? `En el SRS: ${[r.nombre, r.principio, r.conc, r.forma, r.lab, r.noregistro && `Reg. ${r.noregistro}`].filter(Boolean).join(' · ')}.`
        : 'No aparece en el SRS: revisar antes de responder.';
}

/**
 * «Por cobrar» de Apartar: encargos con precio confirmado que esperan el pago
 * (se pagan completos) y reservas de sala con saldo pendiente.
 */
export function porCobrarDeSala(encargos, reservas) {
    const r2 = (n) => Math.round(Number(n) * 100) / 100;
    const e = (encargos ?? []).filter((x) => x.estado === 'confirmado' && x.pago_estado === 'pendiente' && !x.reserva_id).map((x) => ({
        clave: `e${x.id}`, tipo: 'encargo', id: x.id, codigo: codigoDeEncargo(x.id), cliente: x.cliente, producto: x.producto,
        cantidad: x.cantidad, precio: Number(x.precio_unitario), saldo: Number(x.anticipo), fecha: x.fecha_estimada,
    }));
    const r = (reservas ?? []).filter((x) => x.origen === 'sucursal' && ['lista', 'pendiente'].includes(x.estado)
        && Number(x.precio) * Number(x.cantidad) - Number(x.anticipo || 0) > 0.004).map((x) => ({
        clave: `r${x.id}`, tipo: 'reserva', id: x.id, codigo: codigoDeReserva(x.id), cliente: x.cliente,
        producto: x.producto, cantidad: x.cantidad, precio: Number(x.precio),
        saldo: r2(Number(x.precio) * Number(x.cantidad) - Number(x.anticipo || 0)),
    }));
    return [...e, ...r];
}

/** El `apartado` de `operar-caja` para cobrar algo de «Por cobrar». */
export const apartadoPorCobrar = (f) => (f.tipo === 'encargo' ? { modo: 'encargo', encargo_id: f.id } : { modo: 'reserva', reserva_id: f.id });
