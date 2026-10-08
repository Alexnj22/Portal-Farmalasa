// Hasta cuándo se puede mandar a Bodega un lote que vence, para que el
// proveedor lo reciba de vuelta — la regla (g) de Bodega, que vivía dentro de
// `views/productos/tabminmax/ExpandedPanel.jsx` y se mudó el 2026-10-06 para
// que la ficha de Min·Máx del teléfono avise igual.
//
// La cuenta regresiva es sobre la POLÍTICA en meses, no sobre el mes de
// vencimiento: el envío llega ~1 mes después de mandarse (regla h: se manda
// del 25 al 30 y llega en la primera quincena del mes siguiente). Ej.: vence
// en diciembre, política de 2 meses → el límite es la última semana de
// SEPTIEMBRE, no octubre.
export function limiteDeEnvioABodega(fechaVencimiento, mesesDevolucion) {
    const d = new Date(fechaVencimiento);
    d.setMonth(d.getMonth() - (mesesDevolucion + 1));
    d.setDate(25);
    return d;
}

/**
 * Qué decir de un lote por vencer según la política del producto:
 *  · devolutivo con meses → el límite de envío y si ya pasó;
 *  · no devolutivo (ND) → avisar al jefe a partir de ~7 meses antes.
 */
export function avisoDeLote(lote, politica, ahora = new Date()) {
    const dias = Math.ceil((new Date(lote.fecha_vencimiento).getTime() - new Date(ahora).getTime()) / 86400000);
    const limite = politica?.es_devolutivo && politica?.meses_devolucion != null
        ? limiteDeEnvioABodega(lote.fecha_vencimiento, politica.meses_devolucion) : null;
    return {
        dias,
        urgente: dias <= 30,
        limite,
        fueraDePlazo: limite ? ahora > limite : false,
        reportarND: !!politica && !politica.es_devolutivo && dias <= 210,
    };
}
