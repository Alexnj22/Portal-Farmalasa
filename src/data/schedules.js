// Bloque 6.A — capa de datos, entidad "schedules" (cobertura entre
// sucursales + estadísticas de ventas por hora). Extraído de
// SchedulesView.jsx: 8 llamadas supabase.from(). 3 de los 8 sitios
// (employee_rosters) reutilizan fetchRostersForWeekByEmployees de
// data/requests.js y upsertWeeklyRoster/upsertBulkWeeklyRosters de
// data/system.js — mismos queries exactos, no se duplican.
import { supabase } from '../supabaseClient';

// ── Horarios de la semana ────────────────────────────────────────────────────

/** Los horarios de UNA sala en UNA semana.
 *
 *  Antes esto era `select('*').eq('week_start_date', …)` sin filtro de
 *  sucursal: bajaba los horarios de las OCHO salas —con el `jsonb` completo de
 *  cada persona— para pintar una sola. Y el efecto que lo llamaba tenía la sala
 *  en sus dependencias, así que cambiar de sala volvía a bajar lo mismo. */
export function fetchHorariosDeLaSemana(weekStart, branchId) {
    return supabase.rpc('horarios_de_la_semana', {
        p_week_start: weekStart,
        p_branch_id: Number(branchId),
    });
}

/** Escribe UN día del horario. No toca el estado de publicación ni pisa los
 *  otros días — ver la migración `guardar_un_dia_no_despublica_la_semana`. */
export function guardarDiaDeHorario(employeeId, weekStart, dia, datos) {
    return supabase.rpc('guardar_dia_de_horario', {
        p_employee_id: employeeId,
        p_week_start: weekStart,
        p_dia: String(dia),
        p_datos: datos,
    });
}

/** Publica los horarios en borrador de una sala. Devuelve CUÁNTOS publicó, y es
 *  repetible: lo que ya estaba publicado no se toca. */
export function publicarHorariosDeSala(weekStart, branchId) {
    return supabase.rpc('publicar_horarios_de_sala', {
        p_week_start: weekStart,
        p_branch_id: Number(branchId),
    });
}

export function fetchScheduleCoverageAtBranch(branchId, weekStart) {
    return supabase.from('schedule_coverage')
        .select('*')
        .eq('coverage_branch_id', branchId)
        .eq('week_start_date', weekStart);
}

export function fetchScheduleCoverageFromBranch(employeeIds, weekStart) {
    return supabase.from('schedule_coverage')
        .select('employee_id, coverage_branch_id, day_of_week')
        .in('employee_id', employeeIds)
        .eq('week_start_date', weekStart);
}

export function fetchBranchHourlySales(branchId, sinceDateStr) {
    return supabase.from('branch_hourly_sales')
        .select('*')
        .eq('branch_id', branchId)
        .gte('sale_date', sinceDateStr);
}

// FormWfmAnalytics.jsx — mismo filtro base que fetchBranchHourlySales pero
// con order+limit (10000, la vista analítica pagina distinto que SchedulesView).
export function fetchBranchHourlySalesOrdered(branchId, sinceDateStr, limit) {
    return supabase.from('branch_hourly_sales')
        .select('*')
        .eq('branch_id', branchId)
        .gte('sale_date', sinceDateStr)
        .order('sale_date', { ascending: false })
        .limit(limit);
}

// TabStaff.jsx — historial completo (sin filtro de fecha), columnas reducidas.
export function fetchBranchHourlySalesAll(branchId) {
    return supabase.from('branch_hourly_sales')
        .select('sale_date, sale_hour, total_sales')
        .eq('branch_id', branchId);
}

export function deleteScheduleCoverage(employeeId, branchId, weekStart) {
    return supabase.from('schedule_coverage')
        .delete()
        .eq('employee_id', employeeId)
        .eq('coverage_branch_id', branchId)
        .eq('week_start_date', weekStart);
}

export function upsertScheduleCoverage(entry) {
    return supabase.from('schedule_coverage').upsert(entry, {
        onConflict: 'employee_id,coverage_branch_id,week_start_date,day_of_week',
    });
}
