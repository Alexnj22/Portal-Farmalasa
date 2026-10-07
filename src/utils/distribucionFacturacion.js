// Torogoz, la facturación: las reglas de pantalla de Facturación, del documento,
// del correo al cliente, de la devolución y de los pagos de un pedido.
//
// Vivían dentro de `TabDocumentos`, `DocumentoModal`, `CorreoDocumento`,
// `DevolucionModal`, `PagosDelPedido` y `ComprobantePago`. Se mudaron acá el
// 2026-10-07 para que la app nativa diga y ofrezca EXACTAMENTE lo mismo: si una
// pantalla ofrece «Deshacer la venta» pasado el plazo y la otra no, el que se
// entera es Hacienda.
import { FORMA_PAGO, pideAccion, revisionHacienda, selloValido } from './distribucionComun';
import { fechaNumerica } from './fecha';

// ── Facturación (la lista) ─────────────────────────────────────────────────

/** Los días hacia atrás que mira Facturación. */
export const DIAS_DE_FACTURACION = 120;

const esPorEnviar = (d) => revisionHacienda(d)?.accion === 'reenviar';
const correoVigente = (d) => (Array.isArray(d?.correo) ? d.correo[0] : d?.correo);

/** Los grupos de Facturación: lo que pide acción, por qué, y lo sellado. */
export function gruposDeFacturacion(docs) {
    const lista = docs ?? [];
    const accion = lista.filter(pideAccion);
    const sinEntregar = lista.filter(d => d.estado === 'sellado' && ['pendiente', 'fallido', 'sin_correo'].includes(correoVigente(d)?.estado));
    return {
        accion,
        porEnviar: accion.filter(esPorEnviar),
        rechazados: accion.filter(d => d.estado === 'rechazado'),
        invalidaciones: accion.filter(d => ['pendiente', 'rechazada'].includes(d.invalidacion_estado)),
        contingencia: accion.filter(d => d.estado === 'contingencia'),
        sinAvisoDeContingencia: accion.filter(d => d.estado === 'contingencia' && !d.contingencia_id),
        sellados: lista.filter(d => d.estado === 'sellado' && selloValido(d.sello_recibido)),
        vendido: lista.filter(d => d.estado === 'sellado' && (d.tipo === '01' || d.tipo === '03'))
            .reduce((a, d) => a + Number(d.total_pagar), 0),
        // Sellados que todavía no le llegaron al cliente (borrador 0019).
        sinEntregar,
        // De esos, los que tienen a quién mandárselo.
        enviables: sinEntregar.filter(d => correoVigente(d)?.estado !== 'sin_correo'),
    };
}

/** El semáforo de arriba: ¿está todo bien con Hacienda? */
export function semaforoDeFacturacion(g) {
    const n = g.accion.length;
    if (!n) {
        return { nivel: 'ok', titulo: 'Todo al día con Hacienda',
            detalle: `Los ${g.sellados.length} documentos de los últimos ${DIAS_DE_FACTURACION} días tienen código de generación y sello de recepción.` };
    }
    const grave = g.rechazados.length > 0 || g.invalidaciones.some(d => d.invalidacion_estado === 'rechazada');
    return {
        nivel: grave ? 'error' : 'pendiente',
        titulo: `${n} documento${n === 1 ? '' : 's'} por resolver`,
        detalle: [
            g.porEnviar.length && `${g.porEnviar.length} sin sello de Hacienda`,
            g.rechazados.length && `${g.rechazados.length} rechazado${g.rechazados.length === 1 ? '' : 's'} por corregir`,
            g.invalidaciones.length && `${g.invalidaciones.length} invalidación pendiente`,
            g.contingencia.length && `${g.contingencia.length} en contingencia`,
        ].filter(Boolean).join(' · '),
    };
}

/**
 * Los documentos de una cubeta (`accion` | `todos` | `sellados` | `invalidados`),
 * con el sub-filtro de «Por resolver» (`por_enviar` | `rechazados` |
 * `invalidaciones`), el tipo y una búsqueda (`coincide(d)`).
 */
export function documentosDeLaCubeta(docs, g, { cubeta = 'accion', sub = '', tipo = '', coincide = null } = {}) {
    let base = cubeta === 'accion' ? g.accion
        : cubeta === 'sellados' ? g.sellados
        : cubeta === 'invalidados' ? (docs ?? []).filter(d => d.estado === 'invalidado')
        : (docs ?? []);
    if (cubeta === 'accion' && sub === 'por_enviar') base = g.porEnviar;
    if (cubeta === 'accion' && sub === 'rechazados') base = g.rechazados;
    if (cubeta === 'accion' && sub === 'invalidaciones') base = g.invalidaciones;
    return base.filter(d => (!tipo || d.tipo === tipo) && (!coincide || coincide(d)));
}

