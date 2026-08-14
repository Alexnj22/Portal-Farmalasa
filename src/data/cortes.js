import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';
import { signPhotosDeep } from '../utils/storageFiles';

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

// Lo mínimo para calcular el tramo y clasificarlo: `conTramo` necesita
// `diferenciaDelCorte`, y ésa sale de `total_declarado`, `diferencia_erp`,
// `tk_total_caja` y `tk_cobros_credito`. Nada más.
const CAMPOS_RESUMEN = `
    id, branch_id, tipo, fecha, hora, estado,
    total_declarado, diferencia_erp, esperado, tk_total_caja, tk_cobros_credito
`;

/**
 * Los cortes de un período con las columnas justas para contarlos.
 *
 * Existe aparte de `fetchCortes` por peso: el resumen del mes son ~900 filas y
 * la fila completa tiene 40 columnas —el texto del tiquete incluido—, o sea
 * cientos de kB para pintar tres números en una baldosa del Inicio. Con las 11
 * que de verdad entran en el cálculo baja a una décima parte.
 *
 * Ojo: NO sirve para pintar la lista ni para abrir el detalle (le faltan el
 * nombre, el motivo y todo el tiquete). Es sólo para contar.
 */
export function fetchCortesResumen({ desde, hasta }) {
    return fetchAllRows(() => supabase.from('cortes_caja')
        .select(CAMPOS_RESUMEN)
        .gte('fecha', desde)
        .lte('fecha', hasta));
}

/**
 * Quién resolvió cada corte: nombre y foto, para poder mostrarlos junto a la
 * decisión. `resuelto_por` guarda el `employees.id` que puso el servidor.
 *
 * NO va contra `employees_safe`. La policy de SELECT de `employees` esconde a
 * los superusuarios de todos menos de sí mismos, y quien resuelve un corte
 * suele ser justamente un supervisor con ese rol: la tarjeta decía «Sin
 * registrar quién» sobre una decisión que sí tenía autor. `get_cortes_
 * resolutores` es DEFINER y sólo devuelve a quien aparece como `resuelto_por`
 * de algún corte, y sólo a quien puede ver el módulo.
 *
 * Las fotos se firman: `photo_url` se guarda cruda y el bucket es privado, así
 * que pintarla tal cual da una imagen rota.
 */
export async function fetchPersonas(ids) {
    const unicos = [...new Set((ids || []).filter(Boolean))];
    if (!unicos.length) return [];
    const { data, error } = await supabase.rpc('get_cortes_resolutores', { p_ids: unicos });
    if (error) { console.error('cortes: fetchPersonas failed:', error.message); return []; }
    await signPhotosDeep(data || []);
    return data || [];
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
