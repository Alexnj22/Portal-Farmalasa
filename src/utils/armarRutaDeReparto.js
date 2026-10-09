// Armar una ruta de reparto: qué salas finalizadas se pueden subir, cómo se
// agrupan en paradas, cuánto se tarda y qué se guarda.
//
// Vivía dentro de `CrearRutaModal` (portal). Sale al núcleo para que el
// teléfono arme la MISMA ruta —mismas paradas, mismos totales que quedan
// guardados con ella— con el optimizador de `routeOptimizer`.

import { MIN_POR_PARADA } from './logicaDeRutas';

/** Minutos fijos de descarga por parada: el mismo `MIN_POR_PARADA` del portal. */
export const MINUTOS_POR_PARADA = MIN_POR_PARADA;

/**
 * Los reenvíos de cajas faltantes por despachar (`fetchReenviosPorDespachar`):
 * van PRIMERO y ya marcados (regla del usuario, 2026-10-07). Son paradas como
 * cualquiera, pero viajan con su `reenvio_ciclo`, que es lo que hace que la
 * base las dé por salidas cuando la ruta sale.
 */
export function reenviosParaRuta(reenvios = [], nombres = {}) {
    return reenvios.map(r => ({
        ...r,
        esReenvio:        true,
        suc_name:         nombres[r.erp_sucursal_id] ?? `Suc. ${r.erp_sucursal_id}`,
        total_cajas:      (r.cajas ?? []).length + (r.especiales ?? []).length,
        cajas_electrolit: r.electrolits ?? 0,
        cajas_especiales: [],
    }));
}

/**
 * Las salas listas para salir (`fetchSalasListasParaRuta`: finalizadas, que no
 * salieron ni llegaron) de pedidos vivos, una fila por (pedido, sala).
 */
export function pedidosParaRuta(pedidos = [], finalizados = [], nombres = {}) {
    const porId = new Map(pedidos.map(p => [p.id, p]));
    const items = [];
    for (const pss of finalizados) {
        const p = porId.get(pss.pedido_id);
        if (!p) continue;
        items.push({
            key:              `${p.id}__${pss.erp_sucursal_id}`,
            pedido_id:        p.id,
            numero:           p.numero,
            erp_sucursal_id:  pss.erp_sucursal_id,
            suc_name:         nombres[pss.erp_sucursal_id] ?? `Suc. ${pss.erp_sucursal_id}`,
            total_cajas:      pss.total_cajas      ?? 0,
            cajas_electrolit: pss.cajas_electrolit ?? 0,
            cajas_especiales: pss.cajas_especiales ?? [],
        });
    }
    return items;
}

/** Los nombres de sala desde `fetchSucursalesConCoords`. */
export const nombresDeSalas = (filas = []) =>
    Object.fromEntries(filas.map(r => [r.erp_sucursal_id, r.branch?.name ?? `Suc. ${r.erp_sucursal_id}`]));

/** Una parada por sala, con sus pedidos; separa las que no tienen ubicación. */
export function paradasDeSalas(seleccion = [], porSucursal = {}) {
    const porSala = new Map();
    for (const item of seleccion) {
        if (!porSala.has(item.erp_sucursal_id)) {
            porSala.set(item.erp_sucursal_id, {
                erp_sucursal_id: item.erp_sucursal_id, suc_name: item.suc_name,
                lat: porSucursal[item.erp_sucursal_id]?.lat, lng: porSucursal[item.erp_sucursal_id]?.lng,
                items: [],
            });
        }
        porSala.get(item.erp_sucursal_id).items.push(item);
    }
    const todas = [...porSala.values()];
    return { conUbicacion: todas.filter(s => s.lat && s.lng), sinUbicacion: todas.filter(s => !s.lat || !s.lng) };
}

/** Las paradas sin ubicación van al final, sin tramo medido. */
export function juntarParadas(optimizadas, sinUbicacion, sello = Date.now()) {
    return [
        ...optimizadas,
        ...sinUbicacion.map((s, i) => ({ ...s, orden: optimizadas.length + i + 1, dist_m: null, dur_min: null })),
    ].map((s, i) => ({ ...s, _uid: `stop-${i}-${sello}` }));
}

/** Cajas, Electrolit y especiales por parada, y el tiempo acumulado de manejo. */
export function lineaDeTiempo(paradas = []) {
    let acumulado = 0;
    return paradas.map(stop => {
        const cajas      = stop.items?.reduce((s, it) => s + (it.total_cajas ?? 0), 0) ?? 0;
        const electrolit = stop.items?.reduce((s, it) => s + (it.cajas_electrolit ?? 0), 0) ?? 0;
        const especiales = stop.items?.reduce((s, it) => s + (it.cajas_especiales?.length ?? 0), 0) ?? 0;
        const manejo = stop.dur_min ?? 0;
        acumulado += manejo;
        return { stop, cajas, electrolit, especiales, manejo, descarga: MINUTOS_POR_PARADA, acumulado };
    });
}

/** Lo que va a `crear_ruta`: una fila por pedido de cada parada real. */
export const paradasParaGuardar = (paradas = []) => paradas
    .filter(stop => !stop.isEncargo)
    .flatMap(stop => stop.items.map(item => ({
        pedido_id: item.pedido_id, erp_sucursal_id: item.erp_sucursal_id,
        orden_entrega: stop.orden, dist_m: stop.dist_m ?? null, dur_min: stop.dur_min ?? null,
        reenvio_ciclo: item.reenvio_ciclo ?? null,
    })));

/** Los encargos sin pedido, que se guardan en `rutas.visitas`. */
export const visitasDeRuta = (paradas = []) => paradas
    .filter(s => s.isEncargo)
    .map(s => ({ erp_sucursal_id: s.erp_sucursal_id, suc_name: s.suc_name, orden: s.orden, dist_m: s.dist_m ?? null, dur_min: s.dur_min ?? null }));

export const minutosTexto = (min) => {
    if (!min) return null;
    return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h ${min % 60}min`;
};
