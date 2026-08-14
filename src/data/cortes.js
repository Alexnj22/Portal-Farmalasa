import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';

// Cortes de caja — lectura para CortesView.
//
// `esperado` es columna GENERATED (`total_declarado - diferencia_erp`): es lo
// que el sistema de origen esperaba EN EL MOMENTO del corte. No se recalcula
// desde los `tk_*`, porque esos los reimprime el origen mezclando la foto del
// corte con el total del día en vivo y derivan con las horas. Ver el encabezado
// de `20260814041419_cortes_de_caja_captura.sql`.

const CAMPOS = `
    id, branch_id, erp_corte_id, tipo, fecha, hora, turno, empleado_texto,
    total_declarado, diferencia_erp, esperado,
    tk_venta, tk_ingresos, tk_subtotal, tk_vales, tk_cobros_credito,
    tk_total_caja, tk_retencion, tk_devoluciones, tk_tarjeta, tk_credito,
    estado, motivo_descarte, observaciones, resuelto_por, resuelto_at,
    capturado_at, desfase_seg
`;

/** Todos los cortes de un día, de todas las salas que la sesión pueda ver. */
export function fetchCortesDelDia(fecha) {
    return supabase.from('cortes_caja')
        .select(CAMPOS)
        .eq('fecha', fecha)
        .order('branch_id', { ascending: true })
        .order('hora', { ascending: true });
}

/**
 * Movimientos de caja del día (vales e ingresos).
 *
 * Va por `fetchAllRows` aunque un día ronde las 300 filas: el tope de PostgREST
 * son 1000 y trunca sin avisar. Una sala con muchos pagos de recibos y un día
 * de cruce de mes puede acercarse, y el síntoma sería una sugerencia que
 * "no encuentra" el movimiento que explica la diferencia — o sea, silencio.
 */
export function fetchMovimientosDelDia(fecha) {
    return fetchAllRows(() => supabase.from('cortes_caja_movimientos')
        .select('id, branch_id, erp_movimiento_id, concepto, monto, tipo')
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
