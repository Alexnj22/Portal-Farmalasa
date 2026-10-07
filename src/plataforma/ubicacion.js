// ─────────────────────────────────────────────────────────────────────────────
// Seguir la posición del teléfono — la versión del NAVEGADOR (y de Capacitor).
// ─────────────────────────────────────────────────────────────────────────────
//
// Estaba escrito dos veces: en `RutaMapModal` (el mapa del conductor) y en
// `usePedidosData` (el rastreo que sigue con la pantalla apagada), con dos
// configuraciones distintas del mismo plugin. Y la lógica de pedidos no puede
// conocer al navegador (`npm run gate:nucleo`): la app nativa tendrá su gemelo
// `ubicacion.native.js` con la misma firma.
//
// En Capacitor se usa `BackgroundGeolocation`, que sigue midiendo con la
// pantalla apagada. Es un plugin sin entrada JS: se registra con
// `registerPlugin` —importarlo con `import()` hace fallar a Vite al cargar el
// archivo— y fuera de la app nativa es un stub que no opera.
import { registerPlugin } from '@capacitor/core';

const GpsEnSegundoPlano = registerPlugin('BackgroundGeolocation');

const esNativo = () => !!(typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.());

/**
 * Empieza a seguir la posición. Devuelve una función que la detiene.
 *
 * @param {(pos: {lat: number, lng: number}) => void} alMoverse
 * @param {{ mensaje?: string, alFallar?: (motivo: 'denegado'|'sin-senal'|'sin-gps') => void }} [opciones]
 *   `mensaje` es el aviso fijo que Android muestra mientras se mide en segundo plano.
 * @returns {Promise<() => Promise<void>>}
 */
export async function seguirPosicion(alMoverse, { mensaje = 'Rastreando tu posición.', alFallar } = {}) {
    if (esNativo()) {
        const id = await GpsEnSegundoPlano.addWatcher(
            { backgroundTitle: 'Ruta activa', backgroundMessage: mensaje, requestPermissions: true, stale: false, distanceFilter: 20 },
            (loc, err) => {
                if (err) { console.warn('[GPS]', err); return; }
                if (loc) alMoverse({ lat: loc.latitude, lng: loc.longitude });
            },
        );
        return async () => { await GpsEnSegundoPlano.removeWatcher({ id }).catch(() => {}); };
    }

    const geo = typeof navigator !== 'undefined' ? navigator.geolocation : null;
    if (!geo) { alFallar?.('sin-gps'); return async () => {}; }

    let id = null;
    let detenido = false;
    // Primero una lectura puntual: dice enseguida si hay permiso, y después el
    // seguimiento continuo. Un `watchPosition` a secas puede tardar en fallar.
    geo.getCurrentPosition(
        (p) => {
            if (detenido) return;
            alMoverse({ lat: p.coords.latitude, lng: p.coords.longitude });
            id = geo.watchPosition(
                (q) => alMoverse({ lat: q.coords.latitude, lng: q.coords.longitude }),
                (err) => console.warn('[GPS] seguimiento:', err.code),
                { enableHighAccuracy: true, maximumAge: 5000 },
            );
        },
        (err) => alFallar?.(err.code === 1 ? 'denegado' : 'sin-senal'),
        { enableHighAccuracy: true, timeout: 15000 },
    );
    return async () => {
        detenido = true;
        if (id !== null) geo.clearWatch(id);
    };
}

// La lectura PUNTUAL (la de una visita). Se pide SÓLO en la app (Capacitor):
// en el navegador `vercel.json` manda `geolocation=()`, que la apaga en todo
// el sitio, y la decisión del usuario (2026-10-01) fue «solo para las apps».
// El plugin nativo pide su propio permiso al sistema la primera vez. Vivía
// dentro de `views/distribucion/TabRutas.jsx`.
let geoPromise = null;
function getGeo() {
    if (!geoPromise) {
        geoPromise = import('@capacitor/geolocation')
            .then(m => m.Geolocation)
            .catch(err => { geoPromise = null; throw err; });
    }
    return geoPromise;
}

/** La ubicación del aparato, si la da en 8 segundos; si no, `null` (la visita cuenta igual). */
export async function posicionActual() {
    if (!esNativo()) return null;
    try {
        const Geo = await getGeo();
        const p = await Geo.getCurrentPosition({ enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
        return { lat: p.coords.latitude, lng: p.coords.longitude };
    } catch (e) {
        console.warn('ubicación: sin lectura puntual', e?.message ?? e);
        return null;
    }
}

/** ¿El permiso de ubicación está negado? En el navegador no se pregunta: nunca. */
export async function ubicacionNegada() { return false; }
