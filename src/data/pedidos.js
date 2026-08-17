// Bloque 6.A — capa de datos, entidad "pedidos". Extraído de
// TabPedidos.jsx: 45 llamadas supabase.from() distintas, consolidadas
// en funciones nombradas por forma de query real (varias eran
// duplicados literales — ej. 5 lookups idénticos de la sucursal de
// bodega — y quedan en una sola función acá). Extracción mecánica:
// mismo query/filtro exacto que tenía cada sitio, sin cambiar
// comportamiento. Los dos fetch que hacían paginación manual con un
// while-loop (pedido_items, pedido_item_eventos) ahora usan
// fetchAllRows (utils/supabaseUtils.js), el helper que ya existe en el
// proyecto para esto.
import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';

// ── Sucursal / ERP lookups ──────────────────────────────────────────────────

export function fetchEmployeeBranchId(userId) {
    return supabase.from('employees').select('branch_id').eq('id', userId).maybeSingle();
}

export function fetchSucursalIdForBranch(branchId) {
    return supabase.from('erp_sucursal_map').select('erp_sucursal_id').eq('branch_id', branchId).eq('es_bodega', false).maybeSingle();
}

export function fetchBodegaBranchId() {
    return supabase.from('erp_sucursal_map').select('branch_id').eq('es_bodega', true).maybeSingle();
}

export function fetchBranchIdForSucursal(sucId) {
    return supabase.from('erp_sucursal_map').select('branch_id').eq('erp_sucursal_id', sucId).maybeSingle();
}

// ── pedidoPrint.js (direcciones para el encabezado del PDF de despacho) ────

export function fetchErpSucursalAddressMap() {
    return supabase.from('erp_sucursal_map').select('erp_sucursal_id, branches(address)');
}

export function fetchBranchInfoForSucursal(sucId) {
    return supabase.from('erp_sucursal_map').select('branch_id, nombre').eq('erp_sucursal_id', sucId).maybeSingle();
}

export function fetchBranchNamesForSucursales(sucIds) {
    return supabase.from('erp_sucursal_map').select('erp_sucursal_id, branch:branches!inner(name)').in('erp_sucursal_id', sucIds);
}

// ── Apoyo (personal de refuerzo) ────────────────────────────────────────────

export function fetchApoyoForPedidos(pedidoIds, sucId) {
    let q = supabase.from('pedido_apoyo')
        .select('pedido_id, erp_sucursal_id, employee_id, tipo, employees(name, first_names, last_names, photo_url)')
        .in('pedido_id', pedidoIds);
    if (sucId) q = q.eq('erp_sucursal_id', sucId);
    return q;
}

export function fetchApoyoForPedido(pedidoId, sucId) {
    let q = supabase.from('pedido_apoyo')
        .select('id, employee_id, tipo, employees(name, first_names, last_names, photo_url)')
        .eq('pedido_id', pedidoId);
    if (sucId) q = q.eq('erp_sucursal_id', sucId);
    return q;
}

// ApoioScanModal.jsx — «¿de quién es este carné?»
//
// Lo contesta el SERVIDOR. Antes filtraba `employees` por `code`, y filtrar por
// una columna exige poder leerla: desde que el código de carné es un secreto
// —es la contraseña del portal— esa consulta ya no compila.
//
// El cambio no es sólo mecánico. Un buscador de códigos es un **oráculo**: con
// códigos de 3 a 5 dígitos, quien pregunte cien mil veces reconstruye la tabla
// entera y esconder la columna no habría servido de nada. Por eso
// `identificar_por_carne` sólo contesta por gente de la sala de quien pregunta
// —que es lo que este flujo necesita, el carné está físicamente ahí—, registra
// cada intento en `intentos_identidad` y corta a los 20 fallos en 15 minutos.
export async function fetchEmployeeByKioskPin(code) {
    const { data, error } = await supabase.rpc('identificar_por_carne', {
        p_valor: String(code || '').trim(),
    });
    return { data: data?.[0] ?? null, error };
}

export function upsertPedidoApoyo(payload) {
    return supabase.from('pedido_apoyo').upsert(payload, { onConflict: 'pedido_id,erp_sucursal_id,employee_id,tipo' });
}

// ── Rutas ────────────────────────────────────────────────────────────────────

