// Bloque 6.A — capa de datos, entidad "recepcion" (recepción física de
// pedidos en sucursal). Extraído de RecepcionModal.jsx: 9 llamadas
// supabase.from(). El update de pedido_sucursal_status (cajas_recibidas,
// 3 sitios) reutiliza updatePedidoSucursalStatus ya definido en
// data/pedidos.js (Bloque 6.A) — mismo query exacto, no se duplica.
import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';
import { filtroProductoOCodigo } from '../utils/searchUtils';

export function fetchProductPreciosOpts(productId) {
    return supabase.from('product_precios')
        .select('product_id, factor, descripcion, presentaciones!id_presentacion(tipo)')
        .eq('product_id', productId).eq('activo', true).order('factor');
}

// Paginado con fetchAllRows — antes era un while-loop manual con el mismo
// patrón 1000-en-1000 ya presente en otros archivos de este bloque.
export function fetchProductPreciosOptsForProducts(productIds) {
    return fetchAllRows(() =>
        supabase.from('product_precios')
            .select('product_id, factor, descripcion, presentaciones!id_presentacion(tipo)')
            .in('product_id', productIds).eq('activo', true).order('factor')
    );
}

// `fetchPedidoApoyoBasic` se retiró con la franja de «Responsables» del modal de
// recepción (2026-08-17): era su único llamador, y el apoyo de recepción se
// sigue viendo en la tarjeta del pedido, que lo trae por su cuenta
// (`fetchApoyoForPedidos` → `apoyoMap` en `usePedidosData`, bucket `recepcion`).

export function searchAvailableProducts(term, excludeIds) {
    let q = supabase.from('products').select('id, nombre')
        .eq('activo', true).or(filtroProductoOCodigo(term)).order('nombre').limit(10);
    if (excludeIds.length > 0) q = q.not('id', 'in', `(${excludeIds.join(',')})`);
    return q;
}

export function fetchLastDispatchInfo(productId) {
    return supabase.from('pedido_items')
        .select('dispatch_factor, dispatch_tipo')
        .eq('erp_product_id', productId)
        .not('dispatch_tipo', 'is', null).not('dispatch_factor', 'is', null)
        .order('id', { ascending: false }).limit(1);
}

/**
 * Anotar un producto que llegó y NO venía en el pedido.
 *
 * Se escribe EN EL MOMENTO, no al confirmar. Antes la lista de extras vivía en
 * `useState` dentro de `RecepcionModal`, que se monta como
 * `{modal && <RecepcionModal/>}`: cualquier cierre lo desmontaba y se llevaba
 * lo anotado sin un error, sin un aviso y sin borrador. Medido el 2026-08-24 en
 * Salud 1 — se agregó un producto extra, se confirmó el pedido y
 * `pedido_recepcion_extras` seguía con su única fila del 19-ago.
 *
 * Y `pedido_recepcion_extras` era además una tabla de sólo escritura: nadie la
 * leía, ni en `src/` ni en ninguna función de la base. Hoy el extra nace como
 * un RENGLÓN del pedido con `error_tipo = 'sobrante'`, que es lo que es —llegó
 * en físico y no llegó en el sistema—, y por eso aparece solo en Diferencias
 * con sus dos salidas.
 *
 * `cantidad` va en PAQUETES de `factor`, igual que el resto de los renglones:
 * no hay ninguna división que redondear.
 */
export function agregarExtraAPedido({ pedidoId, sucursalId, productId, cantidad, factor, tipo, nota }) {
    return supabase.rpc('agregar_extra_a_pedido', {
        p_pedido_id: pedidoId,
        p_sucursal_id: sucursalId,
        p_erp_product_id: productId,
        p_cantidad: cantidad,
        p_factor: factor,
        p_tipo: tipo ?? null,
        p_nota: nota ?? null,
    });
}

/**
 * Corregir lo anotado: la cantidad, la presentación o la nota.
 *
 * Existe porque el extra se escribe al agregarlo. Sin esto habría que elegir
 * entre guardar al final (y perderlo al cerrar) o no poder corregirlo. La base
 * lo rechaza en cuanto la diferencia tiene una propuesta en curso: ahí la
 * cantidad es la que aceptó la otra parte.
 */
export function actualizarExtraDePedido({ itemId, cantidad, factor, tipo, nota }) {
    return supabase.rpc('actualizar_extra_de_pedido', {
        p_item_id: itemId,
        p_cantidad: cantidad,
        p_factor: factor,
        p_tipo: tipo ?? null,
        p_nota: nota ?? null,
    });
}

/** Se anula —no se borra—: `pedido_item_eventos` cae en cascada con el renglón. */
export function quitarExtraDePedido(itemId) {
    return supabase.rpc('quitar_extra_de_pedido', { p_item_id: itemId });
}

/**
 * Corregir lo contado de un producto que YA se confirmó.
 *
 * El hueco era exacto: `receive_pedido_sucursal` sólo toca renglones
 * `pendiente` —eso es lo que impide contar dos veces el mismo producto— así
 * que un renglón confirmado no se puede volver a escribir, y
 * `agregar_extra_a_pedido` lo rechaza porque «ese producto tiene su propio
 * renglón». Entre las dos reglas no quedaba ninguna puerta.
 *
 * NO mueve existencias. Deja el renglón `con_diferencia` y de ahí lo toma la
 * conversación que ya existe: la sala propone, bodega contesta, y el traslado
 * de la cantidad de más sale de ese acuerdo. Una sala no le puede bajar la
 * existencia a bodega sin que bodega se entere.
 */
export function corregirRecepcionDeItem({ itemId, cantidad, nota }) {
    return supabase.rpc('corregir_recepcion_de_item', {
        p_item_id: itemId,
        p_cantidad: cantidad,
        p_nota: nota ?? null,
    });
}