/** Lo que dice la fila de un documento sobre Hacienda: rótulo, tono y las dos marcas. */
export function filaDeHacienda(d, estadoDocumento) {
    const r = revisionHacienda(d);
    const est = estadoDocumento?.[d.estado];
    return {
        nivel: r.nivel,
        rotulo: r.nivel === 'ok' ? 'Recibido' : r.nivel === 'info' ? (est?.label ?? r.titulo) : r.titulo,
        codigo: !!r.pasos.find(p => p.clave === 'codigo')?.ok,
        sello: !!r.pasos.find(p => p.clave === 'sello')?.ok,
    };
}

/** El resumen del reenvío en bloque, como lo anuncia la pantalla. */
export function resumenDelReenvio(cuenta) {
    return `${cuenta.sellado} recibidos por Hacienda · ${cuenta.rechazado} rechazados · ${cuenta.pendiente + cuenta.error} siguen pendientes`;
}

/** Sin certificado no hay nada que reintentar: los demás darían lo mismo. */
export const faltaElCertificado = (r) => r?.estado === 'sin_firmar' && /certificado/i.test(r?.aviso ?? '');

// ── El documento ───────────────────────────────────────────────────────────

/** El nombre de una forma de pago, con «A crédito» (CAT-016 condición 2). */
export const nombreFormaPago = (f) => (f === '13' ? 'A crédito' : f === '99' ? 'Otra' : FORMA_PAGO.find(x => x.value === f)?.label ?? f);

/**
 * Qué se puede hacer con un documento: corregir, deshacer, devolver.
 * `plazo` es el de `fetchPlazoInvalidacion` (sólo de sellados). Pasado el
 * plazo, Hacienda no sella el evento: ni «Corregir» (que invalida el sellado)
 * ni «Deshacer» sirven. Queda la Nota de Crédito.
 */
export function accionesDelDocumento(d, { puedeVender = false, plazo = null } = {}) {
    if (!d) return { sinSello: false, conArchivo: false, invalidando: false, vencido: false, puedeCorregir: false, puedeDeshacer: false, puedeDevolver: false, conCorreo: false };
    const sinSello = ['sin_firmar', 'firmado', 'contingencia'].includes(d.estado);
    const invalidando = d.invalidacion_estado === 'pendiente' || d.invalidacion_estado === 'procesada';
    const vencido = d.estado === 'sellado' && plazo?.estado === 'vencido';
    return {
        sinSello,
        conArchivo: !!d.json?.identificacion,
        invalidando,
        vencido,
        puedeCorregir: !!(puedeVender && d.pedido_id && (sinSello || d.estado === 'rechazado' || (d.estado === 'sellado' && !invalidando && !vencido))),
        puedeDeshacer: !!(puedeVender && d.estado === 'sellado' && !invalidando && !vencido),
        // Devolución parcial: Nota de Crédito, que sólo corrige un Crédito Fiscal (borrador 0017).
        puedeDevolver: !!(puedeVender && d.tipo === '03' && d.estado === 'sellado' && !invalidando),
        // El correo va con el documento de venta, y nunca con uno invalidado.
        conCorreo: ['01', '03', '05'].includes(d.tipo) && d.estado !== 'invalidado',
    };
}

/** Qué hace «Corregir» según el estado, dicho antes de apretarlo. */
export function queHaceCorregir(d) {
    if (!d) return '';
    if (d.estado === 'rechazado') return 'El pedido vuelve a «por facturar» para corregir lo que dijo Hacienda y facturarlo de nuevo.';
    if (d.estado === 'sellado') return 'Se abre un pedido NUEVO con lo mismo. Al facturarlo, éste se invalida ante Hacienda y el nuevo lo reemplaza.';
    return 'Se retira antes de llegar a Hacienda y el pedido vuelve a «por facturar» para cambiarle lo que haga falta.';
}

/** La ayuda de abajo del documento sellado: qué hace cada botón. */
export function ayudaDelSellado(tipo) {
    return 'Con sello, «Corregir» emite un documento nuevo que reemplaza a éste, y éste se invalida ante Hacienda. Si la venta no se hizo, usa «Deshacer la venta».'
        + (tipo === '03'
            ? ' Si el cliente regresa sólo una parte, «Devolución» emite una nota de crédito por eso.'
            : ' A una Factura no se le hace nota de crédito: si el cliente regresa una parte, «Corregir» y deja sólo lo que se queda.');
}

