// Recordatorio de tomas (2026-10-12): «Mis tratamientos» avisa cuándo se acaba
// un medicamento; esto avisa cuándo TOMARLO. Todo vive en el teléfono: la
// configuración, los avisos (locales, nunca push) y el registro de «Tomado».
// Al servidor no sale nada — a qué hora toma alguien su medicina es un dato de
// salud y no hace falta en ningún otro lado.
//
// El tope que manda el diseño: iOS guarda como mucho 64 avisos pendientes POR
// APP y, si se pide uno más, descarta en silencio. Por eso:
//   · «Uso continuo» va con UN aviso diario repetido por hora (8:00 y 20:00 son
//     dos pendientes para siempre, no dos por día).
//   · Lo que tiene fin va con avisos de fecha exacta hasta el último día —así
//     no suena de más si la app no se abre—, como mucho 60 por medicina, y
//     entre todos se reparten lo que deja el tope: primero los más cercanos.
//   · Cada vez que la app se abre o vuelve al frente se replanifica: lo que no
//     cupo entra a medida que se van gastando los cercanos.
//   · Se reservan 4 lugares para los «Más tarde».
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as FS from 'expo-file-system/legacy';
import { create } from 'zustand';
import { pedirPermisoDeAvisos } from './avisos';
import { nombrePropio } from './formato';

export const DISPONIBLE = Platform.OS !== 'web';
const ARCHIVO = FS.documentDirectory ? `${FS.documentDirectory}tomas.json` : null;
const CATEGORIA = 'toma';
const CANAL = 'tomas';
export const ACCION_TOMADO = 'toma_tomado';
export const ACCION_LUEGO = 'toma_luego';
const TOPE_TOTAL = 60; // de los 64 de iOS: 4 quedan para los «Más tarde»
const TOPE_POR_MEDICINA = 60;
const POSPONER_MIN = 15;
const DIAS_REGISTRO = 30;

export const PRESETS = { 1: ['08:00'], 2: ['08:00', '20:00'], 3: ['08:00', '14:00', '20:00'], 4: ['08:00', '12:00', '16:00', '20:00'],
  6: ['07:00', '10:00', '13:00', '16:00', '19:00', '22:00'] };

// ── Frecuencias (2026-10-14) ────────────────────────────────────────────────
// Dos formas de decirlo, las dos de una receta:
//   · «N veces al día» (1, 2, 3, 4 o 6): las tomas van DENTRO del día
//     despierto, repartidas parejo (2×: 8:00 y 20:00; 3×: 8:00, 14:00, 20:00);
//     la persona puede mover cualquiera y, si dos quedan muy juntas o fuera de
//     orden, la hoja lo advierte y ofrece «Ajustar automáticamente».
//   · «Cada N horas» (4, 6, 8 o 12): cubren las 24 horas a intervalos exactos
//     (cada 8 h: 6:00, 14:00 y 22:00). Mover una hora corre todas las demás,
//     porque lo que manda es el intervalo.
// Lo que se programa sigue siendo `horas` (la lista de siempre): `modo`, `n` e
// `inicio` sólo recuerdan cómo se armó para volver a abrir la hoja igual.
export const FRECUENCIAS = { veces: [1, 2, 3, 4, 6], cada: [4, 6, 8, 12] };
// Separación pareja dentro del día despierto, y desde qué hora.
const PASO_VECES = { 1: 0, 2: 12 * 60, 3: 6 * 60, 4: 4 * 60, 5: 3 * 60, 6: 3 * 60 };
const INICIO_CADA = { 4: '06:00', 6: '06:00', 8: '06:00', 12: '08:00' };
// Menos que esto entre dos tomas seguidas, se advierte (minutos).
const MINIMO_VECES = { 2: 4 * 60, 3: 3 * 60, 4: 2 * 60, 5: 2 * 60, 6: 90 };
const SEPARACION_TEXTO = { 2: 'unas 12 horas', 3: 'unas 6 a 8 horas', 4: 'unas 4 a 6 horas', 5: 'unas 3 a 4 horas', 6: 'unas 3 a 4 horas' };

