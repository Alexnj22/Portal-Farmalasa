// La bodega de la distribuidora —inventario por lote, cuarentena, conteo,
// bajas, reposición y ventas perdidas— en las reglas que comparten el portal
// (`views/distribucion/Tab*.jsx`) y la app nativa (`apps/mobile/app/torogoz`).
// Sólo cuentas y rótulos: las escrituras son funciones de la base
// (`data/distribucion*.js`), y los íconos se quedan en cada pantalla.
import { diasEntre, hoySV } from './fecha';
import { tokenMatch } from './searchUtils';

/** Lote «por vencer»: vence en estos días o menos. */
export const POR_VENCER = 90;

/** Los movimientos de un lote, con su rótulo y su tono. */
export const TIPO_MOVIMIENTO = {
    entrada: { label: 'Entrada', variant: 'success' },
    ajuste: { label: 'Ajuste', variant: 'warning' },
    venta: { label: 'Venta', variant: 'neutral' },
    liberacion: { label: 'Liberado', variant: 'info' },
    devolucion: { label: 'Devuelto', variant: 'info' },
    compra: { label: 'Compra', variant: 'success' },
    compra_anulada: { label: 'Compra anulada', variant: 'danger' },
};

/** El vencimiento de un lote en una insignia: `{ variant, texto }`. */
export function estadoDeVencimiento(vence, hoy) {
    if (!vence) return { variant: 'neutral', texto: 'Sin fecha' };
    const d = diasEntre(hoy ?? hoySV(), vence);
    if (d < 0) return { variant: 'danger', texto: `Vencido hace ${-d} d` };
    if (d <= POR_VENCER) return { variant: 'warning', texto: d === 0 ? 'Vence hoy' : `En ${d} d` };
    return { variant: 'success', texto: `En ${d} d` };
}

/** Un entero de unidades (0 vale); cualquier otra cosa es `null`. */
export const leerEntero = (t) => {
    const s = String(t ?? '').trim();
    return /^\d+$/.test(s) ? Number(s) : null;
};

/** Para el mínimo y el máximo: vacío = `null` (automático); algo que no es entero = `NaN`. */
export const enteroOpcional = (t) => {
    const s = String(t ?? '').trim();
    return s === '' ? null : /^\d+$/.test(s) ? Number(s) : NaN;
};

/** Costo promedio por `emisor:producto` (sin IVA), de los renglones del catálogo. */
export function costosDelCatalogo(catalogo) {
    return new Map((catalogo ?? []).filter(p => p.costo_promedio !== null && p.costo_promedio !== undefined)
        .map(p => [`${p.emisor_id}:${p.product_id}`, Number(p.costo_promedio)]));
}

/** Los lotes con sus días para vencer, su costo y su valor al costo (`null` si no hay costo). */
export function lotesConDias(lotes, costos, hoy) {
    return (lotes ?? []).map(l => {
        const costo = costos?.get(`${l.emisor_id}:${l.product_id}`);
        return { ...l, dias: l.vence ? diasEntre(hoy ?? hoySV(), l.vence) : null, costo: costo ?? null, valor: costo !== undefined ? costo * l.existencia : null };
    });
}

/**
 * Filtra los lotes de la bodega. Sin filtro sólo se ven los que tienen
 * existencia; `agotados` muestra los que quedaron en cero.
 */
export function filtrarLotes(lotes, { buscar = '', filtro = '' } = {}) {
    const q = String(buscar ?? '').trim();
    return (lotes ?? []).filter(l => (!q || tokenMatch(q, `${l.nombre} ${l.lote}`))
        && (filtro === 'agotados' ? l.existencia === 0 : l.existencia > 0)
        && (filtro !== 'porVencer' || (l.dias !== null && l.dias >= 0 && l.dias <= POR_VENCER))
        && (filtro !== 'vencidos' || (l.dias !== null && l.dias < 0)));
}