/**
 * El plazo para invalidar, dicho antes de que alguien lo intente. Los estados
 * salen de `dist_plazo_invalidacion` (borrador 0028).
 * @returns {{ tono: 'freno'|'cuidado'|'nota', texto: string }|null}
 */
export function avisoDelPlazo(plazo, tipo) {
    if (!plazo) return null;
    const limite = fechaNumerica(plazo.limite);
    if (plazo.estado === 'vencido') {
        return { tono: 'freno', texto: `Venció el plazo para invalidarlo (${limite}).${tipo === '03'
            ? ' Si hay que corregirlo, usa «Devolución»: emite una nota de crédito.'
            : ' Ya no se puede corregir ni deshacer ante Hacienda.'}` };
    }
    if (plazo.estado === 'gracia') {
        return { tono: 'cuidado', texto: `El plazo para invalidarlo era el ${limite}. Puede que Hacienda todavía lo acepte si hubo asuetos; si lo rechaza, corrige con nota de crédito.` };
    }
    if (plazo.estado === 'medicamentos') {
        return { tono: 'cuidado', texto: `Pasaron los 3 meses para invalidar una factura (${limite}). Sólo se puede si la venta es de medicamentos, hasta el ${fechaNumerica(plazo.limite_medicamentos)}.` };
    }
    const quedan = plazo.dias <= 3 ? ` · quedan ${plazo.dias === 0 ? 'horas' : `${plazo.dias} día${plazo.dias === 1 ? '' : 's'}`}` : '';
    return { tono: plazo.dias <= 3 ? 'cuidado' : 'nota', texto: `Se puede corregir o deshacer ante Hacienda hasta el ${limite}${quedan}.` };
}

/** Lo que se le dice a quien acaba de mandar algo a Hacienda, según cómo volvió. */
export function avisoDeAccion(r, estadoDocumento) {
    return {
        titulo: estadoDocumento?.[r?.estado]?.label ?? 'Listo',
        texto: r?.aviso ?? r?.mensaje ?? '',
        bien: r?.estado === 'sellado',
    };
}

/** El aviso de contingencia, contado como lo anuncia la pantalla. */
export function resumenDeContingencia(r) {
    const rechazado = (r?.avisos ?? []).find(a => a.estado === 'rechazado');
    if (rechazado) return { bien: false, titulo: 'Hacienda rechazó el aviso de contingencia', texto: rechazado.mensaje ?? '' };
    return { bien: true, titulo: 'Aviso de contingencia enviado', texto: `${r?.sellados ?? 0} recibidos por Hacienda · ${r?.pendientes ?? 0} pendientes` };
}

// ── El correo al cliente ───────────────────────────────────────────────────

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const correoValido = (s) => CORREO.test(String(s ?? '').trim());

/** Qué decir del correo de un documento, en una línea. */
export function estadoDelCorreo(correo) {
    const c = Array.isArray(correo) ? correo[0] : correo;
    if (!c) return { clave: 'ninguno', texto: 'Todavía no se le envió', variant: 'neutral' };
    if (c.estado === 'enviado') return { clave: 'enviado', texto: `Enviado a ${c.destinatario}`, variant: 'success' };
    if (c.estado === 'sin_correo') return { clave: 'sin_correo', texto: 'El cliente no tiene correo en su ficha', variant: 'warning' };
    if (c.estado === 'fallido') return { clave: 'fallido', texto: `No se pudo enviar a ${c.destinatario}`, variant: 'danger' };
    return { clave: 'pendiente', texto: `Pendiente de enviar a ${c.destinatario}`, variant: 'warning' };
}

/** A quién se le propone mandarlo: al del último envío, o al de la ficha. */
export const destinoDelCorreo = (dte) => correoVigente(dte)?.destinatario ?? dte?.dist_clientes?.correo ?? '';

// ── La devolución (Nota de Crédito) ────────────────────────────────────────

// La cuenta de una devolución en pantalla (borrador 0017). La base valida lo
// mismo (`dist_preparar_devolucion`): acá es para avisar antes de emitir.
export const DESTINOS_DEVOLUCION = [
    { value: 'reingreso', label: 'Vuelve a bodega' },
    { value: 'cuarentena', label: 'Cuarentena' },
];

const entero = (t) => {
    const s = String(t ?? '').trim();
    return /^\d+$/.test(s) ? Number(s) : null;
};

/**
 * `pedidos`: los renglones disponibles con lo que se escribió (`pide`) y su
 * `destino`. Devuelve los renglones a mandar, el total con IVA (unidades ×
 * precio − su parte del descuento, igual que la base) y las claves con error.
 */
