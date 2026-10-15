/**
 * La aritmética de la vista de Ventas: el período contra el que se compara, la
 * variación por día y los renglones de una venta. Vivía dentro de
 * `views/VentasView.jsx`; se mudó el 2026-10-02 para que la app del teléfono
 * compare y descuente con la MISMA regla que el portal.
 */
import { diasEntre, horaSV, hoySV } from './fecha';

const pad = (n) => String(n).padStart(2, '0');

/** Del primero del mes a HOY: así se compara «los mismos días» del mes anterior. */
export function mesEnCurso(hoy = hoySV()) {
    const [y, m] = hoy.split('-');
    return { fini: `${y}-${m}-01`, ffin: hoy, label: `${y}-${m}` };
}

/**
 * El período anterior equivalente: el mismo rango corrido hacia atrás TANTOS
 * MESES COMO ABARCA la selección (bug del 2026-07-17: «Últimos 3 meses» se
 * comparaba contra un mes atrás, casi solapado). Un día que no existe en el mes
 * de destino cae en su último día.
 *   5–9 may → 5–9 abr · may–jul → feb–abr · ene–dic 2026 → ene–dic 2025
 */
export function periodoAnterior(fini, ffin) {
    const [sy, sm] = fini.split('-').map(Number);
    const [ey, em] = ffin.split('-').map(Number);
    const meses = Math.max(1, (ey * 12 + em) - (sy * 12 + sm) + 1);
    const atras = (dia) => {
        const [y, m, d] = dia.split('-').map(Number);
        const idx = y * 12 + (m - 1) - meses;
        const py = Math.floor(idx / 12);
        const pm = ((idx % 12) + 12) % 12 + 1;
        const ultimo = new Date(Date.UTC(py, pm, 0)).getUTCDate();
        return `${py}-${pad(pm)}-${pad(Math.min(d, ultimo))}`;
    };
    return { prevFini: atras(fini), prevFfin: atras(ffin) };
}

/** Días del rango, los dos extremos incluidos. */
export const diasDelRango = (fini, ffin) => diasEntre(fini, ffin) + 1;

/** Variación en % del PROMEDIO POR DÍA: meses de distinto largo se comparan parejo. */
export function variacionPorDia(actual, diasActual, previo, diasPrevio) {
    if (!previo || !diasPrevio || !diasActual) return null;
    const a = actual / diasActual;
    const p = previo / diasPrevio;
    return ((a - p) / p) * 100;
}

/** «HH:MM:00» si el rango termina hoy (el anterior se corta a la misma hora); si no, null. */
export function horaDeCorte(ffin, hoy = hoySV(), hora = horaSV()) {
    if (ffin !== hoy) return null;
    return hora.replace(/:\d\d$/, ':00');
}

/** El producto que se lee como descuento (canje de puntos) en los renglones. */
export const PRODUCTO_DESCUENTO = -999;

/**
 * Los renglones de una venta listos para mostrar: sin duplicados (la
 * sincronización puede traer el mismo renglón dos veces), los productos y el
 * descuento por puntos. Si no viene el renglón de descuento pero la suma de los
 * productos pasa al total por más de un centavo, esa diferencia ES el descuento.
 */
export function renglonesDeLaVenta(items, total) {
    const vistos = new Set();
    const unicos = (items || []).filter((it) => {
        const firma = `${it.erp_product_id ?? it.descripcion}|${it.presentacion ?? ''}|${it.precio_unitario}|${it.total_linea}|${it.lote ?? ''}`;
        if (vistos.has(firma)) return false;
        vistos.add(firma);
        return true;
    });
    const descuentos = unicos.filter((it) => it.erp_product_id === PRODUCTO_DESCUENTO);
    const productos = unicos.filter((it) => it.erp_product_id !== PRODUCTO_DESCUENTO && it.descripcion);
    const porRenglon = descuentos.reduce((s, it) => s + Math.abs(parseFloat(it.total_linea || 0)), 0);
    const suma = productos.reduce((s, it) => s + parseFloat(it.total_linea || 0), 0);
    const porDiferencia = suma - parseFloat(total || 0);
    const descuento = descuentos.length ? porRenglon : (porDiferencia > 0.01 ? porDiferencia : 0);
    return { productos, descuento };
}

