// Ruido blanco y sonidos de fondo (Bienestar, 2026-11-10: «en bienestar,
// podemos agregar ruido blanco?»).
//
// Nada se descarga: cada sonido se FABRICA en el teléfono la primera vez que
// se pide —unos segundos de ruido calculado muestra por muestra— y después se
// repite en bucle con `react-native-audio-api` (el motor de audio de los
// juegos, en su propio contexto para que el `callar` de un juego no lo duerma).
// El final de cada bucle se funde con su principio: sin el «clic» del empalme.
//
// Con el teléfono bloqueado (2026-11-10, «puedes hacer que funcione
// bloqueado?»): el binario pide audio en segundo plano (app.json,
// `iosBackgroundMode` y el servicio de primer plano de Android) y, mientras
// suena, `PlaybackNotificationManager` pone el control en la pantalla de
// bloqueo de iPhone y la notificación fija que Android exige. El temporizador
// se programa DENTRO del audio (una rampa de volumen hasta cero): se cumple
// aunque el teléfono esté bloqueado y JavaScript dormido.
//
// Un binario viejo, sin el permiso, sigue funcionando igual que antes: suena
// con la app abierta y se pausa al bloquear.
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

let AudioAPI = null;
try { AudioAPI = require('react-native-audio-api'); } catch { AudioAPI = null; }

const FREC = 44100;
const SEG = 12; // dura el bucle; las olas caben enteras (dos de 6 s)
const FUNDIDO = Math.round(FREC * 0.5);

export const SONIDOS = {
  blanco: { nombre: 'Blanco', detalle: 'Parejo, tapa ruidos', sf: 'waveform' },
  rosa: { nombre: 'Rosa', detalle: 'Más suave, para dormir', sf: 'moon.stars.fill' },
  cafe: { nombre: 'Profundo', detalle: 'Grave, como un ventilador', sf: 'fan.fill' },
  lluvia: { nombre: 'Lluvia', detalle: 'Lluvia constante', sf: 'cloud.rain.fill' },
  olas: { nombre: 'Olas', detalle: 'El mar que va y viene', sf: 'water.waves' },
};

