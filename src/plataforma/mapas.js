// ─────────────────────────────────────────────────────────────────────────────
// Los mapas — la versión del NAVEGADOR.
// ─────────────────────────────────────────────────────────────────────────────
//
// Cargar la librería de Google Maps o Leaflet dentro de la página y pedirle a
// Google la tabla de distancias por carretera con su SDK de JavaScript. Todo
// eso es del navegador: en la app nativa el mapa es un componente nativo y la
// tabla se pedirá por el intermediario del servidor (`maps-proxy`, que ya la
// sabe dar). La MATEMÁTICA de la ruta —qué orden conviene, cuánto mide cada
// tramo— no está acá: vive en `utils/routeOptimizer.js` y es la misma en las dos.
// Plan en `docs/PLAN-NUCLEO-PORTABLE-2026-09-24.md`.
import { GOOGLE_MAPS_API_KEY } from './config';

// ── Google Maps (una sola carga por página) ──────────────────────────────────
let _mapsPromise = null;
export function loadGoogleMaps() {
    if (_mapsPromise) return _mapsPromise;
    if (window.google?.maps?.DistanceMatrixService) {
        _mapsPromise = Promise.resolve(window.google.maps);
        return _mapsPromise;
    }
    if (!GOOGLE_MAPS_API_KEY) return Promise.reject(new Error('No Maps API key'));

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
        s.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&callback=${cb}&libraries=geometry&loading=async`;
        s.onerror = (e) => { _mapsPromise = null; reject(e); };
        document.head.appendChild(s);
    });
    return _mapsPromise;
}

/**
 * La tabla de distancias por carretera entre todos los puntos, con el SDK de
 * Google. Devuelve `{ dist, dur }`: `dist[i][j]` en metros y `dur[i][j]` en
 * segundos, o `null` en la celda que Google no pudo resolver — qué hacer con
 * ese hueco lo decide el núcleo, no esto. Lanza si no hay mapas (sin llave, sin
 * red): quien la pide cae a la línea recta.
 */
export async function matrizPorCarretera(puntos) {
    if (!GOOGLE_MAPS_API_KEY) throw new Error('No Maps API key');
    const maps = await loadGoogleMaps();
    const svc = new maps.DistanceMatrixService();
    const result = await svc.getDistanceMatrix({
        origins:      puntos,
        destinations: puntos,
        travelMode:   maps.TravelMode.DRIVING,
        unitSystem:   maps.UnitSystem.METRIC,
    });
    const n = puntos.length;
    const dist = Array.from({ length: n }, () => new Array(n).fill(null));
    const dur  = Array.from({ length: n }, () => new Array(n).fill(null));
    result.rows.forEach((row, i) => {
        row.elements.forEach((el, j) => {
            if (el.status === 'OK') {
                dist[i][j] = el.distance.value;
                dur[i][j]  = el.duration.value;
            }
        });
    });
    return { dist, dur };
}

// ── Leaflet loader (mapa de respaldo — no necesita API key) ───────────────
//
// Viene del paquete, NO de unpkg. Antes se inyectaban un `<script>` y un
// `<link>` apuntando a `unpkg.com/leaflet@1.9.4`, o sea código de un tercero
// corriendo **dentro del origen del portal**, con acceso a todo el
// `localStorage` —token de sesión incluido— y sin `integrity` que lo atara a
// una versión concreta. No hacía falta que atacaran al portal: alcanzaba con
// que comprometieran ese paquete en el CDN.
//
// Va por `await import()` porque sólo hace falta al abrir un mapa: es la regla
// de librerías pesadas de CLAUDE.md, la misma de `pdfmake`/`@zxing`/`@imgly`.
// Lo vigila `PESADAS` en `scripts/bundle-gate.mjs`.
let _leafletPromise = null;
export function loadLeaflet() {
    if (_leafletPromise) return _leafletPromise;
    if (window.L?.map) { _leafletPromise = Promise.resolve(window.L); return _leafletPromise; }
    _leafletPromise = Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')])
        .then(([m]) => {
            const L = m.default || m;
            // `window.L` se sigue publicando a propósito: `RutaMapModal.jsx` lo lee
            // directo en su camino de posición en vivo (`&& window.L`, y `const L =
            // window.L` justo después). Quitarlo obliga a rehacer esos dos caminos
            // para no comprar nada.
            window.L = L;
            return L;
        })
        .catch((err) => { _leafletPromise = null; throw err; });
    return _leafletPromise;
}
