// Bloque 6.A — capa de datos, entidad "schedules" (cobertura entre
// sucursales + estadísticas de ventas por hora). Extraído de
// SchedulesView.jsx: 8 llamadas supabase.from(). 3 de los 8 sitios
// (employee_rosters) reutilizan fetchRostersForWeekByEmployees de
// data/requests.js y upsertWeeklyRoster/upsertBulkWeeklyRosters de
// data/system.js — mismos queries exactos, no se duplican.
import { supabase } from '../supabaseClient';

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