// Un generador de números al azar con semilla: el mismo sonido sale igual
// siempre, y no depende de Math.random.
function azar(semilla) {
  let s = semilla >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

function canal(tipo, semilla) {
  const n = FREC * SEG;
  const total = n + FUNDIDO;
  const r = azar(semilla);
  const x = new Float32Array(total);
  // Rosa: filtro de Paul Kellet. Marrón: integrador con fuga.
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, cafe = 0, lp = 0;
  for (let i = 0; i < total; i++) {
    const w = r();
    if (tipo === 'blanco') { x[i] = w * 0.32; continue; }
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    const rosa = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
    cafe = (cafe + 0.02 * w) / 1.02;
    if (tipo === 'rosa') x[i] = rosa * 0.9;
    else if (tipo === 'cafe') x[i] = cafe * 3.2;
    else if (tipo === 'lluvia') {
      // Rosa sin los graves más una lluvia de gotitas cortas.
      lp += 0.08 * (rosa - lp);
      x[i] = (rosa - lp) * 1.4 + cafe * 0.8;
    } else if (tipo === 'olas') {
      // Profundo con un vaivén de 6 s: crece, rompe (brillo) y se retira.
      const fase = ((i % n) / FREC / 6) % 1;
      const ola = Math.pow(Math.sin(Math.PI * fase), 2);
      lp += (0.02 + 0.2 * ola) * (rosa - lp);
      x[i] = (cafe * 2.2 + lp * 1.6) * (0.25 + 0.75 * ola);
    }
  }
  if (tipo === 'lluvia') {
    // Gotas: chasquidos que se apagan en ~15 ms, a destiempo en cada canal.
    for (let k = 0; k < SEG * 90; k++) {
      const at = Math.floor(((r() + 1) / 2) * (n - 800));
      const amp = 0.05 + 0.1 * ((r() + 1) / 2);
      for (let j = 0; j < 700; j++) x[at + j] += r() * amp * Math.exp(-j / 110);
    }
  }
  // El fundido: el tramo extra del final se mezcla sobre el principio.
  const out = new Float32Array(n);
  out.set(x.subarray(0, n));
  for (let j = 0; j < FUNDIDO; j++) {
    const k = j / FUNDIDO;
    out[j] = x[n + j] * (1 - k) + x[j] * k;
  }
  // Todos al mismo volumen percibido, y sin pasar del tope (las olas, al
  // romper, saturaban).
  let pico = 0, suma = 0;
  for (let i = 0; i < n; i++) { const v = out[i]; suma += v * v; if (Math.abs(v) > pico) pico = Math.abs(v); }
  const g = Math.min(0.17 / Math.sqrt(suma / n), 0.9 / pico);
  for (let i = 0; i < n; i++) out[i] *= g;
  return out;
}

let ctx = null;
let salida = null;
const buffers = {};
let nodo = null;
let volumen = 0.6;
let relojFin = null;
let subsAviso = [];
// Lo que ve la pantalla: también cambia desde la notificación o al vencer el
// temporizador con la pantalla apagada.
let estado = { sonando: false, tipo: 'blanco', finEn: null };
const oyentes = new Set();
function poner(cambio) {
  estado = { ...estado, ...cambio };
  oyentes.forEach((f) => f(estado));
}

/** El estado del ruido, para la pantalla. */
export function useRuido() {
  const [e, setE] = useState(estado);
  useEffect(() => { oyentes.add(setE); setE(estado); return () => { oyentes.delete(setE); }; }, []);
  return e;
}

const Aviso = () => AudioAPI?.PlaybackNotificationManager ?? null;

// En iPhone, mientras suena, la sesión NO se mezcla con otras apps: es lo que
// le da el control en la pantalla de bloqueo. Al parar vuelve a mezclarse,
// como la quieren los juegos (lib/sensaciones.js).
function sesion(propia) {
  if (Platform.OS !== 'ios') return;
  try {
    AudioAPI.AudioManager?.setSystemOptions?.({ ios: { category: 'playback', options: propia ? [] : ['mixWithOthers'] } });
  } catch { /* sin opciones de sesión, suena igual */ }
}

function contexto() {
  if (ctx || !AudioAPI) return ctx;
  try {
    sesion(true);
    ctx = new AudioAPI.AudioContext();
    salida = ctx.createGain();
    salida.gain.value = 0;
    salida.connect(ctx.destination);
  } catch { ctx = null; }
  return ctx;
}

function buffer(tipo) {
  if (buffers[tipo]) return buffers[tipo];
  const c = contexto();
  if (!c) return null;
  const b = c.createBuffer(2, FREC * SEG, FREC);
  b.copyToChannel(canal(tipo, 11), 0);
  b.copyToChannel(canal(tipo, 29), 1);
  buffers[tipo] = b;
  return b;
}

/** ¿Este teléfono puede sonar? (sin el motor de audio, la pantalla lo dice). */
export const ruidoDisponible = () => !!AudioAPI;

function rampa(valor, seg) {
  const t = ctx.currentTime;
  try {
    salida.gain.cancelScheduledValues(t);
    salida.gain.setValueAtTime(salida.gain.value, t);
    salida.gain.linearRampToValueAtTime(valor, t + seg);
  } catch { salida.gain.value = valor; }
}

// El temporizador, dentro del audio: el volumen se queda donde está hasta 30 s
// antes del final y de ahí baja a cero. El reloj de JavaScript sólo limpia.
function programarFin() {
  clearTimeout(relojFin);
  if (!nodo || !ctx) return;
  const t = ctx.currentTime;
  try {
    salida.gain.cancelScheduledValues(t + 1.3);
    if (estado.finEn) {
      const quedan = Math.max(2, (estado.finEn - Date.now()) / 1000);
      const bajar = Math.min(30, quedan - 1);
      salida.gain.setValueAtTime(volumen, t + Math.max(1.3, quedan - bajar));
      salida.gain.linearRampToValueAtTime(0, t + quedan);
      relojFin = setTimeout(() => terminar(), quedan * 1000 + 200);
    }
  } catch { /* sin automatización: lo apaga el reloj */
    if (estado.finEn) relojFin = setTimeout(() => pararRuido(), Math.max(0, estado.finEn - Date.now()));
  }
}

async function mostrarAviso(tipo) {
  const A = Aviso();
  if (!A) return;
  try {
    await A.show({ title: `Ruido blanco · ${SONIDOS[tipo].nombre}`, artist: 'Puntos Salud', isLiveStream: true, state: 'playing' });
    for (const [c, on] of [['play', true], ['pause', true], ['stop', true], ['nextTrack', false], ['previousTrack', false], ['skipForward', false], ['skipBackward', false], ['seekTo', false]]) {
      await A.enableControl(c, on).catch(() => {});
    }
    if (!subsAviso.length) {
      subsAviso = [
        A.addEventListener('playbackNotificationPause', () => pausar()),
        A.addEventListener('playbackNotificationStop', () => pararRuido()),
        A.addEventListener('playbackNotificationDismissed', () => pararRuido()),
        A.addEventListener('playbackNotificationPlay', () => { sonarRuido(estado.tipo); }),
      ];
    }
  } catch { /* sin aviso: suena igual */ }
}
function ocultarAviso() {
  const A = Aviso();
  if (!A) return;
  A.hide().catch(() => {});
}

/** Empieza (o cambia a) un sonido, entrando suave. `minutos` 0 = sin límite. */
export async function sonarRuido(tipo, minutos) {
  const c = contexto();
  if (!c) return false;
  sesion(true);
  if (c.state === 'suspended') await c.resume().catch(() => {});
  const b = buffer(tipo);
  if (!b) return false;
  const viejo = nodo;
  if (viejo) { rampa(0, 0.25); await new Promise((ok) => setTimeout(ok, 260)); try { viejo.stop(); } catch { /* ya paró */ } }
  const n = c.createBufferSource();
  n.buffer = b;
  n.loop = true;
  n.connect(salida);
  n.start();
  nodo = n;
  rampa(volumen, 1.2);
  const finEn = minutos === undefined ? estado.finEn : minutos ? Date.now() + minutos * 60_000 : null;
  poner({ sonando: true, tipo, finEn });
  programarFin();
  mostrarAviso(tipo);
  return true;
}

/** Cambia el temporizador del sonido que ya suena. */
export function temporizadorRuido(minutos) {
  poner({ finEn: minutos ? Date.now() + minutos * 60_000 : null });
  if (nodo) { rampa(volumen, 0.3); programarFin(); }
}

export function volumenRuido(v) {
  volumen = v;
  if (nodo && ctx) { rampa(v, 0.3); programarFin(); }
}

function soltar(n, seg) {
  setTimeout(() => {
    try { n.stop(); } catch { /* ya paró */ }
    if (!nodo && ctx?.state === 'running') ctx.suspend().catch(() => {});
  }, seg * 1000 + 100);
}

// Al vencer el temporizador: la rampa ya lo dejó en silencio.
function terminar() {
  if (!nodo) return;
  const n = nodo;
  nodo = null;
  soltar(n, 0);
  poner({ sonando: false, finEn: null });
  ocultarAviso();
  sesion(false);
}

// Pausa desde la pantalla de bloqueo: para, pero el aviso queda para reanudar.
function pausar() {
  if (!nodo || !ctx) return;
  const n = nodo;
  nodo = null;
  clearTimeout(relojFin);
  rampa(0, 0.4);
  soltar(n, 0.4);
  poner({ sonando: false });
  Aviso()?.show({ state: 'paused' }).catch(() => {});
}

/** Para, apagándose en `seg` segundos. */
export function pararRuido(seg = 0.6) {
  clearTimeout(relojFin);
  ocultarAviso();
  poner({ sonando: false, finEn: null });
  if (!nodo || !ctx) { sesion(false); return; }
  const n = nodo;
  nodo = null;
  rampa(0, seg);
  soltar(n, seg);
  sesion(false);
}
