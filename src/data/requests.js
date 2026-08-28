// Bloque 6.A — capa de datos, entidad "requests" (solicitudes de
// empleado + resolución de aprobador). Extraído de requestsSlice.js: 36
// llamadas supabase.from(). Este archivo enruta aprobaciones subiendo
// recursivamente por la jerarquía de roles — cada función de lookup de
// empleados se dejó separada aun cuando se parecen, porque difieren en
// qué filtros son condicionales vs. fijos (cambiar eso sería alterar el
// comportamiento de enrutamiento, no solo mover el query). employee_rosters
// (lectura puntual + upsert) reutiliza fetchEmployeeRosterSchedule/
// upsertWeeklyRoster ya definidos en data/employees.js y data/system.js.
// Lo escrito sobre este módulo:
// `docs/SOLICITUDES-QUIEN-DECIDE-Y-QUIEN-LO-VE-2026-08-24.md` — las TRES veces
// que un filtro del navegador más angosto que el RLS dejó la bandeja vacía sin
// dar error, y por qué los fallbacks del enrutador podían dejar una solicitud
// sin aprobador.
import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';

export const REQUEST_SIMPLE_SELECT = 'id, type, status, note, metadata, approver_note, created_at, updated_at, employee_id, approver_id, current_level, approvals';

// EmployeeDetailView.jsx — tab Solicitudes (solo lectura, historial del
// empleado). Paginada y ordenada de forma total, como todo lo que sale de
// `approval_requests`: es un historial, o sea que sólo crece. Devuelve el
// ARRAY, o `null` si falló la primera página.
export function fetchEmployeeApprovalRequestsDetail(employeeId) {
    return fetchAllRows(() => supabase.from('approval_requests')
        .select('id, type, status, note, approver_note, created_at, updated_at')
        .eq('employee_id', employeeId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false }));
}

// ── Disponibilidad del empleado (vacaciones/incapacidad vigentes) ──────────
//
// Pregunta, no pide. Antes se traía los eventos DE OTRA PERSONA y decidía en el
// cliente; eso obligaba a que `employee_events` estuviera abierta a cualquiera.
// El enrutador necesita un sí/no, no la tabla.
//
// Y el cierre de esa tabla habría sido un fallo CALLADO con la versión vieja: la
// lectura devolvería cero filas, `isUnavailable` diría «disponible» sin error, y
// la solicitud se iría a alguien de vacaciones.

export function fetchEmployeeUnavailable(employeeId) {
    return supabase.rpc('empleado_no_disponible', { p_employee_id: employeeId });
}

// ── Roles / candidatos a aprobador ──────────────────────────────────────────

export function fetchAllRolesHierarchy() {
    return supabase.from('roles').select('id, name, parent_role_id, secondary_parent_role_id');
}

export function fetchRolesByNamePattern(namePattern) {
    return supabase.from('roles').select('id').ilike('name', `%${namePattern}%`);
}

// Filtros fijos (branch_id siempre aplica) — usado por resolveApprover subiendo la jerarquía.
export function fetchActiveEmployeesInRoleAndBranch(roleId, branchId, excludeId) {
    return supabase.from('employees').select('id')
        .eq('role_id', roleId).eq('branch_id', branchId).eq('status', 'ACTIVO').neq('id', excludeId);
}

/**
 * Los escalones de la escala de cargos (`roles.rango`).
 *
 * Antes esto era `ADMIN_SYSTEM_ROLES = ['ADMIN','SUPERADMIN']` y cada consulta
 * enumeraba los valores a mano. Dos problemas: había que acordarse de TODOS en
 * cada sitio, y el valor vivía por persona en `employees.system_role`, que podía
 * contradecir al organigrama —decía `SUPERVISOR` del Gerente General y `ADMIN`
 * de la jefatura de Talento Humano—.
 *
 * Ahora sale del cargo y es una escala ORDENADA, así que «de acá para arriba» se
 * escribe con un tramo y no con una lista que envejece.
 */
export const RANGO = {
    COLABORADOR: 0,
    SUBJEFATURA: 1,
    JEFATURA:    2,
    SUPERVISION: 3,
    DIRECCION:   4,
};

