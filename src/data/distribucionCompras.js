// Compras de la distribuidora a sus proveedores (borrador 0015).
//
// Se guarda como borrador mientras se captura y se RECIBE cuando cuadra: eso
// es lo que mueve inventario y costo, y lo hace la base (`dist_recibir_compra`)
// con las mismas validaciones que `views/distribucion/compras.js` avisa en
// pantalla. Desde acá nunca se escribe una tabla de compras directamente.
import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';

export async function fetchProveedores() {
    const { data, error } = await supabase
        .from('dist_proveedores')
        .select('id, emisor_id, nombre, nit, nrc, relacionada, gran_contribuyente, telefono, correo, plazo_dias, activo')
        .order('nombre')
        .limit(999);
    if (error) throw error;
    return data ?? [];
}

export async function guardarProveedor(p) {
    const fila = {
        emisor_id: p.emisor_id, nombre: p.nombre.trim(), nit: p.nit || null, nrc: p.nrc || null,
        relacionada: !!p.relacionada, gran_contribuyente: !!p.gran_contribuyente,
        telefono: p.telefono || null, correo: p.correo || null, plazo_dias: Number(p.plazo_dias) || 0, activo: p.activo !== false,
    };
    const q = p.id
        ? supabase.from('dist_proveedores').update(fila).eq('id', p.id).select('id').single()
        : supabase.from('dist_proveedores').insert(fila).select('id').single();
    const { data, error } = await q;
    if (error) throw error;
    return data.id;
}

export async function fetchCompras() {
    const rows = await fetchAllRows(() => supabase
        .from('dist_compras')
        .select('id, proveedor_id, tipo_doc, numero, fecha, condicion, vence, gravada, exenta, iva, percepcion, retencion, total, estado, created_at, recibida_at, anulada_motivo, dist_proveedores(nombre, relacionada), dist_compra_items(count)')
        .order('fecha', { ascending: false })
        .order('id', { ascending: false }));
    if (rows === null) throw new Error('No se pudieron cargar las compras.');
    return rows.map(r => ({ ...r, proveedor: r.dist_proveedores?.nombre ?? '—', renglones: r.dist_compra_items?.[0]?.count ?? 0 }));
}

export async function fetchCompra(id) {
    const { data, error } = await supabase
        .from('dist_compras')
        .select('*, dist_proveedores(nombre, nit, nrc, relacionada), dist_compra_items(id, product_id, codigo_proveedor, descripcion_proveedor, cantidad, costo_unitario, lote, vence, lote_id, products(nombre)), recibio:employees!dist_compras_recibida_por_fkey(name), anulo:employees!dist_compras_anulada_por_fkey(name)')
        .eq('id', id)
        .single();
    if (error) throw error;
    return data;
}

/** `{ codigo: { product_id, unidades_por } }` de ese proveedor. */
export async function fetchMemoriaProveedor(proveedorId) {
    const { data, error } = await supabase
        .from('dist_proveedor_productos')
        .select('codigo, product_id, unidades_por')
        .eq('proveedor_id', proveedorId)
        .limit(999);
    if (error) throw error;
    return Object.fromEntries((data ?? []).map(r => [r.codigo, { product_id: r.product_id, unidades_por: r.unidades_por }]));
}

export async function guardarCompra(compra) {
    const { data, error } = await supabase.rpc('dist_guardar_compra', { p_compra: compra });
    if (error) throw error;
    return data;
}

export async function recibirCompra(id) {
    const { data, error } = await supabase.rpc('dist_recibir_compra', { p_compra: id });
    if (error) throw error;
    return data;
}

export async function anularCompra(id, motivo) {
    const { data, error } = await supabase.rpc('dist_anular_compra', { p_compra: id, p_motivo: motivo });
    if (error) throw error;
    return data;
}

// ── Reportes (borrador 0016) ───────────────────────────────────────────────

/** Utilidad bruta del período: `{ resumen, grupos, por_dia }`. Sólo quien administra. */
export async function fetchUtilidad({ desde, hasta, ruta = null, vendedor = null }) {
    const { data, error } = await supabase.rpc('dist_utilidad', { p_desde: desde, p_hasta: hasta, p_ruta: ruta, p_vendedor: vendedor });
    if (error) throw error;
    return data;
}

/**
 * Referencias de precio de mercado por producto (borrador 0022): costo y
 * mayoreo de Farmalasa, precio y costo de Torogoz — todo por unidad y sin IVA.
 * Devuelve `{ [product_id]: {...} }`.
 */
export async function fetchReferenciasRelacionada(productIds) {
    const ids = [...new Set((productIds ?? []).map(Number).filter(n => Number.isInteger(n) && n > 0))];
    if (!ids.length) return {};
    const { data, error } = await supabase.rpc('dist_referencias_relacionada', { p_productos: ids });
    if (error) throw error;
    return data ?? {};
}

/** El reporte de compras a partes relacionadas del período (borrador 0022). */
export async function fetchRelacionadas({ desde, hasta }) {
    const { data, error } = await supabase.rpc('dist_relacionadas', { p_desde: desde, p_hasta: hasta });
    if (error) throw error;
    return data;
}

/** Los libros de ventas del período: `{ contribuyente, consumidor, anulados, sin_sello }` (borrador 0021). */
export async function fetchLibrosVentas({ desde, hasta }) {
    const { data, error } = await supabase.rpc('dist_libros_iva', { p_desde: desde, p_hasta: hasta });
    if (error) throw error;
    return data;
}

/** Las compras recibidas del período, con `en_libro` (sólo los Créditos Fiscales). */
export async function fetchLibroCompras({ desde, hasta }) {
    const { data, error } = await supabase.rpc('dist_libro_compras', { p_desde: desde, p_hasta: hasta });
    if (error) throw error;
    return data ?? [];
}
