// Lo puro de GENERAR un pedido: qué lotes se toman (FEFO) y el código de cada
// sala. Vivía en `pedidoPrint`, que carga pdfmake bajo demanda; la app del
// teléfono genera pedidos sin imprimir, así que no puede arrastrar ese módulo.
// `pedidoPrint` lo reexporta: sus importadores no cambian.
import { ERP_CODIGOS } from '../constants/erp';

const TOTAL_NON_BODEGA = 6;

/** Los lotes que se toman, en orden de vencimiento, hasta cubrir `qty` packs. */
export function fefoProject(lotes, qty) {
    if (!lotes || !lotes.length || qty <= 0) return [];
    let rem = qty;
    const result = [];
    for (const lot of lotes) {
        if (rem <= 0) break;
        const take = Math.min(Number(lot.packs), rem);
        if (take > 0) { result.push({ ...lot, take }); rem -= take; }
    }
    return result;
}

// countsBySuc: { [erp_sucursal_id]: numero_mensual_por_sucursal }
export function buildPedidoCodigo(countsBySuc, date, nSelected) {
    const d      = date instanceof Date ? date : new Date();
    const dd     = String(d.getDate()).padStart(2, '0');
    const mm     = String(d.getMonth() + 1).padStart(2, '0');
    const yy     = String(d.getFullYear()).slice(-2);
    const aabbcc = `${dd}${mm}${yy}`;
    const dist   = nSelected >= TOTAL_NON_BODEGA ? '3' : nSelected > 1 ? '2' : '1';
    return (sucId) => {
        const nn = String(countsBySuc[sucId] ?? 1).padStart(2, '0');
        return `${nn}-${aabbcc}-${dist}-${ERP_CODIGOS[sucId] ?? `S${sucId}`}`;
    };
}
