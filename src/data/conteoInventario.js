// Bloque 6.A — capa de datos, entidad "conteoInventario". El resto del módulo
// son RPCs (ya server-side y fuera de alcance de 6.A).
//
// C5 (2026-07-29): insertConteoItemManual y fetchProductCostoActivo salieron de
// aquí. El alta manual era el único write del módulo que no pasaba por RPC, con
// el cliente eligiendo sistema_cantidad y costo_unitario; ahora es
// agregar_item_conteo, que costea server-side con el mismo criterio que el
// snapshot.
import { supabase } from '../supabaseClient';
import { buscarProductos } from './busquedaProductos';

// Un conteo por sucursal cada vez que se audita: la tabla crece del orden de
// decenas al año, muy lejos del tope de 1000 de PostgREST. El límite va
// explícito para que el día que se acerque sea un cambio deliberado y no un
// truncado silencioso (CLAUDE.md, regla del cap de 1000).
//
// Las columnas van enumeradas y SIN `valor_faltante`/`valor_sobrante`: desde el
// 2026-09-23 la base no las entrega por la tabla (son el valorizado del conteo,
// y sólo lo ve quien tiene «Ver el valorizado»). Se piden aparte a
// `get_conteos_valor`, que sin el permiso devuelve `[]` y deja los dos en null.
// Una columna nueva de `conteos_inventario` hay que agregarla acá Y al GRANT de
// la tabla (20260923…_conteo_valorizado_solo_con_permiso_paso2).
const CONTEO_COLS = 'id, created_at, branch_id, created_by, scope_type, scope_filter, incluye_vencidos, '
    + 'status, finalizado_por, finalizado_at, aprobado_por, aprobado_at, nota_aprobacion, '
    + 'total_items, total_contados, total_diferencias, notas, total_pendientes, '
    + 'pendientes_como_cero, ajuste_erp_aplicado, ajuste_erp_por, ajuste_erp_at, '
    + 'ajuste_erp_nota, total_recontados, modo, fuente_sistema, branches(name)';

async function conValor(res) {
    if (res.error || !res.data) return res;
    const filas = Array.isArray(res.data) ? res.data : [res.data];
    const { data: valores, error } = filas.length
        ? await supabase.rpc('get_conteos_valor', { p_ids: filas.map(c => c.id) })
        : { data: [] };
    if (error) console.error('[conteo] valorizado', error);
    const porId = new Map((valores || []).map(v => [v.id, v]));
    const conMontos = filas.map(c => ({
        ...c,
        valor_faltante: porId.get(c.id)?.valor_faltante ?? null,
        valor_sobrante: porId.get(c.id)?.valor_sobrante ?? null,
    }));
    return { ...res, data: Array.isArray(res.data) ? conMontos : conMontos[0] };
}

export async function fetchConteosInventario() {
    return conValor(await supabase.from('conteos_inventario')
        .select(CONTEO_COLS)
        .order('created_at', { ascending: false })
        .limit(1000));
}

export async function fetchConteoDetalle(conteoId) {
    return conValor(await supabase.from('conteos_inventario').select(CONTEO_COLS).eq('id', conteoId).single());
}

// ── ConteoDetailView.jsx / AddManualItemForm ────────────────────────────────

export function searchActiveProductsForConteo(term) {
    return buscarProductos(term, {
        // `codigo_barras` viaja desde el 2026-08-25: el alta manual lo pinta en
        // la tarjeta del producto elegido. Cuando el escaneo eligió solo, esa
        // línea es la única oportunidad de ver que eligió BIEN — comparar el
        // código de la pantalla contra el de la caja que se tiene en la mano.
        select: 'id, nombre, codigo_barras, laboratorios(nombre)',
        limite: 30,
        // El laboratorio se pinta junto al nombre: se busca lo que se ve.
        conLaboratorio: true,
    });
}

export function fetchProductPresentacionesForConteo(productId) {
    return supabase.from('product_precios')
        .select('id_presentacion, presentaciones(tipo)')
        .eq('product_id', productId)
        .eq('activo', true);
}

export function fetchErpSucursalIdsForBranch(branchId) {
    return supabase.from('erp_sucursal_map').select('erp_sucursal_id').eq('branch_id', branchId);
}

// Qué sucursales pueden tener un conteo: las que están mapeadas al ERP. El
// criterio es el mapeo y no el `type` de la sucursal — es lo mismo que exige
// crear_conteo_inventario (SUCURSAL_SIN_MAPEO_ERP), así que filtrar por otra
// cosa dejaría opciones en la lista que revientan al elegirlas. Hoy la única
// sin mapeo es Administración, que no tiene inventario.
export function fetchBranchIdsConInventario() {
    return supabase.from('erp_sucursal_map').select('branch_id');
}

/*
 * ACOTADA POR EL DATO: el `.in('erp_sucursal_id', …)` va sobre una columna que
 * se repite —el detector `in-columna-repetida` la marca con razón— pero el
 * `.eq('erp_product_id', …)` la fija a UN producto, y la lista de sucursales
 * tiene 7 como máximo. El producto con más lotes de todo el inventario tiene 66
 * (medido 2026-08-17). No hay forma de acercar esto a las 1000 filas.
 */
export function fetchInventoryLotesForProduct(productId, erpSucursalIds) {
    return supabase.from('inventory')
        .select('lote, fecha_vencimiento')
        .eq('erp_product_id', productId)
        .in('erp_sucursal_id', erpSucursalIds)
        .not('lote', 'is', null);
}