/**
 * Quiénes están en un tramo de la escala. La regla vive en la base
 * (`empleados_por_rango`), no acá.
 *
 * Devuelve `{ data: [{id}], error }` —la misma forma que traían las consultas
 * que reemplaza— para que los llamadores no cambien. Es a propósito: el cambio
 * de criterio ya es bastante, y mover además la forma del resultado obligaría a
 * revisar cada uso por una razón distinta a la del cambio.
 */
async function porRango(min, max, { branchId = null, excluir = null } = {}) {
    const { data, error } = await supabase.rpc('empleados_por_rango', {
        p_min: min, p_max: max,
        p_branch_id: branchId ?? null,
        p_excluir: excluir ?? null,
    });
    if (error) return { data: null, error };
    return { data: (data ?? []).map(id => ({ id })), error: null };
}

// Los tres de respaldo del enrutador: el último recurso cuando no hay jefatura
// ni supervisión disponible. Hasta hoy salían de `system_role IN
// ('ADMIN','SUPERADMIN')`, que era UNA sola persona; con el rango son las tres
// de dirección, así que una solicitud deja de poder quedarse sin quién la firme
// porque esa persona esté de vacaciones.
export function fetchBranchAdmins(branchId, excludeId) {
    return porRango(RANGO.DIRECCION, RANGO.DIRECCION, { branchId, excluir: excludeId });
}

export function fetchGlobalAdmins(excludeId) {
    return porRango(RANGO.DIRECCION, RANGO.DIRECCION, { excluir: excludeId });
}

export function fetchAnyActiveAdmin() {
    return porRango(RANGO.DIRECCION, RANGO.DIRECCION);
}

export function fetchApprovalRolePermissions() {
    return supabase.from('role_permissions').select('role_id').eq('module_key', 'requests').eq('can_approve', true);
}

export function fetchActiveEmployeesInRoles(roleIds, excludeId) {
    return supabase.from('employees').select('id').in('role_id', roleIds).eq('status', 'ACTIVO').neq('id', excludeId).limit(1);
}

// Filtros condicionales (branch_id/excludeId solo si aplican) — usado por
// resolveNextApprover, donde sameBranch/excludeId varían según el nivel.
//
// Recibe un TRAMO y no un mínimo porque el enrutador sube escalón por escalón:
// primero la jefatura de la sala, después supervisión y recién al final
// dirección. Con un «de acá para arriba» el primer intento se llevaría también a
// la dirección y nadie escalaría nunca.
export function fetchActiveEmployeesByRangoConditional(min, max, branchId, excludeId, sameBranch) {
    return porRango(min, max, {
        branchId: sameBranch && branchId ? branchId : null,
        excluir: excludeId || null,
    });
}

export function fetchActiveEmployeesByRoleIdConditional(roleId, branchId, excludeId, sameBranch) {
    let q = supabase.from('employees').select('id').eq('role_id', roleId).eq('status', 'ACTIVO');
    if (sameBranch && branchId) q = q.eq('branch_id', branchId);
    if (excludeId) q = q.neq('id', excludeId);
    return q;
}

// ── Cobertura de sucursal (empleados/rosters) ───────────────────────────────

export function fetchActiveBranchEmployeesExcluding(branchId, excludeId) {
    return supabase.from('employees').select('id').eq('branch_id', branchId).eq('status', 'ACTIVO').neq('id', excludeId);
}

export function fetchRostersForWeekByEmployees(weekStart, employeeIds) {
    return supabase.from('employee_rosters').select('employee_id, schedule_data').eq('week_start_date', weekStart).in('employee_id', employeeIds);
}

// ── fetchRequests ────────────────────────────────────────────────────────────

export function fetchBranchActiveEmployeeIds(branchId) {
    return supabase.from('employees').select('id').eq('branch_id', branchId).eq('status', 'ACTIVO');
}

