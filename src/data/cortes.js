import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';

// Cortes de caja — lectura para CortesView y el widget del Inicio.
//
// `esperado` es columna GENERATED (`total_declarado - diferencia_erp`): es lo
// que el sistema de origen esperaba al abrir el formulario del corte. NO es
// siempre la cifra buena — cuenta mal los cobros de crédito, ver
// `utils/cortesDiagnostico.js`.

const CAMPOS = `
    id, branch_id, erp_corte_id, tipo, fecha, hora, turno, empleado_texto,
    total_declarado, diferencia_erp, esperado,
    tk_venta, tk_ingresos, tk_subtotal, tk_vales, tk_cobros_credito,
    tk_total_caja, tk_retencion, tk_devoluciones, tk_tarjeta, tk_credito,
    estado, motivo_descarte, observaciones, resuelto_por, resuelto_at,
    capturado_at, desfase_seg
`;

/**
 * Cortes de un rango de fechas, de todas las salas que la sesión pueda ver.
 *
 * Va por `fetchAllRows`: son ~30 cortes por día y el tope de PostgREST son
 * 1000, así que a partir de un mes de rango truncaría en silencio — y el
 * síntoma sería un día que "no tiene cortes", que se lee como si la sala no
 * hubiera cortado.
 */
export function fetchCortes({ desde, hasta }) {
    return fetchAllRows(() => supabase.from('cortes_caja')
        .select(CAMPOS)
        .gte('fecha', desde)
        .lte('fecha', hasta)
        .order('fecha', { ascending: false })
        .order('branch_id', { ascending: true })
        .order('hora', { ascending: true }));
}

/**
 * Movimientos de caja de UNA sala en UN día — los vales y los ingresos.
 *
 * Se piden al abrir el detalle de un corte y no junto con la lista: son unas
 * 300 filas por día y sólo hacen falta para explicar una diferencia, que es lo
 * que dijo el usuario que son («los movimientos sirven para validar ante una
 * diferencia»). Traerlos para un mes entero sería cargar miles de filas que
 * nadie mira.
 */
export function fetchMovimientos({ branchId, fecha }) {
    return fetchAllRows(() => supabase.from('cortes_caja_movimientos')
        .select('id, branch_id, erp_movimiento_id, concepto, monto, tipo')
        .eq('branch_id', branchId)
        .eq('fecha', fecha)
        .order('monto', { ascending: false }));
}

/**
 * Confirmar o descartar. El RPC valida permiso, alcance de sucursal, que sea un
 * corte de caja (el cierre del día no se confirma) y que siga pendiente; la
 * autoría la pone el servidor, no el navegador.
 */
export function resolverCorte(id, estado, { motivo = null, observaciones = null } = {}) {
    return supabase.rpc('resolver_corte_caja', {
        p_id: id,
        p_estado: estado,
        p_motivo: motivo,
        p_observaciones: observaciones,
    });
}