export function totalDevolucion(pedidos) {
    let centavos = 0;
    const renglones = [];
    const errores = [];
    for (const it of pedidos ?? []) {
        if (String(it.pide ?? '').trim() === '') continue;
        const u = entero(it.pide);
        if (u === null || u > Number(it.disponibles)) { errores.push(it.clave); continue; }
        if (u === 0) continue;
        const bruto = Math.round(u * Number(it.precio_unitario) * 100);
        const desc = Math.round(Number(it.descuento_unitario || 0) * u * 100);
        centavos += bruto - desc;
        renglones.push({ item_id: it.item_id, lote_id: it.lote_id ?? null, unidades: u, destino: it.destino === 'cuarentena' ? 'cuarentena' : 'reingreso' });
    }
    return { total: centavos / 100, renglones, errores };
}

/** La clave de un renglón devolvible (renglón y lote). */
export const claveDeDevolucion = (it) => `${it.item_id}:${it.lote_id ?? ''}`;

/** Lo que se le dice a quien emitió la nota. */
export function avisoDeNotaDeCredito(r, formatMoney) {
    const aFavor = Number(r?.a_favor ?? 0);
    return aFavor > 0
        ? `Hay que devolverle ${formatMoney(aFavor)} al cliente (ya había pagado).`
        : `Se descontó ${formatMoney(Number(r?.credito_aplicado ?? 0))} de su cuenta.`;
}

// ── Los pagos de un pedido y su comprobante ────────────────────────────────

export const VERIFICACION_PAGO = {
    coincide: { variant: 'success', label: 'Coincide' },
    sin_lectura: { variant: 'info', label: 'Confirmado a mano' },
    diferencia_aceptada: { variant: 'warning', label: 'Con diferencia' },
    pendiente: { variant: 'warning', label: 'Falta el comprobante' },
};

export const TEXTO_FORMA_COMPROBANTE = { '02': 'de la tarjeta', '03': 'de la tarjeta', '04': 'del cheque', '05': 'de la transferencia', '08': 'del pago electrónico', '99': 'del pago' };

/**
 * Qué pasa con un comprobante leído (o escrito a mano) contra el pago. Tres
 * salidas, y ninguna traba la venta:
 *   · `coincide` — el monto leído es el del pago;
 *   · `diferencia` — no coincide: se usa el del comprobante (si el pago todavía
 *     se puede cambiar) o se deja el del pago diciendo POR QUÉ;
 *   · `sin_comparar` — la forma es «el resto»: se compara al facturar.
 * Un comprobante que nadie leyó no queda marcado como verificado.
 *
 * `resultado` es la respuesta del lector (`leerComprobante`); `montoPapel` el
 * monto escrito a mano cuando no hubo lectura (ya convertido a número o null).
 */
export function revisionDelComprobante(resultado, { montoEsperado = null, montoPapel = null } = {}) {
    const leido = resultado?.leido;
    const hubieronDatos = !!(resultado && !resultado.sinLector && leido?.es_comprobante && leido?.legible !== false && Number.isFinite(Number(leido?.monto)));
    const noEsComprobante = !!(resultado && !resultado.sinLector && leido && leido.es_comprobante === false);
    const montoLeido = hubieronDatos ? Number(leido.monto) : montoPapel;
    const esperado = montoEsperado == null ? null : Number(montoEsperado);
    const sinComparar = esperado == null;
    const cuadra = montoLeido != null && esperado != null && Math.abs(montoLeido - esperado) < 0.005;
    const pideMontoAMano = !!(resultado && !noEsComprobante && !hubieronDatos);
    const verificacion = hubieronDatos ? 'coincide' : 'sin_lectura';
    return {
        leido: leido ?? null, hubieronDatos, noEsComprobante, pideMontoAMano, montoLeido, esperado,
        estado: noEsComprobante ? 'no_es' : montoLeido == null ? 'falta' : sinComparar ? 'sin_comparar' : cuadra ? 'coincide' : 'diferencia',
        verificacion,
        notaSinLectura: hubieronDatos ? null : (cuadra ? 'Monto escrito por quien subió el comprobante; coincide.' : 'Monto escrito por quien subió el comprobante.'),
        motivoNoEs: noEsComprobante ? `No parece un comprobante de pago${leido.motivo ? `: ${leido.motivo}` : ''}.` : null,
        motivoSinLectura: pideMontoAMano ? (resultado.sinLector ? 'El lector de comprobantes no está disponible.' : 'No se pudo leer el monto con seguridad.') : null,
    };
}
