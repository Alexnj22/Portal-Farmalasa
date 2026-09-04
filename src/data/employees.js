// Bloque 6.A — capa de datos, entidad "employees" (expediente RRHH,
// asistencia). Extraído de employeeSlice.js: 20 llamadas supabase.from()
// (los supabase.storage.from() de subida de archivos quedan fuera —
// acceso a bucket, no a tabla). employee_branches/employee_events/
// employee_rosters ya tienen funciones equivalentes en data/system.js
// (Bloque 6.A, systemSlice.js) — se reutilizan en vez de duplicar.
// Lo escrito sobre este módulo:
// `docs/PERSONAL-EL-EXPEDIENTE-Y-LO-QUE-NO-SE-PUBLICA-2026-08-24.md` — qué salió
// de `employees_safe` y por qué (el código de carné ES la contraseña; 47 de 47
// podían leerlo), por qué `RETURNING` enumera columnas, y por qué sin permiso el
// salario devuelve vacío en vez de error.
import { supabase } from '../supabaseClient';

// ── Catálogo educativo/médico (upsert best-effort, ignora duplicados) ──────

export function upsertEducationCatalogEntries(rows) {
    return supabase.from('education_catalog_entries').upsert(rows, { onConflict: 'category,value', ignoreDuplicates: true });
}

// ── Quién hizo algo, cuando no es de tu sucursal ────────────────────────────
//
// El padrón que carga el arranque viene RECORTADO a la sucursal propia para
// quien no tiene «ver» en Personal (`scopeToMyBranch` en `systemSlice`), y eso
// está bien: una sala no navega los expedientes de las demás. Pero el efecto
// colateral es que **quien preparó tu pedido en bodega no existe en tu mapa de
// empleados**, así que la línea de tiempo pintaba la hora y dejaba el nombre y
// la cara en blanco — no por falta de permiso, sino porque nadie los trajo.
//
// Esto trae SÓLO a las personas que ya aparecen nombradas en registros que el
// usuario tiene delante, y sólo su identidad pública: nombre y foto. No es el
// padrón: es resolver un `id` que la pantalla ya está mostrando.
export function fetchEmployeesPublicByIds(ids) {
    return supabase.from('employees_safe')
        .select('id, name, first_names, last_names, photo_url')
        .in('id', ids);
}

// ── Expediente de empleado ───────────────────────────────────────────────────

// `RETURNING` enumera las columnas a propósito, y NO puede volver a ser `*`.
//
// Desde que `code` y `kiosk_pin` dejaron de ser legibles con la sesión del
// usuario (son la credencial del carné, y el carné es la contraseña del
// portal), un `.select()` sin argumentos pide `*` y el servidor responde
// «permission denied for column code» — o sea que guardar un empleado fallaría
// entero. Se listan los campos que el llamador realmente usa después.
const DEVUELVE = 'id, name, branch_id, role_id, secondary_role_id, photo_url, '
    + 'employee_documents, education_level, status';

export function insertEmployee(dbPayload) {
    return supabase.from('employees').insert([dbPayload]).select(DEVUELVE).single();
}

export function updateEmployee(employeeId, patch) {
    return supabase.from('employees').update(patch).eq('id', employeeId);
}

export function updateEmployeeReturning(employeeId, patch) {
    return supabase.from('employees').update(patch).eq('id', employeeId).select(DEVUELVE).single();
}

/**
 * El código de carné y el PIN de quienes administran personal.
 *
 * Van por RPC y no con la fila porque **el código de carné es la contraseña del
 * portal**: `login()` hace `signInWithPassword(password: code)`. Publicarlo en
 * `employees_safe` significaba que cualquier empleado con sesión podía leer el
 * de todos —medido: 47 de 47— y entrar como cualquiera.
 *
 * La compuerta es la misma que ya gobierna editar un empleado
 * (`staff_list.can_edit`), así que ver un código es ahora una llamada explícita
 * y no un efecto de traer la fila.
 */
