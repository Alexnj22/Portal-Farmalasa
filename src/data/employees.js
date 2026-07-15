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

// ── Expediente de empleado ───────────────────────────────────────────────────

export function insertEmployee(dbPayload) {
    return supabase.from('employees').insert([dbPayload]).select().single();
}

export function updateEmployee(employeeId, patch) {
    return supabase.from('employees').update(patch).eq('id', employeeId);
}

export function updateEmployeeReturning(employeeId, patch) {
    return supabase.from('employees').update(patch).eq('id', employeeId).select().single();
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