// ── Vendedores ──────────────────────────────────────────────────────────────

/** Códigos de vendedor que no son personas: se muestran con su rótulo. */
export const CODIGOS_ESPECIALES = { '1000': 'Administración', '125': 'Domicilio' };

/**
 * El ranking del período a partir de las filas por sala y vendedor
 * (`get_vendedores_resumen`). Un vendedor que vendió en varias salas se suma en
 * UNA fila; un código que no es de nadie (ni ficha ni especial) no se pierde:
 * va aparte, por sala, porque esa plata existe aunque nadie la firme.
 *   → { conocidos: [{cod_vendedor, total, count, branchIds, emp, especial}], sinFicha: [{branch_id, total, count}], total, facturas }
 */
export function rankingDeVendedores(filas, porCodigo) {
    const conocidos = new Map();
    const sinFicha = new Map();
    for (const r of (filas || [])) {
        const total = parseFloat(r.total_ventas ?? r.total ?? 0);
        const count = parseInt(r.total_facturas ?? r.count ?? 0, 10);
        const emp = porCodigo.get(r.cod_vendedor) || null;
        const especial = CODIGOS_ESPECIALES[r.cod_vendedor] || null;
        if (emp || especial) {
            const v = conocidos.get(r.cod_vendedor) || { cod_vendedor: r.cod_vendedor, total: 0, count: 0, branchIds: [], emp, especial };
            v.total += total;
            v.count += count;
            if (!v.branchIds.includes(r.branch_id)) v.branchIds.push(r.branch_id);
            conocidos.set(r.cod_vendedor, v);
        } else {
            const u = sinFicha.get(r.branch_id) || { branch_id: r.branch_id, total: 0, count: 0 };
            u.total += total;
            u.count += count;
            sinFicha.set(r.branch_id, u);
        }
    }
    const lista = [...conocidos.values()].sort((a, b) => b.total - a.total);
    const sueltos = [...sinFicha.values()];
    const suma = (xs, k) => xs.reduce((s, x) => s + x[k], 0);
    return { conocidos: lista, sinFicha: sueltos, total: suma(lista, 'total') + suma(sueltos, 'total'), facturas: suma(lista, 'count') + suma(sueltos, 'count') };
}

