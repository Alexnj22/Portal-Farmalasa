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
// La tardanza es UNA sola regla desde el 2026-10-28: `minutosDeTardanza` vive en
// `supabase/functions/_shared/tiempoTrabajado.ts`, la misma que usa
// `consolidate-timesheets` para escribir `timesheets.late_minutes`. Antes eran
// dos copias que coincidían por casualidad (una en Deno, otra acá).

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

// Cuántos minutos tarde entró alguien — la regla compartida con el cron.
export { minutosDeTardanza } from '../../supabase/functions/_shared/tiempoTrabajado.ts';

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

// Una quincena de TODA la plantilla: 48 personas × 16 días ya son 768 filas, y
// el techo silencioso de PostgREST es 1000. Con la plantilla creciendo, la
// quincena dejaba gente afuera sin error — por eso va paginada entera.
export async function fetchQuincenaTimesheets(startDate, endDate) {
    const data = await fetchAllRows(() => supabase.from('timesheets')
        .select('id, employee_id, work_date, regular_hours, overtime_hours, late_minutes, is_absent, status, nocturnal_hours, nocturnal_overtime_hours, absence_type')
        .gte('work_date', startDate).lte('work_date', endDate)
        .order('id', { ascending: true }), { completo: true });
    return data == null ? { data: null, error: new Error('No se pudo leer la quincena completa') } : { data, error: null };
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
        // Los dos `error` se miran (auditoría 2026-10-21): antes se ignoraban y
        // la solicitud quedaba «Aprobada» sin las horas en la ficha, así que
        // la persona no cobraba lo aprobado y, ya fuera de PENDING, nadie podía
        // reintentarlo desde la pantalla. Si la ficha no se pudo escribir, la
        // solicitud vuelve a PENDING para que se pueda confirmar de nuevo.
        const { data: empRow, error: exErr } = await fetchEmployeeExceptions(req.employee_id);
        if (exErr || !empRow) {
            return devolverAPendiente(req.id, exErr || new Error('No se encontró la ficha de la persona.'));
        }
        {
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
            const { error: updErr } = await updateEmployee(req.employee_id, { exceptions: [...filtered, newEx], updated_at: new Date().toISOString() });
            if (updErr) return devolverAPendiente(req.id, updErr);
        }
    }

    anotar(`SHIFT_EXCEPTION_${newStatus}`, String(req.id), {
        requestId: req.id, empId: req.employee_id, date: meta.date, confirmedStart, confirmedEnd,
    });
    return { error: null, yaResuelta: false };
}

// La decisión entró pero la ficha no: se deshace la decisión (sólo si sigue
// APPROVED) para que la solicitud vuelva a la lista. Si tampoco eso entra, el
// error lo dice, para que no se lea como un «Confirmado».
async function devolverAPendiente(requestId, causa) {
    const { error } = await supabase.from('approval_requests')
        .update({ status: 'PENDING', approver_id: null, updated_at: new Date().toISOString() })
        .eq('id', requestId).eq('status', 'APPROVED');
    const e = new Error(error
        ? 'Se aprobó el turno extra pero no se pudo escribir en el horario de la persona, y tampoco se pudo devolver a pendiente. Avisa a sistemas.'
        : 'No se pudo escribir el turno extra en el horario de la persona. La solicitud sigue pendiente: vuelve a intentarlo.');
    Object.assign(e, { userFacing: true });
    e.cause = causa;
    return { error: e, yaResuelta: false };
}

/**
 * Cerrar la quincena: aprobar de una vez los días que quedaban sin aprobar →
 * `CERRAR_QUINCENA` (D3: la anota esta función, así la pantalla del portal y
 * la del teléfono dejan la misma entrada). `contexto.quincena` es el inicio
 * de la quincena y va como target, igual que lo anotaba el teléfono.
 */
export function closeQuincenaTimesheets(ids, contexto = {}) {
    const { quincena = null, ...resto } = contexto;
    return conBitacora(supabase.from('timesheets').update({ status: 'APPROVED' }).in('id', ids),
        'CERRAR_QUINCENA', quincena != null ? String(quincena) : null, {
            timeline_title: 'Quincena cerrada', dimension: 'HR',
            new_value: `${ids.length} días aprobados`, count: ids.length, ...resto,
        });
}

export function fetchEmployeeExceptions(employeeId) {
    return supabase.from('employees').select('id, exceptions').eq('id', employeeId).single();
}