/** Las cifras de arriba del inventario. */
export function resumenDeLotes(lotes) {
    const vivos = (lotes ?? []).filter(l => l.existencia > 0);
    return {
        productos: new Set(vivos.map(l => l.product_id)).size,
        unidades: vivos.reduce((t, l) => t + l.existencia, 0),
        porVencer: vivos.filter(l => l.dias !== null && l.dias >= 0 && l.dias <= POR_VENCER).length,
        vencidos: vivos.filter(l => l.dias !== null && l.dias < 0).length,
        valor: vivos.reduce((t, l) => t + (l.valor ?? 0), 0),
        sinCosto: new Set(vivos.filter(l => l.costo === null).map(l => l.product_id)).size,
    };
}

/** Qué se puede hacer con lo que está en cuarentena (borrador 0017). */
export const ACCIONES_CUARENTENA = [
    { estado: 'reingresada', label: 'Reingresar', toast: 'Volvió a la existencia de su lote.' },
    { estado: 'devuelta_proveedor', label: 'Al proveedor', toast: 'Anotado como devuelto al proveedor.' },
    { estado: 'destruida', label: 'Destruir', toast: 'Anotado como destruido.' },
];

/** Por qué se da de baja un lote. */
export const MOTIVOS_BAJA = [
    { value: 'vencido', label: 'Vencido' },
    { value: 'danado', label: 'Dañado' },
    { value: 'muestra', label: 'Muestra' },
    { value: 'otro', label: 'Otro' },
];
export const rotuloMotivoBaja = (m) => MOTIVOS_BAJA.find(x => x.value === m)?.label ?? m;

/** El estado de una baja en palabras (la aprobada lleva su valor al costo). */
export const estadoDeBaja = (b, dinero) => (b.estado === 'pendiente' ? 'Por aprobar'
    : b.estado === 'aprobada' ? `Aprobada · ${dinero(b.unidades * Number(b.costo_unitario || 0))}` : 'Rechazada');

/** Lo aprobado en bajas, al costo. */
export const valorDeBajas = (bajas) => (bajas ?? []).filter(b => b.estado === 'aprobada')
    .reduce((a, b) => a + b.unidades * Number(b.costo_unitario || 0), 0);

/** Cuánto va contado y cuánto difiere (la diferencia sólo la ve quien administra). */
export function resumenDeConteo(conteo) {
    const items = conteo?.items ?? [];
    let faltante = 0, sobrante = 0, conDif = 0, contados = 0;
    for (const it of items) {
        if (it.contado != null) contados += 1;
        if (it.contado == null || it.sistema == null) continue;
        const d = it.contado - it.sistema;
        if (d) conDif += 1;
        if (d < 0) faltante += -d * Number(it.costo || 0); else sobrante += d * Number(it.costo || 0);
    }
    return { faltante, sobrante, conDif, contados, total: items.length };
}

/** Los renglones del conteo que se muestran. */
export function renglonesDeConteo(conteo, { buscar = '', soloSinContar = false, producto = null } = {}) {
    const q = String(buscar ?? '').trim();
    return (conteo?.items ?? []).filter(it => (!soloSinContar || it.contado == null)
        && (producto == null || Number(it.product_id) === Number(producto))
        && (!q || tokenMatch(q, it.nombre, it.lote)));
}

/** El producto del catálogo que lleva ese código de barras (o `null`). */
export function productoPorCodigo(catalogo, codigo) {
    const c = String(codigo ?? '').trim();
    if (!c) return null;
    return (catalogo ?? []).find(p => String(p.codigo_barras ?? '').trim() === c) ?? null;
}

/** Reposición: los productos que se muestran (sólo los bajo el mínimo, o todos). */
export function filasDeReposicion(datos, { soloBajo = true, buscar = '' } = {}) {
    const todos = datos?.productos ?? [];
    const q = String(buscar ?? '').trim();
    return (soloBajo ? todos.filter(p => p.sugerido > 0) : todos).filter(p => !q || tokenMatch(q, p.nombre, p.proveedor));
}

/** Las cifras de arriba de la reposición. */
export function resumenDeReposicion(datos) {
    const todos = datos?.productos ?? [];
    const bajo = todos.filter(p => p.sugerido > 0);
    return {
        todos: todos.length,
        bajo: bajo.length,
        costoSugerido: bajo.reduce((a, p) => a + p.sugerido * Number(p.costo || 0), 0),
        vencidos: todos.filter(p => p.vencido > 0).length,
    };
}

