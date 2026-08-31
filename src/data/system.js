// Bloque 6.A — capa de datos, entidad "system" (eventos RRHH, roles,
// avisos, turnos, asuetos, rosters). Extraído de systemSlice.js: 34
// llamadas supabase.from() fuera de fetchBoot (fetchBoot/bootStatus
// quedan intactos — son alcance de 6.B, no de este bloque). 4 pares de
// sitios eran duplicados literales (update genérico de employees,
// insert de employee_documents, update de metadata de employee_events,
// toggle de is_active en shifts) y quedan en una sola función cada uno.
import { supabase } from '../supabaseClient';

// ── Eventos de empleado (RRHH) ───────────────────────────────────────────────

export function fetchOverlappingEvents(employeeId, type, excludeEventId) {
    let q = supabase.from('employee_events').select('date, metadata').eq('employee_id', employeeId).eq('type', type);
    if (excludeEventId) q = q.neq('id', excludeEventId);
    return q;
}

export function insertEmployeeEvent(dbPayload) {
    return supabase.from('employee_events').insert([dbPayload]).select().single();
}

export function fetchEmployeeEventForCancel(eventId) {
    return supabase.from('employee_events').select('type, metadata, employee_id').eq('id', eventId).single();
}

export function fetchEmployeeEventMetadata(eventId) {
    return supabase.from('employee_events').select('metadata').eq('id', eventId).single();
}

export function updateEmployeeEventMetadata(eventId, metadata) {
    return supabase.from('employee_events').update({ metadata }).eq('id', eventId);
}

// ── Expediente de empleado (aplicar/revertir cambios de un evento) ─────────

// Va contra `employees_safe` y no contra la tabla: `select('*')` sobre
// `employees` ya no compila del lado del servidor —`code` y `kiosk_pin` dejaron
// de ser legibles con la sesión del usuario— y la vista es exactamente el resto
// de las columnas. Ver `fetchCredenciales` en `data/employees.js`.
export function fetchEmployeeById(employeeId) {
    return supabase.from('employees_safe').select('*').eq('id', employeeId).single();
}

export function updateEmployeeFields(employeeId, patch) {
    return supabase.from('employees').update(patch).eq('id', employeeId);
}

export function deleteEmployeeBranches(employeeId) {
    return supabase.from('employee_branches').delete().eq('employee_id', employeeId);
}

export function insertEmployeeBranches(rows) {
    return supabase.from('employee_branches').insert(rows);
}

export function insertEmployeeDocument(row) {
    return supabase.from('employee_documents').insert([row]).select().single();
}

// ── Roles ────────────────────────────────────────────────────────────────────

export function insertRole(payload) {
    return supabase.from('roles').insert([payload]).select().single();
}

export function updateRoleRow(roleId, payload) {
    return supabase.from('roles').update(payload).eq('id', roleId).select().single();
}

export function deleteRoleRow(roleId) {
    return supabase.from('roles').delete().eq('id', roleId);
}

// ── Avisos ───────────────────────────────────────────────────────────────────

export function insertAnnouncement(payload) {
    return supabase.from('announcements').insert([payload]).select().single();
}

export function updateAnnouncementFull(id, patch) {
    return supabase.from('announcements').update(patch).eq('id', id).select().single();
}

export function updateAnnouncementFields(id, patch) {
    return supabase.from('announcements').update(patch).eq('id', id);
}

// Marcar un aviso como leído NO va por `updateAnnouncementFields`: la policy
// `announcements_update` exige `announcements/can_edit`, que tienen 4 de 46
// personas. Para el resto el UPDATE no tocaba ninguna fila y PostgREST
// devolvía 204 SIN error, así que el portal lo daba por hecho. La función
// resuelve la ficha con `auth_employee_id()` y comprueba la audiencia, que es
// el candado correcto: quien puede VER el aviso puede marcarlo.
export function marcarAvisoLeido(announcementId) {
    return supabase.rpc('marcar_aviso_leido', { p_announcement_id: announcementId });
}

export function deleteAnnouncementRow(id) {
    return supabase.from('announcements').delete().eq('id', id);
}

// ── Turnos (catálogo) ────────────────────────────────────────────────────────

export function insertShift(payload) {
    return supabase.from('shifts').insert([payload]).select().single();
}

export function deleteShiftRow(id) {
    return supabase.from('shifts').delete().eq('id', id);
}

export function updateShiftRow(id, patch) {
    return supabase.from('shifts').update(patch).eq('id', id).select().single();
}



export function setShiftActive(id, isActive) {
    return supabase.from('shifts').update({ is_active: isActive }).eq('id', id);
}

// ── Asuetos ──────────────────────────────────────────────────────────────────

export function insertHoliday(payload) {
    return supabase.from('holidays').insert([payload]).select().single();
}

export function deleteHolidayRow(id) {
    return supabase.from('holidays').delete().eq('id', id);
}

// ── Rosters semanales ────────────────────────────────────────────────────────


// Escribe el roster COMPLETO de una semana. Lo usan el intercambio de turnos y
// el cambio de horario aprobados. Para una celda suelta va
// `guardarDiaDeHorario` de `data/schedules.js`, que escribe un día y no pisa
// los otros ni toca el estado de publicación.
export function upsertWeeklyRoster(payload) {
    return supabase.from('employee_rosters').upsert(payload, { onConflict: 'employee_id, week_start_date' });
}




export function updateEmployeeRosterById(rosterId, patch) {
    return supabase.from('employee_rosters').update(patch).eq('id', rosterId);
}

// ── Sucursales (fetchKioskBoot — función independiente, no toca bootStatus) ─

export function fetchBranchesBasic() {
    return supabase.from('branches').select('id, name').order('name');
}

// `fetchBranchesFull` se retiró el 2026-08-31. Tenía un solo llamador —el
// respaldo de `fetchKioskBoot`— y ése corre SIN sesión: desde que `anon` tiene
// permiso sólo sobre `id` y `name`, un `select('*')` ahí devuelve *permission
// denied*. Quien necesite la fila entera ya la trae `fetchBoot`, que corre
// autenticado.
