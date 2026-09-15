// Bloque 6.A — capa de datos, entidad "attendanceAudit" (auditoría de
// tiempos: timesheets, excepciones de turno). Extraído de
// AttendanceAuditView.jsx: 8 llamadas supabase.from(). 3 de los 8 sitios
// reutilizan funciones ya definidas en data/employees.js y data/requests.js
// (mismo query exacto): updateAttendancePunch, updateEmployee,
// updateApprovalRequest.
// Lo escrito sobre este módulo:
// `docs/ASISTENCIA-COMO-SE-CUENTA-EL-TIEMPO-2026-08-24.md` — cómo una marcación
// se convierte en horas de planilla: el huso, el reparto nocturno del Art. 168,
// la salida que nadie marcó y las tres ramas del cruce de medianoche que hoy
// nunca se ejecutan.
import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';

// ── La hora de El Salvador, y los minutos de tardanza ───────────────────────
//
// Vivían dentro de `AttendanceAuditView.jsx`, sin exportar, así que no había
// forma de probarlas. Salieron acá el 2026-08-23 con la auditoría: Asistencia
// era una de las ocho áreas sin una sola prueba, y su única matemática estaba
// escondida en el render.
//
// ⚠️ La fórmula de la tardanza está DUPLICADA en
// `supabase/functions/consolidate-timesheets/index.ts` (que la guarda en
// `timesheets.late_minutes`) y acá, que la recalcula para mostrarla. Hoy las dos
// dan lo mismo — se comprobó sobre las 429 filas, todas en 0 — pero son dos
// copias de la misma regla y por lo tanto pueden divergir. Es exactamente la
// situación que motivó centralizar `announcementAppliesToUser`, que había
// divergido entre dos pantallas. No se unificó ahora porque una es Deno y la
// otra el navegador; queda escrito para que se sepa.

/** Una fecha `YYYY-MM-DD` y una hora `HH:MM` como instante de El Salvador. */
export function buildCSTDate(dateStr, timeStr) {
    if (!dateStr || !timeStr) return null;
    return new Date(`${dateStr}T${timeStr}:00-06:00`);
}

/** El día `YYYY-MM-DD` de El Salvador para un instante cualquiera. */
export function getCSTDateStr(isoOrDate) {
    const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
    return new Date(d.getTime() - 6 * 3600000).toISOString().slice(0, 10);
}

/**
 * Cuántos minutos tarde entró alguien.
 *
 * Nunca negativo: llegar antes es puntual, no «menos veinte minutos de
 * tardanza». Sin marcación o sin turno devuelve 0 — no hay contra qué medir, y
 * un `null` acá se sumaría como NaN en el total de la quincena.
 */
export function minutosDeTardanza(marcacionISO, inicioEsperado) {
    if (!marcacionISO || !inicioEsperado) return 0;
    const real = new Date(marcacionISO).getTime();
    const esperado = inicioEsperado instanceof Date ? inicioEsperado.getTime() : new Date(inicioEsperado).getTime();
    if (Number.isNaN(real) || Number.isNaN(esperado)) return 0;
    return Math.max(0, Math.floor((real - esperado) / 60000));
}

// El llamador se queda con las de la quincena filtrando por `metadata.date`,
// que es jsonb y no se puede filtrar en la base — o sea que el recorte pasa
// DESPUÉS. Sin paginar, un corte en 1000 se llevaría filas al azar y la
// quincena saldría incompleta sin una sola señal. Devuelve el ARRAY, o `null`
// si falló la primera página.
export function fetchPendingShiftExceptions() {
    return fetchAllRows(() => supabase.from('approval_requests')
        .select('id, employee_id, status, note, metadata, created_at')
        .eq('type', 'SHIFT_EXCEPTION')
        .eq('status', 'PENDING')
        .order('id', { ascending: true }));
}

export function fetchQuincenaTimesheets(startDate, endDate) {
    return supabase.from('timesheets')
        .select('id, employee_id, work_date, regular_hours, overtime_hours, late_minutes, is_absent, status, nocturnal_hours, nocturnal_overtime_hours, absence_type')
        .gte('work_date', startDate).lte('work_date', endDate);
}

/**
 * Aprobar días de planilla en bloque.
 *
 * ⚠️ **No lleva `approver_id`: esa columna NO existe en `timesheets`.** Sus
 * columnas son las del día trabajado (`work_date`, las horas, `is_absent`, …)
 * más `status`. Y PostgREST rechaza el UPDATE **entero** cuando una sola
 * columna no existe (PGRST204), así que con ese campo adentro esto no aprobaba
 * NINGÚN día: la pantalla contestaba «No se pudo aprobar» y la quincena se
 * quedaba sin aprobar. `closeQuincenaTimesheets`, que manda sólo `status`,
 * siempre funcionó — por eso el defecto no se veía como «la planilla no
 * aprueba» sino como un botón que a veces no anda.
 *
 * Quién aprobó queda en la bitácora (`TIMESHEETS_BULK_APPROVED` en
 * `audit_logs`), que es donde el portal guarda las firmas.
 *
 * Encontrado el 2026-09-15 cruzando TODA escritura del repo contra el catálogo
 * real de columnas de producción, a raíz del mismo defecto en `creditos-erp`.
 */
export function approveTimesheetsBulk(ids) {
    return supabase.from('timesheets')
        .update({ status: 'APPROVED', updated_at: new Date().toISOString() })
        .in('id', ids);
}

export function closeQuincenaTimesheets(ids) {
    return supabase.from('timesheets').update({ status: 'APPROVED' }).in('id', ids);
}

export function fetchEmployeeExceptions(employeeId) {
    return supabase.from('employees').select('id, exceptions').eq('id', employeeId).single();
}
