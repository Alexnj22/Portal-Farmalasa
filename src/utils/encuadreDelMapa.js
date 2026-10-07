// Qué parte del mapa mostrar para que entren todos los puntos (los clientes de
// una ruta, las paradas de un reparto, el recorrido del día). Sin mapa ni
// aparato: recibe números y devuelve números, así lo usan el portal y la app.

const num = (v) => (v == null || v === '' ? NaN : Number(v));

/** ¿Tiene coordenadas utilizables? (0,0 es el golfo de Guinea, no un cliente). */
export function tieneCoordenadas(p) {
    const lat = num(p?.lat), lng = num(p?.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

/** `[{lat,lng}]` o `[[lat,lng]]` → `[{lat,lng}]` numéricos, sin los que no sirven. */
export function puntosValidos(lista) {
    return (lista ?? [])
        .map(p => (Array.isArray(p) ? { lat: p[0], lng: p[1] } : p))
        .filter(tieneCoordenadas)
        .map(p => ({ ...p, lat: num(p.lat), lng: num(p.lng) }));
}

/**
 * La región que abarca todos los puntos, con margen. Con un solo punto, un
 * acercamiento de barrio (~1 km). Sin puntos, `null`: quien llama decide qué
 * mostrar (no se inventa un centro).
 * @returns {{ latitude: number, longitude: number, latitudeDelta: number, longitudeDelta: number } | null}
 */
export function encuadre(lista, { margen = 1.4, minimo = 0.01 } = {}) {
    const pts = puntosValidos(lista);
    if (!pts.length) return null;
    const lats = pts.map(p => p.lat), lngs = pts.map(p => p.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    return {
        latitude: (minLat + maxLat) / 2,
        longitude: (minLng + maxLng) / 2,
        latitudeDelta: Math.max((maxLat - minLat) * margen, minimo),
        longitudeDelta: Math.max((maxLng - minLng) * margen, minimo),
    };
}
