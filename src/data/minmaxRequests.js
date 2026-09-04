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

// `is_hidden` viaja desde el 2026-08-14: ocultar un producto lo deja en «— · —»
// publicado y `approve_minmax_request` se niega a aprobarle nada
// (PRODUCT_HIDDEN), así que el formulario tiene que saberlo ANTES de dejar
// escribir una propuesta que nace muerta.
// `draft_units_sold` viaja desde el 2026-08-14 como reserva de `units_sold_6m`.
// Las dos son el MISMO conteo —unidades vendidas en `analysis_days`, hoy 180— y
// se escriben en la misma pasada de `calculate_stock_params`: la del borrador al
// insertar la fila, la otra sólo en el ON CONFLICT. Una fila que nunca volvió a
// pasar por ahí se queda con la primera y la segunda en null.
//
// Medido: **654 de 759** filas sin `units_sold_6m` en Salud 1 SÍ tienen el
// borrador (656 de 774 en Salud 2). O sea que a uno de cada cuatro productos la
// pantalla le decía «Sin ventas» teniendo el número al lado, en otra columna.
// La reserva sólo agrega donde no había nada; nunca cambia un número existente.
export function fetchCurrentStockParams(erpProductId, erpSucursalId) {
    return supabase.from('product_stock_params')
        .select('manual_min, manual_max, min_units, max_units, units_sold_6m, draft_units_sold, is_hidden')
        .eq('erp_product_id', erpProductId)
        .eq('erp_sucursal_id', Number(erpSucursalId))
        .maybeSingle();
}

/**
 * Lo que hace falta para proponer un MIN·MAX de UN producto en UNA sala: lo
 * vendido este mes, la fecha de la última venta y lo que hay en el estante.
 *
 * Ninguna de las tres sale de `product_stock_params`: `units_sold_6m` es un
 * total de seis meses y no distingue «vende poco» de «dejó de venderse», y la
 * existencia no vive ahí. Tampoco de `product_sales_monthly_agg` a secas, que
 * sólo guarda meses CERRADOS — el mes en curso hay que leerlo de las facturas.
 * El RPC junta las tres en un viaje y mide las unidades igual que el cálculo de
 * MIN·MAX y que el pedido, para que las cifras de la pantalla se puedan
 * comparar entre sí y contra lo que después se repone.
 *
 * Ante un error devuelve nulls, no ceros: un 0 se lee como «no hay» y sería
 * afirmar algo que no se sabe.
 */
export async function fetchMinMaxContextoVenta(erpProductId, erpSucursalId) {
    const vacio = { unidadesMes: null, ultimaVenta: null, existencia: null, existenciaVencida: null };
    const { data, error } = await supabase.rpc('get_minmax_contexto_producto', {
        p_erp_product_id:  Number(erpProductId),
        p_erp_sucursal_id: Number(erpSucursalId),
    });
    if (error) { console.error('fetchMinMaxContextoVenta:', error.message); return vacio; }
    return {
        unidadesMes:       data?.unidades_mes ?? null,
        ultimaVenta:       data?.ultima_venta ?? null,
        existencia:        data?.existencia ?? null,
        existenciaVencida: data?.existencia_vencida ?? null,
    };
}

export function insertMinMaxChangeRequest(payload) {
    return supabase.from('minmax_change_requests').insert(payload);
}

/**
 * Una sola solicitud de Min/Max, por id.
 *
 * La usa el detalle que se despliega en la campana: el aviso trae
 * `metadata.request_id`, pero un ajuste de Min/Max NO vive en
 * `approval_requests` —es otra tabla— así que sin esto había que bajar la lista
 * entera (`fetchAllMinMaxChangeRequests`) para mostrar una fila.
 *
 * `maybeSingle` y no `single`: una solicitud borrada o fuera del alcance del RLS
 * devuelve `null` sin error, que es exactamente el caso que la campana tiene que
 * poder contar («ya no está») en vez de pintar un error técnico.
 */
export function fetchMinMaxChangeRequestById(id) {
    return supabase.from('minmax_change_requests').select('*').eq('id', id).maybeSingle();
}

