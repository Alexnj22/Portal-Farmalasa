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

function minsFromMeters(m) {
  return Math.max(1, Math.round((m / 1000 / AVG_SPEED_KMH) * 60));
}

// stops: [{erp_sucursal_id, suc_name, lat, lng, ...extra}]
// bodega: {lat, lng}
// Returns stops ordered optimally, each with {orden, dist_m, dur_min} added
export function optimizeRoute(stops, bodega) {
  if (!stops.length) return [];

  if (stops.length === 1) {
    const d = haversineMeters(bodega.lat, bodega.lng, stops[0].lat, stops[0].lng);
    return [{ ...stops[0], orden: 1, dist_m: Math.round(d), dur_min: minsFromMeters(d) }];
  }

  // Brute-force TSP — works well for ≤ 8 stops
  let bestOrder = stops.map((_, i) => i);
  let bestDist = Infinity;

  function permute(arr, l) {
    if (l === arr.length) {
      let d = haversineMeters(bodega.lat, bodega.lng, stops[arr[0]].lat, stops[arr[0]].lng);
      for (let i = 0; i < arr.length - 1; i++) {
        d += haversineMeters(stops[arr[i]].lat, stops[arr[i]].lng, stops[arr[i + 1]].lat, stops[arr[i + 1]].lng);
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
  permute(stops.map((_, i) => i), 0);

  return bestOrder.map((si, pos) => {
    const prev = pos === 0 ? bodega : stops[bestOrder[pos - 1]];
    const d = haversineMeters(prev.lat, prev.lng, stops[si].lat, stops[si].lng);
    return { ...stops[si], orden: pos + 1, dist_m: Math.round(d), dur_min: minsFromMeters(d) };
  });
}

export function totalRoute(orderedStops) {
  return {
    dist_m:  orderedStops.reduce((s, p) => s + (p.dist_m  ?? 0), 0),
    dur_min: orderedStops.reduce((s, p) => s + (p.dur_min ?? 0), 0),
  };
}

export { BODEGA_SUC_ID };
