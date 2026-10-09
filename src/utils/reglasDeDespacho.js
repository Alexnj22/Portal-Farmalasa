// Las reglas de despacho de un producto (en qué presentación, de a cuánto y
// con qué etiqueta sale de Bodega): lo que el editor ofrece, lo que guarda y
// cómo se lee.
//
// Vivía dentro de `TabReglas` (portal). Sale al núcleo para que el teléfono
// edite la MISMA regla: mismo payload, mismas presentaciones ofrecidas y el
// mismo ejemplo de «cuánto se despacha».

/** Los múltiplos de un toque; cualquier otro se escribe. */
export const MULTIPLOS = [1, 2, 3, 5, 10, 25, 50];
/** Cómo se lista en el papel una caja física grande (Electrolit, sueros). */
export const ETIQUETAS_DE_DESPACHO = ['CAJA', 'ESTUCHE', 'BOLSA'];
/** Los valores del editor cuando el producto no tiene regla. */
export const SIN_REGLA = { dispatch_id_presentacion: null, dispatch_multiplo: '1', notes: '', dispatch_label: '', caja_especial: false };

/** Necesidad de ejemplo para mostrar el efecto de la regla. */
export const NECESIDAD_EJEMPLO = 7;

/** Cuánto se despacha ante la necesidad de ejemplo — la misma cuenta del pedido. */
export function calcularDespacho(multiplo, etiqueta, necesidad = NECESIDAD_EJEMPLO) {
    const m = multiplo > 0 ? multiplo : 1;
    const porEtiqueta = !!etiqueta && m > 1;
    return {
        porEtiqueta,
        cantidad: porEtiqueta ? Math.ceil(necesidad / m) : Math.ceil(necesidad / m) * m,
    };
}

/** Los valores del editor a partir de la regla guardada. */
export const valoresDeRegla = (rule) => ({
    dispatch_id_presentacion: rule?.dispatch_id_presentacion ?? null,
    dispatch_multiplo:        String(rule?.dispatch_multiplo ?? 1),
    notes:                    rule?.notes ?? '',
    dispatch_label:           rule?.dispatch_label ?? '',
    caja_especial:            rule?.caja_especial ?? false,
});

/** Lo que se escribe en `dispatch_rules`. */
export const payloadDeRegla = (productId, v) => ({
    erp_product_id:           productId,
    dispatch_id_presentacion: v.dispatch_id_presentacion,
    dispatch_multiplo:        Number(v.dispatch_multiplo) || 1,
    dispatch_label:           v.dispatch_label || null,
    caja_especial:            v.caja_especial ?? false,
    solo_cajas:               false,   // NOT NULL en la base
    multiplo:                 null,
    blister:                  null,
    multiplo_unidades:        null,
    notes:                    v.notes || null,
    updated_at:               new Date().toISOString(),
});

/**
 * Las presentaciones que se ofrecen: una por factor (no tiene sentido elegir
 * entre dos «×10» distintas), conservando la de la regla vigente, de la más
 * grande a la más chica.
 */
export function presentacionesOfrecidas(presentaciones = [], idVigente = null) {
    const vistas = new Set();
    const unicas = presentaciones.filter(p => (vistas.has(p.id_presentacion) ? false : (vistas.add(p.id_presentacion), true)));
    const porFactor = new Map();
    for (const p of unicas) {
        if (!porFactor.has(p.factor)) porFactor.set(p.factor, p);
        if (p.id_presentacion === idVigente) porFactor.set(p.factor, p);
    }
    return [...porFactor.values()].sort((a, b) => b.factor - a.factor);
}

/** Cómo se lee una regla en la lista («CAJA ×5», «×2 cajas» las viejas…). */
export function rotuloDeRegla(rule) {
    if (!rule) return null;
    if (rule.dispatch_id_presentacion) {
        const tipo = rule.dispatch_label || rule.dispatch_tipo || rule.presentaciones?.tipo || '–';
        const mult = rule.dispatch_multiplo ?? 1;
        return mult > 1 ? `${tipo} ×${mult}` : tipo;
    }
    if (rule.multiplo != null) return `×${rule.multiplo} cajas`;
    if (rule.blister != null) return `×${rule.blister} blíst.`;
    if (rule.multiplo_unidades != null) return `×${rule.multiplo_unidades}u`;
    return 'Solo cajas';
}
