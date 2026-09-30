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
    const a = primero(e?.first_names), b = primero(e?.last_names);
    if (a || b) return comoNombre(`${a} ${b}`.trim());
    const p = String(e?.name ?? '').trim().split(/\s+/).filter(Boolean);
    return comoNombre(p.length <= 2 ? p.join(' ') : `${p[0]} ${p[2]}`);
}

const vendedor = (nombre, codigo) => (nombre ? nombreCorto({ name: nombre }) : `Cód. ${codigo ?? '?'}`);

const renglonesDeItems = (items) => (Array.isArray(items) ? items : []).map((it) => [
    String(it?.descripcion ?? 'Producto'),
    `${it?.cantidad ?? '?'} ${String(it?.presentacion_tipo ?? '').toLowerCase()}`.trim(),
]);

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
            return { contexto: `Pide ${sala} a ${m.origen_branch_name ?? 'tu sala'}`, renglones: renglonesDeItems(m.items), pie: m.reason ? `Motivo: ${m.reason}` : undefined };
        case 'INVENTORY_TRANSFER_PUSH':
            return { contexto: `${m.origen_branch_name ?? 'Otra sala'} envía a ${sala}`, renglones: renglonesDeItems(m.items), pie: m.reason ? `Motivo: ${m.reason}` : undefined };
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
            return { contexto: m.que === 'ANULAR' ? 'Anular movimiento de caja' : 'Corrección de caja', renglones: [[String(m.concepto ?? 'Movimiento'), m.monto_nuevo == null ? dinero(m.monto_actual) : `${dinero(m.monto_actual)} → ${dinero(m.monto_nuevo)}`]] };
        case 'ABONO_APROBACION':
            return { contexto: 'Abono a crédito', renglones: [[String(m.cliente ?? 'Cliente'), dinero(m.monto)]], pie: m.forma };
        case 'ABONO_CREDITO_CHANGE':
            return {
                contexto: 'Corrección de abono',
                renglones: [[String(m.cliente ?? 'Cliente'), dinero(m.monto_actual)],
                    m.que === 'FORMA' ? ['Forma de pago', `${m.forma_actual ?? '?'} → ${m.forma_nueva ?? '?'}`] : ['Monto', `${dinero(m.monto_actual)} → ${dinero(m.monto_nuevo)}`]],
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
