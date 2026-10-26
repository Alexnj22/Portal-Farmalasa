// Reservas de la app de clientes vistas desde la sala — lo que decide el
// widget del portal (`WidgetReservas`) y la pantalla de la app, escrito UNA
// vez: buscar por el código que el cliente muestra (R-000123 o el pedido del
// carrito P-XXXXXX, que el lector escribe como un teclado) y sumar el pedido.
import { codigoDeEncargo, codigoDeReserva, reservaPorResolver, reservaPorTraer } from '../data/reservas';
import { fechaTexto } from './fecha';
import { puedeEnviarPreventa } from './preventa';

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

// ── La tarjeta y el detalle de una reserva (2026-10-22) ─────────────────────
// Lo que la tarjeta y el detalle dicen IGUAL —el estado en palabras, las
// cuentas, el teléfono, el plazo—, escrito una vez para el portal
// (`TarjetaDeReserva`/`DetalleDeReserva`, vía `views/dashboard/reservaVista`)
// y la app (`reservas-sala`, `reserva/[id]`). Antes vivía en la vista del
// portal; se mudó acá para que las dos no terminen contando cosas distintas.

/**
 * `TRASLADO_DE_RESERVA` con las claves del `Badge` del portal (`label`,
 * `variant`). DERIVADO, no copiado: los rótulos se escriben una sola vez.
 */
export const TRASLADO = Object.fromEntries(Object.entries(TRASLADO_DE_RESERVA)
    .map(([k, v]) => [k, { label: v.texto, variant: v.tono }]));

/** Los renglones de una tarjeta: un pedido trae `renglones`; una reserva sola es su único renglón. */
export const renglonesDe = (r) => r?.renglones ?? [r];

/**
 * Un estado por tarjeta: lo que pide la próxima acción de la sala.
 * `{ label, variant, tono? }` — `tono` sólo cuando la tarjeta entera se tiñe.
 */
export function estadoDeReserva(r) {
    const filas = renglonesDe(r);
    if (r.estado === 'en_revision') {
        return r.receta_estado === 'otra_foto'
            ? { label: 'Esperando otra foto', variant: 'info' }
            : { label: 'Receta por revisar', variant: 'warning', tono: 'warning' };
    }
    const pendientes = filas.filter((x) => x.estado === 'pendiente');
    if (pendientes.length && pendientes.length < filas.length) return { label: 'Una parte en camino', variant: 'info' };
    if (pendientes.length) {
        const t = pendientes.map((x) => TRASLADO[x.traslado_estado]).find(Boolean);
        if (t) return { ...t, tono: t.variant === 'danger' ? 'danger' : undefined };
        return { label: 'Por apartar', variant: 'warning' };
    }
    return { label: 'Lista para retirar', variant: 'success' };
}

/** Total (con el envío), lo pagado y lo que falta. Pagada en línea cuenta entera; si no, el anticipo. */
export function cuentasDeReserva(r) {
    const filas = renglonesDe(r);
    const total = filas.reduce((t, x) => t + Number(x.precio ?? 0) * Number(x.cantidad ?? 1), 0) + Number(r.costo_envio ?? 0);
    const pagadoTodo = filas.every((x) => x.pago_estado === 'pagado') && !filas.some((x) => x.pago_prueba);
    const anticipo = filas.reduce((t, x) => t + Number(x.anticipo ?? 0), 0);
    const pagado = pagadoTodo ? total : Math.min(anticipo, total);
    return { total, pagado, falta: Math.max(0, Math.round((total - pagado) * 100) / 100), pagadoTodo };
}

