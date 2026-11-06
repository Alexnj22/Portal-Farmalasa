// Qué dice una solicitud en una TARJETA de aviso: una línea de contexto,
// renglones (izquierda: qué; derecha: cuánto) y una nota al pie.
//
// Una sola definición para los dos lugares que la dibujan (2026-09-30): la
// notificación del teléfono (`send-push-notification/tarjeta.ts`, que importa
// este archivo) y la pestaña Notificaciones de la app. Escrita dos veces, el
// día que cambie un tipo de solicitud una de las dos mostraría otra cosa.
//
// Sin imports a propósito: la corre también Deno, en el servidor.

export const TOPE_DE_RENGLONES = 4;   // «tampoco un testamento» (usuario, 2026-09-30)

const dinero = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '';
};

const primero = (s) => String(s ?? '').trim().split(/\s+/)[0] || '';

// Los nombres vienen en MAYÚSCULAS del sistema de origen; en un aviso se leen
// como se escribe un nombre (usuario, 2026-09-30: «no la veo moderna»).
const comoNombre = (s) => String(s ?? '').toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, e, l) => e + l.toUpperCase());

/** Primer nombre + primer apellido — la regla de `shortEmployeeName` (nameUtils.js), escrito como nombre. */
export function nombreCorto(e) {
    // El que la persona eligió para el portal, guardado en la ficha por la base
    // (`employees.nombre_corto`, 2026-10-30). Sin él, la regla de siempre.
    if (e?.nombre_corto) return comoNombre(e.nombre_corto);
    const a = primero(e?.first_names), b = primero(e?.last_names);
    if (a || b) return comoNombre(`${a} ${b}`.trim());
    const p = String(e?.name ?? '').trim().split(/\s+/).filter(Boolean);
    return comoNombre(p.length <= 2 ? p.join(' ') : `${p[0]} ${p[2]}`);
}

const vendedor = (nombre, codigo) => (nombre ? nombreCorto({ name: nombre }) : `Cód. ${codigo ?? '?'}`);

/* El lote de un renglón de traslado, en texto corto: «Lote 25009 · 10/2028».
 * Versión mínima de `lotesPorRenglon` (trasladoTexto.js) y de
 * `lotes_de_renglon_de_traslado` (base) — este archivo no puede importar,
 * así que la regla se repite acá y se mueve con ellas: lo que salió, si no lo
 * apartado, si no lo pedido. Un genérico no dice nada: no hay número que
 * cotejar. (2026-11-05, «debe salir el lote, por trazabilidad».) */
const esGenerico = (l) => !l || String(l).trim().toUpperCase() === 'GENERICO';
const mesAnio = (f) => (f ? `${String(f).slice(5, 7)}/${String(f).slice(0, 4)}` : '');
export function loteCortoDeRenglon(m, idx) {
    const items = Array.isArray(m?.items) ? m.items : [];
    const item = items[idx];
    if (!item) return '';
    const det = Array.isArray(m?.erp_traslado?.detalle) ? m.erp_traslado.detalle : [];
    const asig = m?.lotes_asignados?.[idx] ?? m?.lotes_asignados?.[String(idx)] ?? null;
    const pedidos = Array.isArray(item.lotes) ? item.lotes : [];
    const prod = String(item.erp_product_id);
    let lista = [];
    if (det.length && items.filter((i) => String(i?.erp_product_id) === prod).length === 1) {
        lista = det.filter((d) => String(d?.erp_product_id) === prod).map((d) => {
            const lote = d?.numero_lote ? String(d.numero_lote) : null;
            const coincide = asig && ((d?.id_lote_erp && String(asig.id_lote_erp ?? '') === String(d.id_lote_erp))
                || (lote && String(asig.lote ?? '') === lote));
            return { lote, vence: coincide ? asig.vence : (pedidos.find((p) => lote && String(p?.lote) === lote)?.vence ?? null) };
        });
    }
    if (!lista.length && asig && asig.lote) lista = [{ lote: String(asig.lote), vence: asig.vence ?? null }];
    if (!lista.length) lista = pedidos.map((p) => ({ lote: p?.lote ? String(p.lote) : null, vence: p?.vence ?? null }));
    const textos = [...new Set(lista.filter((l) => !esGenerico(l.lote))
        .map((l) => `${l.lote}${l.vence ? ` · ${mesAnio(l.vence)}` : ''}`))];
    if (!textos.length) return '';
    return `${textos.length === 1 ? 'Lote' : 'Lotes'} ${textos.join(', ')}`;
}