// ── UNA sola pregunta (2026-10-14, «¿por qué pregunta veces al día Y cada
// cuántas horas? No tiene sentido») ─────────────────────────────────────────
// «3 veces al día» y «cada 8 horas» son la MISMA receta dicha de dos formas,
// y la hoja las ofrecía como dos filas de botones distintas. Ahora es una
// lista: cada opción dice las dos cosas («3 veces al día · cada 8 h») y se
// programa por INTERVALO desde la primera toma (por defecto 8:00): mover una
// hora corre las demás. «Otro horario» deja poner las horas a mano, con la
// revisión de siempre (`revisarHoras`).
//
// Lo guardado no cambia de forma: una opción de intervalo se guarda como
// `modo: 'cada'` con `n` = horas entre tomas (24 para una vez al día) e
// `inicio`; «Otro horario», como `modo: 'veces'` con `n` = cuántas tomas.
// Así los recordatorios ya guardados se abren sin migrar nada.
export const INICIO_DEFECTO = '08:00';
// La primera toma recomendada según la frecuencia (2026-10-14): con 3 al día
// desde las 8:00 la tercera caía a medianoche; desde las 6:00 queda 6/14/22.
const INICIO_RECOMENDADO = { 24: '08:00', 12: '08:00', 8: '06:00', 6: '06:00', 4: '06:00' };
export const inicioRecomendado = (cada) => INICIO_RECOMENDADO[cada] ?? INICIO_DEFECTO;
export const OPCIONES = [
  { id: '24', cada: 24, texto: '1 vez al día' },
  { id: '12', cada: 12, texto: '2 veces al día', detalle: 'cada 12 h' },
  { id: '8', cada: 8, texto: '3 veces al día', detalle: 'cada 8 h' },
  { id: '6', cada: 6, texto: '4 veces al día', detalle: 'cada 6 h' },
  { id: '4', cada: 4, texto: 'Cada 4 horas', detalle: '6 al día' },
  { id: 'otro', texto: 'Otro horario', detalle: 'tú eliges las horas' },
];
export const MAX_TOMAS_LIBRES = 6;

/**
 * Con qué opción se abre la hoja para un recordatorio guardado:
 * `{ opcion, horas }`. Uno viejo de «N veces al día» que quedó repartido
 * parejo cae en su opción de intervalo; si no, en «Otro horario» con sus horas.
 */
export function opcionGuardada(actual) {
  if (!actual) return { opcion: '12', horas: horasCada(INICIO_DEFECTO, 12) };
  if (actual.modo === 'cada' && actual.inicio && OPCIONES.some((o) => o.cada === actual.n)) {
    return { opcion: String(actual.n), horas: horasCada(actual.inicio, actual.n) };
  }
  const horas = [...(actual.horas ?? [INICIO_DEFECTO])].sort();
  if (horas.length === 1) return { opcion: '24', horas };
  const op = OPCIONES.find((o) => o.cada && Math.round(24 / o.cada) === horas.length);
  if (op) {
    // ¿Es un giro del reparto parejo? Se prueba desde cada toma.
    for (const ini of horas) {
      const pareja = horasCada(ini, op.cada);
      if ([...pareja].sort().join() === horas.join()) return { opcion: op.id, horas: pareja };
    }
  }
  return { opcion: 'otro', horas };
}

