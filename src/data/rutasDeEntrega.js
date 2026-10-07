// Las rutas de reparto con sus paradas ya rotuladas (nombre de la sala y
// número de pedido): la carga que hacía `views/pedidos/TabRutas.jsx` a mano,
// para que la app lea lo mismo.
import { fetchRutasConParadas, fetchBranchNamesForSucursales, fetchPedidoNumerosByIds } from './pedidos';
import { enriquecerRutas, idsDeParadas } from '../utils/rutasDeEntrega';

/** Las últimas rutas (las que trae `fetchRutasConParadas`), con sus paradas rotuladas. */
export async function fetchRutasDeEntrega() {
    const { data, error } = await fetchRutasConParadas();
    if (error) throw error;
    const ids = idsDeParadas(data);
    const [{ data: suc, error: e1 }, { data: ped, error: e2 }] = await Promise.all([
        fetchBranchNamesForSucursales(ids.sucursales.length ? ids.sucursales : [-1]),
        fetchPedidoNumerosByIds(ids.pedidos.length ? ids.pedidos : ['00000000-0000-0000-0000-000000000000']),
    ]);
    // Sin nombres la ruta se lee igual («Suc. 3»): no se pierde por eso.
    if (e1 || e2) console.warn('[rutas] sin nombres de sala o de pedido', e1?.message ?? e2?.message);
    return enriquecerRutas(data, suc, ped);
}
