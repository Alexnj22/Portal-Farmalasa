import { supabase } from '../supabaseClient';

/**
 * La liquidación mensual de bonos — Fase 5 de `docs/PLAN-PROMOCIONES-2026-09-01.md`.
 *
 * Junta en una hoja el bono de meta, los de promociones por producto, los de
 * laboratorio y los excedentes aprobados. Todo el cálculo vive en la base: cruza
 * las ventas del mes contra tres programas distintos y traerlo al navegador
 * sería pedir el techo de las 1000 filas y perder.
 */

/** La hoja de un mes. Un mes sin armar devuelve la cabecera con `existe: false`. */
export async function fetchLiquidacion(mes) {
    const { data, error } = await supabase.rpc('get_liquidacion', {
        p_year_month: mes,
    });
    if (error) throw error;
    return data ?? null;
}

/** Los meses que ya se armaron, para saber dónde hay algo. */
export async function fetchLiquidaciones() {
    const { data, error } = await supabase.rpc('get_liquidaciones');
    if (error) throw error;
    return data ?? [];
}

/**
 * Rehace el detalle del mes y devuelve la hoja.
 *
 * Rehace ENTERO, no incremental: lo que cambia son ventas de un mes que ya
 * pasó, y la respuesta correcta a eso es volver a preguntar. Un mes aprobado
 * lo rechaza la base.
 */
export async function calcularLiquidacion(mes) {
    const { data, error } = await supabase.rpc('calcular_liquidacion', {
        p_year_month: mes,
    });
    if (error) throw error;
    return data ?? null;
}

/** Congela el mes, o lo devuelve a borrador — reabrir EXIGE motivo. */
export async function aprobarLiquidacion(mes, aprobar = true, nota = null) {
    const { data, error } = await supabase.rpc('aprobar_liquidacion', {
        p_year_month: mes,
        p_aprobar: aprobar,
        p_nota: nota || null,
    });
    if (error) throw error;
    return data ?? null;
}