export const aMinutos = (h) => { const [hh, mm] = h.split(':').map(Number); return hh * 60 + mm; };
const deMinutos = (m) => { const t = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

/** Las horas de «cada N horas» a partir de la primera toma: cubren el día. */
export function horasCada(inicio, n) {
  return Array.from({ length: Math.round(24 / n) }, (_, j) => deMinutos(aMinutos(inicio) + j * n * 60));
}
/** Las horas de «N veces al día» a partir de la primera, con la separación pareja. */
export function horasVeces(inicio, n) {
  return Array.from({ length: n }, (_, j) => deMinutos(aMinutos(inicio) + j * PASO_VECES[n]));
}
/** Lo recomendado para cada frecuencia. */
export function horasRecomendadas(modo, n) {
  return modo === 'cada' ? horasCada(INICIO_CADA[n] ?? '06:00', n) : (PRESETS[n] ?? horasVeces('08:00', n));
}
/**
 * «N veces al día»: ¿quedaron bien repartidas? null si sí; si no, la frase.
 * Se miran las tomas en el orden de la lista (Toma 1, Toma 2…): una que va
 * antes que la anterior está fuera de orden; una a menos del mínimo, muy junta.
 */
export function revisarHoras(horas, n) {
  if (n < 2 || horas.length < 2) return null;
  const min = MINIMO_VECES[n] ?? 120;
  for (let i = 1; i < horas.length; i++) {
    const dif = aMinutos(horas[i]) - aMinutos(horas[i - 1]);
    if (dif <= 0) return { tipo: 'orden', mensaje: `La toma ${i + 1} quedó antes que la toma ${i}. Para ${n} veces al día deja ${SEPARACION_TEXTO[n]} entre tomas.` };
    if (dif < min) return { tipo: 'juntas', mensaje: `Las tomas ${i} y ${i + 1} quedaron muy juntas. Para ${n} veces al día deja ${SEPARACION_TEXTO[n]} entre tomas.` };
  }
  return null;
}
export const DURACIONES = [
  { id: '7', texto: '7 días', dias: 7 },
  { id: '14', texto: '14 días', dias: 14 },
  { id: '30', texto: '30 días', dias: 30 },
  { id: 'continuo', texto: 'Uso continuo' },
  { id: 'fecha', texto: 'Hasta una fecha' },
];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// Fechas en la hora DEL TELÉFONO: el aviso suena con su reloj.
const dos = (n) => String(n).padStart(2, '0');
const aIso = (d) => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
export const hoyLocal = () => aIso(new Date());
export function sumarDias(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return aIso(new Date(y, m - 1, d + n));
}
function enFecha(iso, hora) {
  const [y, m, d] = iso.split('-').map(Number);
  const [hh, mm] = hora.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}
const diasEntre = (a, b) => Math.round((enFecha(b, '12:00') - enFecha(a, '12:00')) / 86400_000);

/** '08:00' → «8:00». */
export const horaTexto = (h) => { const [hh, mm] = h.split(':'); return `${Number(hh)}:${mm}`; };
/** '2026-10-30' → «30 oct» (con el año sólo si no es este). */
export function diaTexto(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MESES[m - 1]}${y !== new Date().getFullYear() ? ` ${y}` : ''}`;
}
const enLista = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`);

/** «Te recuerdo 8:00 y 20:00 · hasta el 30 oct» (o «cada 8 h: 6:00, 14:00 y 22:00 · …»). */
export function resumenRecordatorio(c) {
  const lista = c.modo === 'cada' && c.inicio ? horasCada(c.inicio, c.n) : c.horas;
  const horas = `${c.modo === 'cada' && c.n && c.n < 24 ? `cada ${c.n} h: ` : ''}${enLista(lista.map(horaTexto))}`;
  return `Te recuerdo ${horas} · ${c.duracion === 'continuo' ? 'uso continuo' : `hasta el ${diaTexto(c.hasta)}`}`;
}

// «ACETAMINOFEN 500 MG TABLETA X 100» → «Acetaminofen»: el título de un aviso
// se corta a la primera línea, y la concentración no ayuda a reconocerlo.
export function nombreCorto(nombre) {
  const palabras = String(nombre ?? '').trim().split(/\s+/);
  const corto = [];
  for (const p of palabras) { if (/\d/.test(p) || corto.length >= 3) break; corto.push(p); }
  return nombrePropio((corto.length ? corto : palabras.slice(0, 2)).join(' '));
}

// ── Lo guardado ─────────────────────────────────────────────────────────────
// En un archivo y no en SecureStore: con varias medicinas y 30 días de tomas
// pasa del tamaño que el llavero acepta (igual que lib/sinConexion.js).
// `config` va por product_id: { product_id, nombre, horas, duracion, hasta, nota, se_acaba }.
// `registro`: [{ p: product_id, h: ISO }] — «Tomado», los últimos 30 días.

async function escribir(estado) {
  if (!ARCHIVO) return;
  await FS.writeAsStringAsync(ARCHIVO, JSON.stringify({ config: estado.config, registro: estado.registro })).catch(() => {});
}

