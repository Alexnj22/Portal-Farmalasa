// Bloque 6.A — capa de datos, entidad "recepcion" (recepción física de
// pedidos en sucursal). Extraído de RecepcionModal.jsx: 9 llamadas
// supabase.from(). El update de pedido_sucursal_status (cajas_recibidas,
// 3 sitios) reutiliza updatePedidoSucursalStatus ya definido en
// data/pedidos.js (Bloque 6.A) — mismo query exacto, no se duplica.
import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';
import { buscarProductos } from './busquedaProductos';
import { anotar, conBitacora } from './audit';
import { recibirTrasladoPedido, updatePedidoSucursalStatus } from './pedidos';
import { rpcConRespaldo } from './rpcConRespaldo';

export function fetchProductPreciosOpts(productId) {
    return supabase.from('product_precios')
        .select('product_id, factor, descripcion, presentaciones!id_presentacion(tipo)')
        .eq('product_id', productId).eq('activo', true).order('factor');
}

// Ids por consulta. El `.in()` viaja en la URL, y un pedido grande pedía las
// presentaciones de ~1,100 productos de una sola vez: una URL de ~8 KB, al
// borde de lo que aceptan el proxy y PostgREST. Y `product_id` se REPITE en
// `product_precios` (una fila por presentación), así que acotar la entrada no
// acota la salida: cada tanda sigue paginando con `fetchAllRows`.
const TANDA_DE_IDS = 200;

// Paginado con fetchAllRows — antes era un while-loop manual con el mismo
// patrón 1000-en-1000 ya presente en otros archivos de este bloque.
export async function fetchProductPreciosOptsForProducts(productIds) {
    const ids = [...new Set((productIds ?? []).filter(id => id != null))];
    const tandas = [];
    for (let i = 0; i < ids.length; i += TANDA_DE_IDS) tandas.push(ids.slice(i, i + TANDA_DE_IDS));
    const partes = await Promise.all(tandas.map(tanda => fetchAllRows(() =>
        supabase.from('product_precios')
            .select('product_id, factor, descripcion, presentaciones!id_presentacion(tipo)')
            .in('product_id', tanda).eq('activo', true).order('factor').order('id')  // `id` desempata: paginar sin orden único repite o salta filas
    )));
    return partes.flatMap(p => p ?? []);
}

// `fetchPedidoApoyoBasic` se retiró con la franja de «Responsables» del modal de
// recepción (2026-08-17): era su único llamador, y el apoyo de recepción se
// sigue viendo en la tarjeta del pedido, que lo trae por su cuenta
// (`fetchApoyoForPedidos` → `apoyoMap` en `usePedidosData`, bucket `recepcion`).

