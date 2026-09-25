import { supabase } from '../supabaseClient';
import { GOOGLE_MAPS_API_KEY } from '../plataforma/config';

const BODEGA_SUC_ID = 6;
const AVG_SPEED_KMH = 40;

function toRad(d) { return (d * Math.PI) / 180; }

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function minsFromSeconds(s) { return Math.max(1, Math.round(s / 60)); }
function minsFromMeters(m)   { return Math.max(1, Math.round((m / 1000 / AVG_SPEED_KMH) * 60)); }

// ── TSP brute-force (≤ 8 stops) ───────────────────────────────────────────
// distFn(i, j): index of origin → index of destination (0 = bodega, 1..n = stops)
function tspBrute(n, distFn) {
  const indices = Array.from({ length: n }, (_, i) => i);
  let bestOrder = [...indices];
  let bestDist  = Infinity;

  function permute(arr, l) {
    if (l === arr.length) {
      let d = distFn(0, arr[0] + 1);          // bodega → first stop
      for (let i = 0; i < arr.length - 1; i++) {
        d += distFn(arr[i] + 1, arr[i + 1] + 1); // stop → next stop
      }
      if (d < bestDist) { bestDist = d; bestOrder = [...arr]; }
      return;
    }
    for (let i = l; i < arr.length; i++) {
      [arr[l], arr[i]] = [arr[i], arr[l]];
      permute(arr, l + 1);
      [arr[l], arr[i]] = [arr[i], arr[l]];
    }
  }
  permute([...indices], 0);
  return bestOrder;
}

// ── Un tramo en línea recta ───────────────────────────────────────────────
// La ÚNICA estimación sin carretera del portal: distancia en línea recta y
// tiempo a 40 km/h. Estaba escrita a mano tres veces —acá y dos en
// `CrearRutaModal`, con el 40 copiado—.
export function tramoEnLineaRecta(a, b) {
  const d = haversineMeters(a.lat, a.lng, b.lat, b.lng);
  return { dist_m: Math.round(d), dur_min: minsFromMeters(d) };
}

/**
 * Arma una ruta en EL ORDEN DADO: numera las paradas y mide cada una desde la
 * anterior (la primera, desde la bodega) con `medir(a, b) → {dist_m, dur_min}`.
 *
 * Existe porque el orden no lo decide sólo la optimización: la persona sube,
 * baja, quita y agrega paradas a mano. Hasta el 2026-09-25 esos cambios
 * renumeraban y NO volvían a medir: cada parada se quedaba con la distancia
 * desde la que tenía ANTES, los totales de kilómetros y minutos quedaban mal
 * —y se guardaban así con la ruta—. Ahora el mismo armado sirve para las dos
 * cosas y no hay forma de reordenar sin medir.
 *
 * Una parada sin coordenadas no se puede medir (queda en null), y la que le
 * sigue se mide desde el último punto conocido — la ruta no se corta ahí.
 */
export function armarRuta(paradas, bodega, medir = tramoEnLineaRecta) {
  let desde = bodega;
  return paradas.map((p, i) => {
    const tieneCoords = p.lat != null && p.lng != null;
    const tramo = tieneCoords && desde ? medir(desde, p) : { dist_m: null, dur_min: null };
    if (tieneCoords) desde = p;
    return { ...p, orden: i + 1, dist_m: tramo.dist_m, dur_min: tramo.dur_min };
  });
}

/**
 * Un medidor a partir de una tabla de carretera (`{dist, dur}`, ver
 * `plataforma/mapas.js#matrizPorCarretera`). Busca el par en la tabla por
 * coordenadas; si Google no resolvió ese par, o el par no está (una parada
 * agregada después), cae a la línea recta — la misma regla que ya aplicaba la
 * optimización por celda.
 */
export function medidorDeMatriz(puntos, matriz) {
  const indice = new Map(puntos.map((p, i) => [`${p.lat},${p.lng}`, i]));
  const celda = (a, b) => {
    const i = indice.get(`${a.lat},${a.lng}`);
    const j = indice.get(`${b.lat},${b.lng}`);
    return i != null && j != null && matriz.dist[i][j] != null ? [i, j] : null;
  };
  const medir = (a, b) => {
    const c = celda(a, b);
    if (!c) return tramoEnLineaRecta(a, b);
    return { dist_m: Math.round(matriz.dist[c[0]][c[1]]), dur_min: minsFromSeconds(matriz.dur[c[0]][c[1]]) };
  };
  // La distancia SIN redondear, para elegir el orden: la optimización siempre
  // comparó metros exactos, y redondear podría deshacer un empate distinto.
  medir.distancia = (a, b) => {
    const c = celda(a, b);
    return c ? matriz.dist[c[0]][c[1]] : haversineMeters(a.lat, a.lng, b.lat, b.lng);
  };
  return medir;
}

