// Rebajas en las ventas: de campaña o a mano (PENDIENTES 30, 2026-10-29).
// La clasificación la hace la base (`rebajas_en_ventas`); acá sólo el mes que
// se mira y lo que se exporta.
import { shortEmployeeName } from './nameUtils';
import { formatMoney } from './formatNumber';

/** Cómo descuenta una campaña, dicho como lo aplica la venta. */
export function comoDescuenta(c) {
    return c?.tipo === '%' ? `${Number(c.monto)} %` : `${formatMoney(c.monto)} por unidad`;
}

/** El CSV de lo que se mira: las campañas o las rebajas a mano. */
export function csvRebajas(vista, { porCampana, aMano }, periodo, salaDe = () => '') {
    if (vista === 'campana') {
        return {
            nombre: `rebajas-por-campana-${periodo}`,
            headers: ['CAMPAÑA', 'DESCUENTO', 'DESDE', 'HASTA', 'VENTAS', 'UNIDADES', 'COBRADO', 'REBAJADO'],
            rows: porCampana.map((c) => [c.descripcion, comoDescuenta(c), c.inicio, c.fin, c.renglones,
                Number(c.unidades), Number(c.cobrado).toFixed(2), Number(c.rebajado).toFixed(2)]),
        };
    }
    return {
        nombre: `rebajas-a-mano-${periodo}`,
        headers: ['FECHA', 'SUCURSAL', 'DOCUMENTO', 'VENDEDOR', 'PRODUCTO', 'CANTIDAD', 'PRECIO', 'COBRADO', 'REBAJA', '%'],
        rows: aMano.map((r) => [r.fecha, salaDe(r.branch_id), r.correlativo,
            r.vendedor ? shortEmployeeName({ name: r.vendedor }) : '',
            r.producto, Number(r.cantidad), Number(r.precio).toFixed(2), Number(r.cobrado).toFixed(2),
            Number(r.rebaja).toFixed(2), r.porcentaje]),
    };
}
