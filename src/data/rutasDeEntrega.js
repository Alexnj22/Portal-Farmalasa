// Las rutas de reparto con sus paradas ya rotuladas (nombre de la sala y
// número de pedido): la carga que hacía `views/pedidos/TabRutas.jsx` a mano,
// para que la app lea lo mismo.
import { fetchRutasConParadas, fetchBranchNamesForSucursales, fetchPedidoNumerosByIds, fetchSucursalesConCoords } from './pedidos';
import { coordenadasDeSucursales, enriquecerRutas, idsDeParadas } from '../utils/rutasDeEntrega';

/**
 * Las rutas (las que trae `fetchRutasConParadas`: TODAS las activas, paginadas,
 * y las 50 completadas más recientes), con sus paradas rotuladas.
 */
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

// ── Dónde está cada sala: una lectura por sesión ────────────────────────────
// Las coordenadas de las salas no cambian en el día, y cada apertura de un
// mapa de ruta las volvía a leer. Se guarda la PROMESA (dos mapas abiertos a la
// vez comparten la misma lectura) y se olvida si falla, para reintentar en la
// próxima apertura en vez de quedar rota hasta recargar.
let coordenadasPromesa = null;

/** `{ porSucursal: {id: {lat,lng}}, bodega }` (ver `coordenadasDeSucursales`), con caché. */
export function fetchCoordenadasDeSucursales() {
    if (!coordenadasPromesa) {
        coordenadasPromesa = Promise.resolve(fetchSucursalesConCoords())
            .then((res) => {
                if (res?.error) throw res.error;
                return coordenadasDeSucursales(res?.data ?? []);
            })
            .catch((err) => { coordenadasPromesa = null; throw err; });
    }
    return coordenadasPromesa;
}
