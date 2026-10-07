// Seguir la posición del teléfono — la versión de la APP. Mismo contrato que
// src/plataforma/ubicacion.js: `seguirPosicion(alMoverse, { mensaje, alFallar })`
// devuelve la función que lo detiene, y `posicionActual()` da una lectura o
// `null` (una visita cuenta igual sin ubicación).
//
// Con `expo-location` en PRIMER PLANO: mide mientras la app está abierta. Con
// la app cerrada mide la tarea de fondo de `rastreoDeFondo.js` (permiso
// «siempre»); esto queda para la pantalla abierta y como respaldo cuando la
// persona sólo dio «mientras se usa». `mensaje` no aplica (es el aviso fijo de
// Android en segundo plano).
import * as Location from 'expo-location';

// El permiso se pide UNA vez por sesión: si se negó, no se vuelve a preguntar
// en cada pantalla (el sistema tampoco mostraría el diálogo otra vez).
let permiso = null;
async function conPermiso() {
  if (permiso === 'granted') return true;
  try {
    const actual = await Location.getForegroundPermissionsAsync();
    if (actual.status === 'granted') { permiso = 'granted'; return true; }
    if (!actual.canAskAgain) { permiso = actual.status; return false; }
    const r = await Location.requestForegroundPermissionsAsync();
    permiso = r.status;
    return r.status === 'granted';
  } catch (e) {
    console.warn('[GPS] permiso', e?.message ?? e);
    return false;
  }
}

/**
 * Empieza a seguir la posición. Devuelve una función que la detiene.
 * @param {(pos: {lat: number, lng: number}) => void} alMoverse
 * @param {{ mensaje?: string, alFallar?: (motivo: 'denegado'|'sin-senal'|'sin-gps') => void }} [opciones]
 * @returns {Promise<() => Promise<void>>}
 */
// eslint-disable-next-line no-unused-vars
export async function seguirPosicion(alMoverse, { mensaje, alFallar } = {}) {
  if (!(await conPermiso())) { alFallar?.('denegado'); return async () => {}; }
  try {
    const sub = await Location.watchPositionAsync(
      // Igual que la web: alta precisión y un punto nuevo cada 20 m.
      { accuracy: Location.Accuracy.High, distanceInterval: 20, timeInterval: 5000 },
      (p) => alMoverse({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (motivo) => { console.warn('[GPS] seguimiento', motivo); alFallar?.('sin-senal'); },
    );
    return async () => { sub.remove(); };
  } catch (e) {
    console.warn('[GPS] no arrancó', e?.message ?? e);
    alFallar?.('sin-gps');
    return async () => {};
  }
}

/** La ubicación del teléfono, si la da en 8 segundos; si no, `null`. */
export async function posicionActual() {
  if (!(await conPermiso())) return null;
  try {
    // Una lectura reciente (≤ 1 min) sirve y es instantánea.
    const cache = await Location.getLastKnownPositionAsync({ maxAge: 60_000 });
    const p = cache ?? await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise((_, no) => setTimeout(() => no(new Error('sin señal en 8 s')), 8000)),
    ]);
    return p ? { lat: p.coords.latitude, lng: p.coords.longitude } : null;
  } catch (e) {
    console.warn('ubicación: sin lectura puntual', e?.message ?? e);
    return null;
  }
}

/** ¿El permiso está negado? Para avisarlo UNA vez en pantalla. */
export async function ubicacionNegada() {
  try {
    const r = await Location.getForegroundPermissionsAsync();
    return r.status === 'denied';
  } catch { return false; }
}
