import { supabase } from '../supabaseClient';

// Datos del traslado entre salas.
//
// Es la cuarta operación de la familia solicitud → aprobación → aplicación, y
// la primera donde quien pide y quien decide están en salas distintas: pide la
// sala que NO tiene y confirma la que SÍ tiene.
//
// ── Lo que este archivo NO hace ────────────────────────────────────────────
// No elige el aprobador. Lo resuelve un trigger de la base a partir de la sala
// de origen —turno → jefatura → Supervisión— y descarta el `approver_id` que
// mande el navegador. Acá depende del dato y de la hora, así que dejarlo del
// lado del cliente sería dejar elegir quién aprueba.
//
// Tampoco avisa. La notificación nace en la misma transacción que la fila; una
// llamada aparte desde el navegador es justo lo que dejó a Min/Max con cero
// avisos en toda su historia.

/**
 * Los motivos de rechazo, dictados por el usuario el 2026-08-06.
 *
 * La lista vive TAMBIÉN en la base (`validar_rechazo_traslado`), que es la que
 * manda: una validación que solo existe en la pantalla es una sugerencia. Si se
 * agrega uno acá sin agregarlo allá, el rechazo rebota — a propósito.
 */
export const MOTIVOS_RECHAZO = [
    'Producto ya encargado',
    'Sin existencia en físico',
    'Producto dañado',
    'Otro',
];

/** Crea la solicitud. El aviso y el aprobador los pone la base, no esto. */
export function crearSolicitudTraslado(payload) {
    return supabase.from('approval_requests').insert(payload);
}

/**
 * Los traslados que esta sala tiene que confirmar.
 *
 * No filtra por sala: **el RLS ya lo hace**, y con una regla que el navegador no
 * podría reproducir —estar entre los destinatarios que dejó la cascada, o ser
 * jefatura de la sala de origen—. Filtrar de nuevo acá con un criterio parecido
 * pero no idéntico es la forma de que las dos se separen y una esconda lo que
 * la otra muestra.
 */
// Devuelve las filas Y el total exacto en UNA sola consulta: `count: 'exact'`
// sin `head` hace que PostgREST mande el `Content-Range` junto con el cuerpo.
//
// Eso es lo que permite que la baldosa muestre el número sin pedirlo aparte —y
// que el número sea el REAL, no `filas.length`, que mentiría en cuanto se
// crucen las 201 del `range`. Contar por el largo de una lista topada es
// exactamente el tipo de tope silencioso que no queremos.
export async function fetchTrasladosPorConfirmar() {
    const { data, count, error } = await supabase
        .from('approval_requests')
        .select('id, employee_id, note, metadata, created_at', { count: 'exact' })
        .eq('type', 'INVENTORY_TRANSFER_REQUEST')
        .eq('status', 'PENDING')
        .order('created_at', { ascending: true })
        .range(0, 200);
    return { filas: data ?? [], total: count ?? 0, error };
}

// `contarTrasladosPorConfirmar` se eliminó el 2026-08-07. Contaba exactamente
// las mismas filas que devuelve la consulta de arriba —misma tabla, mismos dos
// filtros— y el widget la llamaba de nuevo al terminar CADA carga de la lista,
// aunque entre el montaje y la apertura no hubiera cambiado nada. El total sale
// ahora del `count` de esa misma consulta. Mismo hallazgo que
// `contar_facturas_sala` (v2.515.2), con la diferencia de que acá el viaje
// desperdiciado era barato.

/** Lo que esta sala pidió y ya salió: sirve para saber qué falta recibir. */
export async function fetchTrasladosPorRecibir() {
    const { data, error } = await supabase
        .from('approval_requests')
        .select('id, employee_id, note, metadata, updated_at')
        .eq('type', 'INVENTORY_TRANSFER_REQUEST')
        .eq('status', 'APPROVED')
        .order('updated_at', { ascending: true })
        .range(0, 200);
    // Ya despachado y todavía sin recibir. Se filtra acá y no en la consulta
    // porque son dos claves dentro del mismo jsonb y el filtro de PostgREST
    // sobre ausencia de clave anidada no distingue «no existe» de «es null».
    const filas = (data ?? []).filter(r => r.metadata?.erp_traslado && !r.metadata?.erp_recibido);
    return { filas, error };
}

/**
 * Despacha el traslado en el sistema y recién entonces lo marca aprobado.
 *
 * El navegador NO habla con el sistema de origen: sus credenciales viven en un
 * secreto y quien tiene esa sesión puede mover inventario de cualquier sala.
 * Todo —verificar el permiso, releer la existencia, resolver la presentación,
 * escribir y recién ahí marcar APPROVED— pasa en la Edge Function.
 *
 * Nunca lanza: devuelve `{ ok, ... }` y el llamador decide qué mostrar.
 */
async function invocar(body) {
    try {
        const { data, error } = await supabase.functions.invoke('aplicar-traslado-inventario', { body });
        if (!error) return data ?? { ok: false, error: 'El servidor no devolvió respuesta.' };

        // `functions.invoke` marca error para cualquier status >= 400, pero el
        // motivo real viaja en el cuerpo — sin leerlo, todo fallo se ve como un
        // "non-2xx status code" indistinguible.
        try {
            const cuerpo = await error.context?.json?.();
            if (cuerpo) return cuerpo;
        } catch { /* el cuerpo no era JSON */ }
        return { ok: false, error: error.message ?? 'No se pudo aplicar.' };
    } catch (e) {
        return { ok: false, error: e?.message ?? String(e) };
    }
}

export const despacharTraslado = (requestId, nota = '') =>
    invocar({ request_id: requestId, approver_note: nota, accion: 'enviar' });

