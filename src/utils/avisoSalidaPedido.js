import { notifyBranch } from './notify';
import { fetchBranchIdsForSucursales } from '../data/pedidos';

/**
 * Avisar a cada sala que su pedido salió de bodega.
 *
 * Vive suelto y no dentro de una pantalla porque son **tres** los caminos por
 * los que una ruta se pone en marcha, y hasta el 2026-08-14 sólo uno avisaba:
 *
 *   1. Crear la ruta (`CrearRutaModal`), que la arranca sola — avisaba.
 *   2. «Iniciar ruta» en la pestaña de Rutas — no avisaba.
 *   3. «Iniciar» en la tarjeta de ruta de la pestaña de Pedidos — no avisaba.
 *
 * Los caminos 2 y 3 son los que se usan cuando la ruta quedó pendiente —por
 * ejemplo si el arranque automático falló— o cuando se arma hoy y sale mañana.
 * En esos casos la sala se quedaba esperando sin enterarse.
 *
 * **Va con push** (pedido del usuario, 2026-08-14): es cuando la sala empieza a
 * organizar quién recibe, así que tiene que llegar aunque nadie tenga el portal
 * abierto. Antes era campana sola, o sea que sólo lo veía quien ya estaba
 * mirando la pantalla.
 *
 * **No lanza.** Que un aviso falle no puede deshacer una ruta que ya salió; el
 * error queda en consola. Es la misma decisión que en la llegada: primero se
 * escribe el hecho, después se avisa.
 *
 * @param {Array} paradas  Las paradas de la ruta (`ruta_pedidos`), con
 *                         `erp_sucursal_id` y, si la pantalla los tiene,
 *                         `numeros` (los números de pedido de esa parada).
 * @param {string} conductorNombre  Para que la sala sepa a quién esperar.
 */
export async function avisarSalidaALasSalas(paradas, conductorNombre) {
    try {
        const sucIds = [...new Set((paradas ?? []).map(p => p.erp_sucursal_id).filter(Boolean))];
        if (!sucIds.length) return;

        const { data: mapas, error } = await fetchBranchIdsForSucursales(sucIds);
        if (error) throw error;
        const branchMap = Object.fromEntries((mapas ?? []).map(m => [m.erp_sucursal_id, m.branch_id]));

        for (const parada of paradas) {
            const bid = branchMap[parada.erp_sucursal_id];
            if (!bid) continue;
            // `numeros` no siempre viene: la tarjeta de la pestaña de Pedidos no
            // resuelve los números. Sin ellos el aviso sigue sirviendo, así que
            // se degrada en vez de callarse.
            const numeros = (parada.numeros ?? []).map(n => `#${n}`).join(', ');
            notifyBranch(bid, {
                type:  'PEDIDO_TRACKING',
                title: numeros ? `Pedido ${numeros} en camino` : 'Tu pedido va en camino',
                body:  `Salió de bodega${conductorNombre ? ` con ${conductorNombre}` : ''}.`,
                link:  '/pedidos',
                push:  true,
            });
        }
    } catch (e) {
        console.error('avisarSalidaALasSalas:', e);
    }
}
