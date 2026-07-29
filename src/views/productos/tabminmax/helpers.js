// Extracted from TabMinMax.jsx (Bloque 6.C) — shared by the main tab and its
// extracted sub-components, kept here so neither side duplicates the other.

// Normalize legacy demand_variability values → X/Y/Z
export const normXyz = (v) => ({ stable: 'X', moderate: 'Y', erratic: 'Z' }[v] ?? v ?? 'X');

// Traduce el error crudo de Postgres a algo que se pueda leer. Vive acá y no
// dentro del hook porque las solicitudes (TabMinMaxRequests) muestran los
// mismos errores que el guardado.
export const translateDbError = (msg) => {
    if (!msg) return 'Error desconocido';
    // Los tres CHECK del par MIN/MAX (F1.2/F1.3) van primero: son los que un
    // usuario puede provocar escribiendo, y "valor fuera del rango permitido"
    // no le dice qué corregir.
    if (/psp_draft_pair_valid|chk_min_lt_max|psp_calc_max_gte_min|mmcr_pair_valid/i.test(msg))
        return 'MIN y MAX no forman un par válido: con MIN ≥ 1, el MAX debe ser mayor; con MIN 0, el MAX solo puede ser 0 o 1.';
    if (/MODULE_LOCKED/i.test(msg))
        return 'El módulo está en mantenimiento: por ahora es solo lectura.';
    if (/statement timeout|canceling statement/i.test(msg))
        return 'La consulta tardó demasiado. Intenta nuevamente.';
    if (/row-level security/i.test(msg))
        return 'Sin permisos para esta operación.';
    if (/unique constraint/i.test(msg))
        return 'Ya existe un registro con esos datos.';
    if (/foreign key constraint/i.test(msg))
        return 'No se puede eliminar: hay registros relacionados.';
    if (/not-null constraint/i.test(msg))
        return 'Falta un campo requerido.';
    if (/check constraint/i.test(msg))
        return 'Valor fuera del rango permitido.';
    return msg;
};

// Riesgo de regla de despacho: el MAX efectivo (publicado + manual), llevado
// a la unidad de despacho del producto (factor de presentación de la regla ×
// múltiplo), redondea a 0 incluso en el mejor caso posible (repunte completo
// desde stock 0 hasta MAX). Si eso pasa, este producto NUNCA va a generar un
// pedido real con su MIN/MAX actual — hay que bajarlo a 0/0 o subir el MAX
// para que supere el umbral. Mismo umbral del 40% que usa get_pedido_preview
// para decidir si reponer una unidad completa. Solo aplica a productos con
// regla de despacho explícita (dispatch_pres_factor no nulo) — el resto no
// se marca. Se calcula al vuelo con datos que ya trae get_stock_analysis,
// sin tocar la RPC.
export function hasDispatchRisk(maxValue, dispatchPresFactor, dispatchMultiplo) {
    if (!dispatchPresFactor || !maxValue || maxValue <= 0) return false;
    const unitBase = dispatchPresFactor * (dispatchMultiplo || 1);
    if (!unitBase) return false;
    const whole = Math.floor(maxValue / unitBase);
    const remainder = maxValue % unitBase;
    const rounded = whole + (remainder >= 0.4 * unitBase ? 1 : 0);
    return rounded === 0;
}

export function fmtMoney(n) {
    const v = Number(n) || 0;
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 100_000)   return `$${Math.round(v / 1000)}k`;
    if (v >= 1_000)     return `$${(v / 1000).toFixed(1)}k`;
    return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function sortedPres(presentations) {
    return [...new Map((presentations || []).map(p => [p.factor, p])).values()]
        .filter(p => p.factor > 1).sort((a, b) => b.factor - a.factor);
}

export function smallestPres(presentations) {
    const all = presentations || [];
    const unit = all.find(p => p.factor === 1);
    return unit ?? ([...all].sort((a, b) => a.factor - b.factor)[0] ?? null);
}

export function formatUnits(units, presentations) {
    const n = Number(units);
    if (n === 0) return '0';
    const pres = sortedPres(presentations);
    if (!pres.length) return `${n.toLocaleString()} und`;
    let rem = n;
    const parts = [];
    for (const { tipo, factor } of pres) {
        if (rem >= factor) { parts.push(`${Math.floor(rem / factor)} ${tipo.trim()}`); rem %= factor; }
    }
    if (rem > 0) parts.push(`${rem} und`);
    return parts.length ? parts.join(' + ') : `${n.toLocaleString()} und`;
}

export function formatDominant(units, presentations) {
    const n = Number(units);
    if (!n) return '0';
    const pres = sortedPres(presentations);
    if (!pres.length) return `${n.toLocaleString()} und`;
    const { tipo, factor } = pres[0];
    // ceil: boxes are indivisible — always round up so the displayed quantity covers the unit threshold
    return `≥${Math.ceil(n / factor)} ${tipo.trim()}`;
}