export const useTomas = create((set, get) => ({
  config: {},
  registro: [],
  listo: false,
  cargar: async () => {
    if (get().listo || !DISPONIBLE || !ARCHIVO) { set({ listo: true }); return; }
    try {
      const info = await FS.getInfoAsync(ARCHIVO);
      if (info.exists) {
        const d = JSON.parse(await FS.readAsStringAsync(ARCHIVO));
        const corte = Date.now() - DIAS_REGISTRO * 86400_000;
        set({ config: d?.config ?? {}, registro: (d?.registro ?? []).filter((x) => Date.parse(x.h) >= corte) });
      }
    } catch { /* archivo dañado: se empieza de cero */ }
    set({ listo: true });
  },
  poner: (cambio) => { set(cambio); escribir(get()); },
}));

/** La hora de la última toma de HOY de un medicamento («8:05»), o null. */
export function tomadoHoy(registro, productId) {
  const hoy = hoyLocal();
  for (let i = registro.length - 1; i >= 0; i--) {
    const x = registro[i];
    if (x.p !== productId) continue;
    const d = new Date(x.h);
    return aIso(d) === hoy ? `${d.getHours()}:${dos(d.getMinutes())}` : null;
  }
  return null;
}

// ── Lo que hace la hoja ─────────────────────────────────────────────────────

/** Guarda (o reemplaza) el recordatorio. Devuelve `{ ok }` o `{ error }` para mostrar. */
export async function guardarRecordatorio(c) {
  if (!DISPONIBLE) return { error: 'Los recordatorios sólo funcionan en el teléfono.' };
  if (!(await pedirPermisoDeAvisos())) return { error: 'Activa las notificaciones de Puntos Salud en los ajustes del teléfono para recibir tus recordatorios.' };
  await useTomas.getState().cargar();
  const { config, poner } = useTomas.getState();
  const horas = [...new Set(c.horas)].sort();
  poner({ config: { ...config, [c.product_id]: { ...c, horas } } });
  await replanificar();
  return { ok: true };
}

/** Quita el recordatorio de un medicamento y sus avisos pendientes. */
export async function quitarRecordatorio(productId) {
  if (!DISPONIBLE) return;
  await useTomas.getState().cargar();
  const { config, poner } = useTomas.getState();
  if (!config[productId]) return;
  const resto = { ...config };
  delete resto[productId];
  poner({ config: resto });
  await replanificar();
}

/**
 * Con la lista de «Mis tratamientos»: actualiza cuándo se le acaba cada uno
 * (para el «Te quedan pocas») y quita el recordatorio de lo que ya no toma.
 */
export async function sincronizarConTratamientos(lista) {
  if (!DISPONIBLE || !Array.isArray(lista)) return;
  await useTomas.getState().cargar();
  const { config, poner } = useTomas.getState();
  let cambio = false;
  const nueva = { ...config };
  for (const pid of Object.keys(config)) {
    const t = lista.find((x) => String(x.product_id) === pid);
    if (!t) continue; // si no viene en la lista no se adivina: se deja
    if (t.estado !== 'activo') { delete nueva[pid]; cambio = true; continue; }
    if ((t.se_acaba ?? null) !== (config[pid].se_acaba ?? null)) { nueva[pid] = { ...config[pid], se_acaba: t.se_acaba ?? null }; cambio = true; }
  }
  if (cambio) { poner({ config: nueva }); await replanificar(); }
}

// ── Los avisos ──────────────────────────────────────────────────────────────

let categoriaLista = false;
async function asegurarCategoria() {
  if (categoriaLista) return;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CANAL, {
      name: 'Recordatorio de tomas', importance: Notifications.AndroidImportance.HIGH, sound: 'default',
    }).catch(() => {});
  }
  await Notifications.setNotificationCategoryAsync(CATEGORIA, [
    { identifier: ACCION_TOMADO, buttonTitle: 'Tomado', options: { opensAppToForeground: false } },
    { identifier: ACCION_LUEGO, buttonTitle: `Más tarde (${POSPONER_MIN} min)`, options: { opensAppToForeground: false } },
  ]).catch(() => {});
  categoriaLista = true;
}