/**
 * La lista del centro de solicitudes.
 *
 * `soloMiasId` es el alcance «sólo míos», y son DOS cosas: las que mandé y las
 * que me toca contestar como compañero (el primer nivel de un cambio de turno
 * lo responde el otro, no una jefatura). Sin la segunda mitad, encender el
 * alcance nuevo apagaba los cambios de turno sin decirlo.
 *
 * ── Acá vivía un filtro por `approver_id`, y vaciaba la bandeja ────────────
 * Con permiso de aprobar, la consulta pedía «lo que me tocaba a MÍ»:
 * `approver_id = yo`, sin asignar, o mía. Pero `approver_id` es a quién
 * ENRUTÓ la jerarquía, no quién puede decidir: la policy de UPDATE cobra
 * `can_approve` del módulo de la familia y no mira ese sello, y el aviso lo
 * reparte `notificar_solicitud_creada` entre TODOS los que pueden aprobar esa
 * familia. O sea que había tres definiciones de «esto es tuyo» y la más
 * angosta era la única que decidía qué se veía.
 *
 * Medido en prod el 2026-08-17 con la sesión de Talento Humano —alcance ALL,
 * `can_approve` en las cuatro familias—: 35 solicitudes en la tabla, 5
 * pendientes, y la consulta le devolvía **0**. Recibía la notificación de cada
 * una y llegaba a una pantalla vacía; ni el enlace `?solicitud=` abría nada,
 * porque busca dentro de una lista que nunca la trajo. Cero filas y «no hay
 * solicitudes» se ven idénticos, así que el fallo era mudo.
 *
 * Hoy el recorte lo hace el RLS —que es el que de verdad manda— y el alcance
 * por sala; la bandeja se ordena después, en `visible()` de la vista. Por eso
 * tampoco hace falta `ownId`: lo propio pasa la policy por `employee_id`.
 *
 * **Devuelve el ARRAY —ya paginado—, no `{ data, error }`, y `null` si falló
 * la primera página.** Al sacar el filtro de `approver_id` esta consulta pasó
 * a traer todo lo que el RLS deja pasar, y `approval_requests` sólo crece: sin
 * paginar, el día que cruce las 1000 filas PostgREST corta ahí sin error ni
 * aviso. Sería el MISMO fallo mudo que se acaba de arreglar —una bandeja
 * incompleta se ve igual que una completa—, sólo que reaparecido por la puerta
 * de al lado.
 *
 * El desempate por `id` es la otra mitad de paginar. `range()` corta por
 * posición, así que necesita un orden TOTAL: con empates, la base puede
 * repartir dos filas iguales de cualquier modo entre dos páginas y el
 * resultado es una repetida y otra perdida. Hoy `created_at` no empata
 * —medido: 36 filas, 36 instantes distintos— pero eso es una propiedad de los
 * datos de hoy, no una garantía: el default es `now()`, que es el instante de
 * la TRANSACCIÓN, así que dos filas insertadas juntas nacerían con el mismo
 * sello. Con la clave primaria de segundo criterio la pregunta no se vuelve a
 * plantear.
 */
