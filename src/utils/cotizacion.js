/**
 * La aritmética de una cotización: el precio viene CON IVA (13%), y a un
 * gran contribuyente que retiene se le resta el 1% sobre la base. Vivía en
 * `CotizacionesView` y estaba escrita DOS veces —en la pantalla y en el papel
 * que se imprime—; se mudó el 2026-10-05 a una sola, la misma que usa la app.
 */
export const IVA_COTIZACION = 0.13;
export const RETENCION_COTIZACION = 0.01;
export const UMBRAL_RETENCION = 100;

/** Un precio con IVA, separado en base e impuesto, por unidad y por la cantidad. */
export function desgloseConIva(precioConIva, cantidad = 1) {
    const unitSinIva = precioConIva / (1 + IVA_COTIZACION);
    const unitIva = precioConIva - unitSinIva;
    return {
        unitSinIva, unitIva,
        subtotalSinIva: unitSinIva * cantidad,
        subtotalIva: unitIva * cantidad,
        total: precioConIva * cantidad,
    };
}

/** Los totales: bruto (con IVA), base, IVA, retención (si aplica) y total. */
export function totalesDeCotizacion(items, aplicaRetencion) {
    const gross = (items || []).reduce((s, i) => s + (parseFloat(i.subtotal) || 0), 0);
    const base = gross / (1 + IVA_COTIZACION);
    const iva = gross - base;
    const retention = aplicaRetencion ? base * RETENCION_COTIZACION : 0;
    return { gross, base, iva, retention, total: gross - retention };
}
