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
  _mapsPromise = new Promise((resolve, reject) => {
    const cb = '__gmaps_cb_' + Date.now();
    window[cb] = () => { delete window[cb]; resolve(window.google.maps); };
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&callback=${cb}&libraries=geometry`;
    s.onerror = reject;
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

export { BODEGA_SUC_ID };
