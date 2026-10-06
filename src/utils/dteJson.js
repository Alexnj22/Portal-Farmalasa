/**
 * Lo que se lee del JSON de un documento tributario electrónico: sus renglones
 * y los totales del resumen. El esquema es el de Hacienda —`cuerpoDocumento`,
 * `resumen`—, el mismo para facturas de compra y de venta.
 *
 * Nació el 2026-10-05 para la app: en el teléfono la ficha de una factura de
 * compra tenía que mostrar LOS PRODUCTOS (reporte de sala del 2026-08-20: «no
 * puedo ver los productos, no puedo ver el pdf»), y el texto plano
 * `items_text` mezcla código, lote y vencimiento en una sola línea.
 *
 * Nunca lanza: un JSON raro devuelve lo que se pudo leer, y vacío si nada.
 */

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Los renglones: `{ numero, codigo, descripcion, cantidad, unidad, precio, descuento, total }`. */
export function renglonesDelDte(doc) {
    const cuerpo = Array.isArray(doc?.cuerpoDocumento) ? doc.cuerpoDocumento : [];
    return cuerpo.map((r, i) => {
        const total = [r.ventaGravada, r.ventaExenta, r.ventaNoSuj].map(num).filter((x) => x != null).reduce((a, b) => a + b, 0);
        return {
            numero: num(r.numItem) ?? i + 1,
            codigo: r.codigo ?? null,
            descripcion: String(r.descripcion ?? '').replace(/\s+/g, ' ').trim() || 'Sin descripción',
            cantidad: num(r.cantidad),
            unidad: num(r.uniMedida),
            precio: num(r.precioUni),
            descuento: num(r.montoDescu) || 0,
            total: Math.round(total * 100) / 100,
        };
    });
}

/** Los totales del resumen que se muestran: gravado, exento, IVA, descuentos y a pagar. */
export function totalesDelDte(doc) {
    const r = doc?.resumen || {};
    const iva = num(r.totalIva) ?? (Array.isArray(r.tributos) ? r.tributos.filter((t) => t.codigo === '20').reduce((a, t) => a + (num(t.valor) || 0), 0) : null);
    return {
        gravado: num(r.totalGravada),
        exento: num(r.totalExenta),
        noSujeto: num(r.totalNoSuj),
        descuento: num(r.totalDescu),
        iva,
        retencion: num(r.ivaRete1),
        percepcion: num(r.ivaPerci1),
        total: num(r.totalPagar) ?? num(r.montoTotalOperacion),
    };
}
