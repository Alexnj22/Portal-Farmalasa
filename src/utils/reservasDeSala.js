// Reservas de la app de clientes vistas desde la sala — lo que decide el
// widget del portal (`WidgetReservas`) y la pantalla de la app, escrito UNA
// vez: buscar por el código que el cliente muestra (R-000123 o el pedido del
// carrito P-XXXXXX, que el lector escribe como un teclado) y sumar el pedido.
import { codigoDeEncargo, codigoDeReserva, reservaPorResolver, reservaPorTraer } from '../data/reservas';
import { fechaTexto } from './fecha';
import { formatMoney } from './formatNumber';
import { fechaHora12 } from './hora';
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
    pedido: { texto: 'Pedida a otra sucursal', tono: 'info' },
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
 * La venta que la caja le hizo a este cliente, de este producto, en esta
 * sucursal, después de reservarlo y sin pasar por «Enviar a caja»
 * (`vendida_aparte` de `reservas_de_sucursal`, 2026-11-20). La R-000164 de
 * Salud 1 siguió «Lista para retirar» una semana después de venderse así.
 */
export const vendidaAparte = (x) => (['pendiente', 'lista'].includes(x?.estado) && x?.vendida_aparte?.at ? x.vendida_aparte : null);

/** Qué hacer con un renglón que ya se vendió en caja; vacío si no. */
export function textoDeVentaAparte(x) {
    const v = vendidaAparte(x);
    if (!v) return '';
    return `El ${fechaHora12(v.at)} se le vendió este producto en caja por ${formatMoney(Number(v.total ?? 0))}, sin pasar por la reserva. `
        + 'Si esa venta fue la entrega de esta reserva, toca «Cerrar con esa venta»: te va a preguntar si se le descontó el anticipo.';
}

/**
 * Cuántas faltan en la sala para entregar un renglón LISTO, en su
 * presentación (2026-11-03). Lo calcula la base (`faltan_en_sala` de
 * `reservas_de_sucursal`): apartar no descuenta el inventario y la caja no
 * conoce las reservas, así que lo apartado se puede vender en mostrador. La
 * R-000151 de Salud 2 dijo «Lista para retirar» tres días con 1 de 3 cajas.
 */
export const faltanEnSala = (x) => (x?.estado === 'lista' ? Math.max(0, Number(x.faltan_en_sala) || 0) : 0);

/** Qué hacer con un renglón listo al que le falta producto; vacío si está completo. */
export function textoDeFaltante(x) {
    if (!faltanEnSala(x) || vendidaAparte(x)) return '';
    const hay = Math.max(0, Number(x.hay_en_sala) || 0);
    return `La existencia de la sucursal es ${hay} de ${x.cantidad}. Antes de que llegue el cliente: si están en el estante, pide una carga de inventario; si no, pídelas a otra sucursal desde Inventario.`;
}

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
    // Ya se vendió en caja por fuera (2026-11-20): va antes que el faltante,
    // que en ese caso es consecuencia de la misma venta.
    if (filas.some((x) => vendidaAparte(x))) return { label: 'Ya se vendió en caja', variant: 'danger', tono: 'danger' };
    // Lista, pero la sala ya no la tiene entera (2026-11-03): va primero porque
    // es lo único que puede dejar al cliente en el mostrador sin su producto.
    const conFalta = filas.filter((x) => faltanEnSala(x) > 0);
    if (conFalta.length) {
        const n = conFalta.length === 1 ? faltanEnSala(conFalta[0]) : 0;
        return { label: n ? `${n === 1 ? 'Falta' : 'Faltan'} ${n} en la sucursal` : 'Falta producto en la sucursal', variant: 'danger', tono: 'danger' };
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
    const vendida = vendidaAparte(x);
    if (vendida) return `Se vendió en caja el ${fechaHora12(vendida.at)}`;
    if (x.estado === 'pendiente' && x.traslado_estado) {
        const de = x.traslado_sala ? ` de ${x.traslado_sala}` : '';
        const llegaron = Number(x.traslado_llegaron ?? 0);
        return `${x.traslado_nota || `En camino${de}`}${llegaron > 0 ? ` · llegaron ${llegaron} de ${x.cantidad}` : ''}`;
    }
    if (x.estado === 'pendiente') return 'Por apartar en la sucursal';
    if (faltanEnSala(x)) return `En la sucursal hay ${Math.max(0, Number(x.hay_en_sala) || 0)} de ${x.cantidad}`;
    if (x.estado === 'lista' && x.lista_precio) return x.lista_precio === 'mayoreo_plus' ? 'Lista · precio Mayoreo Plus' : 'Lista · precio Mayoreo';
    if (x.estado === 'lista') return 'Lista';
    if (x.lista_precio) return x.lista_precio === 'mayoreo_plus' ? 'Precio Mayoreo Plus' : 'Precio Mayoreo';
    return '';
}