/** El pedido sugerido, agrupado por el proveedor de la última compra, listo para mandárselo. */
export function pedidoSugeridoCsv(datos) {
    const bajo = (datos?.productos ?? []).filter(p => p.sugerido > 0);
    const orden = [...bajo].sort((a, b) => String(a.proveedor ?? 'ZZZ').localeCompare(String(b.proveedor ?? 'ZZZ')) || a.nombre.localeCompare(b.nombre));
    return {
        headers: ['PROVEEDOR', 'PRODUCTO', 'DISPONIBLE', 'MINIMO', 'MAXIMO', 'COMPRAR', 'ULTIMO COSTO C/U', 'ESTIMADO'],
        rows: orden.map(p => [p.proveedor ?? 'Sin proveedor', p.nombre, p.disponible, p.minimo, p.maximo, p.sugerido,
            p.costo ? Number(p.costo).toFixed(4) : '', p.costo ? (p.sugerido * Number(p.costo)).toFixed(2) : '']),
        nombre: 'pedido-sugerido-torogoz.csv',
    };
}

/**
 * «¿Hay en alguna sala?»: las filas de `buscar_inventario_global_v2` (una por
 * sala, lote y presentación) sumadas en unidades por producto y sala. Lo
 * vencido no cuenta.
 */
export function existenciasPorProducto(filas) {
    const m = new Map();
    for (const f of filas ?? []) {
        if (f.is_vencidos) continue;
        const k = f.erp_product_id;
        if (!m.has(k)) m.set(k, { id: k, nombre: f.descripcion, salas: new Map() });
        const salas = m.get(k).salas;
        const unidades = Number(f.cantidad || 0) * Number(f.factor || 1);
        salas.set(f.erp_sucursal_id, (salas.get(f.erp_sucursal_id) ?? 0) + unidades);
    }
    return [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
}

// ── Ventas perdidas (2026-09-29) ─────────────────────────────────────────

/** De dónde salió una venta perdida, y cuánto se le puede creer al nombre. */
export const ORIGEN_PERDIDA = {
    catalogo: { label: 'Sin existencia', variant: 'warning' },
    srs: { label: 'Medicamento (SRS)', variant: 'info' },
    insumo: { label: 'Insumo', variant: 'neutral' },
};

/** Las ventas perdidas que coinciden con la búsqueda. */
export function filtrarVentasPerdidas(filas, buscar = '') {
    const q = String(buscar ?? '').trim();
    return q ? (filas ?? []).filter(f => tokenMatch(q, f.producto, f.principio_activo, f.dist_clientes?.nombre, f.laboratorio)) : (filas ?? []);
}

/** Quita la basura invisible que trae el registro de la SRS (igual que su buscador). */
export function limpiarSrs(v) {
    if (v == null) return '';
    const s = typeof v === 'object' ? String(v.nombre ?? v.name ?? v.value ?? '') : String(v);
    // eslint-disable-next-line no-control-regex -- intencional: limpia caracteres de control y del área privada
    return s.replace(new RegExp('[\u0000-\u0008\u000B\u000C\u000E-\u001F\uE000-\uF8FF\uFFF0-\uFFFF]', 'g'), '').replace(/\u00A0/g, ' ').trim();
}

/** Un medicamento del registro de la SRS, en los campos que guarda la venta perdida. */
export function medicamentoDeSrs(p) {
    const principio = limpiarSrs(p.principio_activo ?? p.formula);
    const conc = limpiarSrs(p.concentracion);
    return {
        nombre: limpiarSrs(p.nombre_comercial ?? p.nombreComercial),
        principio: principio ? `${principio}${conc ? ` ${conc}` : ''}` : '',
        laboratorio: limpiarSrs(p.laboratorio),
        registro: limpiarSrs(p.noregistro),
        forma: limpiarSrs(p.NOMBRE_FORMA_FARMACEUTICA),
        activo: limpiarSrs(p.estatus ?? p.Activo) === 'A',
    };
}