export function fetchActiveRutas(todayStartIso) {
    return supabase.from('rutas')
        .select(`id, numero, conductor_id, conductor_nombre, status, salida_at, vuelta_base_at,
                 ruta_pedidos(id, pedido_id, erp_sucursal_id, orden_entrega, entregado_at, entregado_por)`)
        .or(`status.in.(pendiente,en_ruta),and(status.eq.completada,created_at.gte.${todayStartIso})`)
        .order('created_at', { ascending: false });
}

// La entrega de cada parada, sin depender de que su ruta siga activa.
// `fetchActiveRutas` sólo trae las rutas pendientes, en curso, o completadas
// HOY —es la que alimenta el mapa en vivo—, así que al día siguiente el paso
// «Entregado» de la tarjeta se quedaba en blanco aunque el conductor lo hubiera
// marcado: el dato estaba en la base y la pantalla lo buscaba en el sitio
// equivocado. Visto el 2026-08-15 con el pedido #114, entregado a las 20:53 del
// día anterior. Va por (pedido, sucursal) porque un pedido con varias sucursales
// tiene una parada por cada una.
//
// Va por RPC y no leyendo `ruta_pedidos`: esa tabla exige permiso del módulo de
// Rutas, así que quien sólo trabaja pedidos seguía viendo el paso vacío, y
// dárselo le abriría una pestaña que no le toca. `get_pedido_entregas` autoriza
// con el mismo permiso con el que ya ve el pedido.
//
// El array se parte en tandas de 1000: PostgREST corta la RESPUESTA en 1000
// filas sin avisar, y con ≤1000 ids adentro la respuesta no puede pasarse.
export async function fetchEntregasDePedidos(pedidoIds) {
    const ids = pedidoIds ?? [];
    const tandas = [];
    for (let i = 0; i < ids.length; i += 1000) tandas.push(ids.slice(i, i + 1000));
    const res = await Promise.all(tandas.map(t => supabase.rpc('get_pedido_entregas', { p_pedido_ids: t })));
    const fallo = res.find(r => r.error);
    return { data: res.flatMap(r => r.data ?? []), error: fallo?.error ?? null };
}

export function fetchRutaLocations(rutaIds) {
    return supabase.from('ruta_locations').select('ruta_id, updated_at').in('ruta_id', rutaIds);
}

export function upsertRutaLocation(rutaId, lat, lng) {
    return supabase.from('ruta_locations')
        .upsert({ ruta_id: rutaId, lat, lng, updated_at: new Date().toISOString() }, { onConflict: 'ruta_id' });
}

export function fetchRutaLocationSingle(rutaId) {
    return supabase.from('ruta_locations').select('lat, lng, updated_at').eq('ruta_id', rutaId).maybeSingle();
}

// ── Escrituras de ruta: "no pasó nada" tiene que doler ──────────────────────
// Un UPDATE que RLS frena NO falla. PostgREST responde 204 sin filas y
// supabase-js entrega `{ data: null, error: null }` — byte por byte lo mismo que
// el éxito. Las dos policies (`rutas_update`, `ruta_pedidos_update`) exigen
// `can_edit` sobre `pedidos_tab_rutas`, así que a quien sólo tenía «ver» el
// botón le giraba, se apagaba, la ruta seguía igual… y encima quedaba una
// entrada en la bitácora afirmando que había arrancado, porque el
// `appendAuditLog` viene después del `if (error)` que nunca se cumplía.
//
// Pidiendo el `RETURNING` (`.select('id')`) se puede contar lo que de veras
// cambió, y "cero filas" pasa a ser un error de verdad. El arreglo va acá y no
// en cada pantalla a propósito: los cinco llamadores ya miraban `error`, así que
// lo heredan sin tocar una línea — y el que se escriba mañana también.
//
// Compromiso conocido: el `RETURNING` pasa por la policy de SELECT, que además
// de `can_view` pide scope `ALL` o una parada en la sucursal propia. Si alguien
// pudiera escribir una ruta que no puede leer, diríamos "no se pudo" sobre una
// escritura que sí ocurrió. Falla del lado seguro —y hoy no alcanza a nadie: no
// se ve la ruta, no se ve el botón— mientras que el silencio de antes era del
// lado caro.
const MSG_RUTA_SIN_EFECTO = 'No se pudo guardar el cambio en la ruta. Puede que ya no tengas permiso para gestionar rutas: vuelve a iniciar sesión y, si sigue igual, consulta con tu jefatura.';

