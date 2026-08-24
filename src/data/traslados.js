import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';
import { rangoDeSemana } from '../utils/semana';

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

/**
 * Crea la solicitud. El aviso y el aprobador los pone la base, no esto.
 *
 * Acepta UNA fila o un ARRAY. El array es cómo sale una composición de varias
 * salas —una solicitud por estante de origen— y va en un solo `insert` a
 * propósito: entran todas o no entra ninguna. Si una choca contra el freno de
 * duplicados, es mejor que no entre nada y se corrija a quedarse con media
 * composición enviada y sin forma de saber cuál mitad.
 */
export function crearSolicitudTraslado(payload) {
    return supabase.from('approval_requests').insert(payload);
}

/**
 * Los traslados que esta sala tiene que confirmar.
 *
 * No filtra por sala: **el RLS ya lo hace**, y con una regla que el navegador no
 * podría reproducir —ser la sala de origen, ser la de destino, o **cubrir a la
 * de origen mientras está cerrada** (`salas_que_cubre_ahora`, la sala de
 * respaldo)—. Filtrar de nuevo acá con un criterio parecido pero no idéntico es
 * la forma de que las dos se separen y una esconda lo que la otra muestra.
 *
 * ── El recorte que sí se puede hacer, y de dónde sale (2026-08-17) ─────────
 * Medido: La Popular veía 3 traslados bajo «Te piden de tu sala» y **los 3 los
 * había pedido ella misma** a Bodega, con los botones de confirmar y rechazar
 * encima de su propia solicitud. El recorte obvio —«origen = mi sala»— es
 * justamente el criterio parecido-pero-no-idéntico contra el que avisa el
 * párrafo de arriba: dejaría a Salud 3 sin ver los traslados de Bodega que
 * desde v2.657.0 puede despachar mientras Bodega está cerrada.
 *
 * Por eso `branchIds` no se arma con una regla escrita acá: sale de
 * `fetchSalasQueCubro`, que llama a **la misma función que llama la policy**
 * (`salas_que_cubre_ahora`). Una fuente, dos lectores.
 *
 * Ya no queda ningún caso fuera del recorte: `metadata.destinatarios` dejó de
 * dar acceso el 2026-08-21 (esa lista se graba al crear la solicitud y no
 * caduca, así que le regalaba a la sala de respaldo el historial entero de
 * Bodega). Hoy el criterio de la policy y el de `fetchSalasQueCubro` son el
 * mismo, y por eso este filtro no puede esconder nada que aquélla muestre.
 *
 * El servidor, mientras tanto, nunca dejó pasar la acción: `aplicar-traslado-
 * inventario` corta con 403 «lo confirma la sala que tiene el producto». Lo que
 * había era una lista con filas que no le tocaban a esa sala, no un movimiento
 * de inventario ajeno.
 */
// Devuelve las filas Y el total exacto en UNA sola consulta: `count: 'exact'`
// sin `head` hace que PostgREST mande el `Content-Range` junto con el cuerpo.
//
// Eso es lo que permite que la baldosa muestre el número sin pedirlo aparte —y
// que el número sea el REAL, no `filas.length`, que mentiría en cuanto se
// crucen las 201 del `range`. Contar por el largo de una lista topada es
// exactamente el tipo de tope silencioso que no queremos.
export async function fetchTrasladosPorConfirmar({ branchIds = null } = {}) {
    let q = supabase
        .from('approval_requests')
        .select('id, employee_id, note, metadata, created_at', { count: 'exact' })
        .eq('type', 'INVENTORY_TRANSFER_REQUEST')
        .eq('status', 'PENDING')
        .order('created_at', { ascending: true })
        .range(0, 200);
    // Texto adentro del jsonb: los ids van como cadenas o no matchean nada.
    if (branchIds?.length) q = q.in('metadata->>origen_branch_id', branchIds.map(String));
    const { data, count, error } = await q;
    return { filas: data ?? [], total: count ?? 0, error };
}

