import { supabase } from '../supabaseClient';

// Metas por sala (Fase 1 — docs/PLAN-METAS-2026-08-03.md). Los tres RPC
// devuelven pocas filas (6 salas × meses), así que no hay paginación que
// cuidar. La base es el total facturado (con IVA), la misma del corte del día.

export async function fetchMetasDashboard(yearMonth) {
    const { data, error } = await supabase.rpc('get_metas_dashboard', {
        p_year_month: yearMonth,
    });
    if (error) throw error;
    return data ?? [];
}

export async function fetchMetasHistorico() {
    const { data, error } = await supabase.rpc('get_metas_historico');
    if (error) throw error;
    return data ?? [];
}

export async function guardarMetaManual({ branchId, yearMonth, monto, nota }) {
    const { error } = await supabase.rpc('upsert_meta_manual', {
        p_branch_id: Number(branchId),
        p_year_month: yearMonth,
        p_monto: monto,
        p_nota: nota || null,
    });
    if (error) throw error;
}

// Una sola fila: umbrales del bono y el interruptor de bonificaciones
// (hoy apagado — el tramo se muestra solo como referencia).
export async function fetchMetasConfig() {
    const { data, error } = await supabase.from('metas_config').select('*').limit(1).single();
    if (error) throw error;
    return data;
}
