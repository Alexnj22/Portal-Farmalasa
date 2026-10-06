/**
 * Qué se escribe al cambiar el par MIN·MAX de un producto en una sala — la
 * decisión de `saveDraftPair` de `hooks/useMinMaxData.js`, pura. Se mudó el
 * 2026-10-01 para que la app la use igual: guardado distinto en el teléfono
 * que en el portal, el mismo cambio sería «en vivo» en uno y «borrador» en el
 * otro.
 *
 *   · Bodega (ERP 6) guarda un DELTA sobre la suma de las salas, nunca por
 *     debajo de esa suma (`pub_min`/`pub_max`).
 *   · Una sala con datos publicados y sin borrador pendiente se edita EN VIVO;
 *     si no, va al borrador (`draft_*`, `draft_status: 'pending'`).
 *   · Poner 0·0 a un producto A o B que tenía par pide confirmación.
 *
 * `row` es la fila del análisis (`effective_min/max`, `draft_*`,
 * `draft_status`, `abc_class`, `pub_min/max`, `_erp_sucursal_id`).
 *
 * Devuelve una de:
 *   { error }               — el par no vale
 *   { confirmarCero: true } — hay que preguntar antes (A/B a 0)
 *   { sinCambio: true }
 *   { tipo: 'bodega'|'vivo'|'borrador', payload, accion, detalle }
 */
export const ERP_BODEGA_MINMAX = 6;

export function planDeGuardadoMinMax({ row, productId, sucursalId, min, max, hayPublicado, confirmado = false, ahora = new Date().toISOString() }) {
    const minNum = min === '' || min == null ? null : parseInt(min, 10);
    const maxNum = max === '' || max == null ? null : parseInt(max, 10);
    if ((Number.isNaN(minNum) && min !== '') || (Number.isNaN(maxNum) && max !== '')) return { error: 'Escribe números enteros.' };

    if (!confirmado && (minNum === 0 || minNum === null) && (maxNum === 0 || maxNum === null)) {
        const cls = row?.draft_abc_class || row?.abc_class;
        const tenia = (row?.draft_min ?? row?.effective_min ?? 0) > 0 || (row?.draft_max ?? row?.effective_max ?? 0) > 0;
        if ((cls === 'A' || cls === 'B') && tenia) return { confirmarCero: true };
    }

    if (Number(sucursalId) === ERP_BODEGA_MINMAX) {
        if (minNum === (row?.effective_min ?? 0) && maxNum === (row?.effective_max ?? 0)) return { sinCambio: true };
        const floorMin = row?.pub_min ?? 0;
        const floorMax = row?.pub_max ?? 0;
        if (floorMin > 0 && (minNum ?? 0) < floorMin) return { error: `MIN de Bodega no puede ser menor a la Σ sucursales (${floorMin.toLocaleString()})` };
        if (floorMax > 0 && (maxNum ?? 0) < floorMax) return { error: `MAX de Bodega no puede ser menor a la Σ sucursales (${floorMax.toLocaleString()})` };
        const deltaMin = minNum - floorMin > 0 ? minNum - floorMin : null;
        const deltaMax = maxNum - floorMax > 0 ? maxNum - floorMax : null;
        return {
            tipo: 'bodega', minNum, maxNum,
            payload: { erp_product_id: productId, erp_sucursal_id: ERP_BODEGA_MINMAX, manual_min: deltaMin, manual_max: deltaMax, updated_at: ahora },
            accion: 'MINMAX_BODEGA_MANUAL_OVERRIDE',
            detalle: {
                field: 'min+max', sucursal_id: ERP_BODEGA_MINMAX,
                old_min: row?.effective_min ?? 0, old_max: row?.effective_max ?? 0, new_min: minNum, new_max: maxNum,
                delta_min: deltaMin, delta_max: deltaMax, pub_sum_min: floorMin, pub_sum_max: floorMax,
            },
        };
    }

    if (minNum > 0 && maxNum > 0 && minNum >= maxNum) return { error: 'MAX debe ser mayor al MIN' };
    const vivo = hayPublicado && row?.draft_status !== 'pending' && row?.draft_status !== 'sparse_data';
    return {
        tipo: vivo ? 'vivo' : 'borrador', minNum, maxNum,
        payload: vivo
            ? { erp_product_id: productId, erp_sucursal_id: sucursalId, min_units: minNum, max_units: maxNum, draft_status: 'none', draft_min: null, draft_max: null, updated_at: ahora }
            : { erp_product_id: productId, erp_sucursal_id: sucursalId, draft_min: minNum, draft_max: maxNum, draft_status: 'pending', updated_at: ahora },
        accion: vivo ? 'MINMAX_LIVE_EDIT' : 'MINMAX_DRAFT_EDIT',
        detalle: {
            field: 'min+max', sucursal_id: sucursalId, new_min: minNum, new_max: maxNum,
            old_min: vivo ? (row?.effective_min ?? 0) : (row?.draft_min ?? row?.effective_min ?? 0),
            old_max: vivo ? (row?.effective_max ?? 0) : (row?.draft_max ?? row?.effective_max ?? 0),
        },
    };
}

