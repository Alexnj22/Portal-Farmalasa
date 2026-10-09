// La configuración GLOBAL de Mín·Máx (`stock_config`): qué se valida antes de
// guardar y qué se escribe. Vivía dentro de `ConfigPanel` (portal); sale al
// núcleo para que el teléfono rechace y escriba exactamente lo mismo.
//
// Ojo (CLAUDE.md §MIN·MAX): el reorden es plano para todo el catálogo, así que
// cambiar el ciclo o los días de reorden reescribe el MIN·MAX de TODOS los
// productos de todas las salas en el próximo cálculo.

/** Los campos, agrupados como en el panel del portal. */
export const SECCIONES_CONFIG_MINMAX = [
    { titulo: 'Ciclo de reposición', campos: [
        { k: 'cycle_days', label: 'MAX — días de cobertura objetivo', unit: 'días', min: 1 },
        { k: 'analysis_days', label: 'Ventana histórica de ventas', unit: 'días', min: 30 },
    ] },
    { titulo: 'MIN — días de reorden por clase XYZ', campos: [
        { k: 'reorder_x_days', label: 'Clase X — demanda estable', unit: 'días', min: 1 },
        { k: 'reorder_y_days', label: 'Clase Y — demanda moderada', unit: 'días', min: 1 },
        { k: 'reorder_z_days', label: 'Clase Z — demanda errática', unit: 'días', min: 1 },
    ] },
    { titulo: 'Umbrales XYZ (percentil de CV, por sucursal)', nota: 'Z = el resto. Relativo: compara cada producto contra sus vecinos dentro de la misma sucursal.', campos: [
        { k: 'xyz_x_percentile', label: 'X = percentil ≤', unit: '%', min: 1, max: 99 },
        { k: 'xyz_y_percentile', label: 'Y = percentil ≤', unit: '%', min: 1, max: 100 },
    ] },
    { titulo: 'Umbrales ABC (% de venta acumulada)', nota: 'C y D = el resto. Recalcula para aplicar.', campos: [
        { k: 'abc_a_pct', label: 'A = top', unit: '%', min: 1 },
        { k: 'abc_b_pct', label: 'B = hasta', unit: '%', min: 1 },
    ] },
    { titulo: 'Alerta «próximo a mínimo»', nota: 'Ej: 25% → alerta si stock < MIN × 1.25', campos: [
        { k: 'approaching_pct', label: 'Umbral (stock < MIN × (1 + X%))', unit: '%', min: 1, max: 100 },
    ] },
    { titulo: 'Buffer de seguridad (días extra al MIN)', nota: 'MIN = velocidad × (reorden + buffer). Recalcula para aplicar.', campos: [
        { k: 'buffer_x_days', label: 'Clase X — demanda estable', unit: 'días', min: 0 },
        { k: 'buffer_y_days', label: 'Clase Y — demanda moderada', unit: 'días', min: 0 },
        { k: 'buffer_z_days', label: 'Clase Z — demanda errática', unit: 'días', min: 0 },
    ] },
    { titulo: 'Ventas atípicas', campos: [
        { k: 'outlier_percentile', label: 'Percentil de corte', unit: '%', min: 50, max: 100 },
    ] },
];

/** `null` si vale; si no, el motivo. */
export function validarConfigMinMax(f) {
    if (Number(f.cycle_days) < 1) return 'El ciclo debe ser ≥ 1 día';
    if (Number(f.abc_a_pct) >= Number(f.abc_b_pct)) return 'El umbral A debe ser menor que el B';
    if (Number(f.xyz_x_percentile) >= Number(f.xyz_y_percentile)) return 'El percentil de X debe ser menor que el de Y';
    if (Number(f.xyz_y_percentile) > 100) return 'El percentil de Y no puede superar 100';
    if (Number(f.approaching_pct) < 1 || Number(f.approaching_pct) > 100) return 'Alerta próximo debe estar entre 1 y 100%';
    return null;
}

/** Lo que se escribe en `stock_config`. */
export const payloadDeConfigMinMax = (f, email = null) => ({
    cycle_days: Number(f.cycle_days),
    reorder_x_days: Number(f.reorder_x_days),
    reorder_y_days: Number(f.reorder_y_days),
    reorder_z_days: Number(f.reorder_z_days),
    xyz_x_percentile: Number(f.xyz_x_percentile),
    xyz_y_percentile: Number(f.xyz_y_percentile),
    abc_a_pct: Number(f.abc_a_pct),
    abc_b_pct: Number(f.abc_b_pct),
    analysis_days: Number(f.analysis_days),
    approaching_pct: Number(f.approaching_pct),
    buffer_x_days: Number(f.buffer_x_days),
    buffer_y_days: Number(f.buffer_y_days),
    buffer_z_days: Number(f.buffer_z_days),
    outlier_percentile: Number(f.outlier_percentile ?? 95),
    updated_at: new Date().toISOString(),
    updated_by: email,
});

/** ¿Cambió algo que reescribe el MIN·MAX de todo el catálogo? */
export const cambiaElCatalogo = (antes = {}, despues = {}) =>
    ['cycle_days', 'reorder_x_days', 'reorder_y_days', 'reorder_z_days', 'buffer_x_days', 'buffer_y_days', 'buffer_z_days', 'analysis_days', 'outlier_percentile']
        .some(k => Number(antes[k]) !== Number(despues[k]));