function ordenOptimo(stops, bodega, distancia) {
  if (stops.length <= 1) return stops;
  const nodes = [bodega, ...stops]; // index 0=bodega, 1..n=stops
  const orden = tspBrute(stops.length, (i, j) => distancia(nodes[i], nodes[j]));
  return orden.map((si) => stops[si]);
}

// ── Optimización en línea recta (sync) ──────────────────────────────────────
// stops: [{erp_sucursal_id, suc_name, lat, lng, items:[]}]
// bodega: {lat, lng}
export function optimizeRoute(stops, bodega) {
  if (!stops.length) return [];
  const recta = (a, b) => haversineMeters(a.lat, a.lng, b.lat, b.lng);
  return armarRuta(ordenOptimo(stops, bodega, recta), bodega, tramoEnLineaRecta);
}

/**
 * Optimización con distancias reales por carretera. La tabla la trae
 * `obtenerMatriz(puntos)` —en la web, el SDK de Google (`plataforma/mapas.js`);
 * en la app nativa será el intermediario del servidor—, así que esto no conoce
 * al navegador. Devuelve las paradas ordenadas y el MEDIDOR, para que la
 * pantalla vuelva a medir con las mismas distancias de carretera cuando la
 * persona reordene. Lanza si no hay tabla: quien la pide cae a `optimizeRoute`.
 */
export async function optimizarPorCarretera(stops, bodega, obtenerMatriz) {
  if (!stops.length) return { paradas: [], medir: tramoEnLineaRecta };
  const puntos = [
    { lat: bodega.lat, lng: bodega.lng },
    ...stops.map((st) => ({ lat: st.lat, lng: st.lng })),
  ];
  const medir = medidorDeMatriz(puntos, await obtenerMatriz(puntos));
  return { paradas: armarRuta(ordenOptimo(stops, bodega, medir.distancia), bodega, medir), medir };
}

export function totalRoute(orderedStops) {
  return {
    dist_m:  orderedStops.reduce((s, p) => s + (p.dist_m  ?? 0), 0),
    dur_min: orderedStops.reduce((s, p) => s + (p.dur_min ?? 0), 0),
  };
}

// ── Decode Google's encoded polyline format ───────────────────────────────
export function decodePolyline(str) {
  const pts = [];
  let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    let b, shift = 0, val = 0;
    do { b = str.charCodeAt(i++) - 63; val |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (val & 1) ? ~(val >> 1) : (val >> 1);
    shift = 0; val = 0;
    do { b = str.charCodeAt(i++) - 63; val |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (val & 1) ? ~(val >> 1) : (val >> 1);
    pts.push([lat / 1e5, lng / 1e5]);
  }
  return pts;
}

// ── Supabase proxy helper (bypasses browser CORS restriction) ─────────────
async function mapsProxy(type, params) {
  const key = GOOGLE_MAPS_API_KEY;
  const { data, error } = await supabase.functions.invoke('maps-proxy', {
    body: { type, params, key },
  });
  if (error) throw error;
  return data;
}


// ── REST Directions — real-road polyline + return leg (via proxy) ─────────
// points: [bodega, ...orderedStops, bodega] — bodega is both origin and destination
export async function getDirectionsREST(points) {
  if (!GOOGLE_MAPS_API_KEY || points.length < 2) return null;

  const fmt    = p => `${p.lat},${p.lng}`;
  const origin = fmt(points[0]);
  const dest   = fmt(points[points.length - 1]);
  const middle = points.slice(1, -1).map(fmt).join('|');

  const data = await mapsProxy('directions', { origin, destination: dest, waypoints: middle || undefined });
  if (data.status !== 'OK' || !data.routes?.length) return null;

  const route   = data.routes[0];
  const lastLeg = route.legs.at(-1);
  return {
    polylinePoints: decodePolyline(route.overview_polyline.points),
    returnLeg: lastLeg
      ? { dist_m: lastLeg.distance.value, dur_min: minsFromSeconds(lastLeg.duration.value) }
      : null,
  };
}

export { BODEGA_SUC_ID };
