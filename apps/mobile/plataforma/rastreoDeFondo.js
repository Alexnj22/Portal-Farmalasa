// El GPS de una ruta con la app CERRADA (usuario, 2026-10-07: «que se vea en
// vivo dónde va el repartidor aun con la app en segundo plano»).
//
// UNA sola tarea de ubicación de fondo para las dos rutas que rastrean —el
// reparto de Pedidos y la venta en ruta de Torogoz—, porque iOS da una por
// app. Qué ruta sigue viva, con qué cadencia y a cuál le toca escribir lo
// decide el núcleo (`@nucleo/utils/rastreoDeFondo`); acá sólo está el aparato.
//
// La tarea se DEFINE al cargar este módulo, y `app/_layout.js` lo importa
// arriba de todo: cuando iOS relanza la app en segundo plano para entregar
// posiciones, no hay pantalla, sólo el arranque del bundle, y la tarea tiene
// que existir antes de que llegue el primer lote.
//
// Qué ruta está viva se guarda en el almacén del teléfono (SQLite, síncrono),
// así la tarea sabe a dónde escribir aunque la app no tenga pantalla. La
// escritura es la MISMA de la pantalla abierta (`upsertRutaLocation` y
// `registrarPosicion`), con la sesión guardada; sin sesión no se escribe.
//
// Ojo, iOS: `timeInterval` no existe ahí. El sistema entrega por distancia
// (`distanceInterval`), así que un camión detenido no manda nada —en el mapa
// queda su última posición— y el reloj de cada ruta evita escribir de más.
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { supabase } from '@nucleo/supabaseClient';
import { fetchEstadoDeRuta, upsertRutaLocation } from '@nucleo/data/pedidos';
import { registrarPosicion } from '@nucleo/data/distribucion';
import { hoySV } from '@nucleo/utils/fecha';
import { cadenciaDe, quienesEscriben, repartoSigueEnRuta, rutasVigentes, sinRutas, ultimaPosicion } from '@nucleo/utils/rastreoDeFondo';
import * as almacen from './almacen';

export const TAREA_RUTA = 'farmalasa-rastreo-de-ruta';
const CLAVE_ESTADO = 'rastreo-fondo:estado';
const CLAVE_ULTIMAS = 'rastreo-fondo:ultimas';

const leerJson = (clave) => { try { return JSON.parse(almacen.leer(clave) || 'null'); } catch { return null; } };
const guardarJson = (clave, valor) => {
  try { if (valor == null) almacen.borrar(clave); else almacen.guardar(clave, JSON.stringify(valor)); }
  catch { /* sin almacén: la tarea no tendrá a dónde escribir y se apaga sola */ }
};

/** Las rutas vivas en este teléfono (Torogoz de ayer ya no cuenta). */
export const rutasDeFondo = () => rutasVigentes(leerJson(CLAVE_ESTADO), hoySV());
/** ¿Esta ruta la está escribiendo la tarea de fondo? La pantalla abierta no escribe entonces. */
export const fondoActivo = (tipo) => !!rutasDeFondo()[tipo];

const oyentes = new Set();
const avisar = () => { for (const f of [...oyentes]) { try { f(); } catch { /* una pantalla no tumba a otra */ } } };
/** Avisa cuando cambia qué rutas rastrean de fondo; devuelve cómo dejar de escuchar. */
export const escucharFondo = (alCambiar) => { oyentes.add(alCambiar); return () => oyentes.delete(alCambiar); };

const ESCRIBIR = {
  reparto: async (ruta, p) => { const { error } = await upsertRutaLocation(ruta.rutaId, p.lat, p.lng); if (error) throw error; },
  torogoz: (_ruta, p) => registrarPosicion(p.lat, p.lng, p.precision),
};

try {
  TaskManager.defineTask(TAREA_RUTA, async ({ data, error }) => {
    if (error) { console.warn('[ruta de fondo]', error?.message ?? error); return; }
    const rutas = rutasDeFondo();
    if (sinRutas(rutas)) { await apagar(); return; }
    const pos = ultimaPosicion(data?.locations);
    if (!pos) return;
    let sesion = null;
    try { sesion = (await supabase.auth.getSession())?.data?.session ?? null; } catch { sesion = null; }
    if (!sesion) return; // sin sesión no se escribe: la policy lo rechazaría igual
    const { tipos, ultimas } = quienesEscriben(rutas, leerJson(CLAVE_ULTIMAS) ?? {}, Date.now());
    if (!tipos.length) return;
    guardarJson(CLAVE_ULTIMAS, ultimas);
    await Promise.all(tipos.map((t) => Promise.resolve()
      .then(() => ESCRIBIR[t](rutas[t], pos))
      .catch((e) => console.warn(`[ruta de fondo] ${t}: no se anotó`, e?.message ?? e))));
  });
} catch (e) {
  console.warn('[ruta de fondo] sin tareas de fondo en este entorno', e?.message ?? e);
}

