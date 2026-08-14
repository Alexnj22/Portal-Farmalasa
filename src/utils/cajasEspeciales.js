/**
 * Las cajas especiales de un despacho — una entrada por CAJA FÍSICA.
 *
 * Una caja especial es una **caja**, no una unidad. Un Electrolit ×12 marcado
 * como caja especial viaja como una caja: 24 botellas son **2** cajas
 * especiales, no 24. Y al sistema se le manda un traslado con las 24 unidades,
 * no 24 traslados de una — eso ya lo hace `planificar_traslado_pedido`, que
 * emite una línea por renglón con la cantidad completa.
 *
 * Antes esto se armaba con `Array.from({ length: cantidad_asignada })` en el
 * momento de finalizar, o sea **una etiqueta por unidad**. El pedido #114 (La
 * Popular, 14-ago-2026) salió con 60 etiquetas E1…E60 para 5 cajas reales, y la
 * pantalla de recepción —que armaba su propia lista, una por producto— decía 4.
 * Tres números distintos para lo mismo. De ahí que la construcción viva acá y
 * en un solo lugar: mientras cada pantalla la reconstruya a su manera, van a
 * volver a discrepar.
 *
 * El universo de `caja_especial` son dos familias, y la fórmula sirve a las dos:
 * andaderas, bastones y sillas tienen factor 1 —una unidad ES una caja, así que
 * nada cambia para ellas— y los diez sabores de Electrolit 625 ml tienen factor
 * 12.
 */

/**
 * Cuántas cajas físicas son las unidades asignadas de un renglón.
 *
 * `ceil` y no `round` porque una caja a medio llenar sigue siendo una caja que
 * alguien tiene que cargar y contar. Hoy no cambia ningún número —el múltiplo de
 * despacho obliga a cantidades exactas— pero el día que entre un parcial, `round`
 * lo desaparecería.
 */
export function cajasDeRenglon(r) {
    const unidades = r?.cantidad_asignada ?? 0;
    if (unidades <= 0) return 0;
    return Math.ceil(unidades / (Number(r?.dispatch_factor) || 1));
}

/**
 * La lista de cajas especiales de un despacho: `[{ label, pedido_item_id, … }]`,
 * numeradas E1, E2, E3… en orden de nombre de producto.
 *
 * El orden importa y por eso está fijado acá: la etiqueta es la **clave** con la
 * que después se marca una caja como dañada (`cajas_especiales_llegadas`), así
 * que si dos pantallas numeran distinto, marcar «E2 dañada» en una señala otra
 * caja en la otra.
 */
export function construirCajasEspeciales(rows) {
    let n = 1;
    return [...(rows ?? [])]
        .filter(r => r.caja_especial === true && (r.cantidad_asignada ?? 0) > 0)
        .sort((a, b) => (a.products?.nombre ?? '').localeCompare(b.products?.nombre ?? '', 'es'))
        .flatMap(r => Array.from({ length: cajasDeRenglon(r) }, () => ({
            label:          `E${n++}`,
            pedido_item_id: r.id,
            erp_product_id: r.erp_product_id,
            product_name:   r.products?.nombre ?? '',
        })));
}
