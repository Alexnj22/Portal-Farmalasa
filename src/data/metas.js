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

// ── Fase 2: el flujo de confirmación ─────────────────────────────────────────
// Las filas con su id y estado, directo de la tabla (SELECT para authenticated;
// las escrituras solo pasan por los RPC de abajo). Pocos meses → pocas filas.
export async function fetchMetasRows(yearMonths) {
    const { data, error } = await supabase
        .from('metas_sucursal')
        .select('id, branch_id, year_month, monto_meta, monto_propuesto, estado, nota, nota_devolucion, supervisor_at, gerente_at, autorizado_por, autorizado_nota')
        .in('year_month', yearMonths);
    if (error) throw error;
    return data ?? [];
}

export async function generarPropuestas() {
    const { data, error } = await supabase.rpc('generar_propuestas_metas_manual');
    if (error) throw error;
    return data ?? 0; // cuántas se crearon
}

export async function confirmarMeta({ id, monto, nota }) {
    const { error } = await supabase.rpc('confirmar_meta_supervisor', {
        p_id: id,
        p_monto: monto ?? null,
        p_nota: nota || null,
    });
    if (error) throw error;
}

export async function aprobarMeta(id) {
    const { error } = await supabase.rpc('aprobar_meta_gerente', { p_id: id });
    if (error) throw error;
}

export async function devolverMeta({ id, nota }) {
    const { error } = await supabase.rpc('devolver_meta_gerente', { p_id: id, p_nota: nota });
    if (error) throw error;
}

// Quiénes pueden figurar como autorizantes (gerentes activos). Va por RPC y no
// por un select a `employees`: quien registra la autorización no tiene por qué
// poder leer el expediente de nadie.
export async function fetchAutorizadores() {
    const { data, error } = await supabase.rpc('get_metas_autorizadores');
    if (error) throw error;
    return data || [];
}

// Deja la meta oficial asentando que el gerente autorizó de palabra. El servidor
// guarda las DOS personas: quien ejecutó y quien autorizó, y le avisa al segundo.
export async function aprobarMetaPorAutorizacion({ id, autorizoPor, nota }) {
    const { error } = await supabase.rpc('aprobar_meta_por_autorizacion', {
        p_id: id, p_autorizo: autorizoPor, p_nota: nota,
    });
    if (error) throw error;
}

// ── Fase 3: la meta de UNA sala, para el widget del Inicio ───────────────────
// Devuelve una sola fila (o ninguna: sin permiso, sin sucursal asignada o
// Bodega). El mes lo decide el servidor —siempre el que está corriendo— y el
// scope también: con scope BRANCH el parámetro se ignora y manda su sala.
// ── Fase 4: el bono de meta, persona por persona ─────────────────────────────
// Un solo objeto JSON con la cabecera (bolsa, tramo, lo que se pierde) y el
// detalle de la sala. El mes lo manda el llamador; el scope lo impone el
// servidor igual que en el resto del módulo.
export async function fetchBonoMetaSala(branchId, yearMonth) {
    const { data, error } = await supabase.rpc('get_bono_meta_sala', {
        p_branch_id: Number(branchId),
        p_year_month: yearMonth,
    });
    if (error) throw error;
    return data ?? null;
}

export async function fetchMetaSala(branchId = null) {
    const { data, error } = await supabase.rpc('get_meta_sala', {
        p_branch_id: branchId != null ? Number(branchId) : null,
    });
    if (error) throw error;
    return data?.[0] ?? null;
}
