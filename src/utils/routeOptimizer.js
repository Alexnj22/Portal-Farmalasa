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

// ── Haversine optimization (sync) ─────────────────────────────────────────
// stops: [{erp_sucursal_id, suc_name, lat, lng, items:[]}]
// bodega: {lat, lng}
export function optimizeRoute(stops, bodega) {
  if (!stops.length) return [];

  const nodes = [bodega, ...stops]; // index 0=bodega, 1..n=stops
  const distFn = (i, j) => haversineMeters(nodes[i].lat, nodes[i].lng, nodes[j].lat, nodes[j].lng);

  const order = stops.length === 1 ? [0] : tspBrute(stops.length, distFn);

  return order.map((si, pos) => {
    const prevIdx = pos === 0 ? 0 : order[pos - 1] + 1;
    const d = haversineMeters(nodes[prevIdx].lat, nodes[prevIdx].lng, stops[si].lat, stops[si].lng);
    return { ...stops[si], orden: pos + 1, dist_m: Math.round(d), dur_min: minsFromMeters(d) };
  });
}

// ── Google Maps loader (singleton) ────────────────────────────────────────
let _mapsPromise = null;
export function loadGoogleMaps() {
  if (_mapsPromise) return _mapsPromise;
  if (window.google?.maps?.DistanceMatrixService) {
    _mapsPromise = Promise.resolve(window.google.maps);
    return _mapsPromise;
  }
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return Promise.reject(new Error('No Maps API key'));

  _mapsPromise = new Promise((resolve, reject) => {
    // gm_authFailure se dispara cuando la key es inválida o está restringida
    const prevAuthFailure = window.gm_authFailure;
    window.gm_authFailure = () => {
      _mapsPromise = null; // permite reintentar si la key se corrige
      reject(new Error('InvalidKey'));
      if (prevAuthFailure) prevAuthFailure();
    };

    const cb = '__gmaps_cb_' + Date.now();
    window[cb] = () => { delete window[cb]; resolve(window.google.maps); };
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&callback=${cb}&libraries=geometry`;
    s.onerror = (e) => { _mapsPromise = null; reject(e); };
    document.head.appendChild(s);
  });
  return _mapsPromise;
}

// ── Google Maps Distance Matrix optimization (async, called once) ─────────
// Returns same shape as optimizeRoute but with real road distances/durations.
export async function optimizeRouteGoogleMaps(stops, bodega) {
  if (!stops.length) return [];
  if (!import.meta.env.VITE_GOOGLE_MAPS_API_KEY) return optimizeRoute(stops, bodega);

  const maps = await loadGoogleMaps();
  const svc  = new maps.DistanceMatrixService();

  // All points: bodega first, then each unique stop
  const allPoints = [
    { lat: bodega.lat, lng: bodega.lng },
    ...stops.map(s => ({ lat: s.lat, lng: s.lng })),
  ];

  const result = await svc.getDistanceMatrix({
    origins:      allPoints,
    destinations: allPoints,
    travelMode:   maps.TravelMode.DRIVING,
    unitSystem:   maps.UnitSystem.METRIC,
  });

  // Build distance matrix [i][j] = meters, [i][j]_dur = seconds
  const n = allPoints.length;
  const distMatrix = Array.from({ length: n }, () => new Array(n).fill(Infinity));
  const durMatrix  = Array.from({ length: n }, () => new Array(n).fill(0));

  result.rows.forEach((row, i) => {
    row.elements.forEach((el, j) => {
      if (el.status === 'OK') {
        distMatrix[i][j] = el.distance.value;
        durMatrix[i][j]  = el.duration.value;
      } else {
        // Fallback to haversine for this pair
        distMatrix[i][j] = haversineMeters(allPoints[i].lat, allPoints[i].lng, allPoints[j].lat, allPoints[j].lng);
        durMatrix[i][j]  = distMatrix[i][j] / 1000 / AVG_SPEED_KMH * 3600;
      }
    });
  });

  const order = stops.length === 1 ? [0] : tspBrute(stops.length, (i, j) => distMatrix[i][j]);

  return order.map((si, pos) => {
    const prevIdx = pos === 0 ? 0 : order[pos - 1] + 1;
    return {
      ...stops[si],
      orden:   pos + 1,
      dist_m:  Math.round(distMatrix[prevIdx][si + 1]),
      dur_min: minsFromSeconds(durMatrix[prevIdx][si + 1]),
    };
  });
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

// ── REST Distance Matrix optimization (no Maps JS SDK needed) ────────────
export async function optimizeRouteREST(stops, bodega) {
  if (!stops.length) return [];
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error('No key');

  const allPoints = [bodega, ...stops];
  const coords    = allPoints.map(p => `${p.lat},${p.lng}`).join('|');
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json` +
              `?origins=${coords}&destinations=${coords}&key=${apiKey}`;

  const data = await fetch(url).then(r => r.json());
  if (data.status !== 'OK') throw new Error(`DM:${data.status}`);

  const n = allPoints.length;
  const distM = Array.from({ length: n }, () => new Array(n).fill(Infinity));
  const durS  = Array.from({ length: n }, () => new Array(n).fill(0));

  data.rows.forEach((row, i) => {
    row.elements.forEach((el, j) => {
      if (el.status === 'OK') {
        distM[i][j] = el.distance.value;
        durS[i][j]  = el.duration.value;
      } else {
        distM[i][j] = haversineMeters(allPoints[i].lat, allPoints[i].lng, allPoints[j].lat, allPoints[j].lng);
        durS[i][j]  = distM[i][j] / 1000 / AVG_SPEED_KMH * 3600;
      }
    });
  });

  const order = stops.length === 1 ? [0] : tspBrute(stops.length, (i, j) => distM[i][j]);

  return order.map((si, pos) => {
    const prevIdx = pos === 0 ? 0 : order[pos - 1] + 1;
    return {
      ...stops[si],
      orden:   pos + 1,
      dist_m:  Math.round(distM[prevIdx][si + 1]),
      dur_min: minsFromSeconds(durS[prevIdx][si + 1]),
    };
  });
}

// ── REST Directions — real-road polyline + return leg ────────────────────
// points: [bodega, ...orderedStops, bodega] — bodega is both origin and destination
export async function getDirectionsREST(points) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!apiKey || points.length < 2) return null;

  const fmt    = p => `${p.lat},${p.lng}`;
  const origin = fmt(points[0]);
  const dest   = fmt(points[points.length - 1]);
  const middle = points.slice(1, -1).map(fmt).join('|');

  let url = `https://maps.googleapis.com/maps/api/directions/json` +
            `?origin=${origin}&destination=${dest}&key=${apiKey}`;
  if (middle) url += `&waypoints=${middle}`;

  const data = await fetch(url).then(r => r.json());
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

// ── Leaflet loader (fallback map — no API key needed) ─────────────────────
let _leafletPromise = null;
export function loadLeaflet() {
  if (_leafletPromise) return _leafletPromise;
  if (window.L?.map) { _leafletPromise = Promise.resolve(window.L); return _leafletPromise; }
  _leafletPromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[href*="leaflet"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s.onload = () => resolve(window.L);
    s.onerror = (e) => { _leafletPromise = null; reject(e); };
    document.head.appendChild(s);
  });
  return _leafletPromise;
}

export { BODEGA_SUC_ID };
