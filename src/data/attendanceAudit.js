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
import { diaSV } from '../utils/fecha';
import { anotar, conBitacora } from './audit';
import { updateAttendancePunch, updateEmployee } from './employees';
import { resolverApprovalRequest } from './requests';

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
    return diaSV(d);
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
export function approveTimesheetsBulk(ids, { employeeId = null, quincena = null } = {}) {
    // La firma la anota esta función (D3, 2026-09-28), no la pantalla.
    return conBitacora(supabase.from('timesheets')
        .update({ status: 'APPROVED', updated_at: new Date().toISOString() })
        .in('id', ids),
        'TIMESHEETS_BULK_APPROVED', employeeId != null ? String(employeeId) : null,
        { empId: employeeId, count: ids.length, quincena });
}

/**
 * Dar por revisadas las marcaciones que esperaban a Talento Humano →
 * `ATTENDANCE_HR_REVIEW_CLEARED`. Vivía como un bucle en la pantalla; acá la
 * bitácora sale de la misma función que escribe (D3, 2026-09-28). Lanza si
 * una escritura falla, como hacía el bucle.
 */
export async function marcarMarcajesRevisados(punches, { employeeId = null, date = null, revisadoPor = null } = {}) {
    const now = new Date().toISOString();
    for (const p of punches) {
        const details = { ...p.details, pendingHRReview: false, hrReviewedBy: revisadoPor, hrReviewedAt: now };
        const { error } = await updateAttendancePunch(p.id, { details });
        if (error) throw error;
    }
    anotar('ATTENDANCE_HR_REVIEW_CLEARED', employeeId != null ? String(employeeId) : null, {
        empId: employeeId, date, count: punches.length,
    });
}

/**
 * Confirmar o rechazar un turno extra (`SHIFT_EXCEPTION`) →
 * `SHIFT_EXCEPTION_APPROVED` / `SHIFT_EXCEPTION_REJECTED`.
 *
 * Se decide PRIMERO, y sólo si la decisión entra se toca al empleado. Con dos
 * pestañas abiertas la lista sigue mostrando el turno extra por confirmar
 * aunque ya se haya resuelto en la otra, y el orden viejo —escribir la
 * excepción y después marcar la solicitud— dejaba pasar la segunda
 * confirmación entera: horario reescrito, bitácora duplicada y un «Confirmado»
 * que no era cierto. El UPDATE condicionado a PENDING es el candado de todo lo
 * que sigue.
 *
 * Devuelve `{ error, yaResuelta }`. Vivía entero en la pantalla; salió acá con
 * la bitácora (D3, 2026-09-28) para que la app lo herede tal cual.
 */
export async function resolverTurnoExtra(req, aprobar, {
    confirmedStart = null, confirmedEnd = null, motivo = '', approverId = null, approverName = null,
} = {}) {
    const meta = req.metadata || {};
    const newStatus = aprobar ? 'APPROVED' : 'REJECTED';
    const nota = String(motivo ?? '').trim();
    const { error: reqErr, count } = await resolverApprovalRequest(req.id, {
        status: newStatus, approver_id: approverId,
        /* El motivo del rechazo. Este camino no lo escribía y la pantalla no lo
         * pedía: el empleado veía su turno extra rechazado sin saber por qué, y
         * en la base no quedaba nada. Obligatorio desde el 2026-08-18. */
        ...(nota ? { approver_note: nota } : {}),
        updated_at: new Date().toISOString(),
    });
    if (reqErr) return { error: reqErr, yaResuelta: false };
    if (count === 0) return { error: null, yaResuelta: true };

    if (aprobar && confirmedStart && confirmedEnd) {
        // La excepción va a la ficha para que consolidate-timesheets use las
        // horas declaradas.
        const { data: empRow } = await fetchEmployeeExceptions(req.employee_id);
        if (empRow) {
            const existing = Array.isArray(empRow.exceptions) ? empRow.exceptions : [];
            const filtered = existing.filter(ex => ex.date !== meta.date);
            const newEx = {
                id: Date.now().toString(),
                date: meta.date,
                isCustom: true,
                customStart: confirmedStart,
                customEnd: confirmedEnd,
                note: `Turno extra confirmado por TH (${approverName || 'supervisor'})`,
            };
            await updateEmployee(req.employee_id, { exceptions: [...filtered, newEx], updated_at: new Date().toISOString() });
        }
    }

    anotar(`SHIFT_EXCEPTION_${newStatus}`, String(req.id), {
        requestId: req.id, empId: req.employee_id, date: meta.date, confirmedStart, confirmedEnd,
    });
    return { error: null, yaResuelta: false };
}

export function closeQuincenaTimesheets(ids) {
    return supabase.from('timesheets').update({ status: 'APPROVED' }).in('id', ids);
}

export function fetchEmployeeExceptions(employeeId) {
    return supabase.from('employees').select('id, exceptions').eq('id', employeeId).single();
}