/** @returns {[string, string][]} */
const renglonesDeItems = (items, m = null) => (Array.isArray(items) ? items : []).map((it, i) => {
    const lote = m ? loteCortoDeRenglon(m, i) : '';
    return [
        `${String(it?.descripcion ?? 'Producto')}${lote ? ` (${lote})` : ''}`,
        `${it?.cantidad ?? '?'} ${String(it?.presentacion_tipo ?? '').toLowerCase()}`.trim(),
    ];
});

// «0000065777_COF» → «COF 65 777». Sin los ceros ni el sufijo repetido, y en
// grupos: diez dígitos seguidos el teléfono los toma por un número de teléfono
// y los pinta de azul como enlace.
function documento(m) {
    const tipo = m.tipo_documento ?? 'Documento';
    const numero = String(m.correlativo ?? '').replace(/_[A-Z]+$/, '').replace(/^0+(?=\d)/, '');
    const agrupado = numero.replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009');
    return `${tipo} ${agrupado}`.trim();
}

/**
 * El detalle de una fila de `approval_requests`, TODOS sus renglones (quien
 * dibuja recorta con `recortar`).
 * @returns {{ contexto?: string, renglones: [string, string][], pie?: string }}
 */
export function detalleDeSolicitud(s) {
    const m = s?.metadata ?? {};
    const sala = m.branch_name ?? '';
    switch (s?.type) {
        case 'INVENTORY_TRANSFER_REQUEST':
            return { contexto: `Pide ${sala} a ${m.origen_branch_name ?? 'tu sala'}`, renglones: renglonesDeItems(m.items, m), pie: m.reason ? `Motivo: ${m.reason}` : undefined };
        case 'INVENTORY_TRANSFER_PUSH':
            return { contexto: `${m.origen_branch_name ?? 'Otra sala'} envía a ${sala}`, renglones: renglonesDeItems(m.items, m), pie: m.reason ? `Motivo: ${m.reason}` : undefined };
        case 'INVENTORY_DISCARD_REQUEST':
            return { contexto: `Descarte en ${sala}`, renglones: renglonesDeItems(m.items), pie: m.motivo_label ?? m.reason };
        case 'INVENTORY_LOAD_REQUEST':
            return { contexto: `Carga en ${sala}`, renglones: renglonesDeItems(m.items), pie: m.reason };
        case 'ANNULMENT_REQUEST':
            return { contexto: `Anular en ${sala}`, renglones: [[documento(m), dinero(m.total)]], pie: m.reason };
        case 'PAYMENT_CHANGE_REQUEST':
            return { contexto: `Cambio de pago en ${sala}`, renglones: [[documento(m), dinero(m.total)], ['Pago', `${m.current_pago ?? '?'} → ${m.new_pago ?? '?'}`]] };
        case 'VENDOR_CHANGE_REQUEST':
            return { contexto: `Cambio de vendedor en ${sala}`, renglones: [[documento(m), dinero(m.total)], ['Vendedor', `${vendedor(m.current_vendor_name, m.current_vendor_code)} → ${vendedor(m.new_vendor_name, m.new_vendor_code)}`]] };
        case 'CAJA_MOVIMIENTO_CHANGE':
            if (m.que === 'FORMA') {
                return { contexto: 'Cambiar cómo se pagó', renglones: [[String(m.concepto ?? 'Movimiento'), dinero(m.monto_actual)], ['Pago', `${String(m.forma_actual ?? '?').toLowerCase()} → ${String(m.forma_nueva ?? '?').toLowerCase()}`]] };
            }
            return { contexto: m.que === 'ANULAR' ? 'Anular movimiento de caja' : 'Corrección de caja', renglones: [[String(m.concepto ?? 'Movimiento'), m.monto_nuevo == null ? dinero(m.monto_actual) : `${dinero(m.monto_actual)} → ${dinero(m.monto_nuevo)}`]] };
        case 'CAJA_INGRESO_AUTORIZACION':
            return {
                contexto: `${m.sentido === 'SALIDA' ? 'Salida' : 'Ingreso'} ${m.forma_pago === 'TRANSFERENCIA' ? 'por transferencia'
                    : m.forma_pago === 'TARJETA' ? 'con tarjeta' : 'en efectivo'} sin comprobante`,
                renglones: [[String(m.detalle || m.concepto || 'Ingreso'), dinero(m.monto)]],
                pie: s?.note ?? undefined,
            };
        case 'ABONO_APROBACION':
            return { contexto: 'Abono a crédito', renglones: [[String(m.cliente ?? 'Cliente'), dinero(m.monto)]], pie: m.forma };
        case 'ABONO_CREDITO_CHANGE':
            return {
                contexto: 'Corrección de abono',
                renglones: [[String(m.cliente ?? 'Cliente'), dinero(m.monto_actual)],
                    m.que === 'FORMA' ? ['Forma de pago', `${m.forma_actual ?? '?'} → ${m.forma_nueva ?? '?'}`] : ['Monto', `${dinero(m.monto_actual)} → ${dinero(m.monto_nuevo)}`]],
            };
        // El descuento de una venta de la distribuidora (Torogoz): a quién, qué
        // renglón y cuánto — sin esto la tarjeta «Por decidir» salía vacía.
        case 'DIST_DESCUENTO':
            return {
                contexto: `Descuento a ${m.cliente ?? 'un cliente'}${m.pedido_id ? ` · pedido ${m.pedido_id}` : ''}`,
                renglones: (m.renglones ?? []).map((r) => [String(r.descripcion ?? 'Producto'), `−${dinero(r.descuento)}${r.pct != null ? ` (${Number(r.pct).toFixed(1)}%)` : ''}`]),
                pie: `Total ${dinero(m.total)}${m.tope_pct != null ? ` · tope ${Number(m.tope_pct)}%` : ''}`,
            };
        // Corregir o deshacer un documento sellado de la distribuidora: cuál, de
        // quién y qué pasa con el dinero si se aprueba.
        case 'DIST_INVALIDACION':
            return {
                contexto: `${m.accion === 'corregir' ? 'Corregir' : 'Deshacer'} ${m.numero_control ?? 'un documento'} · ${m.cliente ?? 'un cliente'}`,
                renglones: m.accion === 'corregir'
                    ? [['Total del documento', dinero(m.total)], ['Abonado (pasa a la cuenta nueva)', dinero(m.abonado ?? 0)]]
                    : [['Total del documento', dinero(m.total)], ['Efectivo que se devuelve', dinero(m.devolver_efectivo ?? 0)],
                        ['Queda a favor del cliente', dinero(m.a_favor ?? 0)]],
                pie: s?.note ?? undefined,
            };
        default:
            return { renglones: [], pie: s?.note ?? undefined };
    }
}

/** El detalle de una fila de `minmax_change_requests`. */
export function detalleDeMinMax(f) {
    return {
        contexto: 'Ajuste de Min/Max',
        renglones: [
            [String(f?.product_name ?? 'Producto'), ''],
            ['Mínimo', `${f?.current_min ?? '—'} → ${f?.requested_min ?? '—'}`],
            ['Máximo', `${f?.current_max ?? '—'} → ${f?.requested_max ?? '—'}`],
        ],
        pie: f?.reason ?? undefined,
    };
}

/** Hasta el tope, y cuántos quedaron afuera. */
export function recortar(detalle, tope = TOPE_DE_RENGLONES) {
    const r = detalle?.renglones ?? [];
    return { ...detalle, renglones: r.slice(0, tope), resto: Math.max(0, r.length - tope) };
}
