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
        .select('id, branch_id, year_month, monto_meta, monto_base, monto_recuperacion, monto_propuesto, estado, nota, nota_devolucion, supervisor_at, gerente_at, autorizado_por, autorizado_nota')
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

// Confirma varias de una vez. Va en UNA transacción del lado del servidor: si
// alguna falla no quedan la mitad confirmadas.
export async function confirmarMetasLote(items) {
    const { data, error } = await supabase.rpc('confirmar_metas_lote', { p_items: items });
    if (error) throw error;
    return data ?? 0;
}

export async function aprobarMeta(id) {
    const { error } = await supabase.rpc('aprobar_meta_gerente', { p_id: id });
    if (error) throw error;
}

// Aprueba varias de una vez, en UNA transacción: si alguna falla no quedan la
// mitad oficiales. Igual que `confirmarMetasLote`, del otro lado del flujo.
export async function aprobarMetasLote(ids) {
    const { data, error } = await supabase.rpc('aprobar_metas_lote', { p_ids: ids });
    if (error) throw error;
    return data ?? 0;
}

// Lo mismo por el camino de la autorización verbal: se pregunta UNA vez quién
// autorizó y cómo, y se aplica a todas. Cada meta conserva su propio renglón en
// la bitácora y su propio aviso a quien autorizó.
export async function aprobarMetasPorAutorizacionLote({ ids, autorizoPor, nota }) {
    const { data, error } = await supabase.rpc('aprobar_metas_por_autorizacion_lote', {
        p_ids: ids, p_autorizo: autorizoPor, p_nota: nota,
    });
    if (error) throw error;
    return data ?? 0;
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

// ── Gastos por recuperar ─────────────────────────────────────────────────────
// Un gasto se carga a una o varias salas y se suma a su meta convertido a venta
// por el margen de ganancia: $1,000 ÷ 0.25 = $4,000. El reparto en meses y el
// margen los resuelve el servidor — acá no se calcula nada.

export async function fetchMetasGastos() {
    const { data, error } = await supabase.rpc('get_metas_gastos');
    if (error) throw error;
    return data ?? [];
}

// El desglose mes × sala ANTES de guardar. Sale del mismo `metas_gasto_reparto`
// que usa el alta, así que la vista previa no puede divergir de lo que se
// guarda — que es exactamente cómo un día divergen dos cálculos gemelos.
export async function previewMetaGasto({ salas, ymInicio, meses }) {
    const { data, error } = await supabase.rpc('preview_metas_gasto', {
        p_salas: salas, p_ym_inicio: ymInicio, p_meses: meses,
    });
    if (error) throw error;
    return data ?? null;
}

export async function crearMetaGasto({ concepto, salas, ymInicio, meses, nota }) {
    const { data, error } = await supabase.rpc('crear_metas_gasto', {
        p_concepto: concepto, p_salas: salas, p_ym_inicio: ymInicio,
        p_meses: meses, p_nota: nota || null,
    });
    if (error) throw error;
    return data;
}

export async function anularMetaGasto({ id, nota }) {
    const { data, error } = await supabase.rpc('anular_metas_gasto', { p_id: id, p_nota: nota });
    if (error) throw error;
    return data;
}

export async function fetchMetaSala(branchId = null) {
    const { data, error } = await supabase.rpc('get_meta_sala', {
        p_branch_id: branchId != null ? Number(branchId) : null,
    });
    if (error) throw error;
    return data?.[0] ?? null;
}