// ¿Se le acaba en 3 días o menos, contando desde el día de la toma?
const pocas = (c, dia) => !!c.se_acaba && diasEntre(dia, c.se_acaba) <= 3;

function contenido(c, dia, extra = '') {
  const quedanPocas = pocas(c, dia);
  const partes = [c.nota?.trim() || 'Toca «Tomado» cuando lo tomes.'];
  if (quedanPocas) partes.push('Te quedan pocas, ¿lo reservamos?');
  if (extra) partes.push(extra);
  return {
    title: `Hora de tu ${nombreCorto(c.nombre)}`,
    body: partes.join(' '),
    sound: 'default',
    categoryIdentifier: CATEGORIA,
    // `tipo` pinta el banner con la app abierta como los de tratamientos; la
    // `url` sólo cuando hay que reservar (tocarlo lleva a «Mis tratamientos»).
    data: { toma: String(c.product_id), tipo: 'tratamiento', ...(quedanPocas ? { url: '/tratamientos' } : {}) },
  };
}

async function planificar() {
  if (!DISPONIBLE) return;
  await useTomas.getState().cargar();
  const hoy = hoyLocal();
  // Lo que terminó, se va solo.
  const { config, poner } = useTomas.getState();
  const vigentes = Object.fromEntries(Object.entries(config).filter(([, c]) => c.duracion === 'continuo' || (c.hasta && c.hasta >= hoy)));
  if (Object.keys(vigentes).length !== Object.keys(config).length) poner({ config: vigentes });

  const pendientes = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  let pospuestas = 0;
  for (const p of pendientes) {
    const d = p?.content?.data ?? {};
    if (!d.toma) continue;
    // Un «Más tarde» de algo que ya no tiene recordatorio también se va.
    if (d.pospuesta && vigentes[d.toma]) { pospuestas++; continue; }
    await Notifications.cancelScheduledNotificationAsync(p.identifier).catch(() => {});
  }
  const lista = Object.values(vigentes);
  if (!lista.length) return;
  const { status } = await Notifications.getPermissionsAsync().catch(() => ({ status: null }));
  if (status !== 'granted') return; // sin permiso no hay qué programar; se reintenta al volver
  await asegurarCategoria();

  let libres = Math.max(0, TOPE_TOTAL - pospuestas);
  const canal = Platform.OS === 'android' ? { channelId: CANAL } : {};

  // Uso continuo: un diario por hora. Van primero porque no se renuevan solos.
  for (const c of lista.filter((x) => x.duracion === 'continuo')) {
    for (const h of c.horas) {
      if (libres <= 0) break;
      const [hour, minute] = h.split(':').map(Number);
      await Notifications.scheduleNotificationAsync({
        content: contenido(c, hoy),
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute, ...canal },
      }).then(() => { libres--; }).catch(() => {});
    }
  }

  // Con fin: cada toma con su fecha, las más cercanas primero entre todas.
  const ahora = Date.now() + 30_000;
  const tomas = [];
  const total = {};
  for (const c of lista.filter((x) => x.duracion !== 'continuo')) {
    let n = 0;
    for (let dia = hoy; dia <= c.hasta; dia = sumarDias(dia, 1)) {
      for (const h of c.horas) {
        const cuando = enFecha(dia, h);
        if (cuando.getTime() <= ahora) continue;
        n++;
        if (n <= TOPE_POR_MEDICINA) tomas.push({ c, dia, cuando });
      }
    }
    total[c.product_id] = n;
  }
  tomas.sort((a, b) => a.cuando - b.cuando);
  const elegidas = tomas.slice(0, libres);
  // La última que cupo de una medicina que no cupo entera pide abrir la app:
  // si nadie la abre en una semana, que no se corte sin decir nada.
  const ultima = {};
  elegidas.forEach((x, i) => { ultima[x.c.product_id] = i; });
  const cuentan = {};
  elegidas.forEach((x) => { cuentan[x.c.product_id] = (cuentan[x.c.product_id] ?? 0) + 1; });
  for (let i = 0; i < elegidas.length; i++) {
    const { c, dia, cuando } = elegidas[i];
    const corta = ultima[c.product_id] === i && cuentan[c.product_id] < total[c.product_id];
    await Notifications.scheduleNotificationAsync({
      content: contenido(c, dia, corta ? 'Abre Puntos Salud para seguir recibiendo tus recordatorios.' : ''),
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: cuando, ...canal },
    }).catch(() => {});
  }
}