async function encender(rutas) {
  const c = cadenciaDe(rutas);
  if (!c) { await apagar(); return; }
  await Location.startLocationUpdatesAsync(TAREA_RUTA, {
    accuracy: Location.Accuracy.High,
    timeInterval: c.intervaloMs,          // Android; iOS entrega por distancia
    distanceInterval: c.distanciaM,
    showsBackgroundLocationIndicator: true,
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.AutomotiveNavigation,
    foregroundService: { notificationTitle: 'Ruta en curso', notificationBody: 'Se está marcando tu recorrido hasta que termines la ruta.' },
  });
}

async function apagar() {
  guardarJson(CLAVE_ULTIMAS, null);
  try {
    if (await Location.hasStartedLocationUpdatesAsync(TAREA_RUTA)) await Location.stopLocationUpdatesAsync(TAREA_RUTA);
  } catch (e) { console.warn('[ruta de fondo] no se apagó', e?.message ?? e); }
}

/**
 * Pide «mientras se usa» y después «siempre». Devuelve:
 * 'siempre' (hay fondo) | 'en-uso' (sólo con la app abierta) | 'denegado'.
 */
export async function pedirPermisoDeFondo() {
  try {
    let fg = await Location.getForegroundPermissionsAsync();
    if (fg.status !== 'granted' && fg.canAskAgain) fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') return 'denegado';
    let bg = await Location.getBackgroundPermissionsAsync();
    if (bg.status !== 'granted' && bg.canAskAgain) bg = await Location.requestBackgroundPermissionsAsync();
    return bg.status === 'granted' ? 'siempre' : 'en-uso';
  } catch (e) {
    console.warn('[ruta de fondo] permiso', e?.message ?? e);
    return 'en-uso';
  }
}

async function guardarYEncender(rutas) {
  guardarJson(CLAVE_ESTADO, sinRutas(rutas) ? null : rutas);
  if (sinRutas(rutas)) await apagar(); else await encender(rutas);
}

/**
 * Empieza a rastrear esta ruta con la app cerrada. `datos`: reparto
 * `{ rutaId }`, Torogoz `{ yo }`. Devuelve 'fondo' si quedó corriendo, o el
 * motivo por el que no ('en-uso' | 'denegado' | 'sin-fondo'): entonces la
 * pantalla abierta sigue rastreando como respaldo.
 */
export async function activarRutaDeFondo(tipo, datos) {
  const permiso = await pedirPermisoDeFondo();
  if (permiso !== 'siempre') { await quitarRutaDeFondo(tipo); return permiso; }
  const rutas = { ...rutasDeFondo(), [tipo]: tipo === 'torogoz' ? { ...datos, fecha: hoySV() } : datos };
  try {
    await guardarYEncender(rutas);
  } catch (e) {
    console.warn('[ruta de fondo] no arrancó', e?.message ?? e);
    const sin = { ...rutas };
    delete sin[tipo];
    await guardarYEncender(sin).catch(() => {});
    avisar();
    return 'sin-fondo';
  }
  avisar();
  return 'fondo';
}

/** Deja de rastrear esta ruta; si no queda ninguna, el GPS de fondo se apaga. */
export async function quitarRutaDeFondo(tipo) {
  const rutas = { ...rutasDeFondo() };
  if (!rutas[tipo]) {
    if (sinRutas(rutas)) await apagar();
    return;
  }
  delete rutas[tipo];
  await guardarYEncender(rutas).catch((e) => console.warn('[ruta de fondo]', e?.message ?? e));
  avisar();
}

/**
 * Al abrir la app con sesión: lo guardado manda. Si la ruta de reparto ya no
 * está en ruta en la base, o Torogoz era de ayer, o se quitó el permiso
 * «siempre», se suelta; si queda algo vivo y la tarea no corre, se reanuda.
 * Nunca queda el GPS encendido sin ruta.
 */
export async function revisarRastreoDeFondo() {
  const rutas = rutasDeFondo();
  if (rutas.reparto) {
    try {
      const { data, error } = await fetchEstadoDeRuta(rutas.reparto.rutaId);
      if (!error && !repartoSigueEnRuta(data?.status)) delete rutas.reparto;
    } catch { /* sin red: se conserva; la próxima apertura lo vuelve a mirar */ }
  }
  try {
    const bg = await Location.getBackgroundPermissionsAsync();
    if (bg.status !== 'granted') { guardarJson(CLAVE_ESTADO, null); await apagar(); avisar(); return; }
  } catch { /* sin módulo de ubicación: nada que revisar */ }
  try {
    guardarJson(CLAVE_ESTADO, sinRutas(rutas) ? null : rutas);
    if (sinRutas(rutas)) await apagar();
    else if (!(await Location.hasStartedLocationUpdatesAsync(TAREA_RUTA))) await encender(rutas);
  } catch (e) { console.warn('[ruta de fondo] revisión', e?.message ?? e); }
  avisar();
}

// Cerrar sesión suelta todo: el GPS de fondo es de la persona, no del aparato.
try {
  supabase.auth.onAuthStateChange((evento) => {
    if (evento !== 'SIGNED_OUT') return;
    guardarJson(CLAVE_ESTADO, null);
    Promise.resolve(apagar()).catch(() => {});
    avisar();
  });
} catch { /* sin cliente: no hay sesión que cerrar */ }
