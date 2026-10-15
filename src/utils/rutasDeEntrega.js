// Las rutas de reparto de Pedidos (bodega → salas), escritas UNA vez para el
// portal (`views/pedidos/TabRutas.jsx` y `RutaMapModal.jsx`) y la app nativa:
// cómo se rotula su estado, el orden de las paradas, el avance, la distancia,
// dónde está cada sala en el mapa y cuándo el conductor cuenta «en vivo».
import { tokenMatch } from './searchUtils';

export const ESTADO_RUTA = {
    pendiente:  { label: 'Pendiente',  variante: 'warning' },
    en_ruta:    { label: 'En ruta',    variante: 'chart-9' },
    completada: { label: 'Completada', variante: 'success' },
    con_alerta: { label: 'Con alerta', variante: 'danger'  },
};
export const estadoDeRuta = (status) => ESTADO_RUTA[status] ?? ESTADO_RUTA.pendiente;

/** El conductor escribe su posición cada 30 s mientras tiene el mapa abierto. */
export const INTERVALO_POSICION_CONDUCTOR_MS = 30_000;
/** Una posición de hace menos de esto se lee «en vivo»; más vieja, «última posición». */
export const MINUTOS_EN_VIVO = 3;

/** «850 m» · «1.2 km»; sin distancia, `null` (no se pinta). */
export function distanciaTexto(m) {
    if (!m) return null;
    return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}

/** Las paradas en su orden de entrega (sin tocar el arreglo original). */
export const ordenarParadas = (ruta) => [...(ruta?.ruta_pedidos ?? [])].sort((a, b) => a.orden_entrega - b.orden_entrega);

/** Cuántas paradas ya se entregaron, de cuántas. */
export function avanceDeEntrega(paradas) {
    const total = paradas?.length ?? 0;
    const entregadas = (paradas ?? []).filter(p => p.entregado_at).length;
    return { entregadas, total, completa: total > 0 && entregadas === total };
}

/**
 * Le pone a cada parada el nombre de la sala y el número de su pedido.
 * `sucursales`: filas `{ erp_sucursal_id, branch: { name } }`; `pedidos`: `{ id, numero }`.
 */
export function enriquecerRutas(rutas, sucursales, pedidos) {
    const nombre = Object.fromEntries((sucursales ?? []).map(s => [s.erp_sucursal_id, s.branch?.name]));
    const numero = Object.fromEntries((pedidos ?? []).map(p => [p.id, p.numero]));
    return (rutas ?? []).map(ruta => ({
        ...ruta,
        ruta_pedidos: (ruta.ruta_pedidos ?? []).map(rp => ({
            ...rp,
            suc_name: nombre[rp.erp_sucursal_id] ?? `Suc. ${rp.erp_sucursal_id}`,
            numeros: [numero[rp.pedido_id]].filter(Boolean),
        })),
    }));
}

/** Los ids que hacen falta para enriquecer (sucursales y pedidos de todas las paradas). */
export function idsDeParadas(rutas) {
    const paradas = (rutas ?? []).flatMap(r => r.ruta_pedidos ?? []);
    return {
        sucursales: [...new Set(paradas.map(rp => rp.erp_sucursal_id))],
        pedidos: [...new Set(paradas.map(rp => rp.pedido_id))],
    };
}

/** Busca por número de ruta o por conductor. */
export function filtrarRutas(rutas, q) {
    const t = String(q ?? '').trim();
    if (!t) return rutas;
    return rutas.filter(r => String(r.numero).includes(t) || tokenMatch(t, r.conductor_nombre));
}

/** Las que siguen vivas arriba; las completadas aparte. */
export function separarRutas(rutas) {
    return {
        activas: rutas.filter(r => r.status !== 'completada'),
        completadas: rutas.filter(r => r.status === 'completada'),
    };
}

/**
 * Dónde está cada sala, de `fetchSucursalesConCoords` (la ubicación vive en
 * `branch.settings.location`). Devuelve `{ porSucursal: {id: {lat,lng}}, bodega }`.
 */
export function coordenadasDeSucursales(filas) {
    const porSucursal = {};
    let bodega = null;
    for (const row of filas ?? []) {
        const loc = row.branch?.settings?.location ?? {};
        const lat = parseFloat(loc.lat), lng = parseFloat(loc.lng);
        if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
            porSucursal[row.erp_sucursal_id] = { lat, lng };
            if (row.es_bodega) bodega = { lat, lng };
        }
    }
    return { porSucursal, bodega };
}

/** El trazo del reparto: bodega → paradas en orden → bodega (las que tienen ubicación). */
export function trazoDeReparto(bodega, paradas, porSucursal) {
    const pts = (paradas ?? []).map(p => porSucursal?.[p.erp_sucursal_id]).filter(Boolean);
    return bodega ? [bodega, ...pts, bodega] : pts;
}

/** ¿La última posición del conductor es reciente? */
export function conductorEnVivo(actualizadaEl, ahora = Date.now()) {
    if (!actualizadaEl) return false;
    return (ahora - new Date(actualizadaEl).getTime()) / 60_000 < MINUTOS_EN_VIVO;
}

// ── Las cifras y los filtros de la pestaña (2026-10-15) ─────────────────────
// Mudados de `TabRutas` para que la app muestre las mismas tres cifras y
// filtre igual (estado, período de las completadas, conductor).

/** Días hacia atrás de cada período de las completadas. */
export const PERIODOS_RUTAS = { hoy: 0, '7d': 7, '30d': 30 };

/** Cuándo una ruta se cuenta como hecha: al volver a base, o lo más cercano. */
const momentoDeRuta = (r) => new Date(r.vuelta_base_at ?? r.salida_at ?? r.created_at);

/** Las tres cifras de lo que pasa HOY, sin importar el filtro. */
export function cifrasDeRutas(rutas, ahora = new Date()) {
    const inicioHoy = new Date(ahora); inicioHoy.setHours(0, 0, 0, 0);
    const enCalle = (rutas ?? []).filter(r => r.status === 'en_ruta' || r.status === 'con_alerta');
    const pendientes = (rutas ?? []).filter(r => r.status === 'pendiente');
    const cerradasHoy = (rutas ?? []).filter(r => r.status === 'completada' && momentoDeRuta(r) >= inicioHoy);
    const paradasVivas = [...enCalle, ...pendientes].flatMap(r => r.ruta_pedidos ?? []);
    return {
        enCalle, pendientes, cerradasHoy,
        paradasVivas: paradasVivas.length,
        entregadasVivas: paradasVivas.filter(p => p.entregado_at).length,
    };
}

/** Las completadas dentro del período (`PERIODOS_RUTAS`). */
export function completadasEnPeriodo(completadas, periodo, ahora = new Date()) {
    const d = new Date(ahora); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (PERIODOS_RUTAS[periodo] ?? 7));
    return (completadas ?? []).filter(r => momentoDeRuta(r).getTime() >= d.getTime());
}

/** Los conductores que aparecen en las rutas, para el filtro. */
export const conductoresDeRutas = (rutas) =>
    [...new Set((rutas ?? []).map(r => r.conductor_nombre).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
