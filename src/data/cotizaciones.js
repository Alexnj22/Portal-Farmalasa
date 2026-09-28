// Bloque 6.A — capa de datos, entidad "cotizaciones". Extraído de
// CotizacionesView.jsx: 15 llamadas supabase.from() (una compartida con
// data/system.js: fetchBranchesBasic, mismo query exacto).
import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';
import { buscarProductos } from './busquedaProductos';
import { buscarClientes } from './customers';
import { anotar, conBitacora } from './audit';

// Paginado con fetchAllRows — antes era un while-loop manual con el mismo
// patrón 1000-en-1000 ya presente en otros archivos de este bloque.
export function fetchAllProductPreciosForCotizaciones() {
    return fetchAllRows(() =>
        supabase
            .from('product_precios')
            .select('product_id, id_presentacion, descripcion, vineta, descuento_1, vip, clinica, mayoreo, premium, precio_7, presentaciones(tipo)')
            .eq('activo', true)
            .order('product_id', { ascending: true })
            .order('id_presentacion', { ascending: true })
    );
}

export function searchProductsActive(term) {
    return buscarProductos(term, { select: 'id, nombre', limite: 20 });
}

// Con la regla del portal (antes: `ilike` de la frase entera, sin quitar
// tildes). Devuelve `{ data, error, aproximado }`.
export function searchCustomersByName(term) {
    return buscarClientes(term, { select: 'id, name, nit', limite: 60 });
}

export function fetchCotizacionesList(scopeBranchId) {
    let q = supabase
        .from('cotizaciones')
        .select('id, numero, fecha, customer_name, document_type, payment_type, total, status, created_by_name, created_by_photo, branch_id')
        .order('created_at', { ascending: false })
        .limit(300);
    if (scopeBranchId) q = q.eq('branch_id', scopeBranchId);
    return q;
}

export function insertCotizacion(payload) {
    return supabase.from('cotizaciones').insert(payload).select().single();
}

export function updateCotizacion(cotId, patch, returning = false) {
    const q = supabase.from('cotizaciones').update(patch).eq('id', cotId);
    return returning ? q.select().single() : q;
}

export function insertCotizacionItems(rows) {
    return supabase.from('cotizacion_items').insert(rows);
}

export function fetchCotizacionItems(cotizacionId) {
    return supabase.from('cotizacion_items').select('*').eq('cotizacion_id', cotizacionId).order('sort_order');
}

export function deleteCotizacionItems(cotizacionId) {
    return supabase.from('cotizacion_items').delete().eq('cotizacion_id', cotizacionId);
}

// ── Llamadas que vivían en las pantallas (F3 del núcleo portable) ──────────
// Reciben los parámetros de la función tal cual y devuelven `{ data, error }`.

/** El número que le toca a la próxima cotización. */
export const siguienteNumeroDeCotizacion = () => supabase.rpc('next_cotizacion_numero');

// ── Guardar una cotización, y anotarla (D3, 2026-09-28) ─────────────────────
// Una cotización es un precio que la empresa le ofrece a alguien por escrito.
// Quién la emitió, por cuánto y a quién no quedaba en ningún lado fuera de la
// propia fila, que después se edita encima. Por eso las tres escrituras anotan
// su entrada acá: cualquier cliente que las llame la deja. Devuelven
// `{ data, error }`; `data` es la fila de la cotización.

/** Pide el número, crea la cotización y sus renglones (`rows` sin `cotizacion_id`). */
export async function crearCotizacion(payload, rows) {
    const { data: numero, error: numErr } = await siguienteNumeroDeCotizacion();
    if (numErr) return { data: null, error: numErr };
    const { data: cot, error: cotErr } = await insertCotizacion({ numero, ...payload });
    if (cotErr) return { data: null, error: cotErr };
    const { error: itemsErr } = await insertCotizacionItems(rows.map(r => ({ ...r, cotizacion_id: cot.id })));
    if (itemsErr) return { data: cot, error: itemsErr };
    anotar('CREAR_COTIZACION', cot.id, {
        numero, cliente: cot.cliente_nombre ?? null, total: cot.total ?? null, renglones: rows.length,
    });
    return { data: cot, error: null };
}

/**
 * Edita la cotización y REESCRIBE sus renglones: el precio de antes deja de
 * existir en la fila. Sin registro no hay forma de mostrar qué se había
 * ofrecido si el cliente reclama.
 */
export async function editarCotizacion(cotId, patch, rows) {
    const { data: cot, error: cotErr } = await updateCotizacion(cotId, patch, true);
    if (cotErr) return { data: null, error: cotErr };
    await deleteCotizacionItems(cotId);
    const { error: itemsErr } = await insertCotizacionItems(rows.map(r => ({ ...r, cotizacion_id: cotId })));
    if (itemsErr) return { data: cot, error: itemsErr };
    anotar('EDITAR_COTIZACION', cotId, {
        numero: cot?.numero ?? null, total: cot?.total ?? null, renglones: rows.length,
    });
    return { data: cot, error: null };
}

export function anularCotizacion(cotId) {
    return conBitacora(updateCotizacion(cotId, { status: 'ANULADA' }), 'ANULAR_COTIZACION', cotId, {});
}