// Una replanificación a la vez: dos en paralelo cancelarían lo que la otra programa.
let cola = Promise.resolve();
export function replanificar() {
  cola = cola.then(planificar).catch(() => {});
  return cola;
}

// ── Las respuestas: «Tomado» y «Más tarde» ──────────────────────────────────

const atendidas = new Set();

/** ¿Es un botón de un aviso de toma? (AbrirAviso no debe navegar con ésos.) */
export function esAccionDeToma(r) {
  const a = r?.actionIdentifier;
  return !!r?.notification?.request?.content?.data?.toma && (a === ACCION_TOMADO || a === ACCION_LUEGO);
}

async function atender(r) {
  if (!esAccionDeToma(r)) return;
  const n = r.notification;
  const llave = `${n.request.identifier}|${r.actionIdentifier}|${n.date}`;
  if (atendidas.has(llave)) return; // la respuesta de arranque y el oyente traen la misma
  atendidas.add(llave);
  // Atendida: que al volver a abrir la app no se cuente otra vez.
  Notifications.clearLastNotificationResponseAsync?.().catch?.(() => {});
  const pid = n.request.content.data.toma;
  Notifications.dismissNotificationAsync(n.request.identifier).catch(() => {});
  if (r.actionIdentifier === ACCION_TOMADO) {
    await useTomas.getState().cargar();
    const { registro, poner } = useTomas.getState();
    const corte = Date.now() - DIAS_REGISTRO * 86400_000;
    poner({ registro: [...registro.filter((x) => Date.parse(x.h) >= corte), { p: pid, h: new Date().toISOString() }] });
    return;
  }
  // «Más tarde»: 15 minutos después de que sonó. Si la respuesta llega tarde
  // (la app estaba cerrada y se abrió después), no se inventa un aviso viejo.
  const sono = typeof n.date === 'number' && n.date > 0 ? n.date : Date.now();
  const segundos = Math.round((sono + POSPONER_MIN * 60_000 - Date.now()) / 1000);
  if (segundos < 5) return;
  const { title, body, sound, categoryIdentifier, data } = n.request.content;
  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: sound ? 'default' : undefined, categoryIdentifier, data: { ...data, pospuesta: true } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: segundos, repeats: false,
      ...(Platform.OS === 'android' ? { channelId: CANAL } : {}) },
  }).catch(() => {});
}

let instalado = false;
/**
 * Una vez, al arrancar (app/_layout.js): el oyente de los botones va a nivel
 * de módulo para no perder el que despertó a la app, y al abrirla o volver al
 * frente se replanifica.
 */
export function instalarTomas() {
  if (instalado || !DISPONIBLE) return;
  instalado = true;
  Notifications.addNotificationResponseReceivedListener((r) => { atender(r); });
  Notifications.getLastNotificationResponseAsync().then((r) => r && atender(r)).catch(() => {});
  useTomas.getState().cargar().then(() => { if (Object.keys(useTomas.getState().config).length) replanificar(); });
  AppState.addEventListener('change', (e) => {
    if (e === 'active' && Object.keys(useTomas.getState().config).length) replanificar();
  });
}

/** Al cerrar sesión en un teléfono compartido: fuera avisos, configuración y registro. */
export function olvidarTomas() {
  if (!DISPONIBLE) return Promise.resolve();
  // En la misma cola: una replanificación en vuelo volvería a programar lo borrado.
  cola = cola.then(async () => {
    useTomas.setState({ config: {}, registro: [], listo: true });
    const pendientes = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
    for (const p of pendientes) {
      if (p?.content?.data?.toma) await Notifications.cancelScheduledNotificationAsync(p.identifier).catch(() => {});
    }
    if (ARCHIVO) await FS.deleteAsync(ARCHIVO, { idempotent: true }).catch(() => {});
  }).catch(() => {});
  return cola;
}