export function fetchApprovalRequestsList({ employeeId, branchEmpIds, soloMiasId }) {
    // El cuerpo va DENTRO de `fetchAllRows` —y no en un `const construir` que
    // se pasa después— porque así lo lee también el detector de `gate:data`,
    // que busca la llamada en las líneas de arriba del `.from(`. Con el cierre
    // con nombre marcaba esta consulta como sin paginar teniéndolo, y un
    // detector que grita sobre código sano se termina apagando.
    return fetchAllRows(() => {
        let q = supabase.from('approval_requests').select(REQUEST_SIMPLE_SELECT)
            .order('created_at', { ascending: false })
            .order('id', { ascending: false });
        if (employeeId) q = q.eq('employee_id', employeeId);
        if (soloMiasId) return q.or(`employee_id.eq.${soloMiasId},approver_id.eq.${soloMiasId}`);
        /* ── El traslado NO se recorta por la sala de quien pidió ───────────
         * Es el único tipo donde quien pide y quien contesta están en salas
         * DISTINTAS: pide la sala que no tiene y confirma la que sí. Su
         * `employee_id` es entonces de la otra sala por definición, así que
         * `employee_id IN (los de mi sala)` lo descarta SIEMPRE — justo en la
         * bandeja de quien tiene que contestarlo.
         *
         * Medido en prod el 2026-08-17 con la sesión de Bodega (alcance
         * BRANCH): la policy le dejaba ver 4 traslados pendientes y este
         * filtro dejaba 0. El aviso le llegaba igual, así que el traslado
         * existía en la campana y en ninguna pantalla. Es el MISMO fallo que
         * `approver_id` unas líneas más arriba —un recorte del navegador más
         * angosto que el del servidor— por la puerta de al lado.
         *
         * Quién ve cuál lo decide la policy, y para este tipo mira tres cosas
         * que este filtro no puede reproducir: ser la sala de ORIGEN (la que
         * tiene el producto), ser la de DESTINO, o **cubrir a la de origen
         * mientras está cerrada y la solicitud sigue pendiente** — la sala de
         * respaldo.
         *
         * `metadata.destinatarios` era una cuarta, y se quitó el 2026-08-21: la
         * lista se graba al crear la solicitud y no caduca, así que le dejaba a
         * la sala de respaldo el historial entero de Bodega para siempre. Sirve
         * para avisar, no para autorizar. */
        if (branchEmpIds && branchEmpIds.length > 0) {
            q = q.or(`employee_id.in.(${branchEmpIds.join(',')}),type.eq.INVENTORY_TRANSFER_REQUEST`);
        }
        return q;
    });
}

export function fetchEmployeesByIds(ids, columns) {
    return supabase.from('employees').select(columns).in('id', ids);
}

/**
 * Los que `employees` esconde.
 *
 * `employees_select` no deja ver a quien tenga un cargo con `roles.is_su`, salvo
 * a sí mismo. Es lo que se quiso —un superusuario no figura en el directorio de
 * personal— pero el aprobador real del portal tiene uno de esos cargos, así que
 * la consulta de arriba devolvía la solicitud SIN su aprobador y la ficha
 * «Aprobó» quedaba en «Sin registro»: ni cara ni nombre. Medido el 2026-08-12
 * con la sesión de una vendedora: 8 de 8 solicitudes resueltas.
 *
 * La RPC es SECURITY DEFINER y devuelve sólo lo que se pinta —nombre, foto,
 * cargo y sala—, y sólo de quien participa de alguna solicitud. No trae `code`
 * a propósito: ese código es hoy la contraseña del carné.
 *
 * Es un COMPLEMENTO, no un reemplazo: `fetchEmployeesByIds` sigue trayendo las
 * columnas completas de todos los que sí se ven (el detalle muestra el código
 * de quien pide), y esto rellena únicamente los huecos.
 *
 * Dos entradas porque hay dos formas de nombrar a la misma persona: las
 * solicitudes de aprobación guardan un uuid, y Min/Max guarda el CORREO con el
 * que decidió. Cada fila vuelve con la `clave` que hizo juego, así el llamador
 * la guarda bajo la misma llave con la que la buscó.
 */
export function fetchPersonasDeSolicitudes(ids = [], claves = []) {
    return supabase.rpc('get_personas_de_solicitudes',
        { p_ids: ids, p_claves: claves });
}

// ── createRequest ────────────────────────────────────────────────────────────

export function fetchEmployeeApprovalInfo(employeeId) {
    return supabase.from('employees').select('role_id, branch_id').eq('id', employeeId).single();
}

export function fetchEmployeeName(employeeId) {
    return supabase.from('employees').select('name').eq('id', employeeId).single();
}

export function insertApprovalRequest(payload) {
    return supabase.from('approval_requests').insert([payload]).select(REQUEST_SIMPLE_SELECT).single();
}

// Variante "silenciosa" (sin .select() de vuelta) — usada por
// WidgetAnnulmentRequest.jsx en sus 4 formularios (annul/pay_change/
// vendor_change/client_change): el caller solo chequea { error }, nunca
// lee la fila insertada, así que no se agrega un round-trip extra.
export function insertApprovalRequestSilent(payload) {
    return supabase.from('approval_requests').insert(payload);
}

