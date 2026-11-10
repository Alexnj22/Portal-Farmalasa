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
// con la app abierta, se pausa al bloquear y no muestra el control
// (`conSegundoPlano`).
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import { Asset } from 'expo-asset';
import PortadaViva from '../modules/portada-viva';
import VIVAS from './portadasVivas';

let AudioAPI = null;
try { AudioAPI = require('react-native-audio-api'); } catch { AudioAPI = null; }

// 22 050 muestras por segundo: el parlante de un teléfono no da más de 11 kHz
// y fabricar el sonido cuesta la mitad. El motor lo lleva a su frecuencia.
const FREC = 22050;
const FUNDIDO = Math.round(FREC * 0.6);

// Segunda versión, el mismo día: «se escuchan casi igual todos». Antes los
// cinco eran ruido filtrado distinto, y por el parlante de un teléfono el
// filtro casi no se nota. Ahora cada uno tiene SU forma: la lluvia son miles
// de gotas con tono, las olas crecen, rompen y se retiran, el fuego chisporrotea,
// los grillos cantan en pulsos y el ventilador zumba. `seg`: cuánto dura su
// bucle (las olas necesitan espacio para tres olas distintas).
export const SONIDOS = {
  lluvia: { nombre: 'Lluvia', detalle: 'Gotas sobre el techo', sf: 'cloud.rain.fill', seg: 16, colores: ['#050B18', '#0F2440', '#1D3B5E'], acento: '#8EC5FF' },
  olas: { nombre: 'Olas', detalle: 'El mar que va y viene', sf: 'water.waves', seg: 26, colores: ['#021A26', '#06394D', '#0D5C6E'], acento: '#6FE3E1' },
  fuego: { nombre: 'Fogata', detalle: 'Leña que cruje', sf: 'flame.fill', seg: 14, colores: ['#140504', '#3A0E06', '#6B1F08'], acento: '#FFB25B' },
  noche: { nombre: 'Noche', detalle: 'Grillos en el campo', sf: 'moon.stars.fill', seg: 15, colores: ['#04061A', '#0F1640', '#25235E'], acento: '#C9B8FF' },
  ventilador: { nombre: 'Ventilador', detalle: 'Zumbido parejo', sf: 'fan.fill', seg: 12, colores: ['#0B1116', '#1A2731', '#2C3E4C'], acento: '#A7C4D8' },
  blanco: { nombre: 'Blanco', detalle: 'Brillante, tapa todo', sf: 'waveform', seg: 10, colores: ['#101014', '#26262E', '#3A3A46'], acento: '#FFFFFF' },
  rosa: { nombre: 'Rosa', detalle: 'Suave, para dormir', sf: 'sparkles', seg: 10, colores: ['#1A0716', '#3D1235', '#6A2158'], acento: '#FF9AD5' },
  cafe: { nombre: 'Profundo', detalle: 'Grave, como un avión', sf: 'airplane', seg: 12, colores: ['#120B06', '#2E1D10', '#4A2F1A'], acento: '#E0B98A' },
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
const u = (r) => (r() + 1) / 2; // 0..1

// Las tres bases: blanco, rosa (Paul Kellet) y marrón (integrador con fuga).
function bases(total, r) {
  const w = new Float32Array(total), p = new Float32Array(total), m = new Float32Array(total);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, c = 0;
  for (let i = 0; i < total; i++) {
    const x = r();
    b0 = 0.99886 * b0 + x * 0.0555179; b1 = 0.99332 * b1 + x * 0.0750759;
    b2 = 0.969 * b2 + x * 0.153852; b3 = 0.8665 * b3 + x * 0.3104856;
    b4 = 0.55 * b4 + x * 0.5329522; b5 = -0.7616 * b5 - x * 0.016898;
    p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11;
    b6 = x * 0.115926;
    c = (c + 0.02 * x) / 1.02;
    w[i] = x; m[i] = c * 3.5;
  }
  return { w, p, m };
}

// Un golpe con tono que se apaga: una gota, un chasquido, un pulso de grillo.
// Sin un seno ni una exponencial por muestra (son miles de gotas): el tono gira
// con una rotación y la caída es una multiplicación.
function golpe(x, at, frec, amp, caida, dur, r, ruido = 0) {
  const fin = Math.min(x.length, at + dur);
  const paso = (2 * Math.PI * frec) / FREC;
  const c = Math.cos(paso), q = Math.sin(paso), baja = Math.exp(-1 / caida);
  let sn = 0, cs = 1, env = amp;
  const tono = 1 - ruido;
  for (let j = 0, i = at; i < fin; i++, j++) {
    x[i] += (sn * tono + r() * ruido) * env * (j < 12 ? j / 12 : 1);
    const s2 = sn * c + cs * q; cs = cs * c - sn * q; sn = s2;
    env *= baja;
  }
}

function canal(tipo, semilla) {
  const seg = SONIDOS[tipo].seg;
  const n = FREC * seg;
  const total = n + FUNDIDO;
  const r = azar(semilla);
  const { w, p, m } = bases(total, r);
  const x = new Float32Array(total);
  let lp = 0, lp2 = 0, hp = 0;

  if (tipo === 'blanco') {
    for (let i = 0; i < total; i++) x[i] = w[i];
  } else if (tipo === 'rosa') {
    // Rosa con los agudos recortados: el siseo se vuelve un soplo.
    for (let i = 0; i < total; i++) { lp += 0.35 * (p[i] - lp); x[i] = lp; }
  } else if (tipo === 'cafe') {
    // Marrón, y encima un soplo grave que respira muy lento (la cabina).
    for (let i = 0; i < total; i++) {
      const t = (i % n) / FREC;
      lp += 0.06 * (p[i] - lp);
      x[i] = m[i] * (0.9 + 0.1 * Math.sin((2 * Math.PI * t) / seg)) + lp * 0.5;
    }
  } else if (tipo === 'ventilador') {
    // Motor: zumbido de 100 Hz con armónicos, aire que pasa por las aspas
    // (un vaivén de 12 Hz) y un batido lento. Frecuencias enteras: el bucle cierra.
    for (let i = 0; i < total; i++) {
      const t = i / FREC;
      lp += 0.12 * (p[i] - lp);
      const aspas = 1 + 0.18 * Math.sin(2 * Math.PI * 12 * t);
      const motor = 0.05 * Math.sin(2 * Math.PI * 100 * t) + 0.03 * Math.sin(2 * Math.PI * 200 * t + 0.5) + 0.015 * Math.sin(2 * Math.PI * 300 * t);
      x[i] = (lp * 1.3 + m[i] * 0.5) * aspas + motor * (1 + 0.3 * Math.sin((2 * Math.PI * t) / 4));
    }
  } else if (tipo === 'lluvia') {
    // Cama: el rumor lejano (rosa sin graves) y el agua que corre (marrón suave).
    for (let i = 0; i < total; i++) {
      lp += 0.05 * (p[i] - lp);
      x[i] = (p[i] - lp) * 0.55 + m[i] * 0.18;
    }
    // Miles de gotas chicas y agudas, unas cuantas gordas que suenan a techo.
    for (let k = 0; k < seg * 420; k++) {
      golpe(x, Math.floor(u(r) * n), 1800 + u(r) * 4200, 0.02 + 0.05 * u(r) ** 2, 25 + 60 * u(r), 500, r, 0.55);
    }
    for (let k = 0; k < seg * 7; k++) {
      golpe(x, Math.floor(u(r) * n), 500 + u(r) * 900, 0.08 + 0.12 * u(r), 180 + 200 * u(r), 2200, r, 0.3);
    }
  } else if (tipo === 'olas') {
    // Tres olas de largo distinto: crecen despacio, rompen (un golpe brillante)
    // y se retiran arrastrando espuma (siseo que se apaga).
    const largos = [9.5, 7.5, 9];
    const inicios = [0, 9.5, 17];
    for (let i = 0; i < total; i++) {
      const t = (i % n) / FREC;
      let k = 0;
      while (k < 2 && t >= inicios[k + 1]) k++;
      const f = (t - inicios[k]) / largos[k];
      const sube = f < 0.55 ? Math.pow(f / 0.55, 2.2) : 0;
      const rompe = f >= 0.55 ? Math.exp(-(f - 0.55) * 9) : 0;
      const espuma = f >= 0.55 ? Math.exp(-(f - 0.55) * 3.2) : 0;
      lp += (0.01 + 0.12 * (sube + rompe)) * (p[i] - lp);
      hp = 0.97 * (hp + w[i] - (i ? w[i - 1] : 0));
      x[i] = m[i] * (0.18 + 0.5 * sube + 0.6 * rompe) + lp * (0.4 + 1.4 * rompe) + hp * 0.22 * espuma * (0.6 + 0.4 * u(r));
    }
  } else if (tipo === 'fuego') {
    // Rumor de llama (grave que ondula) y chasquidos: muchos chicos, en racimos,
    // y de vez en cuando el «crac» de un leño.
    for (let i = 0; i < total; i++) {
      const t = i / FREC;
      lp += 0.03 * (p[i] - lp);
      lp2 += 0.2 * (w[i] - lp2);
      x[i] = m[i] * (0.4 + 0.15 * Math.sin(2 * Math.PI * 0.5 * t)) + lp * 0.8 + (w[i] - lp2) * 0.04;
    }
    let at = 0;
    while (at < n) {
      at += Math.floor(FREC * (0.03 + 0.25 * u(r) ** 2));
      const racimo = 1 + Math.floor(u(r) * 4);
      for (let c = 0; c < racimo && at < n; c++) {
        golpe(x, at, 1500 + u(r) * 3500, 0.15 + 0.35 * u(r) ** 2, 8 + 25 * u(r), 600, r, 0.9);
        at += Math.floor(FREC * (0.004 + 0.02 * u(r)));
      }
    }
    for (let k = 0; k < seg * 0.6; k++) {
      golpe(x, Math.floor(u(r) * n), 300 + 500 * u(r), 0.5 + 0.3 * u(r), 90, 1800, r, 0.85);
    }
  } else if (tipo === 'noche') {
    // Noche melancólica (2026-11-10, «un sonido como de noche, con grillos, que
    // sea melancólico»): brisa que va y viene, un acorde menor muy lejano (la,
    // do, mi) que crece y se apaga como una nota de órgano en otro cuarto,
    // grillos pausados y, lejos, un búho dos veces por vuelta. Las frecuencias
    // del acorde caben enteras en los 15 s: el bucle cierra sin salto.
    // Cada voz es un oscilador que gira (una multiplicación por muestra, no un seno).
    const voces = [];
    for (const [fr, a] of [[110, 1], [130.8, 0.8], [164.8, 0.7], [220, 0.35], [261.6, 0.2]]) {
      // Dos voces apenas desafinadas: el coro que lo vuelve lejano.
      for (const [df, f0] of [[0, 0], [2 / seg, 1.3]]) {
        const ang = (2 * Math.PI * (fr + df)) / FREC;
        voces.push({ a, c: Math.cos(ang), q: Math.sin(ang), s: Math.sin(f0), k: Math.cos(f0) });
      }
    }
    for (let i = 0; i < total; i++) {
      const t = (i % n) / FREC;
      lp += 0.015 * (p[i] - lp);
      const rafaga = 0.5 + 0.5 * Math.sin((2 * Math.PI * t) / 7.5 - 1);
      const swell = Math.pow(Math.sin((Math.PI * t) / seg), 2);
      let acorde = 0;
      for (const o of voces) { const s2 = o.s * o.c + o.k * o.q; o.k = o.k * o.c - o.s * o.q; o.s = s2; acorde += o.a * o.s; }
      x[i] = lp * (0.5 + 0.6 * rafaga) + m[i] * 0.08 + acorde * 0.018 * (0.35 + 0.65 * swell);
    }
    const grillos = [
      { f: 4400, amp: 0.09, cada: 0.95 },
      { f: 3900, amp: 0.05, cada: 1.3 },
      { f: 4900, amp: 0.025, cada: 0.7 },
    ];
    for (const g of grillos) {
      let at = Math.floor(u(r) * FREC * g.cada);
      while (at < n) {
        const pulsos = 2 + Math.floor(u(r) * 3);
        for (let q = 0; q < pulsos; q++) golpe(x, at + q * Math.floor(FREC * 0.034), g.f + (u(r) - 0.5) * 60, g.amp, 190, 1000, r, 0.05);
        at += Math.floor(FREC * g.cada * (0.8 + 0.5 * u(r)));
      }
    }
    // El búho: «uu… uuu», grave, con la nota que cae al final.
    for (const at0 of [3.2, 10.4]) {
      for (const [d, dur, f0] of [[0, 0.32, 392], [0.55, 0.7, 370]]) {
        const ini = Math.floor((at0 + d) * FREC), largo = Math.floor(dur * FREC);
        for (let j = 0; j < largo && ini + j < x.length; j++) {
          const k = j / largo;
          const env = Math.sin(Math.PI * Math.min(1, k * 1.4)) * (k < 0.7 ? 1 : (1 - k) / 0.3);
          const fr = f0 * (1 - 0.06 * k);
          x[ini + j] += Math.sin(2 * Math.PI * fr * (j / FREC)) * 0.06 * Math.max(0, env);
        }
      }
    }
  }
  // El fundido: el tramo extra del final se mezcla sobre el principio.
  const out = new Float32Array(n);
  out.set(x.subarray(0, n));
  for (let j = 0; j < FUNDIDO; j++) {
    const k = j / FUNDIDO;
    out[j] = x[n + j] * (1 - k) + x[j] * k;
  }
  // Sin componente continua, al mismo volumen percibido y sin pasar del tope.
  let media = 0;
  for (let i = 0; i < n; i++) media += out[i];
  media /= n;
  let suma = 0;
  for (let i = 0; i < n; i++) { const v = out[i] - media; out[i] = v; suma += v * v; }
  // Al volumen de los demás, y los picos (una ola que rompe, un leño) se
  // redondean en vez de bajar todo el sonido para que quepan.
  const g = 0.16 / Math.sqrt(suma / n);
  for (let i = 0; i < n; i++) { const v = out[i] * g; out[i] = Math.abs(v) < 0.6 ? v : Math.sign(v) * (0.6 + 0.35 * Math.tanh((Math.abs(v) - 0.6) / 0.35)); }
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
// `minutos` es el temporizador ELEGIDO (0 = sin límite) y vive acá, no en la
// pantalla: al volver a Sonidos, o tras pausar y reanudar desde la pantalla
// bloqueada, la pantalla lo lee de aquí (2026-11-10, «el temporizador no
// cambia… no se sincronizan»). `restaMs` es lo que le quedaba al pausar.
let estado = { sonando: false, pausado: false, tipo: 'lluvia', finEn: null, minutos: 30, restaMs: null };
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

// El control de la pantalla de bloqueo SÓLO si este binario trae el permiso.
// En Android, mostrarlo arranca un servicio de primer plano: en un binario sin
// él declarado, la app se cierra. La configuración que se lee es la que viajó
// con este paquete, que siempre es la del binario (misma huella).
function conSegundoPlano() {
  try {
    const pl = (Constants.expoConfig?.plugins ?? []).find((x) => Array.isArray(x) && x[0] === 'react-native-audio-api');
    const op = pl?.[1] ?? {};
    return Platform.OS === 'ios' ? op.iosBackgroundMode === true : op.androidForegroundService === true;
  } catch { return false; }
}
const Aviso = () => (conSegundoPlano() ? AudioAPI?.PlaybackNotificationManager ?? null : null);

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
  const largo = FREC * SONIDOS[tipo].seg;
  const b = c.createBuffer(2, largo, FREC);
  const izq = canal(tipo, 11);
  // El derecho es el mismo bucle corrido media vuelta: suena abierto, como
  // dos canales distintos, y se fabrica una sola vez.
  const der = new Float32Array(largo);
  const medio = Math.floor(largo / 2);
  der.set(izq.subarray(medio)); der.set(izq.subarray(0, medio), largo - medio);
  b.copyToChannel(izq, 0);
  b.copyToChannel(der, 1);
  buffers[tipo] = b;
  return b;
}

/** Fabrica el sonido de antemano (al abrir la pantalla), para que «Reproducir» sea inmediato. */
export function prepararRuido(tipo) { try { buffer(tipo); } catch { /* se fabrica al tocar */ } }
export const volumenActual = () => volumen;

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

// La portada de cada lugar en la pantalla de bloqueo (2026-11-10, «en iOS no
// se ve foto de lo que se reproduce»). El reproductor pide un archivo: el
// módulo de la imagen se baja a disco una vez y se pasa su `file://`.
const PORTADAS = {
  lluvia: require('../assets/sonidos/portadas/lluvia.jpg'),
  olas: require('../assets/sonidos/portadas/olas.jpg'),
  fuego: require('../assets/sonidos/portadas/fuego.jpg'),
  noche: require('../assets/sonidos/portadas/noche.jpg'),
  ventilador: require('../assets/sonidos/portadas/ventilador.jpg'),
  blanco: require('../assets/sonidos/portadas/blanco.jpg'),
  rosa: require('../assets/sonidos/portadas/rosa.jpg'),
  cafe: require('../assets/sonidos/portadas/cafe.jpg'),
};
async function archivo(modulo) {
  if (!modulo) return undefined;
  try {
    const a = Asset.fromModule(modulo);
    if (!a.localUri) await a.downloadAsync();
    return a.localUri ?? a.uri ?? undefined;
  } catch { return undefined; }
}
const portada = (tipo) => archivo(PORTADAS[tipo]);

// iPhone con el módulo propio (binario desde 2026-11-10): portada viva y fija
// a resolución completa. Sin él, el aviso de react-native-audio-api.
let subsViva = null;
let turnoViva = 0;
async function mostrarViva(tipo, pausado) {
  if (!subsViva) {
    subsViva = [
      PortadaViva.addListener('alPausar', () => { pausarRuido(); sincronizarAviso(); }),
      PortadaViva.addListener('alReanudar', () => { reanudarRuido().finally(sincronizarAviso); }),
      PortadaViva.addListener('alDetener', () => pararRuido()),
    ];
  }
  const yo = ++turnoViva;
  const [alto, cuadrado] = VIVAS[tipo] ?? [];
  const [p, va, vc] = await Promise.all([portada(tipo), archivo(alto), archivo(cuadrado)]);
  // Pausar y reanudar rápido dispara dos pedidos; sin esto el más viejo podía
  // llegar último y dejar el reproductor al revés de lo que suena.
  if (yo !== turnoViva) return;
  pausado = estado.pausado;
  await PortadaViva.mostrar({
    clave: tipo, titulo: SONIDOS[tipo].nombre, artista: 'Sonidos · Puntos Salud',
    portada: p, videoAlto: va, videoCuadrado: vc, sonando: !pausado,
    resta: restaMs() != null ? restaMs() / 1000 : null,
  });
}

/** Lo que le queda al temporizador, en ms (congelado si está en pausa). */
function restaMs() {
  if (estado.pausado) return estado.restaMs;
  return estado.finEn ? Math.max(0, estado.finEn - Date.now()) : null;
}

/** Pone el reproductor de la pantalla bloqueada igual a lo que de verdad pasa. */
function sincronizarAviso() {
  if (estado.sonando || estado.pausado) mostrarAviso(estado.tipo, estado.pausado);
  else ocultarAviso();
}

async function mostrarAviso(tipo, pausado = false) {
  if (PortadaViva) { mostrarViva(tipo, pausado).catch(() => {}); return; }
  const A = Aviso();
  if (!A) return;
  try {
    const artwork = await portada(tipo);
    await A.show({ title: SONIDOS[tipo].nombre, artist: 'Sonidos · Puntos Salud', artwork, isLiveStream: false, state: pausado ? 'paused' : 'playing' });
    for (const [c, on] of [['play', true], ['pause', true], ['stop', true], ['nextTrack', false], ['previousTrack', false], ['skipForward', false], ['skipBackward', false], ['seekTo', false]]) {
      await A.enableControl(c, on).catch(() => {});
    }
    if (!subsAviso.length) {
      subsAviso = [
        A.addEventListener('playbackNotificationPause', () => { pausarRuido(); sincronizarAviso(); }),
        A.addEventListener('playbackNotificationPlay', () => { reanudarRuido().finally(sincronizarAviso); }),
        A.addEventListener('playbackNotificationStop', () => pararRuido()),
        A.addEventListener('playbackNotificationDismissed', () => pararRuido()),
      ];
    }
  } catch { /* sin aviso: suena igual */ }
}
function ocultarAviso() {
  if (PortadaViva) { PortadaViva.ocultar().catch(() => {}); return; }
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
  const m = minutos === undefined ? estado.minutos : minutos;
  const finEn = m ? Date.now() + m * 60_000 : null;
  poner({ sonando: true, pausado: false, tipo, finEn, minutos: m, restaMs: null });
  programarFin();
  mostrarAviso(tipo);
  return true;
}

/** Elige el temporizador (0 = sin límite); si algo suena o está en pausa, cuenta desde ahora. */
export function temporizadorRuido(minutos) {
  const ms = minutos ? minutos * 60_000 : null;
  if (estado.pausado) {
    quedabaMs = ms;
    poner({ minutos, restaMs: ms, finEn: ms ? Date.now() + ms : null });
  } else if (estado.sonando) {
    poner({ minutos, finEn: ms ? Date.now() + ms : null });
    if (nodo) { rampa(volumen, 0.3); programarFin(); }
  } else {
    poner({ minutos });
    return;
  }
  sincronizarAviso(); // la barra del reproductor, al día
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
  poner({ sonando: false, pausado: false, finEn: null });
  ocultarAviso();
  sesion(false);
}

// Pausa DE VERDAD (2026-11-10, «si lo pauso, no se pausa si no que se cancela
// y se mantiene el reproductor»): antes paraba el sonido. Ahora el bucle se
// queda donde está, en silencio; reanudar sube el volumen. El temporizador
// se congela con él: al reanudar le quedan los mismos minutos.
//
// El motor NO se suspende (2026-11-10, en la compilación 103 «al pausar no
// pausa, si no que se cancela de nuevo»): sin audio en curso iOS da por
// terminada la reproducción, quita el reproductor de la pantalla bloqueada y
// duerme la app, y el botón de reanudar ya no tiene a quién avisar. En pausa
// el motor sigue andando con volumen 0 —lo que hace cualquier reproductor—, y
// para no gastar batería toda la noche, a los 30 minutos en pausa se apaga.
const PAUSA_MAXIMA_MS = 30 * 60_000;
let quedabaMs = null;
let relojPausa = null;
export function pausarRuido() {
  if (!nodo || !ctx || estado.pausado) return;
  clearTimeout(relojFin);
  quedabaMs = estado.finEn ? Math.max(0, estado.finEn - Date.now()) : null;
  rampa(0, 0.3);
  clearTimeout(relojPausa);
  relojPausa = setTimeout(() => { if (estado.pausado) pararRuido(0); }, PAUSA_MAXIMA_MS);
  poner({ sonando: false, pausado: true, restaMs: quedabaMs });
  mostrarAviso(estado.tipo, true);
}

export async function reanudarRuido() {
  if (!estado.pausado) return;
  clearTimeout(relojPausa);
  if (!nodo || !ctx) { await sonarRuido(estado.tipo); return; }
  sesion(true);
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  rampa(volumen, 0.6);
  poner({ sonando: true, pausado: false, restaMs: null, finEn: quedabaMs != null ? Date.now() + quedabaMs : null });
  programarFin();
  mostrarAviso(estado.tipo, false);
}

/** Para del todo y quita el reproductor de la pantalla de bloqueo. */
export function pararRuido(seg = 0.6) {
  clearTimeout(relojFin);
  clearTimeout(relojPausa);
  ocultarAviso();
  const pausadoAntes = estado.pausado;
  poner({ sonando: false, pausado: false, finEn: null, restaMs: null });
  if (!nodo || !ctx) { sesion(false); return; }
  const n = nodo;
  nodo = null;
  if (pausadoAntes) { soltar(n, 0); sesion(false); return; }
  rampa(0, seg);
  soltar(n, seg);
  sesion(false);
}

// Al volver a la app, el reproductor de la pantalla bloqueada se alinea con lo
// que de verdad suena (por si se perdió un toque mientras estaba en segundo plano).
AppState.addEventListener('change', (e) => { if (e === 'active' && (estado.sonando || estado.pausado)) sincronizarAviso(); });
