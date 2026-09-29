// Los números de la venta en pantalla, sacados del MISMO motor que arma el
// documento para Hacienda (`supabase/functions/_shared/dte/calculos.ts`).
//
// Antes la pantalla hacía su propia cuenta —subtotal sin IVA + IVA redondeado—
// y el documento otra —suma de renglones con IVA—: cobraba $32.40 sobre un
// papel que decía $32.39. Hacienda tolera ±$0.01, pero la caja no: el vendedor
// liquidaba un centavo de más o de menos por venta. Con un solo motor la
// pantalla, el ticket, el PDF y el documento dicen el mismo número por
// construcción.
//
// Los precios llegan CON IVA en centavos (así se guardan, borrador 0007) y el
// motor los lleva a la base de cada documento: con IVA en la Factura, sin IVA
// a 8 decimales en el Crédito Fiscal.
import { calcularRenglon, calcularResumen } from '../../../supabase/functions/_shared/dte/calculos.ts';
import { aCentavos, dec, mul, div, num } from '../../../supabase/functions/_shared/dte/decimal.ts';

const UNO_TRECE = dec('1.13');

/**
 * El descuento de un renglón, CON IVA, como lo guarda la base:
 *   · en %: a centavos (el trigger hace el mismo redondeo);
 *   · en $: lo escrito, llevado a con IVA si el precio que se ve es sin IVA.
 */
export function descuentoConIva({ tipo, valor, cantidad, precioConIva, conIva }) {
    const v = Number(valor);
    if (!Number.isFinite(v) || v <= 0 || !(cantidad > 0)) return 0;
    if (tipo === 'pct') return num(aCentavos(div(mul(mul(dec(cantidad), dec(precioConIva)), dec(v)), dec(100))));
    return conIva ? v : num(mul(dec(v), UNO_TRECE));
}

/**
 * Calcula la venta como la calcularía el documento.
 * `lineas`: [{ cantidad, precioConIva, descuentoConIva }]. Devuelve los
 * renglones en la base del documento y el resumen, o `error` si el motor
 * rechaza algo (un descuento mayor que el importe, por ejemplo).
 */
export function calcularVenta(lineas, { tipoDoc, retiene1 = false, percibe1 = false }) {
    const base = tipoDoc === '01' ? 'con_iva' : 'sin_iva';
    const vacio = { renglones: [], suma: 0, descuentos: 0, iva: 0, retencion: 0, percepcion: 0, total: 0, error: null };
    if (!lineas.length) return vacio;
    try {
        const calc = lineas.map(l => calcularRenglon({
            cantidad: l.cantidad, precio: l.precioConIva, precioIncluyeIva: true, descuento: l.descuentoConIva || 0,
        }, base));
        const res = calcularResumen(calc, base, { retiene1, percibe1 });
        return {
            renglones: calc.map(c => ({
                precioUni: num(c.precioUni),
                bruto: num(mul(c.cantidad, c.precioUni)),
                descuento: num(c.montoDescu),
                importe: num(c.ventaGravada),
            })),
            suma: num(res.subTotalVentas + res.totalDescu),
            descuentos: num(res.totalDescu),
            iva: num(res.iva),
            retencion: num(res.ivaRete),
            percepcion: num(res.ivaPerci),
            total: num(res.totalPagar),
            error: null,
        };
    } catch (e) {
        return { ...vacio, error: e.message };
    }
}

/**
 * El total de una preventa guardada (renglones con IVA, como los deja la base).
 * Sin la retención del 1%: ésa la decide el documento con la ficha del cliente.
 */
export function totalDePedido(pedido) {
    const items = pedido?.dist_pedido_items ?? [];
    if (!items.length) return 0;
    return calcularVenta(items.map(i => ({
        cantidad: Number(i.cantidad), precioConIva: Number(i.precio_con_iva), descuentoConIva: Number(i.descuento) || 0,
    })), { tipoDoc: pedido.tipo_documento ?? '01' }).total;
}
