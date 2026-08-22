// Bloque 6.A — capa de datos, entidad "dispatchRules" (reglas de
// despacho por producto). Extraído de TabReglas.jsx: 9 llamadas
// supabase.from().
import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';
import { filtroProductoOCodigo } from '../utils/searchUtils';

// keepIdPresentacion: la regla ya configurada puede apuntar a una presentación
// que desde entonces se marcó activo=false en el catálogo — igual debe listarse
// para que el editor no la pierda de vista, pero ninguna OTRA inactiva debe
// ofrecerse como opción nueva (mismo bug que get_stock_analysis con Alcanfor).
export function fetchProductPresentacionesForDispatch(productId, keepIdPresentacion) {
    let q = supabase
        .from('product_precios')
        .select('id, id_presentacion, factor, descripcion, activo, presentaciones!inner(id, tipo)')
        .eq('product_id', productId);
    q = keepIdPresentacion
        ? q.or(`activo.eq.true,id_presentacion.eq.${keepIdPresentacion}`)
        : q.eq('activo', true);
    return q.order('factor', { ascending: false });
}

// Trae también el NOMBRE porque el mismo fetch alimenta dos cosas: la lista de
// laboratorios que hay que excluir (los ocultos en MIN·MAX) y las opciones del
// filtro de laboratorio de la vista. Dos consultas a una tabla de <1000 filas
// para leer dos columnas de las mismas filas no se justifica.
// `ocultar_en_minmax` ES booleano en la base (verificado contra el catálogo),
// así que comparar contra `true` acá es correcto.
export function fetchLaboratorios() {
    return supabase.from('laboratorios').select('id, nombre, ocultar_en_minmax').order('nombre');
}

const DISPATCH_RULE_SELECT = 'id, erp_product_id, solo_cajas, multiplo, blister, multiplo_unidades, notes, dispatch_id_presentacion, dispatch_multiplo, dispatch_label, caja_especial, presentaciones(tipo)';

// Paginado con fetchAllRows — antes era un while-loop manual con el mismo
// patrón 1000-en-1000 ya presente en otros archivos de este bloque.
export function fetchAllDispatchRules() {
    return fetchAllRows(() => supabase.from('dispatch_rules').select(DISPATCH_RULE_SELECT));
}

export function fetchActiveProductsCount() {
    return supabase.from('products').select('id', { count: 'exact', head: true }).eq('activo', true);
}

export function fetchNewProductsThisMonth(startOfMonthIso) {
    return supabase.from('products').select('id', { count: 'exact' }).eq('activo', true).gte('created_at', startOfMonthIso);
}

// `ruleFilter` ('' | 'con' | 'sin'), `soloNuevos` y `labId` son TRES filtros
// independientes y se aplican juntos. Antes «nuevo» era un tercer valor de
// `ruleFilter`, o sea excluyente con «con regla»/«sin regla» — y «los nuevos que
// todavía no tienen regla» es justamente la pregunta para la que existe esta
// pantalla, así que era la combinación imposible de pedir.
export function fetchProductsWithLabPage({ offset, pageSize, hiddenLabs, sortKey, ascending, term, ruleFilter, ruleIds, soloNuevos, newIds, labId }) {
    let q = supabase
        .from('products_with_lab')
        .select('id, nombre, es_antibiotico, laboratorio_nombre, laboratorio_id', { count: 'exact' })
        .eq('activo', true)
        .range(offset, offset + pageSize - 1);

    // El laboratorio elegido manda sobre la lista de ocultos: si alguien lo pide
    // por su nombre, no tiene sentido esconderlo. Y las opciones del filtro ya
    // salen de los NO ocultos, así que en la práctica no se cruzan.
    if (labId != null) q = q.eq('laboratorio_id', labId);
    else if (hiddenLabs?.length > 0)
        q = q.not('laboratorio_id', 'in', `(${hiddenLabs.join(',')})`);

    q = q.order(sortKey, { ascending });
    if (sortKey !== 'nombre') q = q.order('nombre', { ascending: true });

    if (term.length >= 2) q = q.or(filtroProductoOCodigo(term));

    if (ruleFilter === 'con') {
        q = ruleIds.length > 0 ? q.in('id', ruleIds) : q.in('id', [0]);
    } else if (ruleFilter === 'sin' && ruleIds.length > 0) {
        q = q.not('id', 'in', `(${ruleIds.join(',')})`);
    }

    if (soloNuevos) {
        const arr = [...newIds];
        q = arr.length > 0 ? q.in('id', arr) : q.in('id', [0]);
    }

    return q;
}

export function deleteDispatchRule(id) {
    return supabase.from('dispatch_rules').delete().eq('id', id);
}

export function updateDispatchRule(id, payload) {
    return supabase.from('dispatch_rules').update(payload).eq('id', id).select().single();
}

export function insertDispatchRule(payload) {
    return supabase.from('dispatch_rules').insert(payload).select().single();
}
