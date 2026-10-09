// El CSV de Mín·Máx de una sala (el botón «CSV» de `TabMinMax`): para una
// sala, MIN·MAX en unidades y las ventas de 6 meses; para Bodega, en la
// presentación mayor, con el inventario, la cantidad a pedir, el proveedor
// principal y una alerta de cobertura de la red (Bodega + salas).
//
// Vivía dentro de `TabMinMax` (portal); sale al núcleo para que el teléfono
// exporte el MISMO archivo.
import { applyPresRule } from './presentacion';
import { normXyz, sortedPres } from './minmaxTabla';

/** `{ headers, filas }` — `filas` con los valores crudos, una por producto. */
export function csvDeMinMax(rows, sucursalName, isBodega = false, netStockMap = {}, supplierMap = {}) {
    const sorted = isBodega
        ? [...rows].sort((a, b) => {
            const la = (a.laboratorio_nombre || '').toLowerCase();
            const lb = (b.laboratorio_nombre || '').toLowerCase();
            return la < lb ? -1 : la > lb ? 1 : (a.product_name || '').localeCompare(b.product_name || '', 'es');
          })
        : rows;
    const headers = isBodega
        ? ['Sucursal','Laboratorio','Producto','Clase','MIN','MAX','Presentación','Inventario actual','Cantidad a pedir','Proveedor','Alerta']
        : ['Sucursal','Laboratorio','Producto','Clase','MIN (und)','MAX (und)','Ventas 6 meses'];
    const filas = sorted.map(r => {
        const abc  = (r.draft_abc_class || r.abc_class || '');
        const xyz  = normXyz(r.draft_demand_variability || r.demand_variability);
        const minU = r.effective_min ?? 0;
        const maxU = r.effective_max ?? 0;
        if (isBodega) {
            const pres   = sortedPres(r.presentations || []);
            const best   = pres[0];
            const factor = best?.factor ?? 1;
            const tipo   = best ? best.tipo.trim() : 'und';
            let minPres = applyPresRule(minU, factor);
            const maxPres = applyPresRule(maxU, factor);
            const invPres = applyPresRule(Number(r.current_stock ?? 0), factor);
            if (maxPres > 0 && minPres === maxPres) minPres = maxPres - 1;
            const hasVal = maxU > 0 || minU > 0;
            const bodegaStock  = Number(r.current_stock ?? 0);
            const sucursalStock = Number(netStockMap[r.erp_product_id] ?? 0);
            const totalStock   = bodegaStock + sucursalStock;
            const vel          = Number(r.daily_velocity ?? 0);
            const daysCoverage = vel > 0 ? totalStock / vel : Infinity;
            const belowBodegaMin = minU > 0 && bodegaStock < minU;
            const alertLabel = (() => {
                if (bodegaStock === 0) return 'SIN STOCK';
                if (!hasVal) return 'SIN MIN/MAX';
                const hasVel = vel > 0 && isFinite(daysCoverage);
                const d = hasVel ? Math.round(daysCoverage) : null;
                if (belowBodegaMin) return d !== null ? `CRÍTICO (${d}d red)` : 'CRÍTICO';
                if (!hasVel) return '';
                if (daysCoverage < 14) return `CRÍTICO (${d}d)`;
                if (daysCoverage < 30) return `ATENCIÓN (${d}d)`;
                return '';
            })();
            return [sucursalName || '', r.laboratorio_nombre || '', r.product_name || '', `${abc}${xyz}`,
                hasVal ? minPres : '', hasVal ? maxPres : '', tipo, invPres,
                hasVal ? Math.max(0, maxPres - invPres) : '', supplierMap[r.erp_product_id] || 'Sin registro', alertLabel];
        }
        return [sucursalName || '', r.laboratorio_nombre || '', r.product_name || '', `${abc}${xyz}`,
            (maxU > 0 || minU > 0) ? minU : '', maxU > 0 ? maxU : '', r.units_sold_6m ?? 0];
    });
    return { headers, filas };
}