/**
 * Aplica en el ERP una solicitud de facturación aprobada.
 *
 * El navegador NO habla con el ERP: sus credenciales viven en un secreto de
 * Supabase, y quien tiene esa sesión puede anular cualquier factura de
 * cualquier sucursal. Toda la operación —verificar el permiso, traducir el id
 * del portal al del ERP, escribir, releer para confirmar y recién entonces
 * marcar APPROVED— pasa en la Edge Function.
 *
 * Devuelve `{ ok, aplicado }` o `{ ok:false, error }`. Nunca lanza: el llamador
 * decide qué mostrar.
 */
export async function aplicarSolicitudEnErp(requestId, approverNote = '') {
    try {
        const { data, error } = await supabase.functions.invoke('aplicar-solicitud-facturacion', {
            body: { request_id: requestId, approver_note: approverNote },
        });
        if (!error) return data ?? { ok: false, error: 'El servidor no devolvió respuesta.' };

        // `functions.invoke` marca error para cualquier status >= 400, pero el
        // motivo real viaja en el cuerpo — sin leerlo, todo fallo se ve como
        // un "Edge Function returned a non-2xx status code" indistinguible.
        let detalle = '';
        try { detalle = (await error.context?.json())?.error ?? ''; } catch { /* sin cuerpo legible */ }
        return { ok: false, error: detalle || error.message };
    } catch (e) {
        return { ok: false, error: e?.message || String(e) };
    }
}

/**
 * Aplica una carga o un descarte de inventario aprobado.
 *
 * Mismo reparto que arriba: el navegador no habla con el sistema de origen. Y
 * acá pesa más todavía, porque la sucursal es estado de la sesión de ese
 * sistema — dos aplicaciones simultáneas que compartieran sesión podrían
 * terminar moviendo existencias de la sucursal equivocada. Cada aplicación abre
 * la suya dentro de la Edge Function.
 *
 * Devuelve `{ ok, aplicado }` o `{ ok:false, error }`. Nunca lanza.
 */
export async function aplicarMovimientoInventarioEnErp(requestId, approverNote = '', aceptadas = null) {
    try {
        const { data, error } = await supabase.functions.invoke('aplicar-movimiento-inventario', {
            // `lineas_aceptadas` son ÍNDICES dentro de `metadata.items`, no las
            // líneas mismas: mandar las líneas sería dejar que el navegador
            // eligiera qué se mueve y en qué cantidad. El servidor las resuelve
            // contra lo que quedó guardado al crear la solicitud.
            body: { request_id: requestId, approver_note: approverNote,
                    ...(aceptadas ? { lineas_aceptadas: aceptadas } : {}) },
        });
        if (!error) return data ?? { ok: false, error: 'El servidor no devolvió respuesta.' };

        // El motivo real viaja en el cuerpo; sin leerlo todo fallo se ve como
        // un "non-2xx status code" indistinguible.
        let detalle = '';
        try { detalle = (await error.context?.json())?.error ?? ''; } catch { /* sin cuerpo legible */ }
        return { ok: false, error: detalle || error.message };
    } catch (e) {
        return { ok: false, error: e?.message || String(e) };
    }
}

/**
 * Cuántas solicitudes de facturación esperan decisión.
 *
 * El RLS ya recorta lo que cada quien puede ver, así que el número que sale
 * acá es el que esa persona podría resolver — no un total global que prometa
 * trabajo ajeno.
 */
