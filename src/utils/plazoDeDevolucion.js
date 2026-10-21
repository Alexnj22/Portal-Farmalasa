import { correrMes, diasEntre, hoySV } from './fecha';

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
//
// Todo va en días `YYYY-MM-DD` y nunca por `new Date(fecha)`: así se leía la
// fecha como medianoche UTC —las 18:00 del día ANTERIOR en El Salvador— y un
// lote que vence el día 1 caía en el mes previo, con el límite un mes antes
// (vence 1-dic, política de 2 meses → 25-ago en vez de 25-sep). Medido el
// 2026-10-21: el 98% de los lotes con existencia vencen un día 1.
export function limiteDeEnvioABodega(fechaVencimiento, mesesDevolucion) {
    return `${correrMes(fechaVencimiento, -(mesesDevolucion + 1))}-25`;
}

/**
 * Qué decir de un lote por vencer según la política del producto:
 *  · devolutivo con meses → el límite de envío (`YYYY-MM-DD`) y si ya pasó;
 *  · no devolutivo (ND) → avisar al jefe a partir de ~7 meses antes.
 * `hoy` es el día de la sala; se pasa para probar, nunca hace falta en pantalla.
 */
export function avisoDeLote(lote, politica, hoy = hoySV()) {
    const dias = diasEntre(hoy, lote.fecha_vencimiento);
    const limite = politica?.es_devolutivo && politica?.meses_devolucion != null
        ? limiteDeEnvioABodega(lote.fecha_vencimiento, politica.meses_devolucion) : null;
    return {
        dias,
        urgente: dias <= 30,
        limite,
        fueraDePlazo: limite ? hoy > limite : false,
        reportarND: !!politica && !politica.es_devolutivo && dias <= 210,
    };
}