/**
 * Cómo se le alarga el plazo a una reserva lista o a un encargo listo
 * (2026-10-30):
 *   'directa'   — condiciones anteriores: la sala la da, 7 días, una vez;
 *   'pedir'     — reglamento v2, cláusula 6.4: se pide con días y motivo y la
 *                 autoriza Talento Humano o Supervisión de ventas;
 *   'pendiente' — ya se pidió y espera la decisión (el plazo no vence);
 *   null        — no aplica, o ya tuvo su prórroga.
 * `prorrogable` lo manda la base y sólo es verdad para la directa; sin el
 * campo (respuesta vieja), la regla vieja.
 */
export function modoDeProrroga(x, { encargo = false } = {}) {
    if (!x) return null;
    const lista = encargo ? x.estado === 'listo' : (x.estado === 'lista' && !!x.vence_at);
    if (!lista) return null;
    if (x.prorroga?.estado === 'pendiente') return 'pendiente';
    const usada = encargo ? x.prorrogado_at : x.prorrogada_at;
    if (x.prorrogable === undefined) return usada ? null : 'directa';
    if (x.prorrogable) return 'directa';
    return usada ? null : 'pedir';
}

/** El texto de la prórroga junto al plazo: «(prorrogada)», «prórroga pedida…», o nada. */
export function textoDeProrroga(x, { encargo = false } = {}) {
    if (modoDeProrroga(x, { encargo }) === 'pendiente') {
        const d = Number(x.prorroga?.dias ?? 0);
        return ` · prórroga de ${d} ${d === 1 ? 'día' : 'días'} pedida, por autorizar`;
    }
    return (encargo ? x?.prorrogado_at : x?.prorrogada_at) ? (encargo ? ' (prorrogado)' : ' (prorrogada)') : '';
}