export async function fetchCredenciales(ids) {
    const unicos = [...new Set((ids || []).filter(Boolean))];
    if (!unicos.length) return new Map();
    const { data, error } = await supabase.rpc('get_employee_credenciales', { p_ids: unicos });
    if (error) { console.error('employees: fetchCredenciales failed:', error.message); return new Map(); }
    return new Map((data || []).map((r) => [r.employee_id, r]));
}

/**
 * Los datos de dinero de un empleado: sueldo base, banco y número de cuenta.
 *
 * Van por RPC y no con la fila por el MISMO motivo que el código de carné:
 * `employees_safe` los publicaba a cualquiera que pudiera leer la vista, y el
 * módulo `staff_salary` —que la pantalla de Permisos deja prender y apagar— no
 * gateaba nada. Era una llave sin cerradura.
 *
 * **Sin la llave devuelve VACÍO, no error.** Es deliberado: quien no puede ver
 * salarios abre el expediente igual y ve un guión donde va el monto. Lanzar
 * convertiría «no te toca» en «se rompió», que es peor y además le dice al
 * navegador que ahí hay algo.
 *
 * Se piden TODOS de una en el arranque y no de a uno: Nómina calcula la
 * planilla sobre la lista completa, así que pedirlos por expediente obligaría a
 * una llamada por persona justo cuando más se necesitan juntos.
 */
export async function fetchSalarios(ids) {
    const unicos = [...new Set((ids || []).filter(Boolean))];
    if (!unicos.length) return new Map();
    const { data, error } = await supabase.rpc('get_employee_salarios', { p_ids: unicos });
    if (error) { console.error('employees: fetchSalarios failed:', error.message); return new Map(); }
    return new Map((data || []).map((r) => [r.employee_id, r]));
}

/**
 * La identidad previsional: DUI, documento alterno, ISSS y AFP.
 *
 * Salieron de `employees_safe` el 2026-08-24 por el mismo motivo que el sueldo y
 * que el código de carné, pero con una diferencia que conviene tener presente:
 * ahí la protección existía por una coincidencia de configuración —los cuatro
 * cargos que abren un expediente eran los cuatro que tenían la llave—. Acá no
 * había coincidencia que valga. La policy de `employees` deja que **cualquier
 * sesión** lea las filas que no son de un superusuario, y el recorte por
 * sucursal lo hace el NAVEGADOR: el documento de identidad de las 47 personas
 * viajaba a cualquiera que abriera la consola.
 *
 * **Sin la llave devuelve lo PROPIO, no vacío.** Es la diferencia con
 * `fetchSalarios`: «Mi perfil» muestra el documento de uno mismo, y esconderle a
 * alguien su propio DUI no protege a nadie — rompe una pantalla. El servidor
 * resuelve las dos cosas en la misma consulta.
 */
export async function fetchIdentidades(ids) {
    const unicos = [...new Set((ids || []).filter(Boolean))];
    if (!unicos.length) return new Map();
    const { data, error } = await supabase.rpc('get_employee_identidad', { p_ids: unicos });
    if (error) { console.error('employees: fetchIdentidades failed:', error.message); return new Map(); }
    return new Map((data || []).map((r) => [r.employee_id, r]));
}

/**
 * El gemelo de ESCRITURA de las dos anteriores.
 *
 * Hasta el 2026-09-03 la lectura de la ficha estaba partida en tres llaves y la
 * escritura era una sola: `staff_list.can_edit` alcanzaba para cambiarle a
 * cualquiera el sueldo y la cuenta donde se le deposita, **sin poder verlos**.
 * Hoy `authenticated` no tiene INSERT ni UPDATE sobre esas diez columnas y esta
 * función es el único camino.
 *
 * **Lanza y no devuelve vacío**, al revés que las de lectura. Ahí el silencio
 * muestra menos; acá sería un guardado falso — la pantalla diría «guardado»
 * sobre una ficha intacta, que es la familia de
 * `feedback_sin_policy_de_update_el_write_devuelve_cero`. Por eso el error sube.
 *
 * Es UNA llamada y no tres —una por llave— porque así o entran las dos tandas o
 * no entra ninguna: con tres, el sueldo puede guardarse y la identidad fallar, y
 * la ficha queda escrita por la mitad sin que acá se sepa cuál mitad.
 */
