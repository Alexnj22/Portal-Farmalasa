// La consulta de inventario, resumida por PRODUCTO — para una lista donde cada
// renglón es un producto y dice cuánto hay y en cuántas salas (la app del
// teléfono la usa para elegir qué pedir a otra sala).
//
// Las unidades se cuentan con `unidadesDe`, que ya multiplica por el factor de
// la presentación: sumar `cantidad` a secas mezclaría cajas con unidades y daría
// un número sin unidad. Las filas del área de vencidos de Bodega no cuentan
// como existencia para pedir.
import { unidadesDe } from './unidadesInventario';
import { ERP_NAMES, ERP_ORDEN } from '../constants/erp';

/** Letras mínimas para buscar: con una sola, «a» traía 16,722 filas. */
export const MIN_LETRAS_BUSQUEDA = 3;

/** Filas de `buscarInventarioGlobalV2` → un renglón por producto, en el orden del servidor. */
export function resumirPorProducto(filas) {
    const porProducto = new Map();
    for (const f of filas || []) {
        if (f.is_vencidos) continue;
        const clave = String(f.erp_product_id ?? f.descripcion);
        if (!porProducto.has(clave)) {
            porProducto.set(clave, {
                erp_product_id: f.erp_product_id ?? null,
                descripcion: f.descripcion,
                principioActivo: f.principio_activo ?? null,
                unidades: 0,
                porSala: new Map(),
            });
        }
        const p = porProducto.get(clave);
        const u = unidadesDe(f);
        p.unidades += u;
        p.porSala.set(f.erp_sucursal_id, (p.porSala.get(f.erp_sucursal_id) || 0) + u);
    }
    return [...porProducto.values()].map((p) => ({
        ...p,
        salas: ERP_ORDEN
            .filter((id) => (p.porSala.get(id) || 0) > 0)
            .map((id) => ({ erp_sucursal_id: id, sala: ERP_NAMES[id] ?? String(id), unidades: p.porSala.get(id) })),
    }));
}