export const recibirTraslado = (requestId) =>
    invocar({ request_id: requestId, accion: 'recibir' });

/**
 * Si la sala de origen todavía puede, y quién más podría.
 *
 * Se pregunta al ABRIR la lista y no al apretar el botón: entre que alguien
 * pide y alguien contesta, la sala pudo haber vendido lo último que le quedaba
 * —o habérselo enviado a otra que pidió antes—. Sin esto, quien confirma se
 * entera recién cuando el sistema le rebota el despacho.
 *
 * Las alternativas son las salas que sí podrían cederlo sin quedar debajo de su
 * propio mínimo, excluyendo el origen y el destino.
 */
export async function fetchDisponibilidadTraslado(requestId) {
    const { data, error } = await supabase
        .rpc('get_traslado_disponibilidad', { p_request_id: requestId });
    return { disponibilidad: data ?? null, error };
}

/**
 * Los traslados que ya se cerraron: recibidos y rechazados.
 *
 * Es lo que no estaba en ninguna parte. El widget del tablero muestra sólo lo
 * que está EN VUELO —lo que falta confirmar y lo que falta recibir—, así que en
 * cuanto un traslado termina desaparece de la única pantalla que lo mostraba.
 * Medido el 2026-08-07: los 6 traslados de la historia estaban invisibles, los
 * 4 recibidos porque el filtro de «por recibir» los descarta y los 2 rechazados
 * porque nadie los consultaba nunca.
 *
 * «Cerrado» es rechazado, o aprobado y ya recibido. Un APPROVED sin recibir
 * sigue en vuelo y vive en la otra pestaña: si apareciera en las dos, el mismo
 * traslado se contaría dos veces.
 *
 * `branchId` recorta a una sala mirándola por los DOS lados —lo que pidió y lo
 * que le pidieron—: un traslado le pertenece igual siendo origen que destino.
 * Sin sala, se devuelve lo que el RLS deje ver, que para alcance ALL es todo.
 */
export async function fetchTrasladosHistorial({ branchId = null, limite = 200 } = {}) {
    let q = supabase
        .from('approval_requests')
        .select('id, employee_id, note, approver_note, status, metadata, created_at, updated_at')
        .eq('type', 'INVENTORY_TRANSFER_REQUEST')
        .in('status', ['APPROVED', 'REJECTED'])
        .order('updated_at', { ascending: false })
        .range(0, limite);

    if (branchId) {
        // Los dos ids viven dentro del mismo jsonb, así que el filtro va por
        // `metadata->>` y no por columna. Son texto ahí adentro: comparar
        // contra un número no matchea nada.
        const id = String(branchId);
        q = q.or(`metadata->>branch_id.eq.${id},metadata->>origen_branch_id.eq.${id}`);
    }

    const { data, error } = await q;
    // El APPROVED sin recibir se descarta acá y no en la consulta: PostgREST no
    // distingue «la clave no existe» de «la clave es null» dentro de un jsonb,
    // que es justo la diferencia entre despachado y recibido.
    const filas = (data ?? []).filter(r => r.status === 'REJECTED' || r.metadata?.erp_recibido);
    return { filas, error };
}

/**
 * En qué salas hay un producto, para poder pedirlo desde la búsqueda.
 *
 * La lista de faltantes ya trae sus salas adentro; la búsqueda no. Y el caso
 * real es justamente ese: alguien busca porque un cliente está preguntando, ve
 * que otra sala lo tiene y necesita poder pedirlo ahí mismo.
 *
 * Sale de la misma vista que todo lo demás, así que la existencia viene con lo
 * que ya salió descontado. Contarlo en el navegador sobre las filas de la
 * búsqueda mezclaría cajas con unidades.
 */
export async function fetchDondeHay(erpProductId, erpSucursalDestino) {
    const { data, error } = await supabase.rpc('get_donde_hay', {
        p_erp_product_id: Number(erpProductId),
        p_erp_sucursal_destino: Number(erpSucursalDestino),
    });
    return { donde: data ?? [], error };
}

/** Si el producto lleva receta. Es lo único que hoy se valida al pedirlo. */
export async function fetchEsAntibiotico(erpProductId) {
    const { data, error } = await supabase
        .from('products')
        .select('es_antibiotico')
        .eq('id', Number(erpProductId))
        .maybeSingle();
    return { esAntibiotico: Boolean(data?.es_antibiotico), error };
}

/**
 * Rechaza el traslado con su motivo, y con la sugerencia adentro.
 *
 * El motivo va en `metadata` y no solo en la nota porque un trigger lo valida
 * contra la lista cerrada; «Otro» además exige que se escriba cuál.
 *
 * La `sugerencia` viaja en el mismo lugar porque el aviso de rechazo la lee de
 * ahí: sin ella, quien pidió se entera de que no y vuelve a empezar de cero.
 */
export async function rechazarTraslado(requestId, motivo, texto = '', sugerencia = '') {
    const { data: actual, error: errLeer } = await supabase
        .from('approval_requests')
        .select('metadata')
        .eq('id', requestId)
        .maybeSingle();
    if (errLeer) return { error: errLeer };

    return supabase
        .from('approval_requests')
        .update({
            status: 'REJECTED',
            approver_note: String(texto ?? '').trim() || null,
            metadata: {
                ...(actual?.metadata ?? {}),
                rejection_reason: motivo,
                ...(sugerencia ? { sugerencia } : {}),
            },
        })
        .eq('id', requestId)
        .eq('status', 'PENDING');   // no pisar si otro la resolvió en el medio
}
