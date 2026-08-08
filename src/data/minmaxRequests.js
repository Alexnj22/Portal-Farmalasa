// Bloque 6.A — capa de datos, entidad "minmaxRequests". Extraído de
// WidgetMinMaxRequest.jsx: 5 llamadas supabase.from(). Las 2 últimas
// (fetchActiveProductsCount + fetchActiveProductsChunk) preservan el
// patrón de paginación en paralelo (count + N chunks de 1000 vía
// .range()) que ya usaba el caller — Patrón B de CLAUDE.md, no es un
// bug, solo se extrae el query builder.
import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';

export function fetchProductPreciosForMinMax(productId) {
    return supabase.from('product_precios')
        .select('factor, descripcion, presentaciones(tipo)')
        .eq('product_id', productId)
        .eq('activo', true);
}

export function fetchCurrentStockParams(erpProductId, erpSucursalId) {
    return supabase.from('product_stock_params')
        .select('manual_min, manual_max, min_units, max_units, units_sold_6m')
        .eq('erp_product_id', erpProductId)
        .eq('erp_sucursal_id', Number(erpSucursalId))
        .maybeSingle();
}

export function insertMinMaxChangeRequest(payload) {
    return supabase.from('minmax_change_requests').insert(payload);
}

// ── TabMinMaxRequests.jsx (bandeja de aprobación — todas las solicitudes) ──

// `.limit(1000)` está prohibido (CLAUDE.md): es el cap EXACTO de PostgREST, así
// que el día que la tabla lo cruza trunca en silencio y la bandeja muestra 1000
// de N sin decirlo. Se pagina con el helper canónico.
export function fetchAllMinMaxChangeRequests() {
    return fetchAllRows(() => supabase.from('minmax_change_requests')
        .select('*')
        .order('requested_at', { ascending: false }));
}

/**
 * El buscador de producto del widget Ajuste de Min/Max.
 *
 * Reemplaza a `fetchActiveProductsCount` + N × `fetchActiveProductsChunk`, que
 * bajaban los **5.205 productos activos** al navegador —nombre, laboratorio,
 * foto y principio activo— para después filtrarlos con `smartFilter` en
 * memoria. Medido el 2026-08-07: 6 peticiones y 4.462 ms de mediana hasta ver
 * el primer resultado, con tandas de entre 1,0 y 4,2 s cada una.
 *
 * El criterio es EL MISMO que hacía `smartFilter` —los tokens contra el pajar
 * de nombre + principio activo + laboratorio, y caída a aproximado si no hay
 * nada— pero resuelto en `buscar_productos_minmax`. Lo que cambia es el
 * algoritmo del aproximado: Levenshtein palabra a palabra allá, trigramas acá.
 * Está anotado en la migración.
 */
export async function buscarProductosMinMax(termino, limite = 20) {
    const { data, error } = await supabase.rpc('buscar_productos_minmax', {
        p_search: termino, p_limit: limite,
    });
    if (error) { console.error('buscarProductosMinMax:', error.message); return { filas: [], error }; }
    return { filas: data ?? [], error: null };
}

export function fetchActiveProductsCount() {
    return supabase.from('products').select('*', { count: 'exact', head: true }).eq('activo', true);
}

export function fetchActiveProductsChunk(rangeFrom, rangeTo) {
    return supabase.from('products')
        .select('id, nombre, laboratorio_id, foto_url, principio_activo, laboratorios(nombre)')
        .eq('activo', true)
        .order('nombre')
        .range(rangeFrom, rangeTo);
}

/**
 * Cuántas propuestas de Min/Max están esperando decisión.
 *
 * Es lo que la baldosa del tablero muestra: sin un número, una puerta cerrada
 * no da ningún motivo para abrirla. `head: true` pide el CONTEO, no las filas.
 */
// Los tres estados de un vistazo, en el MISMO viaje que antes traía sólo el
// conteo de pendientes.
//
// ── Por qué no hay una línea de tendencia acá (2026-08-08) ────────────────
// La franja de esta baldosa iba a ser una línea de propuestas por semana. Al
// mirar la tabla antes de escribirla: **cero filas**, o sea que nadie ha usado
// la función todavía y la línea habría sido una recta en cero, permanente, más
// una consulta extra para dibujarla. Lo que sí dice algo desde la primera
// propuesta es en qué terminan: si se aplican o se rechazan. Eso decide si vale
// la pena proponer, y sale de esta misma consulta.
//
// La ventana de 90 días es para que lo decidido hace medio año no siga pesando
// en la proporción; las pendientes no se filtran por fecha, porque una
// solicitud vieja sin responder es justamente lo que hay que ver.
export async function fetchMinMaxEstados(erpSucursalId = null) {
    const desde = new Date(Date.now() - 90 * 86400000).toISOString();
    let q = supabase
        .from('minmax_change_requests')
        .select('id, status, requested_at')
        .or(`status.eq.PENDING,requested_at.gte.${desde}`);
    if (erpSucursalId) q = q.eq('erp_sucursal_id', Number(erpSucursalId));
    const { data, error } = await q;

    const filas = data ?? [];
    const cuenta = (s) => filas.filter(f => f.status === s).length;
    return {
        pendientes: cuenta('PENDING'),
        aplicadas:  cuenta('APPROVED'),
        rechazadas: cuenta('REJECTED'),
        error,
    };
}
