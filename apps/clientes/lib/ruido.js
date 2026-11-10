// Ruido blanco y sonidos de fondo (Bienestar, 2026-11-10: «en bienestar,
// podemos agregar ruido blanco?»).
//
// Nada se descarga: cada sonido se FABRICA en el teléfono la primera vez que
// se pide —unos segundos de ruido calculado muestra por muestra— y después se
// repite en bucle con `react-native-audio-api` (el motor de audio de los
// juegos, en su propio contexto para que el `callar` de un juego no lo duerma).
// El final de cada bucle se funde con su principio: sin el «clic» del empalme.
//
// Suena mientras la app está abierta: el binario no pide audio en segundo
// plano (app.json, `iosBackgroundMode: false`), así que al bloquear el
// teléfono iOS lo pausa. Por eso la pantalla de ruido no deja que se apague.
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
let actual = null;

function contexto() {
  if (ctx || !AudioAPI) return ctx;
  try {
    if (Platform.OS === 'ios') {
      AudioAPI.AudioManager?.setSystemOptions?.({ ios: { category: 'playback', options: ['mixWithOthers'] } });
    }
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

let volumen = 0.6;

/** Empieza (o cambia a) un sonido, entrando suave. */
export async function sonarRuido(tipo) {
  const c = contexto();
  if (!c) return false;
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
  nodo = n; actual = tipo;
  rampa(volumen, 1.2);
  return true;
}

export function volumenRuido(v) {
  volumen = v;
  if (nodo && ctx) rampa(v, 0.3);
}

/** Para, apagándose en `seg` segundos (al terminar el temporizador, más lento). */
export function pararRuido(seg = 0.6) {
  if (!nodo || !ctx) return;
  const n = nodo;
  nodo = null; actual = null;
  rampa(0, seg);
  setTimeout(() => {
    try { n.stop(); } catch { /* ya paró */ }
    if (!nodo && ctx?.state === 'running') ctx.suspend().catch(() => {});
  }, seg * 1000 + 100);
}

export const ruidoActual = () => actual;
