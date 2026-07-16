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

export function fetchEmployeeById(employeeId) {
    return supabase.from('employees').select('*').eq('id', employeeId).single();
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

// FormTurnos.jsx (3 sitios — upsert crea/edita, updateShiftFlags archiva/restaura)
export function upsertShift(shiftObject) {
    return supabase.from('shifts').upsert(shiftObject).select();
}

export function updateShiftFlags(id, patch) {
    return supabase.from('shifts').update(patch).eq('id', id);
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

export function fetchWeekRostersRaw(weekStartDate) {
    return supabase.from('employee_rosters').select('*').eq('week_start_date', weekStartDate);
}

export function upsertWeeklyRoster(payload) {
    return supabase.from('employee_rosters').upsert(payload, { onConflict: 'employee_id, week_start_date' });
}

export function upsertBulkWeeklyRosters(rows) {
    return supabase.from('employee_rosters').upsert(rows, { onConflict: 'employee_id,week_start_date' });
}

export function publishWeekRostersQuery(weekStartDate, employeeIds) {
    let q = supabase.from('employee_rosters').update({ status: 'PUBLISHED' }).eq('week_start_date', weekStartDate);
    if (employeeIds) q = q.in('employee_id', employeeIds);
    return q;
}

// ShiftExceptionModal.jsx (2 de sus 4 sitios; reutilizados 2× cada uno —
// handleSave y handleRemoveException hacen el mismo select/update)
export function fetchPublishedRosterWithId(employeeId, weekStartDate) {
    return supabase.from('employee_rosters')
        .select('id, schedule_data')
        .eq('employee_id', employeeId)
        .eq('week_start_date', weekStartDate)
        .eq('status', 'PUBLISHED')
        .maybeSingle();
}

export function updateEmployeeRosterById(rosterId, patch) {
    return supabase.from('employee_rosters').update(patch).eq('id', rosterId);
}

// ── Sucursales (fetchKioskBoot — función independiente, no toca bootStatus) ─

export function fetchBranchesBasic() {
    return supabase.from('branches').select('id, name').order('name');
}

export function fetchBranchesFull() {
    return supabase.from('branches').select('*').order('name');
}