/**
 * Resolver un ajuste de Min/Max desde el centro de solicitudes.
 *
 * Es la MISMA RPC que usa la pestaña de Min/Max (`TabMinMaxRequests`), no una
 * segunda forma de decidir lo mismo: la autoría la resuelve la función con
 * `auth.email()` y el permiso lo cobra `mmcr_update`, que sigue pidiendo
 * `minmax.can_approve`.
 *
 * Eso último es lo que hace que traer Min/Max al centro **no reparta poder**:
 * la sala entera lo VE porque `mmcr_select` acepta `requests.can_view`, y no
 * puede decidirlo porque el UPDATE nunca aflojó.
 */
export async function decidirMinMax(requestId, aprobar, nota = '') {
    const fn = aprobar ? 'approve_minmax_request' : 'reject_minmax_request';
    // `data` se devuelve desde el 2026-08-14: al aprobar, la función trae el par
    // ANTERIOR (`previous_min`/`previous_max`) — el único momento en que alguien
    // lo tiene sin volver a consultar es justo antes de pisarlo. Sin eso, el
    // historial de MIN·MAX escribía la aprobación sin el «de → a» y la pintaba
    // como «MIN — MAX —».
    const { data, error } = await supabase.rpc(fn, { p_request_id: requestId, p_note: nota || null });
    return { ok: !error, error: error?.message ?? null, data: data ?? null };
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
//
// ── El estado se guarda en MINÚSCULAS (2026-08-13) ────────────────────────
// Esta función preguntaba por `PENDING`/`APPROVED`/`REJECTED`. La columna sólo
// acepta `pending`/`approved`/`rejected` —lo fija el CHECK `mmcr_status_chk`—,
// así que las tres comparaciones daban falso SIEMPRE: la baldosa decía «Sin
// propuestas» y dibujaba el riel vacío con cuatro solicitudes en la tabla, y el
// `.or()` ni siquiera traía las pendientes viejas, que son justo las que hay que
// ver. Cero y cero-porque-no-coincide se ven idénticos.
//
// Las mayúsculas son del CENTRO de solicitudes, no de la base: ahí conviven con
// las de `approval_requests` y `adaptarMinMax` las traduce con
// `.toLowerCase()`. Ese adaptador es el que estaba bien, y por eso acá se
// normaliza igual en vez de escribir el literal de la otra pantalla.
export async function fetchMinMaxEstados(erpSucursalId = null) {
    const desde = new Date(Date.now() - 90 * 86400000).toISOString();
    let q = supabase
        .from('minmax_change_requests')
        .select('id, status, requested_at')
        .or(`status.eq.pending,requested_at.gte.${desde}`);
    if (erpSucursalId) q = q.eq('erp_sucursal_id', Number(erpSucursalId));
    const { data, error } = await q;

    const filas = data ?? [];
    const cuenta = (s) => filas.filter(f => String(f.status ?? '').toLowerCase() === s).length;
    return {
        pendientes: cuenta('pending'),
        aplicadas:  cuenta('approved'),
        rechazadas: cuenta('rejected'),
        error,
    };
}

// ── Historial de una fila de Min·Máx ──────────────────────────────────────────

/**
 * Las solicitudes de UN producto en UNA sala, para el historial de su fila.
 *
 * Va por RPC y no por `.from('minmax_change_requests')` porque la policy
 * `mmcr_select` deja ver una solicitud a quien la pidió, a quien puede
 * aprobarlas y a quien ve el módulo de solicitudes — y ninguna de esas tres es
 * «puede ver Min·Máx». Medido sobre los 6 cargos con `minmax.can_view`,
 * **Gerente General no tiene ninguna**: el motivo le volvería como cero filas,
 * que en pantalla se lee igual que «no hubo solicitud».
 *
 * `get_minmax_solicitudes_de_producto` es DEFINER y pide el permiso del dato
 * que se está mirando: si podés ver el MIN y el MAX, podés ver por qué son ese
 * número.
 */
export async function fetchSolicitudesDeProducto(erpProductId, erpSucursalId) {
    const { data, error } = await supabase.rpc('get_minmax_solicitudes_de_producto', {
        p_erp_product_id:  Number(erpProductId),
        p_erp_sucursal_id: Number(erpSucursalId),
    });
    return { data: data ?? [], error };
}