// El mecanismo, ya sin nombre de ruta: pide el `RETURNING` y trata "cero
// filas" como el fallo que es. Lo comparten las rutas y la recepción — ver
// `escrituraDeRecepcion` más abajo, que nació del mismo silencio.
async function escrituraQueDebeTocarFilas(builder, mensaje) {
    const { data, error } = await builder.select('id');
    if (error) return { data: null, error };
    if (!data?.length) return { data: null, error: new Error(mensaje) };
    return { data, error: null };
}

function escrituraDeRuta(builder) {
    return escrituraQueDebeTocarFilas(builder, MSG_RUTA_SIN_EFECTO);
}

// ── Y lo mismo en la recepción, que costó un pedido entero ──────────────────
// El 2026-08-14 en La Popular: a los cargos de sala se les había apagado
// «Gestionar» en Pedidos, así que RLS frenaba cada UPDATE de la recepción y
// devolvía exactamente lo que devuelve el éxito. La pantalla dio la llegada
// por confirmada, escribió en la bitácora y le avisó a bodega; en la base no
// quedó ni la llegada ni una sola caja. Quien recibía volvía a contar las
// mismas cajas sin entender por qué reaparecían.
//
// La lección es que la red de las rutas se escribió para las rutas y nadie la
// llevó al camino de al lado. Por eso ahora el mecanismo está aparte y las dos
// puertas lo usan: `pedido_sucursal_status` (llegada, cajas recibidas,
// reenvíos) y `pedido_items` (qué caja no llegó).
const MSG_RECEPCION_SIN_EFECTO = 'No se pudo guardar el avance de la recepción. Puede que ya no tengas permiso para gestionar pedidos: vuelve a iniciar sesión y, si sigue igual, consulta con tu jefatura.';

function escrituraDeRecepcion(builder) {
    return escrituraQueDebeTocarFilas(builder, MSG_RECEPCION_SIN_EFECTO);
}

export function updateRutaStatus(rutaId, patch) {
    return escrituraDeRuta(supabase.from('rutas').update(patch).eq('id', rutaId));
}

export function updateRutaPedidoEntregado(stopId, userId) {
    return escrituraDeRuta(
        supabase.from('ruta_pedidos')
            .update({ entregado_at: new Date().toISOString(), entregado_por: userId })
            .eq('id', stopId)
    );
}

// Extraído de TabRutas.jsx (5 de sus 7 sitios reutilizan funciones ya
// definidas arriba: updateRutaStatus, updateRutaPedidoEntregado,
// fetchBranchNamesForSucursales, fetchBranchIdForSucursal).
export function fetchRutasConParadas() {
    return supabase.from('rutas')
        .select(`
            id, numero, conductor_id, conductor_nombre, status,
            salida_at, vuelta_base_at, distancia_total_m, duracion_estimada_min, created_at,
            ruta_pedidos (
              id, pedido_id, erp_sucursal_id, orden_entrega,
              distancia_desde_anterior_m, duracion_desde_anterior_min,
              entregado_at, entregado_por, confirmado_suc_at, discrepancia
            )
        `)
        .in('status', ['pendiente', 'en_ruta', 'completada', 'con_alerta'])
        .order('created_at', { ascending: false })
        .limit(50);
}

export function fetchPedidoNumerosByIds(pedidoIds) {
    return supabase.from('pedidos').select('id, numero').in('id', pedidoIds);
}

// ── pedido_items ─────────────────────────────────────────────────────────────

const ITEMS_SELECT = `
    id, erp_sucursal_id, erp_product_id, cantidad_asignada, cantidad_enviada, cantidad_recibida,
    status, nota_diferencia, error_tipo, received_at, received_by, lotes_asignados, agotamiento,
    sin_stock, revision_minmax, falta_caja, caja_especial,
    factor, dispatch_tipo, dispatch_factor, dispatch_multiplo,
    max_qty_snapshot, stock_packs_snapshot,
    resolucion_status, resolucion_tipo, resolucion_nota,
    resuelto_por, resuelto_at, confirmado_suc_por, confirmado_suc_at,
    rechazado_por, rechazado_at, nota_rechazo,
    products ( nombre, es_antibiotico, laboratorios ( nombre ), product_precios ( factor, activo, presentaciones!id_presentacion ( tipo ) ), dispatch_rules ( dispatch_label ) ),
    presentaciones!erp_presentacion_id ( tipo )
`;