/** Hasta cuándo vale lo que está pasando ahora con la reserva. */
export function plazoDeReserva(r) {
    const dia = (v) => fechaTexto(v, { weekday: 'short', day: 'numeric', month: 'short' });
    if (r.estado === 'lista' && r.vence_at) return `Retira hasta el ${dia(r.vence_at)}${textoDeProrroga(r)}`;
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
    // Ya se vendió en caja por fuera (2026-11-20): apartar, retirar o mandar a
    // caja ya no tiene sentido. Se cierra amarrada a esa venta, o se cancela.
    const vendida = filas.find((x) => vendidaAparte(x));
    if (vendida) {
        if (!soloLectura) lista.push({ k: 'amarrar', label: 'Cerrar con esa venta', renglon: vendida,
            title: 'Esa venta en caja fue la entrega: la reserva queda retirada y amarrada a esa factura' });
        lista.push({ k: 'cancelar', label: 'Cancelar reserva', menor: true });
        return lista;
    }
    const hayPendiente = filas.some((x) => x.estado === 'pendiente');
    const hayLista = filas.some((x) => x.estado === 'lista');
    const porResolverDe = filas.find(reservaPorResolver);
    const porTraerDe = filas.find(reservaPorTraer);
    const enCamino = filas.some((x) => x.estado === 'pendiente' && x.traslado_estado);
    if (porResolverDe) lista.push({ k: 'resolver', label: 'Resolver', renglon: porResolverDe,
        title: 'La otra sucursal no la manda, llega una parte o Bodega cambió el precio. Decide qué hacer' });
    if (hayPendiente) lista.push({ k: 'apartar', label: enCamino ? 'Ya llegó: apartar' : 'Apartar y avisar',
        title: enCamino ? 'Si el traslado ya llegó y no quedó lista sola: déjala lista y avisa al cliente' : 'Déjala lista para retirar y avisa al cliente' });
    const conFalta = filas.some((x) => faltanEnSala(x) > 0);
    if (hayLista) lista.push({ k: 'retirar', label: 'Retirar', title: conFalta
        ? 'Sólo si el producto está completo en el estante. La existencia de la sucursal no alcanza'
        : 'El cliente vino: cobra lo que falta y entrégala' });
    if (puedePreventa && filas.some(puedeEnviarPreventa)) lista.push({ k: 'caja', label: 'Enviar a caja',
        title: 'Deja la venta armada en caja: producto, cliente y tú como vendedor' });
    if (!porResolverDe && porTraerDe) lista.push({ k: 'traer', label: 'Traer de otra sucursal', renglon: porTraerDe,
        title: `Si esta sucursal no tiene ${porTraerDe.producto}, pídelo a otra sucursal o a Bodega` });
    // Avisarle que está lista cuando no lo está es mandarlo a la sala por nada.
    if (hayLista && !conFalta && !r.tiene_app) lista.push({ k: 'whatsapp', label: 'Avisar por WhatsApp' });
    // La prórroga (`modoDeProrroga`): la directa de 7 días de las condiciones
    // anteriores, o la que se PIDE desde el reglamento v2 (cláusula 6.4).
    const modos = filas.map((x) => modoDeProrroga(x));
    if (modos.includes('directa')) lista.push({ k: 'prorrogar', label: 'Prorrogar 7 días', title: 'Una sola prórroga' });
    else if (modos.includes('pedir') && !modos.includes('pendiente')) lista.push({ k: 'pedir_prorroga', label: 'Pedir prórroga',
        title: 'Los días que necesita el cliente y el motivo: la autoriza Talento Humano o el supervisor de ventas' });
    // Reglamento v2, cláusula 9: el aviso por llamada queda registrado (quién,
    // cuándo y qué respondió el cliente). Lo habilita la base (`registrar_llamada`).
    if (filas.some((x) => x.registrar_llamada)) lista.push({ k: 'llamada', label: 'Registrar aviso', title: 'Anota que le avisaste al cliente (por llamada o en persona) y qué respondió' });
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
        prorrogable: filas.some((x) => modoDeProrroga(x) === 'directa'),
        // «Ya llegó: apartar» cuando lo pendiente venía por traslado.
        vieneDeTraslado: filas.some((x) => x.estado === 'pendiente' && x.traslado_estado),
    };
}

/** Por preparar: llegan de otra sala, esperan receta o hay que apartarlas. */
export const esPorPreparar = (g) => g.estado === 'en_revision' || (g.renglones ?? [g]).some((x) => x.estado === 'pendiente');