export async function searchAvailableProducts(term, excludeIds) {
    // Se piden de más por los que ya están en el pedido, que se descartan acá.
    const r = await buscarProductos(term, {
        select: 'id, nombre',
        limite: 10 + excludeIds.length,
        armar: (q) => excludeIds.length > 0 ? q.not('id', 'in', `(${excludeIds.join(',')})`) : q,
    });
    return { ...r, data: r.data?.slice(0, 10) ?? r.data };
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
export function corregirRecepcionDeItem({ itemId, cantidad, nota, pedidoId = null }, contexto = {}) {
    return conBitacora(supabase.rpc('corregir_recepcion_de_item', {
        p_item_id: itemId,
        p_cantidad: cantidad,
        p_nota: nota ?? null,
    }), 'CORREGIR_CONTEO_PEDIDO', pedidoId ?? itemId, {
        ...contexto, pedido_item_id: itemId, ahora: cantidad,
    });
}

// ── Llamadas que vivían en las pantallas (F3 del núcleo portable) ──────────
// Reciben los parámetros de la función tal cual y devuelven `{ data, error }`.

// ── Bitácora de la recepción (D3 del núcleo portable) ───────────────────────
// La anotan estas funciones y no la pantalla, para que la herede cualquier
// cliente. Una recepción se anota según QUÉ se cerró:
//   · un pedido sin hojas o una caja especial → `recibirPedidoDeSucursal`
//     con `accion` en el contexto (sin `accion` no anota: es un paso de algo
//     que anota otra función);
//   · una o varias hojas → `marcarHojasRecibidas`, que anota DESPUÉS de dejar
//     la hoja marcada — sin esa marca la hoja reaparece pendiente;
//   · un producto suelto → `recibirProductoSuelto`.
const ACCIONES_DE_RECEPCION = new Set(['CONFIRMAR_RECEPCION_PEDIDO', 'CONFIRMAR_RECEPCION_ESPECIAL']);

/** Registra lo que recibió una sala de un pedido. */
export function recibirPedidoDeSucursal(params, { accion = null, ...contexto } = {}) {
    const escritura = supabase.rpc('receive_pedido_sucursal', params);
    if (!accion) return escritura;
    if (!ACCIONES_DE_RECEPCION.has(accion)) {
        console.error('bitácora: acción de recepción desconocida', accion);
        return escritura;
    }
    return conBitacora(escritura, accion, params?.p_pedido_id, {
        sucursal_id: params?.p_sucursal_id, items_count: (params?.p_items || []).length, ...contexto,
    });
}

// ── Las hojas contadas se AGREGAN, no se reescriben ─────────────────────────
//
// `hojas_recibidas` se escribía entero con la lista que tenía la pantalla. Dos
// personas contando hojas distintas del mismo pedido —lo normal en una sala con
// apoyo— se pisaban: la segunda en guardar borraba la hoja de la primera, que
// reaparecía pendiente y se volvía a contar.
//
// El camino bueno es `marcar_hojas_recibidas`, que une en la base sin
// duplicados. Mientras esa función no exista, se cae al UPDATE de siempre pero
// RELEYENDO la fila justo antes y uniendo: deja una ventana de milisegundos en
// vez de la de todo el conteo. `rpcConRespaldo` recuerda que no existe para no
// preguntar en cada hoja.
async function agregarHojasRecibidas(pedidoId, sucursalId, hojas) {
    const lista = [...new Set((hojas ?? []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
    return rpcConRespaldo('marcar_hojas_recibidas', {
        p_pedido_id: pedidoId, p_sucursal_id: sucursalId, p_hojas: lista,
    }, () => unirHojasPasoAPaso(pedidoId, sucursalId, lista));
}

async function unirHojasPasoAPaso(pedidoId, sucursalId, lista) {
    const { data: fila, error: errLectura } = await supabase.from('pedido_sucursal_status')
        .select('hojas_recibidas')
        .eq('pedido_id', pedidoId).eq('erp_sucursal_id', sucursalId)
        .maybeSingle();
    if (errLectura) return { data: null, error: errLectura };
    const yaEstaban = Array.isArray(fila?.hojas_recibidas) ? fila.hojas_recibidas.map(Number) : [];
    const union = [...new Set([...yaEstaban, ...lista])].filter(Number.isFinite).sort((a, b) => a - b);
    return updatePedidoSucursalStatus(pedidoId, sucursalId, { hojas_recibidas: union });
}

/**
 * Deja las hojas marcadas como recibidas y anota lo que se cerró con ellas:
 * `hojas` ([{ hoja, items_count }]) una entrada por hoja, `especiales`
 * (etiquetas) una por caja especial confirmada en el mismo paso, y `pedido`
 * (objeto de detalles, o null) la del pedido completo. El resto de
 * `contexto` va en todas.
 */
export async function marcarHojasRecibidas(pedidoId, sucursalId, hojasRecibidas,
    { hojas = [], especiales = [], pedido = null, ...contexto } = {}) {
    const res = await agregarHojasRecibidas(pedidoId, sucursalId, hojasRecibidas);
    if (res?.error) return res;
    for (const { hoja, items_count } of hojas) {
        anotar('CONFIRMAR_RECEPCION_HOJA', pedidoId, { sucursal_id: sucursalId, hoja, items_count, ...contexto });
    }
    for (const especial of especiales) {
        anotar('CONFIRMAR_RECEPCION_ESPECIAL', pedidoId, { sucursal_id: sucursalId, especial, ...contexto });
    }
    if (pedido) anotar('CONFIRMAR_RECEPCION_PEDIDO', pedidoId, { sucursal_id: sucursalId, ...pedido });
    return res;
}

/**
 * Recibe UN producto sin contar el resto de la caja: lo cuenta y lo ingresa
 * al inventario (su propio traslado, entero). Devuelve `{ error, erp }`; `erp`
 * es la respuesta del ingreso. La bitácora dice si entró al sistema.
 */
export async function recibirProductoSuelto({ pedidoId, sucursalId, items, receivedBy = null, itemId }, contexto = {}) {
    const { error } = await supabase.rpc('receive_pedido_sucursal', {
        p_pedido_id: pedidoId, p_sucursal_id: sucursalId,
        p_items: items, p_received_by: receivedBy,
    });
    if (error) return { error, erp: null };
    const erp = await recibirTrasladoPedido(pedidoId, sucursalId, { itemIds: [itemId] });
    anotar('RECIBIR_PRODUCTO_SUELTO', pedidoId, {
        sucursal_id: sucursalId, pedido_item_id: itemId, ...contexto,
        entro_al_sistema: erp?.ok === true,
    });
    return { error: null, erp };
}