/** El primer día del mes anterior al de `fini` («2026-10-15» → «2026-09-01»). */
export function mesAnteriorDe(fini) {
    const [y, m] = fini.split('-').map(Number);
    const idx = y * 12 + (m - 1) - 1;
    return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}-01`;
}

/** El puesto de cada vendedor el mes anterior (sin los códigos especiales): Map cod → 1, 2, … */
export function puestosDelMesAnterior(filas) {
    const porVendedor = new Map();
    for (const r of (filas || [])) {
        if (CODIGOS_ESPECIALES[r.cod_vendedor]) continue;
        porVendedor.set(r.cod_vendedor, (porVendedor.get(r.cod_vendedor) || 0) + parseFloat(r.total_sum || 0));
    }
    const puestos = new Map();
    [...porVendedor.entries()].sort((a, b) => b[1] - a[1]).forEach(([cod], i) => puestos.set(cod, i + 1));
    return puestos;
}

/** Las ventas de un vendedor por día, con el reparto por sala (`get_vendedor_diario`). */
export function ventasDiariasDelVendedor(filas) {
    const porDia = new Map();
    for (const d of (filas || [])) {
        const v = porDia.get(d.fecha) || { fecha: d.fecha, total: 0, count: 0, branches: [] };
        v.total += parseFloat(d.total_ventas || 0);
        v.count += parseInt(d.total_facturas || 0, 10);
        v.branches.push({ branch_id: d.branch_id, total: parseFloat(d.total_ventas || 0) });
        porDia.set(d.fecha, v);
    }
    return [...porDia.values()];
}

// ── Productos vendidos ──────────────────────────────────────────────────────

/**
 * Una fila de `get_product_sales_agg_jsonb` lista para mostrar: utilidad y
 * margen sobre el neto (sin IVA), costo unitario, y las unidades BASE — las
 * presentaciones por su factor, porque «2 cajas X30» son 60 unidades.
 */
export function filaDeProductoVendido(item) {
    const qty = parseFloat(item.cantidad || 0);
    const neto = parseFloat(item.neto || 0);
    const costo_total = item.costo_total != null ? parseFloat(item.costo_total) : null;
    const utilidad = costo_total != null ? neto - costo_total : null;
    const margen = utilidad != null && neto > 0 ? (utilidad / neto) * 100 : null;
    const costo_unitario = costo_total != null && qty > 0 ? costo_total / qty : null;
    const presentaciones = (item.presentaciones || []).map((p) => ({
        presentacion: p.presentacion || '',
        cantidad: parseFloat(p.cantidad || 0),
        neto: parseFloat(p.neto || 0),
        factor: parseInt(p.factor || 1, 10),
    }));
    const cantidad_base = presentaciones.length > 0
        ? presentaciones.reduce((s, p) => s + p.cantidad * p.factor, 0)
        : qty;
    return {
        erp_product_id: item.erp_product_id,
        descripcion: item.descripcion,
        laboratorio_id: item.laboratorio_id ?? null,
        laboratorio_nombre: item.laboratorio_nombre || null,
        cantidad: qty, cantidad_base, neto, costo_total, costo_unitario, utilidad, margen, presentaciones,
        ultima_venta: item.ultima_venta || null,
        ultima_venta_por_suc: item.ultima_venta_por_suc || [],
        oculto_en_ventas: !!item.oculto_en_ventas,
        oculto_por: item.oculto_en_ventas
            ? { first_names: item.oculto_por_first_names || null, last_names: item.oculto_por_last_names || null }
            : null,
        oculto_at: item.oculto_at || null,
    };
}

/** Los totales de una lista de productos vendidos. El costo y la utilidad sólo suman lo que tiene costo. */
export function totalesDeProductos(filas) {
    let neto = 0, costo = 0, utilidad = 0, mayor = 0;
    for (const r of (filas || [])) {
        neto += r.neto;
        if (r.costo_total != null) costo += r.costo_total;
        if (r.utilidad != null) utilidad += r.utilidad;
        if (r.neto > mayor) mayor = r.neto;
    }
    return { neto, costo, utilidad, margen: neto > 0 ? (utilidad / neto) * 100 : 0, conIva: neto * 1.13, mayor: mayor || 1 };
}

/**
 * El precio y el neto de un renglón como los lee quien compra: el crédito
 * fiscal (CCF) va sin IVA —el IVA se desglosa aparte—; todo lo demás, con IVA.
 */
export function precioALaVista(renglon) {
    const f = renglon.tipo_documento === 'CCF' ? 1 : 1.13;
    return { precio: parseFloat(renglon.precio_unitario || 0) * f, neto: parseFloat(renglon.neto || 0) * f };
}

// ── Productos ocultos y laboratorios (pestaña Productos, 2026-10-09) ────────
// Ocultar un producto es global y permanente: por defecto la vista excluye los
// ocultos; «ver ocultos» invierte a SÓLO los ocultos para revisarlos y
// destaparlos. Escrito UNA vez para el portal y la app.
export const productosSegunOcultos = (filas, verOcultos) => (filas || []).filter((r) => (verOcultos ? r.oculto_en_ventas : !r.oculto_en_ventas));
export const cuantosOcultos = (filas) => (filas || []).filter((r) => r.oculto_en_ventas).length;

/** Los laboratorios que aparecen en la lista, por nombre. */
export function laboratoriosDeProductos(filas) {
    const vistos = new Map();
    for (const r of filas || []) {
        if (r.laboratorio_id != null && !vistos.has(r.laboratorio_id)) vistos.set(r.laboratorio_id, r.laboratorio_nombre || `Lab. ${r.laboratorio_id}`);
    }
    return [...vistos.entries()].map(([value, label]) => ({ value: String(value), label })).sort((a, b) => a.label.localeCompare(b.label));
}

/** «Ocultar montos»: el monto se reemplaza por puntos, nunca se redondea a otra cosa. */
export const montoPrivado = (texto, privado) => (privado ? '••••••' : texto);

// ── El tipo de precio que se cobró, y los cambios de una factura ───────────
// Vivían escritos dentro de `VentasView` (la fila de una venta y el detalle de
// un producto); la app los necesita iguales, así que pasan acá y la vista los
// importa. `variante` es el nombre de la variante de `Badge` del portal.

/** Los niveles de precio, con el número con que los nombra la sala. */
export const DRILL_TIERS = [
    { key: 'vip',         label: 'VIP',     variante: 'chart-3', num: 3 },
    { key: 'clinica',     label: 'Clínica', variante: 'warning', num: 4 },
    { key: 'mayoreo',     label: 'Mayoreo', variante: 'chart-4', num: 5 },
    { key: 'premium',     label: 'Premium', variante: 'warning', num: 6 },
    { key: 'descuento_1', label: 'Desc.',   variante: 'success', num: 2 },
    { key: 'precio_7',    label: 'P7',      variante: 'chart-9', num: 7 },
    { key: 'vineta',      label: 'Viñeta',  variante: 'neutral', num: 1 },
];
/** Del más bajo al más alto: hasta dónde llega cada cargo (`maxPriceLevel`). */
export const DRILL_TIER_ORDER = ['vineta', 'descuento_1', 'vip', 'clinica', 'mayoreo', 'premium', 'precio_7'];

/**
 * Qué nivel de precio se cobró: el más cercano al precio unitario de la venta
 * (los precios pueden venir con o sin IVA; se prueban los dos). A más de 10 %
 * de todos, «Especial». `null` si no hay con qué comparar.
 */
export function detectTier(precioUnitario, preciosRow, tiers = DRILL_TIERS) {
    if (!preciosRow || !precioUnitario) return null;
    const p = parseFloat(precioUnitario);
    const candidates = tiers
        .map((t) => {
            const gross = parseFloat(preciosRow[t.key] || 0);
            if (!gross) return null;
            const net = gross / 1.13;
            const diff = Math.min(Math.abs(gross - p) / gross, Math.abs(net - p) / net);
            return { ...t, diff };
        })
        .filter(Boolean);
    if (!candidates.length) return null;
    const best = candidates.reduce((a, b) => (b.diff < a.diff ? b : a));
    if (best.diff > 0.10) return { key: 'especial', label: 'Especial', color: 'bg-chart-6/10 text-chart-6-text' };
    return best;
}

/**
 * El nivel de un renglón de venta contra TODAS las filas de precio del
 * producto (la venta y el catálogo usan ids de presentación distintos, así que
 * no se cruza por presentación): gana la más cercana.
 */
export function tierDelRenglon(precioUnitario, filasDePrecio) {
    const candidatos = (filasDePrecio || []).map((row) => detectTier(parseFloat(precioUnitario), row)).filter(Boolean);
    if (!candidatos.length) return null;
    return candidatos.reduce((best, t) => ((t.diff ?? Infinity) < (best.diff ?? Infinity) ? t : best));
}

/** Los campos de `sales_invoice_changelog` que se le muestran a la sala. */
export const RELEVANT_CAMPOS = new Set(['tipo_pago', 'recibido_mh']);
export const CAMPO_LABELS = { tipo_pago: 'Forma de pago', recibido_mh: 'Sello MH' };
export const fmtCampoVal = (campo, val) => {
    if (val == null) return 'Sin registro';
    if (campo === 'recibido_mh') return val === true || val === 'true' ? 'Recibido' : `Recibido (${val})`;
    return String(val);
};

// ── El detalle de un producto vendido: el nivel cobrado y si cambió ─────────
// (Vivía en `VentasView`, `fetchDrillDown`.) Cada venta se cruza con el precio
// VIGENTE ese día (historial) y con el de hoy: si el nivel no coincide, el
// precio cambió después — es el filtro «precio cambió» del portal.

// Normalize a presentacion name for loose matching: "UNIDAD 1x1" → "UNIDAD 1X1"
export function presKey(tipo, descripcion) {
    return `${tipo ?? ''} ${descripcion ?? ''}`.toUpperCase().replace(/\s+/g, ' ').trim();
}

// Find the price record active on a given date (YYYY-MM-DD) from a pre-filtered list.
export function findHistFromList(list, fechaStr) {
    const matches = (list || []).filter(h => {
        const from  = h.valid_from.slice(0, 10);
        const until = h.valid_until ? h.valid_until.slice(0, 10) : null;
        return from <= fechaStr && (until === null || until > fechaStr);
    });
    return matches.sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0] ?? null;
}

// Find the price record that was active on a given date (YYYY-MM-DD string).
// valid_from/valid_until are UTC ISO timestamps — we compare date prefix only.
export function findHistPrices(history, idPresentacion, fechaStr) {
    return findHistFromList((history || []).filter(h => h.id_presentacion === idPresentacion), fechaStr);
}

// Find the earliest price change AFTER a given date for a given id_presentacion list.
export function findFirstChangeSince(history, idPresentaciones, fechaStr) {
    const ids = Array.isArray(idPresentaciones) ? idPresentaciones : [idPresentaciones];
    const later = (history || [])
        .filter(h => ids.includes(h.id_presentacion) && h.valid_from.slice(0, 10) > fechaStr)
        .sort((a, b) => a.valid_from.localeCompare(b.valid_from));
    return later[0]?.valid_from ?? null;
}

/**
 * Las ventas de un producto (`get_product_sales_lines`) con su nivel de precio:
 * `tier` (el de ese día), `currentTier` (el de hoy), `tierChanged` y desde
 * cuándo. `precios` = `fetchProductPreciosDetail`, `history` =
 * `fetchProductPreciosHistory`; `tiers` = los niveles que el cargo puede ver.
 */
export function lineasDelDrill(data, precios, history, tiers = DRILL_TIERS) {
    const preciosMap = new Map((precios || []).map(p => [p.id_presentacion, p]));
    // Secondary lookup by presentation name — handles ERP duplicate IDs
    const preciosNameMap = new Map();
    for (const p of (precios || [])) {
        const k = presKey(p.presentaciones?.tipo, p.descripcion);
        if (k) preciosNameMap.set(k, p);
    }
    const presDescMap = new Map((precios || []).map(p => [p.id_presentacion, p.descripcion]));
    const histNameMap = new Map();
    for (const h of (history || [])) {
        const k = presKey(h.presentaciones?.tipo, presDescMap.get(h.id_presentacion));
        if (k) { if (!histNameMap.has(k)) histNameMap.set(k, []); histNameMap.get(k).push(h); }
    }
    const fallbackCurr = (precios || []).length === 1 ? precios[0] : null;
    return (data || []).map(row => {
        const idPres    = row.id_presentacion;
        const saleKey   = (row.presentacion || '').toUpperCase().replace(/\s+/g, ' ').trim();
        const currPrices = preciosMap.get(idPres) ?? preciosNameMap.get(saleKey) ?? fallbackCurr;
        const histById   = findHistPrices(history || [], idPres, row.fecha);
        const histByName = histById ? null : findHistFromList(histNameMap.get(saleKey) || [], row.fecha);
        const histPrices = histById ?? histByName;
        const resolvedHistId = histById ? idPres
            : histByName ? (histNameMap.get(saleKey) || [])[0]?.id_presentacion
            : idPres;
        const { precio: precio_display, neto: neto_display } = precioALaVista(row);
        const tier        = detectTier(precio_display, histPrices ?? currPrices, tiers);
        const currentTier = detectTier(precio_display, currPrices, tiers);
        const tierChanged   = !!(histPrices && currPrices && tier?.label !== currentTier?.label);
        const tierChangedAt = tierChanged ? findFirstChangeSince(history || [], [idPres, resolvedHistId], row.fecha) : null;
        return {
            id: row.item_id, invoice_id: row.invoice_id, fecha: row.fecha, erp_invoice_id: row.erp_invoice_id, correlativo: row.correlativo,
            presentacion: row.presentacion, id_presentacion: idPres, cantidad: row.cantidad, precio_unitario: row.precio_unitario,
            precio_display, neto: row.neto, neto_display, cliente: row.cliente, branch_id: row.branch_id,
            tipo_documento: row.tipo_documento, cod_vendedor: row.cod_vendedor, tipo_pago: row.tipo_pago,
            lote: row.lote, fecha_vencimiento: row.fecha_vencimiento,
            tier, currentTier, tierChanged, tierChangedAt,
        };
    });
}
