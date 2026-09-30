// @ts-nocheck — Las tablas `dist_*` todavía NO existen en producción (viven en
// supabase/borradores/distribucion y sólo en el entorno de pruebas). Al migrar:
// `npm run tipos:base` y se QUITA esta línea. Ver distribucionInventario.js.
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