/**
 * Las salas que ESTA sala cubre ahora mismo, porque están cerradas.
 *
 * Es la función que consulta la policy de `approval_requests` para decidir
 * quién puede despachar un traslado fuera del horario de la sala que tiene el
 * producto (v2.657.0). La pantalla la llama para recortar su lista con el MISMO
 * criterio: si acá se escribiera una versión propia, el día que cambie el
 * horario o el respaldo una de las dos dejaría de coincidir — y la que se
 * equivoque hacia abajo esconde traslados que alguien tiene que atender.
 *
 * Devuelve `[]` cuando no cubre a nadie, que es lo normal en horario.
 */
export async function fetchSalasQueCubro(branchId) {
    if (!branchId) return [];
    const { data, error } = await supabase.rpc('salas_que_cubre_ahora', {
        p_branch_id: Number(branchId),
    });
    if (error) {
        console.error('traslados: fetchSalasQueCubro failed:', error.message);
        return [];
    }
    return data ?? [];
}

// `contarTrasladosPorConfirmar` se eliminó el 2026-08-07. Contaba exactamente
// las mismas filas que devuelve la consulta de arriba —misma tabla, mismos dos
// filtros— y el widget la llamaba de nuevo al terminar CADA carga de la lista,
// aunque entre el montaje y la apertura no hubiera cambiado nada. El total sale
// ahora del `count` de esa misma consulta. Mismo hallazgo que
// `contar_facturas_sala` (v2.515.2), con la diferencia de que acá el viaje
// desperdiciado era barato.

/**
 * Lo que esta sala pidió y ya salió: sirve para saber qué falta recibir. O sea
 * **donde MI sala es el DESTINO**.
 *
 * ── Por qué acá el RLS no alcanza (2026-08-17) ─────────────────────────────
 * El RLS contesta *este traslado te incumbe* y deja ver los de la sala por los
 * DOS lados —tiene que hacerlo: una sala es origen de unos y destino de otros—.
 * Esta lista es direccional: es lo que ME LLEGA. Sin el recorte, la sala que
 * despacha veía lo que mandó a otra como si estuviera por llegarle. Medido
 * sobre las filas reales: **Salud 5 abría «En camino» con 2 traslados y ninguno
 * venía a Salud 5** —los había despachado ella, a Salud 3 y a La Popular—, y
 * Salud 3 veía 2 de los cuales sólo 1 era suyo. Reportado así: «salen de todas
 * las salas, no sólo la de los empleados de esa sala».
 *
 * Y el criterio no se está inventando acá: recibir es del destino y punto —lo
 * dice la misma Edge Function («el traslado lo recibe la sala que lo pidió») y
 * la decisión sobre la sala de respaldo, que cubre SÓLO el despacho. Ese es el
 * motivo de que este recorte sí se pueda escribir y el de «por confirmar» no.
 *
 * `branchId` en `null` significa ver todo, que es lo correcto para alcance ALL:
 * gerencia mira las siete salas y recorta con el filtro de la pantalla.
 */
/**
 * En qué va cada composición: cuántas salas contestaron y cuántas no.
 *
 * Una solicitud a tres salas son TRES filas hermanadas por `grupo_id`, y cada
 * sala contesta por su cuenta. La lista de «en camino» sólo muestra las que ya
 * salieron, así que por sí sola no puede decir «2 de 3 respondieron»: le faltan
 * justamente las que no. Esto trae el grupo entero.
 *
 * ⚠️ `metadata->>grupo_id` se REPITE —es una fila por sala—, así que acotar la
 * entrada no acota la salida y `.in()` a secas puede truncar en 1000 sin avisar
 * (regla del tope de PostgREST). Por eso va con `fetchAllRows` aunque hoy los
 * grupos sean de dos o tres.
 *
 * No filtra por sala: el RLS ya decide qué se puede ver, y filtrar de nuevo acá
 * con un criterio parecido pero no idéntico es cómo las dos se separan.
 */
