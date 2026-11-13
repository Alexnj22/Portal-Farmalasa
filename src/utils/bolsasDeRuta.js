// Las bolsas de traslado que la ruta de reparto puede llevarse «de paso».
//
// La base dice qué bolsas sirven (`ruta_bolsas`: destino en una parada que
// falta) y si quedan EN el camino o son un DESVÍO. Cuánto cuesta un desvío lo
// calcula esto con la ubicación de las salas: el mejor lugar para meter la
// sala de origen en lo que le queda de ruta antes del destino, en línea recta
// y a la velocidad del portal (`routeOptimizer`). Es una estimación para
// decidir, no una ruta.
import { haversineMeters, minutosDeMetros } from './routeOptimizer';

const metros = (a, b) => haversineMeters(a.lat, a.lng, b.lat, b.lng);

/**
 * Minutos de más que cuesta pasar por la sala de origen de `bolsa` antes de
 * llegar a su destino. `null` si falta alguna ubicación o el destino no es una
 * parada pendiente.
 *
 * @param bolsa      `{ origen_erp, destino_erp }`
 * @param paradas    las paradas de la ruta EN ORDEN (`ordenarParadas`)
 * @param porSucursal `{ [erp_sucursal_id]: { lat, lng } }`
 * @param bodega     `{ lat, lng }` — de donde sale si todavía no entregó nada
 */
export function minutosDeDesvio(bolsa, paradas = [], porSucursal = {}, bodega = null) {
    const origen = porSucursal?.[bolsa?.origen_erp];
    if (!origen) return null;
    // Desde dónde sigue: la última parada entregada, o la bodega.
    const hechas = paradas.filter(p => p.entregado_at);
    const desde = hechas.length ? porSucursal[hechas[hechas.length - 1].erp_sucursal_id] : bodega;
    if (!desde) return null;
    const faltan = paradas.filter(p => !p.entregado_at && !p.no_entregado_at);
    const hasta = faltan.findIndex(p => p.erp_sucursal_id === bolsa.destino_erp);
    if (hasta < 0) return null;
    const camino = [desde, ...faltan.slice(0, hasta + 1).map(p => porSucursal[p.erp_sucursal_id])];
    if (camino.some(p => !p)) return null;
    let mejor = Infinity;
    for (let i = 0; i < camino.length - 1; i++) {
        const extra = metros(camino[i], origen) + metros(origen, camino[i + 1]) - metros(camino[i], camino[i + 1]);
        if (extra < mejor) mejor = extra;
    }
    return Number.isFinite(mejor) ? minutosDeMetros(Math.max(0, mejor)) : null;
}

/** El rótulo de una sugerencia: «En tu camino» o «Desvío de ~N min». */
export function rotuloDeSugerida(bolsa, minutos) {
    if (bolsa?.categoria === 'en_ruta') return 'En tu camino';
    return minutos != null ? `Desvío de ~${minutos} min` : 'Desvío';
}

/** Las sugerencias en el orden útil: primero las del camino, después los desvíos más cortos. */
export function ordenarSugeridas(sugeridas = [], minutosDe = () => null) {
    return [...sugeridas]
        .map(s => ({ ...s, minutos: s.categoria === 'en_ruta' ? 0 : minutosDe(s) }))
        .sort((a, b) => (a.categoria === 'en_ruta' ? 0 : 1) - (b.categoria === 'en_ruta' ? 0 : 1)
            || (a.minutos ?? 999) - (b.minutos ?? 999));
}

/** Las bolsas que todavía lleva encima (ni entregadas ni soltadas). */
export const bolsasEncima = (llevas = []) => llevas.filter(b => !b.entregada_at && !b.soltada_at);