// Pedidos con >1000 items existen en producción — paginado con fetchAllRows
// (antes era un while-loop manual duplicado con el de pedido_item_eventos).
export function fetchPedidoItemsAll(pedidoId, sucFilter) {
    return fetchAllRows(() => {
        let q = supabase.from('pedido_items').select(ITEMS_SELECT).eq('pedido_id', pedidoId);
        if (sucFilter) q = q.eq('erp_sucursal_id', sucFilter);
        return q;
    });
}

export function fetchPedidoItemEventosAll(pedidoId, sucFilter) {
    return fetchAllRows(() => {
        let q = supabase.from('pedido_item_eventos')
            .select('id, pedido_item_id, tipo, resolucion_tipo, nota, hecho_por, created_at')
            .eq('pedido_id', pedidoId).order('created_at', { ascending: true });
        if (sucFilter) q = q.eq('erp_sucursal_id', sucFilter);
        return q;
    });
}

export function fetchPedidoItemsPendientesIds(pedidoId, sucId) {
    return supabase.from('pedido_items').select('id')
        .eq('pedido_id', pedidoId).eq('erp_sucursal_id', sucId).eq('status', 'pendiente');
}

export function fetchPedidoItemsFaltaElectrolit(pedidoId, sucId) {
    return supabase.from('pedido_items')
        .select('id, products(nombre)')
        .eq('pedido_id', pedidoId).eq('erp_sucursal_id', sucId)
        .eq('falta_caja', true).eq('status', 'pendiente');
}

export function fetchPedidoItemsFaltaEspeciales(pedidoId, sucId) {
    return supabase.from('pedido_items')
        .select('id')
        .eq('pedido_id', pedidoId).eq('erp_sucursal_id', sucId)
        .eq('falta_caja', true).eq('status', 'pendiente').eq('caja_especial', true);
}

export function updatePedidoItemsFaltaCaja(ids, value) {
    return escrituraDeRecepcion(
        supabase.from('pedido_items').update({ falta_caja: value }).in('id', ids)
    );
}

/**
 * Si el producto lleva etiqueta de despacho propia (la «CAJA» de Electrolit).
 *
 * Vive acá y no repetido en cada vista porque la forma del dato **no es la que
 * parece**: `dispatch_rules.erp_product_id` es UNIQUE, así que PostgREST trata
 * el embed como uno-a-uno y devuelve un OBJETO, no un arreglo. El código hacía
 * `dispatch_rules?.[0]?.dispatch_label` —indexar un objeto— y daba `undefined`
 * siempre: medido sobre un pedido real, **0 de 378 filas** lo derivaron bien.
 *
 * La consecuencia no era cosmética: `isAdicional()` nunca reconocía las cajas
 * de Electrolit, así que se colaban dentro de las hojas numeradas en vez de ir
 * al bloque aparte del PDF. Lo destapó generar un pedido de Salud 3 con 11
 * hojas — el de Salud 5 no lo mostró porque sus Electrolit no tenían existencia.
 *
 * Acepta las dos formas a propósito: si algún día se cae la restricción única,
 * PostgREST pasaría a devolver arreglo y esto seguiría funcionando.
 */
export function tieneEtiquetaDeDespacho(row) {
    const reglas = row?.products?.dispatch_rules;
    const label = Array.isArray(reglas) ? reglas[0]?.dispatch_label : reglas?.dispatch_label;
    return !!label;
}

// ── Confirmación de lo que sale, y su verificación contra el sistema ────────
//
// Al finalizar hay que decir qué se envía de verdad: puede salir menos que lo
// asignado, más, o nada. Lo normal es que salga lo asignado, así que sólo
// viajan las EXCEPCIONES — pedirle a alguien que confirme 476 productos uno por
// uno es pedirle que apriete "sí" 476 veces, que no confirma nada.
//
// `ajustes`: [{ pedido_item_id, cantidad_enviada, motivo }]
export function confirmarEnvioPedido(pedidoId, sucId, ajustes = []) {
    return supabase.rpc('confirmar_envio_pedido', {
        p_pedido_id: pedidoId, p_sucursal_id: sucId, p_ajustes: ajustes,
    });
}