export async function fetchEstadoDeGrupos(grupoIds) {
    const ids = [...new Set((grupoIds ?? []).filter(Boolean).map(String))];
    if (ids.length === 0) return { grupos: {}, error: null };

    const filas = await fetchAllRows(() => supabase
        .from('approval_requests')
        .select('id, status, metadata')
        .eq('type', 'INVENTORY_TRANSFER_REQUEST')
        .in('metadata->>grupo_id', ids));

    if (filas === null) return { grupos: {}, error: new Error('No se pudo leer el grupo.') };

    const grupos = {};
    for (const f of filas) {
        const g = f.metadata?.grupo_id;
        if (!g) continue;
        (grupos[g] ||= {
            total: 0, sinResponder: 0, rechazadas: 0, enCamino: 0, recibidas: 0,
            salas: [], porRecibir: [],
        });
        const grupo = grupos[g];
        grupo.total += 1;
        if (f.metadata?.origen_branch_name) grupo.salas.push(f.metadata.origen_branch_name);

        // El orden importa: una rechazada nunca tuvo despacho, y una recibida ya
        // no está en camino. Preguntar al revés las contaría dos veces.
        if (f.status === 'REJECTED') grupo.rechazadas += 1;
        else if (f.metadata?.erp_recibido) grupo.recibidas += 1;
        else if (f.metadata?.erp_traslado) { grupo.enCamino += 1; grupo.porRecibir.push(f.id); }
        else grupo.sinResponder += 1;
    }
    return { grupos, error: null };
}

/**
 * Los traslados DESPACHADOS y todavía SIN RECIBIR.
 *
 * ── Por qué el filtro está en la base y no acá (2026-08-20) ─────────────────
 * Lo estuvo. Traía las 201 primeras solicitudes APROBADAS con su `metadata`
 * jsonb entero y filtraba en JavaScript, con este motivo escrito: «son dos
 * claves dentro del mismo jsonb y el filtro de PostgREST sobre ausencia de
 * clave anidada no distingue "no existe" de "es null"». El motivo era cierto y
 * la conclusión no: lo que no puede hacer PostgREST sí lo hace una función.
 *
 * Costaba **397 kB por carga del Inicio** —el 41% de todo lo que baja la
 * pantalla— para quedarse con unas veinte filas.
 *
 * Y el peso no era lo peor. Hay 205 solicitudes aprobadas y el `.range(0, 200)`
 * cortaba en 201, **antes** de filtrar: medido el 2026-08-20, cumplían la
 * condición 19 y el portal mostraba 16. Tres cajas despachadas y sin recibir no
 * aparecían en ninguna pantalla, y el número seguía creciendo. Verificado
 * contra la implementación vieja: 0 filas perdidas, 0 valores distintos, y las
 * que faltaban aparecieron.
 *
 * `get_traslados_por_recibir` es INVOKER: el RLS sigue decidiendo quién ve qué,
 * igual que cuando la consulta salía del navegador.
 */