/**
 * Qué se escribe al RESTAURAR el par de una sala a lo calculado — la decisión
 * de `resetToCalc` de `hooks/useMinMaxData.js`, pura (2026-10-06, para que la
 * ficha del teléfono restaure igual que el portal):
 *
 *   · Bodega: restaurar es quitar el ajuste manual; vuelve a Σ de las salas.
 *     Sin ajuste manual no hay nada que hacer.
 *   · Sin valores calculados: se limpian borrador y manual, el par queda «—».
 *   · Con calculado: EN VIVO si la sala publicó y no hay borrador pendiente;
 *     si no, al borrador.
 *
 * `row` lleva `calc_min/max`, `draft_status`, `has_manual` (o `manual_min/max`),
 * `effective_min/max` y `draft_min/max`.
 *
 * Devuelve { sinCambio } | { tipo: 'bodega'|'limpiar', patch, accion, detalle }
 *        | { tipo: 'vivo'|'borrador', payload, accion, detalle, min, max }.
 */
export function planDeRestaurarMinMax({ row, productId, sucursalId, hayPublicado, ahora = new Date().toISOString() }) {
    const tieneManual = row?.has_manual ?? (row?.manual_min != null || row?.manual_max != null);
    if (Number(sucursalId) === ERP_BODEGA_MINMAX) {
        if (!tieneManual) return { sinCambio: true };
        return {
            tipo: 'bodega',
            patch: { manual_min: null, manual_max: null, updated_at: ahora },
            accion: 'MINMAX_BODEGA_RESET_MANUAL',
            detalle: { field: 'min+max', sucursal_id: ERP_BODEGA_MINMAX, old_min: row?.effective_min ?? 0, old_max: row?.effective_max ?? 0 },
        };
    }
    if (row?.calc_min == null && row?.calc_max == null) {
        return {
            tipo: 'limpiar', min: null, max: null,
            patch: { draft_min: null, draft_max: null, draft_status: 'none', manual_min: null, manual_max: null, updated_at: ahora },
            accion: 'MINMAX_RESET_CLEAR',
            detalle: {
                field: 'min+max', sucursal_id: sucursalId,
                old_min: row?.draft_min ?? row?.effective_min ?? 0, old_max: row?.draft_max ?? row?.effective_max ?? 0,
                new_min: null, new_max: null,
            },
        };
    }
    const cMin = row.calc_min ?? 0;
    const cMax = row.calc_max ?? 0;
    const vivo = !!hayPublicado && row.draft_status !== 'pending';
    return {
        tipo: vivo ? 'vivo' : 'borrador', min: cMin, max: cMax,
        payload: vivo
            ? { erp_product_id: productId, erp_sucursal_id: sucursalId, min_units: cMin, max_units: cMax, manual_min: null, manual_max: null, updated_at: ahora }
            : { erp_product_id: productId, erp_sucursal_id: sucursalId, draft_min: cMin, draft_max: cMax, draft_status: 'pending', updated_at: ahora },
        accion: 'MINMAX_RESET_CALC',
        detalle: {
            field: 'min+max', sucursal_id: sucursalId, mode: vivo ? 'live' : 'draft',
            old_min: vivo ? (row.effective_min ?? 0) : (row.draft_min ?? row.effective_min ?? 0),
            old_max: vivo ? (row.effective_max ?? 0) : (row.draft_max ?? row.effective_max ?? 0),
            new_min: cMin, new_max: cMax, calc_min: cMin, calc_max: cMax,
        },
    };
}

/** La proyección de existencia a N días con la velocidad diaria; nunca bajo 0. */
export const proyeccionDeExistencia = (stock, velocidad, dias) => Math.max(0, Math.round((Number(stock) || 0) - (Number(velocidad) || 0) * dias));

/**
 * La proyección para PINTAR: las unidades redondeadas y si de verdad se agota.
 * «Se agota» se decide con lo que queda SIN redondear: 2 unidades a 0.06/día
 * dejan 0.2 a los 30 días — redondeado es 0, pero se agota el día 33, no antes.
 * Pintar «0 se agota» al lado de «33 días de cobertura» era contradecirse.
 */
export function estadoDeProyeccion(stock, velocidad, dias) {
    const queda = (Number(stock) || 0) - (Number(velocidad) || 0) * dias;
    return { unidades: Math.max(0, Math.round(queda)), agotado: queda <= 0, casi: queda > 0 && queda < 1 };
}

/** Cuántos días alcanza lo que hay a esta velocidad, o `null` sin venta. */
export const diasDeCobertura = (stock, velocidad) => (Number(velocidad) > 0 ? (Number(stock) || 0) / Number(velocidad) : null);