/** La lista partida en lo que hay que hacer y lo que espera al cliente («me pierdo», 2026-10-22). */
export function seccionesDeReservas(grupos) {
    return [
        { clave: 'preparar', titulo: 'Por preparar', ayuda: 'Llegan de otra sucursal, esperan receta o hay que apartarlas', lista: (grupos || []).filter(esPorPreparar) },
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
    llamada: 'Registrar aviso',
    cobrar: 'Cobrar',
    fecha: 'Cambiar fecha',
    no_entrego: 'El proveedor no entregó',
    foto: 'Ver la foto',
    prorrogar: 'Prorrogar 7 días',
    pedir_prorroga: 'Pedir prórroga',
    saldo: 'Pasar a saldo a favor',
    cancelar: 'Ya no lo quiere',
    ya_vendido: 'Ya se vendió',
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

/**
 * Un encargo que Bodega todavía no confirma, de un producto con precio en el
 * catálogo (2026-11-21): admite un anticipo contra ese precio de REFERENCIA
 * (`precio_referencia`, la viñeta, de `encargos_de_sucursal`). Sin mínimo y
 * hasta ese total; el precio final lo pone Bodega. La base repite la regla
 * (`apartado_cotizar`).
 */
export const encargoAnticipable = (e) => e?.estado === 'solicitado' && Number(e?.precio_referencia) > 0;

/**
 * Un encargo con precio confirmado cuyo pago todavía no entró (2026-11-04): se
 * cobra completo en caja. El resto de una reserva no, ése va con la reserva.
 */
export const encargoPorCobrar = (e) => (e?.estado === 'confirmado' || encargoAnticipable(e))
    && e?.pago_estado === 'pendiente' && !e?.reserva && !e?.reserva_id;

/** El total de referencia de un encargo sin confirmar, o null. */
const totalDeReferencia = (e) => (encargoAnticipable(e)
    ? Math.round(Number(e.precio_referencia) * Number(e.cantidad || 1) * 100) / 100 : null);

/**
 * La cifra de plata de la tarjeta de un encargo. `anticipo` guarda lo que el
 * cliente paga (el 100 %) desde que Compras confirma el precio, ANTES de que
 * entre el pago: rotularlo «Pagado» sin mirar `pago_estado` decía «Pagado
 * $130.00» sobre un encargo «Esperando pago» (E-000016, 2026-11-04).
 * `null` si no hay monto.
 */
export function cifraDeEncargo(e) {
    // Sin confirmar (2026-11-21): lo que dejó, o el total de referencia por cobrar.
    if (e?.estado === 'solicitado') {
        if (e?.pago_estado === 'anticipo' && Number(e?.abonado) > 0) return { rotulo: 'Anticipo', valor: Number(e.abonado), cobrado: true };
        const ref = totalDeReferencia(e);
        if (ref && encargoPorCobrar(e)) return { rotulo: 'Precio aprox.', valor: ref, cobrado: false };
        return null;
    }
    const valor = Number(e?.anticipo);
    if (!(valor > 0)) return null;
    if (encargoPorCobrar(e)) return { rotulo: 'Por cobrar', valor, cobrado: false };
    // Con adelanto o sin anticipo (2026-11-18), lo que importa es lo que falta cobrar al retirar.
    const cargo = encargoACargo(e);
    if (cargo && cargo.falta > 0.004) return { rotulo: 'Falta al retirar', valor: cargo.falta, cobrado: false };
    return { rotulo: 'Pagado', valor, cobrado: true };
}

/**
 * Un encargo que se pidió sin el 100 % (2026-11-18): con un adelanto
 * (`pago_estado = 'anticipo'`) o sin anticipo. Queda a cargo de quien lo
 * cobró o lo aceptó, como la reserva sin anticipo. `null` si no aplica.
 * `persona` va en la forma de `AvatarConEstado`.
 */
export function encargoACargo(e) {
    const r = e?.responsable;
    if (!r?.id || e?.pago_estado === 'pagado') return null;
    const total = Number(e?.anticipo) || 0;
    const abonado = e?.pago_estado === 'anticipo' ? Number(e?.abonado) || 0 : 0;
    return {
        persona: { id: r.id, first_names: r.first_names, last_names: r.last_names, name: r.name },
        at: r.at ?? null,
        abonado,
        falta: Math.max(Math.round((total - abonado) * 100) / 100, 0),
        sinAnticipo: abonado <= 0.004,
    };
}

/**
 * Los pasos de un encargo, en orden, con quién hizo cada uno (2026-11-04).
 * `e.pasos` lo manda `encargos_de_sucursal`: `{ paso, at, por_id, por,
 * por_nombres, por_apellidos }`. Devuelve los seis pasos del recorrido —los
 * hechos con su persona y su hora, y los que faltan sin ellos— para que la
 * tarjeta muestre dónde está el encargo y qué viene.
 *
 * `persona` es `null` cuando el paso no lo hizo nadie del personal: entonces
 * `quien` lo dice («El cliente, desde la app», «En línea»).
 */
export function pasosDeEncargo(e) {
    const hechos = Object.fromEntries((e?.pasos ?? []).map((p) => [p.paso, p]));
    const persona = (p) => (p?.por_id ? { id: p.por_id, first_names: p.por_nombres, last_names: p.por_apellidos, name: p.por } : null);
    const resto = !!(e?.reserva || e?.reserva_id);
    const orden = ['solicitado', 'confirmado', 'aceptado', 'pedido', 'listo', 'entregado'];
    const en = orden.indexOf(e?.estado);
    // Hecho = hay registro, o el estado ya pasó por ahí (un encargo viejo sin bitácora).
    const paso = (clave, titulo, desde, sinPersona = null) => {
        const h = hechos[clave];
        const hecho = !!h || (en >= 0 && en >= orden.indexOf(desde));
        return { clave, titulo, hecho, at: h?.at ?? null, persona: persona(h), quien: hecho && !persona(h) ? sinPersona : null };
    };
    const cargo = encargoACargo(e);
    const cobrado = resto ? { clave: 'cobrado', titulo: 'Pagado con la reserva', hecho: true, at: null, persona: null, quien: null }
        // Sin el 100 % (2026-11-18): el paso dice cuánto dejó y quién responde.
        : cargo?.sinAnticipo ? { clave: 'cobrado', titulo: 'Sin anticipo, a cargo de', hecho: true, at: cargo.at, persona: cargo.persona, quien: null }
            : cargo ? { ...paso('cobrado', `Dejó ${formatMoney(cargo.abonado)} de adelanto`, 'aceptado', 'En línea'), persona: cargo.persona }
                : paso('cobrado', 'El cliente pagó', 'aceptado', 'En línea');
    return [
        paso('encargado', 'Se encargó', 'solicitado', resto ? `Resto de la reserva ${e.reserva ?? ''}`.trim() : 'El cliente, desde la app'),
        paso('confirmado', 'Compras confirmó precio y fecha', 'confirmado'),
        cobrado,
        paso('pedido', 'Se le pidió al proveedor', 'pedido'),
        paso('llego', 'Llegó a la sucursal', 'listo'),
        paso('entregado', 'Se le entregó al cliente', 'entregado'),
    ];
}

/**
 * Lo que toca AHORA con un encargo, dicho para quien lo tiene enfrente: quién
 * lo hace y con qué botón. `cobraAqui`: quien mira puede cobrar desde la
 * tarjeta; si no, se dice dónde se cobra.
 */
export function siguientePasoDeEncargo(e, { cobraAqui = false } = {}) {
    const llega = e?.fecha_estimada ? fechaTexto(e.fecha_estimada, { day: 'numeric', month: 'long' }) : null;
    switch (e?.estado) {
        case 'solicitado':
            if (e?.pago_estado === 'anticipo' && Number(e?.abonado) > 0) {
                return `Dejó ${formatMoney(Number(e.abonado))} de anticipo. Compras averigua a qué precio y cuándo llega, y aprieta «Confirmar»: queda aceptado solo. Si el precio sube, falta la diferencia al retirar; si baja, se le devuelve. Si no se consigue, lo que dejó queda a su favor.`;
            }
            return 'Compras averigua si se consigue, a qué precio y cuándo llega, y aprieta «Confirmar». Si no se consigue, «No se puede conseguir».';
        case 'confirmado':
            if (e?.reserva || e?.reserva_id) return 'El cliente decide si acepta el precio nuevo; se resuelve desde su reserva.';
            return `Avisarle al cliente el precio y cobrarle el total${Number(e?.anticipo) > 0 ? ` (${formatMoney(Number(e.anticipo))})` : ''}. Si deja menos o nada, queda a tu cargo y el resto se cobra al retirar. Hasta que pague o alguien se haga cargo, no se pide al proveedor.${cobraAqui ? '' : ' Se cobra en Reservar con anticipo → Por cobrar, en la sala del retiro.'}${e?.tiene_app ? ' Si ya no lo quiere, lo cancela desde su app: sin pago no se pierde nada.' : ' Si ya no lo quiere, «Ya no lo quiere»: sin pago no se pierde nada.'}`;
        case 'aceptado': {
            const cargo = encargoACargo(e);
            if (cargo) return `${cargo.sinAnticipo ? 'Sin anticipo' : `Dejó ${formatMoney(cargo.abonado)}`}: faltan ${formatMoney(cargo.falta)} al retirar. Compras le hace el pedido al proveedor y aprieta «Ya se pidió», para que nadie lo pida dos veces.`;
            return 'Ya está pagado. Compras le hace el pedido al proveedor y aprieta «Ya se pidió», para que nadie lo pida dos veces.';
        }
        case 'pedido':
            return `Esperar a que llegue${llega ? ` (aprox. ${llega})` : ''}. Cuando esté en la sucursal, aprieta «Llegó». El cliente recibe el aviso.`;
        case 'listo':
            return `El cliente pasa a retirarlo${e?.retirar_hasta ? ` hasta el ${fechaTexto(e.retirar_hasta, { day: 'numeric', month: 'long' })}` : ''}. Al dárselo, apretar «Entregar».`;
        default:
            return '';
    }
}

// La persona de un paso de `encargos_de_sucursal`, en la forma de `AvatarConEstado`.
const personaDePaso = (p) => (p?.por_id ? { id: p.por_id, first_names: p.por_nombres, last_names: p.por_apellidos, name: p.por } : null);
const pasoDe = (e, clave) => (e?.pasos ?? []).find((p) => p.paso === clave) ?? null;

/**
 * Quién pidió el encargo y cómo (2026-11-14): el cliente, por qué camino
 * (su app, anotado en la sala por alguien, o el resto de una reserva), cuándo
 * y lo que escribió. Para la tarjeta, que antes sólo decía el primer nombre.
 */
export function pedidoDelEncargo(e) {
    const h = pasoDe(e, 'encargado');
    const persona = personaDePaso(h);
    const resto = !!(e?.reserva || e?.reserva_id);
    return {
        cliente: e?.cliente || 'Sin cliente',
        canal: resto ? `Es el resto de la reserva ${e?.reserva ?? ''}`.trim() : persona ? 'Lo anotó en la sucursal' : 'Lo pidió desde su app',
        persona,
        at: h?.at ?? e?.creado ?? null,
        nota: String(e?.nota_cliente ?? '').trim() || null,
    };
}

/**
 * Lo que respondió Bodega (Compras): si se consigue, a qué precio, para cuándo,
 * quién lo confirmó y su nota. `hecho: false` mientras no responde.
 */
export function respuestaDeBodega(e) {
    if (!e || e.estado === 'solicitado') {
        return { hecho: false, texto: 'Todavía no responde. Averigua si se consigue, a qué precio y cuándo llega.', persona: null, at: null, nota: null };
    }
    const h = pasoDe(e, 'confirmado');
    const precio = Number(e.precio_unitario);
    const total = Number(e.anticipo);
    const llega = e.fecha_estimada ? fechaTexto(e.fecha_estimada, { weekday: 'short', day: 'numeric', month: 'short' }) : null;
    const partes = [
        precio > 0 ? `Sí se consigue a ${formatMoney(precio)}${Number(e.cantidad) > 1 ? ' c/u' : ''}` : 'Sí se consigue',
        Number(e.cantidad) > 1 && total > 0 ? `total ${formatMoney(total)}` : null,
        llega ? `llega aprox. el ${llega}` : null,
    ].filter(Boolean);
    return {
        hecho: true,
        texto: partes.join(' · '),
        persona: personaDePaso(h),
        at: h?.at ?? null,
        nota: String(e.nota_sucursal ?? '').trim() || null,
    };
}

/**
 * El cliente ya no quiere un encargo que no pagó (2026-11-14): lo cancela la
 * sala con `encargo_cancelar_sin_pago`. La base repite la regla y además frena
 * si hay un cobro en caja o un pago en línea en curso.
 */
export const encargoCancelableSinPago = (e) => (['solicitado', 'confirmado'].includes(e?.estado)
    // Aceptado sin anticipo (2026-11-18): también, y responde quien lo aceptó.
    || (['aceptado', 'pedido', 'listo'].includes(e?.estado) && !!e?.responsable?.id))
    && e?.pago_estado === 'pendiente' && !e?.reserva && !e?.reserva_id;

/** Lo que el cliente ya pagó de un encargo: el total, o el adelanto (2026-11-18). */
export const pagadoDeEncargo = (e) => (e?.pago_estado === 'anticipo' ? Number(e?.abonado) || 0 : Number(e?.anticipo) || 0);

/** Hay algo pagado que puede quedar a favor: el total o un adelanto (2026-11-18). */
export const encargoPasaASaldo = (e) => !e?.reserva && ['pagado', 'anticipo'].includes(e?.pago_estado)
    // Antes de que Bodega confirme (2026-11-21), un anticipo también.
    && (['aceptado', 'pedido', 'listo'].includes(e?.estado) || (e?.estado === 'solicitado' && e?.pago_estado === 'anticipo'));

/**
 * Se cobró en caja como una venta normal y nadie lo pasó por el portal
 * (2026-11-14): se puede amarrar a esa venta mientras no haya dinero del portal.
 */
export const encargoVendibleAfuera = (e) => ['solicitado', 'confirmado', 'aceptado', 'pedido', 'listo'].includes(e?.estado)
    && e?.pago_estado === 'pendiente' && !e?.reserva && !e?.reserva_id;

/** La venta casi seguro es la del encargo: mismo producto y mismo monto, o mismo cliente con uno de los dos. */
export const ventaProbableDeEncargo = (v) => !!v && ((v.mismo_producto && v.mismo_monto) || (v.mismo_cliente && (v.mismo_producto || v.mismo_monto)));

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
    // Sin confirmar (2026-11-21): con el precio de referencia, y `porConfirmar`
    // para que la pantalla y el papel digan que el precio puede cambiar.
    const e = (encargos ?? []).filter(encargoPorCobrar).map((x) => {
        const porConfirmar = x.estado === 'solicitado';
        return {
            clave: `e${x.id}`, tipo: 'encargo', id: x.id, codigo: codigoDeEncargo(x.id), cliente: x.cliente, producto: x.producto,
            cantidad: x.cantidad, porConfirmar,
            precio: Number(porConfirmar ? x.precio_referencia : x.precio_unitario),
            saldo: porConfirmar ? totalDeReferencia(x) : Number(x.anticipo), fecha: x.fecha_estimada,
        };
    });
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

/**
 * Lo que dice «Cerrar con esa venta» de cada opción (2026-11-21). Depende de si
 * el anticipo ya cubría el precio: con la R-000164 ($6.60 de $6.60) «pagó sólo
 * lo que faltaba» confundía, porque no faltaba nada. Una sola fuente para el
 * portal y la app. `k` es lo que recibe `amarrarReservaAVenta`
 * (true = el anticipo se usó en esa venta).
 */
export function opcionesCerrarConVenta(x) {
    const anticipo = Number(x?.anticipo ?? 0);
    const total = Math.round(Number(x?.precio ?? 0) * Number(x?.cantidad ?? 1) * 100) / 100;
    const vendida = Number(x?.vendida_aparte?.total ?? total);
    const cubria = total > 0 && anticipo >= total - 0.004;
    const falta = Math.max(Math.round((total - anticipo) * 100) / 100, 0);
    const devuelto = 'Elige esta también si ya se le devolvió el anticipo en efectivo.';
    return {
        anticipo, cubria,
        pregunta: cubria
            ? `Dejó un anticipo de ${formatMoney(anticipo)}: ya había pagado todo el precio. ¿Qué pasó en caja?`
            : `Dejó un anticipo de ${formatMoney(anticipo)} de ${formatMoney(total)}. ¿Qué pasó en caja?`,
        opciones: cubria ? [
            { k: true, titulo: 'Se usó el anticipo', corto: 'Se usó el anticipo',
              texto: `En caja no pagó nada más: la venta se cubrió con lo que ya había pagado. No queda nada a su favor. ${devuelto}`,
              confirma: 'Se usó el anticipo. No queda nada a su favor.' },
            { k: false, titulo: 'Volvió a pagar en caja', corto: 'Volvió a pagar',
              texto: `En caja pagó otra vez ${formatMoney(vendida)}. Los ${formatMoney(anticipo)} del anticipo quedan a su favor para otra compra o para devolvérselos.`,
              confirma: `Volvió a pagar en caja. Los ${formatMoney(anticipo)} del anticipo quedan a su favor.` },
        ] : [
            { k: true, titulo: 'Se le descontó el anticipo', corto: 'Se le descontó',
              texto: `En caja pagó sólo los ${formatMoney(falta)} que faltaban. No queda nada a su favor. ${devuelto}`,
              confirma: 'Se le descontó el anticipo. No queda nada a su favor.' },
            { k: false, titulo: 'Pagó la venta completa', corto: 'Pagó completo',
              texto: `En caja pagó los ${formatMoney(vendida)} completos, aparte del anticipo. Los ${formatMoney(anticipo)} quedan a su favor para otra compra o para devolvérselos.`,
              confirma: `Pagó la venta completa. Los ${formatMoney(anticipo)} del anticipo quedan a su favor.` },
        ],
    };
}