/**
 * Verifica el pedido contra el sistema SIN escribir nada, y devuelve el id de
 * la corrida. Tarda ~40 s para una sucursal grande, así que responde enseguida
 * y sigue trabajando por su cuenta: el resultado se lee después con
 * `fetchTrasladoErp`.
 *
 * Se dispara al ABRIR el modal de finalizar, no al llegar a la pantalla de
 * confirmación: mientras quien despacha cuenta cajas y reparte páginas, la
 * verificación ya viene corriendo y llega hecha.
 */
export async function lanzarSimulacroTraslado(pedidoId, sucId) {
    const { data, error } = await supabase.functions.invoke('trasladar-pedido-erp', {
        body: { pedido_id: pedidoId, erp_sucursal_id: sucId, simulacro: true, background: true },
    });
    if (error) {
        // El motivo real viaja en el cuerpo; sin leerlo todo fallo se ve como un
        // "non-2xx status code" indistinguible.
        try {
            const cuerpo = await error.context?.json?.();
            if (cuerpo) return { trasladoId: null, error: cuerpo.error ?? 'No se pudo verificar.' };
        } catch { /* el cuerpo no era JSON */ }
        return { trasladoId: null, error: error.message ?? 'No se pudo verificar.' };
    }
    return { trasladoId: data?.traslado_id ?? null, error: null };
}

export function fetchTrasladoErp(id) {
    return supabase.from('pedido_traslado_erp')
        .select('id, estado, productos, lineas, hallazgos, ms_total, error_msg')
        .eq('id', id).maybeSingle();
}

/**
 * Saca el pedido de bodega en el sistema: un traslado por producto.
 *
 * Se dispara al finalizar y no bloquea nada — responde enseguida y sigue en
 * segundo plano, porque 900 productos no entran en una respuesta. El avance
 * vive en `pedido_traslado_erp` y el detalle en `pedido_traslado_linea`.
 *
 * Se niega si las hojas guardadas no son las del PDF impreso: el traslado lleva
 * el número de hoja adentro y una hoja equivocada es peor que ninguna.
 */
export async function despacharTrasladoPedido(pedidoId, sucId) {
    const { data, error } = await supabase.functions.invoke('trasladar-pedido-erp', {
        body: {
            pedido_id: pedidoId, erp_sucursal_id: sucId,
            accion: 'enviar', simulacro: false, background: true,
        },
    });
    if (error) {
        try {
            const cuerpo = await error.context?.json?.();
            if (cuerpo) return { ok: false, error: cuerpo.error ?? 'No se pudo despachar.', codigo: cuerpo.codigo };
        } catch { /* el cuerpo no era JSON */ }
        return { ok: false, error: error.message ?? 'No se pudo despachar.' };
    }
    return { ok: true, ...data };
}

/**
 * Ingresa en la sucursal lo que ya salió de bodega.
 *
 * `hoja` recibe una hoja entera; `itemIds` recibe productos sueltos —el que la
 * sala va a vender antes de terminar de contar la caja—. Como cada producto
 * viaja en su propio traslado, cualquiera de las dos formas recibe traslados
 * COMPLETOS: no depende de que el sistema soporte recepción parcial, que no la
 * soporta.
 *
 * `enSegundoPlano` decide QUIÉN espera, y la respuesta cambia con él:
 *
 *   · sin él (por omisión) se espera el resultado completo — `recibidas`,
 *     `pedidas`, `completo` y los fallos. Es lo que necesita quien recibe UN
 *     producto para venderlo ya: sin saber si entró, no puede facturarlo.
 *   · con él vuelve un `{ ok: true, en_segundo_plano: true, pedidas }` en cuanto
 *     el encargo queda tomado, y el trabajo sigue del lado del servidor. Es para
 *     confirmar una hoja o el pedido entero: 35 productos son 18-45 s medidos, y
 *     la sala no tiene por qué mirar la pantalla mientras tanto. El resultado se
 *     lee después en la tarjeta del pedido («en el inventario» / «sin ingresar»).
 *
 * Que el trabajo siga aunque la sala pierda el internet no es un accidente: la
 * función corre en el servidor, no en el navegador. Lo único que se pierde es la
 * respuesta.
 */