// Devuelve las filas y no el conteo: es el MISMO viaje —las cuatro clases de
// solicitud, sólo las PENDING, que son pocas por definición— y con `type` y
// `created_at` la baldosa arma su franja (de qué son) y la antigüedad de la más
// vieja. Pedir `head: true` y después otra consulta para el desglose serían dos
// round-trips para lo que cabe en uno.
//
// Acá decía «sin `fetchAllRows` a propósito: lo pendiente es una cola que
// alguien vacía; si alguna vez pasara de 1000 filas, el problema no es la
// paginación». Lo primero es cierto y lo segundo mezcla dos cosas: que la cola
// desbordada sea un problema del negocio no quita que la BALDOSA mienta. Sin
// paginar, a las 1000 el número se queda clavado ahí y la franja se arma con
// una muestra — y como no hay error, se lee como el dato bueno. Es un renglón
// de más y hoy es una sola página; el `.in('type', …)` tampoco acota nada,
// porque el tipo se repite.
export async function fetchSolicitudesFacturacionPendientes() {
    const filas = await fetchAllRows(() => supabase
        .from('approval_requests')
        .select('id, type, created_at')
        .eq('status', 'PENDING')
        .in('type', ['ANNULMENT_REQUEST', 'PAYMENT_CHANGE_REQUEST',
                     'VENDOR_CHANGE_REQUEST', 'CLIENT_CHANGE_REQUEST'])
        .order('created_at', { ascending: true })
        .order('id', { ascending: true }));
    // Se mantiene la forma `{ filas, error }` que espera la baldosa; el motivo
    // del fallo ya quedó en consola dentro de `fetchAllRows`.
    return { filas: filas ?? [], error: filas === null ? new Error('No se pudieron cargar las solicitudes pendientes.') : null };
}

// ── approve/reject/cancel ────────────────────────────────────────────────────

export function updateApprovalRequest(requestId, patch) {
    return supabase.from('approval_requests').update(patch).eq('id', requestId);
}

/**
 * Decidir o avanzar una solicitud, pero SÓLO si sigue donde el aprobador la vio.
 *
 * `updateApprovalRequest` es un UPDATE por id a secas. La campana se sincroniza
 * sola entre pestañas —`notifications` viaja por realtime—, pero la lista de
 * Solicitudes no: `approval_requests` no está publicada, así que una pestaña
 * parada ahí sigue mostrando PENDIENTE con el botón vivo aunque la solicitud ya
 * se haya decidido en otra. Apretarlo otra vez volvía a disparar todo lo que
 * cuelga de aprobar: el evento en el legajo, el aviso al empleado, el aviso al
 * siguiente nivel.
 *
 * `desdeNivel` cierra el mismo hueco un escalón más abajo: una solicitud que ya
 * avanzó SIGUE siendo PENDING, así que el estado solo no alcanza — sin comparar
 * el nivel, la pestaña vieja la empuja de nuevo.
 *
 * Cuenta con `count: 'exact'` y NO con `.select()`: la representación de vuelta
 * pasa por la policy de LECTURA, y quien puede escribir no siempre puede releer
 * —el compañero de un cambio de turno es el caso—. Ahí `.select()` devolvería
 * cero filas y esto leería «ya resuelta» sobre algo que sí acaba de escribir.
 */
export function resolverApprovalRequest(requestId, patch, desdeNivel = null) {
    let q = supabase.from('approval_requests')
        .update(patch, { count: 'exact' })
        .eq('id', requestId)
        .eq('status', 'PENDING');
    if (desdeNivel != null) q = q.eq('current_level', desdeNivel);
    return q;
}

export function fetchApprovalRequestById(requestId) {
    return supabase.from('approval_requests').select(REQUEST_SIMPLE_SELECT).eq('id', requestId).single();
}

// El escalón de una persona concreta. Sale de `employees_safe`, que lo publica
// derivado del cargo — el propio y el secundario.
export function fetchEmployeeRango(employeeId) {
    return supabase.from('employees_safe').select('rango').eq('id', employeeId).maybeSingle();
}

// ── SHIFT_CHANGE: patch de rosters publicados en la aprobación final ───────

export function fetchShiftsBasic() {
    return supabase.from('shifts').select('id, start_time, end_time');
}

export function fetchPublishedRostersForSwap(employeeIds, weekStart) {
    return supabase.from('employee_rosters')
        .select('id, employee_id, schedule_data')
        .in('employee_id', employeeIds)
        .eq('week_start_date', weekStart)
        .eq('status', 'PUBLISHED');
}

export function updateEmployeeRosterById(rosterId, patch) {
    return supabase.from('employee_rosters').update(patch).eq('id', rosterId);
}
