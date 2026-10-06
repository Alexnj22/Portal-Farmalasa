import { dteAdmiteProveedor } from './dteTypes';

/**
 * Las tarjetas de Facturas de compra (Total, Crédito IVA, Compras netas,
 * Invalidados, Sin proveedor). Vivían en `FacturasCompraView`; se mudaron el
 * 2026-10-06 para que la app cuente lo mismo.
 *
 * Los invalidados se EXCLUYEN de los totales monetarios (Art. 119-E CT: no
 * amparan crédito fiscal) y se muestran aparte, no restados en silencio. Las
 * Notas de Crédito (tipo 05) entran en negativo — es la única corrección con
 * signo que trae el propio documento. «Sin proveedor» sólo cuenta lo que la
 * sincronización PUEDE emparejar (`dteAdmiteProveedor`).
 */
export function tarjetasDeDocumentosDeCompra(rows) {
    let totalCompras = 0, creditoFiscal = 0, comprasNetas = 0;
    let invalidadosCount = 0, invalidadosMonto = 0, sinProveedorCount = 0;
    for (const r of rows ?? []) {
        const monto = parseFloat(r.monto_total) || 0;
        const iva = parseFloat(r.total_iva) || 0;
        if (r.invalidado) {
            invalidadosCount++;
            invalidadosMonto += monto;
        } else {
            const sign = r.tipo_dte === '05' ? -1 : 1;
            totalCompras += monto;
            creditoFiscal += sign * iva;
            comprasNetas += sign * monto;
        }
        if (!r.proveedor_id && dteAdmiteProveedor(r.tipo_dte)) sinProveedorCount++;
    }
    return { totalCompras, creditoFiscal, comprasNetas, invalidadosCount, invalidadosMonto, sinProveedorCount };
}