export async function recibirTrasladoPedido(pedidoId, sucId, { hoja = null, itemIds = [], enSegundoPlano = false } = {}) {
    const { data, error } = await supabase.functions.invoke('trasladar-pedido-erp', {
        body: {
            pedido_id: pedidoId, erp_sucursal_id: sucId, accion: 'recibir',
            ...(hoja != null ? { hoja } : {}),
            ...(itemIds.length ? { pedido_item_ids: itemIds } : {}),
            ...(enSegundoPlano ? { background: true } : {}),
        },
    });
    if (error) {
        try {
            const cuerpo = await error.context?.json?.();
            if (cuerpo) return { ok: false, error: cuerpo.error ?? 'No se pudo recibir.', codigo: cuerpo.codigo, ...cuerpo };
        } catch { /* el cuerpo no era JSON */ }
        return { ok: false, error: error.message ?? 'No se pudo recibir.' };
    }
    return { ok: true, ...data };
}

/**
 * El estado del traslado de VARIOS pedidos, en una sola consulta.
 *
 * Una por tarjeta serían N viajes para pintar un badge. Se filtra al despacho
 * real —el simulacro es diagnóstico y no es lo que la tarjeta cuenta—.
 */
export function fetchTrasladosDePedidos(pedidoIds) {
    return supabase.from('pedido_traslado_erp')
        .select('pedido_id, erp_sucursal_id, estado, lineas, productos, hallazgos, error_msg')
        .in('pedido_id', pedidoIds)
        .eq('modo', 'real').eq('paso', 'enviar');
}

/**
 * ¿Lo que la sala dio por recibido está en el inventario?
 *
 * Confirmar una recepción escribe en dos sitios y el segundo —el que mueve
 * existencias— puede fallar solo, a propósito: un tropiezo del otro lado no
 * puede deshacer un conteo que ya se guardó. O sea que «lo conté y NO entró»
 * existe por diseño, y es el único estado que deja a la sala sin poder
 * facturar. Esto es lo que le permite a la tarjeta decirlo.
 *
 * Una llamada para las N tarjetas: devuelve una fila por (pedido, sucursal), no
 * una por renglón, así que no se acerca al corte de 1000.
 */
export function fetchResumenIngresoPedidos(pedidoIds) {
    return supabase.rpc('resumen_ingreso_pedidos', { p_pedido_ids: pedidoIds });
}

/**
 * Los renglones que hay que reintentar, para mandarlos EXPLÍCITOS.
 *
 * Sin lista, la recepción toma todo lo pendiente de la sucursal — y ahí
 * entrarían al inventario renglones que la sala todavía no contó, que es el
 * defecto inverso al que se está arreglando.
 */
export async function fetchItemsSinIngresar(pedidoId, sucId) {
    const { data, error } = await supabase.rpc('items_sin_ingresar', {
        p_pedido_id: pedidoId, p_sucursal_id: sucId,
    });
    return { itemIds: data ?? [], error };
}

/** El avance del traslado de una sucursal, por estado y por hoja. */
export async function fetchResumenTraslado(pedidoId, sucId) {
    const { data, error } = await supabase.rpc('resumen_traslado_pedido', {
        p_pedido_id: pedidoId, p_sucursal_id: sucId,
    });
    return { resumen: data ?? null, error };
}

// ── pedido_sucursal_status ──────────────────────────────────────────────────
// Getter/setter genéricos — mismo par (pedido_id, erp_sucursal_id) en TODOS
// los sitios que los usan, solo cambian las columnas seleccionadas o el
// payload del update. El caller sigue armando el patch/columns exactos que
// ya armaba antes; acá solo se centraliza el query builder.

export function fetchPedidoSucursalStatus(pedidoId, sucId, columns) {
    return supabase.from('pedido_sucursal_status').select(columns)
        .eq('pedido_id', pedidoId).eq('erp_sucursal_id', sucId).maybeSingle();
}