export async function fetchTrasladosPorRecibir({ branchId = null } = {}) {
    // `branchId ? … : null` y no `!= null`: la versión vieja filtraba dentro de
    // un `if (branchId)`, así que un 0 o una cadena vacía significaban «todas
    // las salas». Se conserva esa lectura — cambiarla acá movería el alcance.
    const { data, error } = await supabase.rpc('get_traslados_por_recibir', {
        p_branch_id: branchId ? String(branchId) : null,
    });
    return { filas: data ?? [], error };
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

/**
 * Despacha el traslado. `lineasAceptadas` es lo que sale cuando NO sale todo.
 *
 * Viaja como ÍNDICES con su cantidad —`[{ i, cantidad }]`— y nunca como los
 * renglones: con los renglones, el navegador elegiría qué producto se mueve, y
 * del otro lado hay credenciales para mover inventario de cualquier sala. Con
 * índices lo único que puede hacer es señalar cuáles de los que ya se guardaron
 * salen, y bajarles la cantidad. Mismo contrato que la aprobación parcial de
 * carga y descarte.
 *
 * `null` significa «sale todo lo pedido», que es como funcionó siempre — y por
 * eso se manda `null` y no la lista completa: el camino normal sigue siendo
 * exactamente el mismo viaje que antes.
 *
 * La cantidad va en PAQUETES de la presentación del renglón, igual que
 * `items[].cantidad`. El servidor la topa contra lo pedido de nuevo: esto es una
 * sugerencia, no la autoridad.
 */
export const despacharTraslado = (requestId, nota = '', lineasAceptadas = null) =>
    invocar({
        request_id: requestId,
        approver_note: nota,
        accion: 'enviar',
        ...(lineasAceptadas ? { lineas_aceptadas: lineasAceptadas } : {}),
    });

export const recibirTraslado = (requestId) =>
    invocar({ request_id: requestId, accion: 'recibir' });

/**
 * Del número de las barras del ticket a la bolsa que alguien tiene en la mano.
 *
 * El papel pegado a la bolsa lleva `id_traslado` en su código; lo que
 * `recibirTraslado` necesita es el `id` de la solicitud, que vive en otra
 * columna. Sin este paso no hay camino del papel a la fila.
 *
 * **La consulta va a la base y no acá** por la misma razón que
 * `get_traslados_por_recibir`: el número está adentro de un `jsonb` anidado
 * (`metadata->'erp_traslado'->>'id_traslado'`) y eso PostgREST no lo filtra.
 * `traslado_por_codigo` es INVOKER, así que el RLS sigue decidiendo qué se ve.
 *
 * **Nunca lanza y nunca devuelve `null`**: siempre trae un objeto con al menos
 * `codigo`, para que la pantalla pueda decir qué pasó con lo que se escaneó en
 * vez de quedarse muda. Los cuatro desenlaces se distinguen así:
 *
 * | qué pasó | cómo se ve |
 * |---|---|
 * | es una bolsa mía, sin recibir | `id` con valor, `ya_recibido: false` |
 * | ya la recibieron | `ya_recibido: true` + `recibio` y `recibido_at` |
 * | el código es de un pedido de Bodega | `id: null`, `es_de_un_pedido: true` |
 * | no existe, o no es de esta sala | todo en `null` |
 *
 * Los dos últimos NO se pueden separar y es a propósito: el RLS oculta lo
 * ajeno, así que afirmar «no existe» sobre algo que sí existe en otra sala
 * sería mentir. El mensaje dice las dos cosas.
 */
export async function fetchTrasladoPorCodigo(codigo) {
    const { data, error } = await supabase.rpc('traslado_por_codigo', {
        p_codigo: String(codigo ?? ''),
    });
    if (error) {
        console.error('traslados: traslado_por_codigo failed:', error.message);
        return { traslado: null, error };
    }
    return { traslado: data ?? null, error: null };
}

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
export async function fetchTrasladosHistorial({ branchId = null, limite = 200, semana = null } = {}) {
    let q = supabase
        .from('approval_requests')
        // `approver_id`: quién lo despachó o quién lo rechazó. El historial
        // guardaba el motivo pero no de quién era la firma, así que el registro
        // no decía quién decidió — reportado: «no sale el proceso de
        // aprobaciones».
        .select('id, employee_id, approver_id, note, approver_note, status, metadata, created_at, updated_at')
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

    /* La semana va en la CONSULTA y no en el navegador, y no es una
     * preferencia: arriba hay un `.range(0, limite)`, y **un tope se aplica
     * antes del filtro**. Recortando acá afuera, pedir una semana de hace dos
     * meses no devolvería «las de esa semana» sino «las de esa semana entre las
     * 201 más nuevas» — o sea, ninguna, sin error y sin nada que lo explique.
     *
     * Corta por `updated_at` porque es CUÁNDO SE RESOLVIÓ, que es la fecha que
     * el historial muestra en su columna y la que ordena la consulta. Cortar
     * por `created_at` haría que un traslado pedido el domingo y despachado el
     * lunes cayera en una semana distinta de la que lo muestra. */
    if (semana) {
        const { desde, hasta } = rangoDeSemana(semana);
        q = q.gte('updated_at', desde).lt('updated_at', hasta);
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
