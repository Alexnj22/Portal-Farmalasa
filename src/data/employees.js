// Bloque 6.A — capa de datos, entidad "employees" (expediente RRHH,
// asistencia). Extraído de employeeSlice.js: 20 llamadas supabase.from()
// (los supabase.storage.from() de subida de archivos quedan fuera —
// acceso a bucket, no a tabla). employee_branches/employee_events/
// employee_rosters ya tienen funciones equivalentes en data/system.js
// (Bloque 6.A, systemSlice.js) — se reutilizan en vez de duplicar.
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