export function updatePedidoSucursalStatus(pedidoId, sucId, patch) {
    return escrituraDeRecepcion(
        supabase.from('pedido_sucursal_status').update(patch)
            .eq('pedido_id', pedidoId).eq('erp_sucursal_id', sucId)
    );
}

// ── Pausas / asistencia ──────────────────────────────────────────────────────

export function fetchPausaHistorial(pedidoId, sucId) {
    return supabase.from('pedido_pausa_historial').select('razon').eq('pedido_id', pedidoId).eq('erp_sucursal_id', sucId);
}

export function fetchAttendancePunches(employeeId, sinceIso) {
    return supabase.from('attendance').select('type, timestamp')
        .eq('employee_id', employeeId).in('type', ['OUT_LUNCH', 'IN_LUNCH'])
        .gte('timestamp', sinceIso).order('timestamp', { ascending: false }).limit(10);
}

// ── TabGenerar.jsx (6 sitios) ─────────────────────────────────────────────────

export function fetchActiveEmployeesBasic() {
    return supabase.from('employees').select('id, first_names, last_names').eq('status', 'ACTIVO');
}

export function fetchPedidoNumero(pedidoId) {
    return supabase.from('pedidos').select('numero').eq('id', pedidoId).single();
}

export function fetchPedidoIdsSinceExcluding(monthStartIso, excludeId) {
    return supabase.from('pedidos').select('id').gte('created_at', monthStartIso).neq('id', excludeId);
}

export function fetchPedidoSucursalStatusForPedidos(pedidoIds, sucIds) {
    return supabase.from('pedido_sucursal_status').select('erp_sucursal_id')
        .in('pedido_id', pedidoIds).in('erp_sucursal_id', sucIds);
}

// `dispatch_rules(dispatch_label)` no es decorativo: junto con `caja_especial`
// es lo que `isAdicional()` mira para separar el bloque "CAJAS ADICIONALES" del
// PDF de la tabla numerada. Sin traerlo, la captura de hojas metía las cajas de
// Electrolit dentro de las hojas numeradas y las que se guardaban dejaban de
// ser las que se imprimieron (auditoría 2026-08-11).
//
// Y va paginado por el mismo motivo: acá se decide qué producto cae en qué
// hoja, así que un corte silencioso a las 1000 filas no daría un error — daría
// hojas incompletas, que es el mismo defecto por otra puerta. Hoy la sucursal
// más grande ronda las 520 filas, pero el margen no es una garantía.
// Devuelve el array directo (no `{ data }`), como todo lo que pasa por el helper.
export function fetchPedidoItemsForPrintCapture(pedidoId, sucId) {
    return fetchAllRows(() => supabase.from('pedido_items')
        .select('id, factor, dispatch_factor, dispatch_tipo, cantidad_asignada, lotes_asignados, sin_stock, caja_especial, products(nombre, es_antibiotico, laboratorios(nombre), dispatch_rules(dispatch_label))')
        .eq('pedido_id', pedidoId).eq('erp_sucursal_id', sucId).gt('cantidad_asignada', 0));
}

// ── CrearRutaModal.jsx (6 sitios — 2 de ellos reutilizan updateRutaStatus y
// fetchBranchIdForSucursal ya definidos arriba) ─────────────────────────────

export function fetchEmployeeDriverInfo(userId) {
    return supabase.from('employees').select('first_names, last_names, photo_url').eq('id', userId).maybeSingle();
}

export function fetchPedidosDisponiblesParaRuta() {
    return supabase.from('pedidos').select('id, numero')
        .in('status', ['confirmado', 'enviado', 'parcial']).order('numero');
}

export function fetchPedidoSucursalStatusFinalizados() {
    return supabase.from('pedido_sucursal_status')
        .select('pedido_id, erp_sucursal_id, total_cajas, cajas_electrolit, cajas_especiales, finalizado_at')
        .not('finalizado_at', 'is', null);
}

export function fetchSucursalesConCoords() {
    return supabase.from('erp_sucursal_map')
        .select('erp_sucursal_id, es_bodega, branch:branches!inner(settings, name)')
        .order('erp_sucursal_id');
}

export function fetchBranchIdsForSucursales(sucIds) {
    return supabase.from('erp_sucursal_map').select('erp_sucursal_id, branch_id').in('erp_sucursal_id', sucIds);
}