export async function guardarDatosProtegidos(employeeId, patch) {
    if (!employeeId || !patch || !Object.keys(patch).length) return;
    const { error } = await supabase.rpc('guardar_datos_protegidos_de_empleado', {
        p_id: employeeId, p_patch: patch,
    });
    if (error) throw error;
}

/**
 * ¿Este DUI está libre?
 *
 * Misma historia que el carné: la comprobación cruzaba contra el padrón que el
 * navegador ya tenía, y sin `dui` ahí no encontraría **nunca** un choque. No
 * fallaría al comprobar: guardaría, y recién ahí saltaría el índice único de la
 * base con un error de Postgres en pantalla.
 *
 * Devuelve `null` si no se pudo preguntar. Quien la llama distingue los tres
 * casos: `false` bloquea, `true` deja pasar, `null` deja seguir — porque la red
 * caída no puede impedir dar de alta a alguien, y el índice único de la base
 * sigue ahí como última palabra.
 */
export async function duiDisponible(dui, excluirId = null) {
    const { data, error } = await supabase.rpc('dui_disponible', {
        p_dui: String(dui || ''), p_excluir: excluirId,
    });
    if (error) { console.error('employees: duiDisponible failed:', error.message); return null; }
    return data;
}

/**
 * ¿Este código de carné está libre?
 *
 * La comprobación vivía en el navegador, cruzando contra la lista de empleados
 * ya cargada. Sin `code` en esa lista no encontraría nunca un choque —y un
 * choque sin detectar son dos personas con la misma contraseña—, así que la
 * pregunta la contesta el servidor sin devolver de quién es.
 */
export async function codigoDeCarneLibre(codigo, excluirId = null) {
    const { data, error } = await supabase.rpc('carne_disponible', {
        p_code: String(codigo || ''), p_excluir: excluirId,
    });
    if (error) { console.error('employees: codigoDeCarneLibre failed:', error.message); return null; }
    return data;
}

// ── EmployeeDetailView.jsx (timeline, VIEW employee_timeline) ───────────────

export function fetchEmployeeTimeline(employeeId) {
    return supabase.from('employee_timeline').select('*')
        .eq('employee_id', employeeId).order('event_date', { ascending: false });
}

// ── EmployeeFormModal.jsx ────────────────────────────────────────────────────

export function fetchEducationCatalogEntries() {
    return supabase.from('education_catalog_entries').select('category, value').order('value');
}

export function fetchLastTerminationEvent(employeeId) {
    return supabase.from('employee_events').select('date')
        .eq('employee_id', employeeId).eq('type', 'TERMINATION')
        .order('date', { ascending: false }).limit(1);
}

// ── Roster (lectura puntual — el upsert usa upsertWeeklyRoster de data/system) ─

export function fetchEmployeeRosterSchedule(employeeId, weekStart) {
    return supabase.from('employee_rosters').select('schedule_data')
        .eq('employee_id', employeeId).eq('week_start_date', weekStart).maybeSingle();
}

// ── Eventos (fire-and-forget — sin .select(), a diferencia de
// insertEmployeeEvent de data/system que sí devuelve la fila) ──────────────

export function insertEmployeeEventRaw(payload) {
    return supabase.from('employee_events').insert([payload]);
}

// ── Asistencia ────────────────────────────────────────────────────────────

export function fetchAttendanceSince(sinceIso) {
    return supabase.from('attendance').select('*').gte('timestamp', sinceIso);
}

export function insertAttendancePunch(payload) {
    return supabase.from('attendance').insert([payload]).select().single();
}

export function deleteAttendancePunch(punchId) {
    return supabase.from('attendance').delete().eq('id', punchId);
}

export function fetchAttendancePunchDetails(punchId) {
    return supabase.from('attendance').select('details').eq('id', punchId).single();
}

export function updateAttendancePunch(punchId, patch) {
    return supabase.from('attendance').update(patch).eq('id', punchId);
}