/** 72557451 → 7255-7451 */
export function telefonoLegible(tel) {
    const d = String(tel ?? '').replace(/\D/g, '');
    if (!d) return '';
    return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4)}` : d;
}

export const formaDePagoLegible = (m) => ({
    efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', en_linea: 'En línea',
}[String(m ?? '').toLowerCase()] ?? (m || '—'));

/** El estado de la receta de una reserva bajo receta, en palabras. */
export const recetaLegible = (estado) => ({
    pendiente: 'Por revisar', aprobada: 'Aprobada', rechazada: 'Rechazada', otra_foto: 'Se pidió otra foto',
}[estado] ?? 'Sin receta');

/**
 * Una línea por producto: en qué va SU parte (sólo cuando dice algo; si no,
 * la tarjeta pone «$x c/u»). Igual que `detalleDelRenglon` de la tarjeta del
 * portal (v2.1349.3).
 */
export function detalleDelRenglonDeReserva(x) {
    if (x.estado === 'pendiente' && x.traslado_estado) {
        const de = x.traslado_sala ? ` de ${x.traslado_sala}` : '';
        const llegaron = Number(x.traslado_llegaron ?? 0);
        return `${x.traslado_nota || `En camino${de}`}${llegaron > 0 ? ` · llegaron ${llegaron} de ${x.cantidad}` : ''}`;
    }
    if (x.estado === 'pendiente') return 'Por apartar en la sala';
    if (x.estado === 'lista' && x.lista_precio) return x.lista_precio === 'mayoreo_plus' ? 'Lista · precio Mayoreo Plus' : 'Lista · precio Mayoreo';
    if (x.estado === 'lista') return 'Lista';
    if (x.lista_precio) return x.lista_precio === 'mayoreo_plus' ? 'Precio Mayoreo Plus' : 'Precio Mayoreo';
    return '';
}

/** Hasta cuándo vale lo que está pasando ahora con la reserva. */
export function plazoDeReserva(r) {
    const dia = (v) => fechaTexto(v, { weekday: 'short', day: 'numeric', month: 'short' });
    if (r.estado === 'lista' && r.vence_at) return `Retira hasta el ${dia(r.vence_at)}${r.prorrogada_at ? ' (prorrogada)' : ''}`;
    if (r.estado === 'pendiente' && r.horas_al_preparar) {
        const dias = Math.round(Number(r.horas_al_preparar) / 24);
        return `Al quedar lista tiene ${dias >= 1 ? `${dias} ${dias === 1 ? 'día' : 'días'}` : `${r.horas_al_preparar} h`} para retirarla`;
    }
    if (r.creada) return `Creada el ${dia(r.creada)}`;
    return '';
}

/** Cuántos productos muestra la tarjeta antes del «+N más» (el resto, en el detalle). */
export const PRODUCTOS_EN_TARJETA = 2;

/** «+ 1 producto más» / «+ 3 productos más». */
export const productosOcultos = (n) => (n > 0 ? `+ ${n} ${n === 1 ? 'producto más' : 'productos más'}` : '');

/**
 * Qué se puede hacer con una tarjeta de reserva, EN ORDEN y con su rótulo
 * (2026-10-22). Es la decisión de `accionesDeReserva` del `WidgetReservas` del
 * portal sin los handlers, para que el portal y la app ofrezcan lo mismo:
 *
 *   receta («Revisar receta» / «Ver receta») | resolver, apartar, retirar,
 *   caja, traer (sólo sin resolver), whatsapp (lista y sin app),
 *   prorrogar, cancelar (`menor`).
 *
 * La PRIMERA es la principal; la tarjeta muestra las dos primeras y el resto
 * va al detalle. `renglon` es el renglón sobre el que actúa resolver/traer:
 * en un pedido de varios productos, el que lo necesita y no el primero.
 */
export function accionesDeReservaNucleo(r, { soloLectura = false, puedeRecetas = false, puedePreventa = false } = {}) {
    if (!r) return [];
    const enRevision = r.estado === 'en_revision';
    if (soloLectura && !enRevision) return [];
    const filas = renglonesDe(r);
    const lista = [];
    if (enRevision) {
        if (r.receta_ruta && (r.puede_revisar_receta ?? puedeRecetas)) {
            lista.push({ k: 'receta', label: r.receta_estado === 'pendiente' ? 'Revisar receta' : 'Ver receta' });
        }
        // Reglamento, cláusula 3.10: se cancela cualquier reserva no retirada,
        // también la que espera receta (la base lo permite). Quien no revisa
        // recetas no la aparta, pero sí la cancela si el cliente lo pide.
        if (!soloLectura) lista.push({ k: 'cancelar', label: 'Cancelar reserva', menor: true });
        return lista;
    }
    const hayPendiente = filas.some((x) => x.estado === 'pendiente');
    const hayLista = filas.some((x) => x.estado === 'lista');
    const porResolverDe = filas.find(reservaPorResolver);
    const porTraerDe = filas.find(reservaPorTraer);
    const enCamino = filas.some((x) => x.estado === 'pendiente' && x.traslado_estado);
    if (porResolverDe) lista.push({ k: 'resolver', label: 'Resolver', renglon: porResolverDe,
        title: 'La otra sala no la manda, llega una parte o Bodega cambió el precio: decide qué hacer' });
    if (hayPendiente) lista.push({ k: 'apartar', label: enCamino ? 'Ya llegó: apartar' : 'Apartar y avisar',
        title: enCamino ? 'Si el traslado ya llegó y no quedó lista sola: déjala lista y avisa al cliente' : 'Déjala lista para retirar y avisa al cliente' });
    if (hayLista) lista.push({ k: 'retirar', label: 'Retirar', title: 'El cliente vino: cobra lo que falta y entrégala' });
    if (puedePreventa && filas.some(puedeEnviarPreventa)) lista.push({ k: 'caja', label: 'Enviar a caja',
        title: 'Deja la venta armada en caja: producto, cliente y tú como vendedor' });
    if (!porResolverDe && porTraerDe) lista.push({ k: 'traer', label: 'Traer de otra sala', renglon: porTraerDe,
        title: `Si esta sala no tiene ${porTraerDe.producto}: pedirlo a otra sala o a Bodega` });
    if (hayLista && !r.tiene_app) lista.push({ k: 'whatsapp', label: 'Avisar por WhatsApp' });
    // La prórroga la decide la base (`prorrogable`): el reglamento v2 la quita
    // desde `reglas_v2_desde()`. Sin el campo (respuesta vieja), la regla v1.
    if (filas.some((x) => x.estado === 'lista' && (x.prorrogable ?? !x.prorrogada_at))) lista.push({ k: 'prorrogar', label: 'Prorrogar 7 días', title: 'Una sola prórroga' });
    // Reglamento v2, cláusula 9: el aviso por llamada queda registrado (quién,
    // cuándo y qué respondió el cliente). Lo habilita la base (`registrar_llamada`).
    if (filas.some((x) => x.registrar_llamada)) lista.push({ k: 'llamada', label: 'Registrar llamada', title: 'Anota que llamaste al cliente y qué respondió' });
    lista.push({ k: 'cancelar', label: 'Cancelar reserva', menor: true });
    return lista;
}

/**
 * El texto de «Resolver» para una reserva de la APP. Desde el 2026-10-26 se
 * ajusta igual que una de sala (cláusula 3.6): lo que cambia es que el cliente
 * no está enfrente, así que se le llama antes y la app le avisa lo que quedó.
 * Vacío para una de sala.
 */
export function textoDeResolverDeLaApp(r) {
    if (r?.origen !== 'app') return '';
    return 'Reserva de la app: llama al cliente antes de decidir. Le llega el aviso con lo que quedó y, si sobra dinero, queda a su favor.';
}

/**
 * Si la reserva quedó pero el traslado no se pidió (2026-10-26). Un traslado
 * pedido después desde Inventario NO queda amarrado a la reserva —y para una
 * reserva de sala no hay «Traer de otra sala» en la lista—, así que no se
 * completa sola: hay que marcarla lista a mano cuando llegue.
 */
export const SI_EL_TRASLADO_NO_SALIO = 'Pide el traslado desde Inventario y, cuando llegue, márcala como lista en Reservas.';

/** Lo que sigue cuando el cliente no acepta el precio de Bodega. */
export const textoAlNoAceptarElPrecio = () => 'Ahora decide con el cliente: lo que llegó, una alternativa o cancelar.';

/**
 * Lo que dice la tarjeta de una reserva que espera receta cuando quien la mira
 * no la puede revisar (2026-10-26): sin esto quedaba sin texto ni botón y no
 * se sabía quién la tenía que mover. Vacío si no aplica.
 */
export function quienRevisaLaReceta(r, { puedeRecetas = false } = {}) {
    if (!r || r.estado !== 'en_revision' || !r.receta_ruta) return '';
    return (r.puede_revisar_receta ?? puedeRecetas) ? '' : 'La revisa quien tiene permiso de recetas';
}

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
        prorrogable: filas.some((x) => x.estado === 'lista' && (x.prorrogable ?? !x.prorrogada_at)),
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

/**
 * Los rótulos de las acciones de un encargo (2026-10-26): los mismos en el
 * portal y en la app del personal. Escritos dos veces se habían separado
 * («Pedido» / «Ya se pidió», «No se consigue» / «No se puede conseguir»…).
 */
export const ROTULOS_DE_ENCARGO = {
    confirmar: 'Confirmar',
    rechazar: 'No se puede conseguir',
    pedido: 'Ya se pidió',
    vincular: 'Vincular producto',
    llego: 'Llegó',
    entregar: 'Entregar',
    whatsapp: 'Avisar por WhatsApp',
    llamada: 'Registrar llamada',
    fecha: 'Cambiar fecha',
    no_entrego: 'El proveedor no entregó',
    foto: 'Ver la foto',
    prorrogar: 'Prorrogar 7 días',
    saldo: 'Pasar a saldo a favor',
};

/**
 * Lo que dice la tarjeta de un encargo que no tiene botón en la sala. Hoy: el
 * confirmado que espera el pago del cliente («Esperando pago»), que se cobra
 * desde otra pantalla. Vacío si no aplica.
 */
export function notaDeEncargo(e) {
    if (e?.estado === 'confirmado' && !e?.reserva) return 'Se cobra en Reservar con anticipo → Por cobrar';
    return '';
}

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

/**
 * Cuánto dura lo que se aparta en la sala, dicho para quien atiende. Las
 * reglas son las de `reserva_reglas()` (v1 o v2 por fecha); sin ellas, v1.
 * v2: con anticipo 30 días y pagado completo 60 (cláusula 3.3).
 */
export function plazoAlApartar(reglas) {
    return reglas?.v2 ? `${reglas.dias_anticipo} días (${reglas.dias_pagada} si lo paga completo)` : '7 días';
}

/**
 * «Cliente Oro · con prioridad»: el nivel del cliente que lo pone primero en
 * la lista (`nivel` de `reservas_de_sucursal` / `encargos_de_sucursal`, que la
 * base manda sólo desde `reglas_v2_desde()`).
 */
export function textoDeNivel(nivel) {
    return nivel?.prioridad ? `Cliente ${nivel.nombre} · con prioridad` : null;
}
