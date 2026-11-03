// Sonido y vibración de la zona anti estrés (2026-11-03), en UN solo sitio.
//
// Tercera versión, el mismo día: «los sonidos, haptic, etc. no funcionan
// apropiadamente» · «al presionar varios no se sienten fluidos» · «se traba».
//
// La causa estaba en el código de la librería, no adivinada: en Android,
// `expo-audio` ejecuta CADA llamada de un reproductor —`play`, `seekTo`,
// `volume`, `setPlaybackRate`— en el hilo PRINCIPAL (`runOnMain` en
// `AudioModule.kt`), que es el mismo que dibuja la pantalla. Un reventón eran
// tres o cuatro de esas llamadas; arrastrar el dedo por una fila, veinte en
// medio segundo, justo cuando el tablero más necesitaba ese hilo. Y como cada
// sonido tenía 2 o 3 reproductores que se turnaban, el cuarto toque seguido
// cortaba al primero: por eso «al presionar varios» sonaba entrecortado.
//
// Ahora los efectos van por `react-native-audio-api` (Web Audio nativo, de
// Software Mansion): los WAV se decodifican UNA vez en memoria y cada sonido es
// un nodo que se dispara en el hilo de audio, sin tocar el de la pantalla.
// Polifonía de verdad: diez «pop» seguidos suenan los diez, y el tono es un
// parámetro del nodo, sin costo. `expo-audio` se queda sólo para las notas de
// voz del chat.
//
// La vibración, igual: en Android los golpes «impact» de `expo-haptics` usan el
// motor de vibración con una forma de onda —blandos y lentos de arrancar— y
// encimados en una ráfaga se sienten como un zumbido. Para los toques se usa
// el háptico del SISTEMA (`performHapticFeedback`, el del teclado): seco,
// inmediato y sin cola. Y nunca más de un toque cada 30 ms: dos vibraciones
// pegadas no se sienten como dos, se sienten como una mala.
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Haptics from 'expo-haptics';

let AudioAPI = null;
try { AudioAPI = require('react-native-audio-api'); } catch { AudioAPI = null; }

const ARCHIVOS = {
  'pop-1': require('../assets/sonidos/pop-1.wav'),
  'pop-2': require('../assets/sonidos/pop-2.wav'),
  'pop-3': require('../assets/sonidos/pop-3.wav'),
  'pop-4': require('../assets/sonidos/pop-4.wav'),
  'pop-5': require('../assets/sonidos/pop-5.wav'),
  'pop-6': require('../assets/sonidos/pop-6.wav'),
  voltear: require('../assets/sonidos/voltear.wav'),
  par: require('../assets/sonidos/par.wav'),
  fallo: require('../assets/sonidos/fallo.wav'),
  ganar: require('../assets/sonidos/ganar.wav'),
  campana: require('../assets/sonidos/campana.wav'),
  inhalar: require('../assets/sonidos/inhalar.wav'),
  exhalar: require('../assets/sonidos/exhalar.wav'),
  'toque-1': require('../assets/sonidos/toque-1.wav'),
  'toque-2': require('../assets/sonidos/toque-2.wav'),
  'toque-3': require('../assets/sonidos/toque-3.wav'),
  'toque-4': require('../assets/sonidos/toque-4.wav'),
  'toque-5': require('../assets/sonidos/toque-5.wav'),
  'toque-6': require('../assets/sonidos/toque-6.wav'),
  bloque: require('../assets/sonidos/bloque.wav'),
  derrumbe: require('../assets/sonidos/derrumbe.wav'),
  gota: require('../assets/sonidos/gota.wav'),
};
// Cuántas copias de un mismo sonido pueden sonar a la vez: de sobra para una
// ráfaga, y con techo para que un dedo loco no apile cien.
const MAX_A_LA_VEZ = 8;

const CLAVE_SONIDO = 'puntos_salud_bienestar_sonido';
const CLAVE_VIBRA = 'puntos_salud_bienestar_vibra';
const ajustes = { sonido: true, vibra: true };
const oyentes = new Set();
let leidos = false;
function leerAjustes() {
  if (leidos) return;
  leidos = true;
  Promise.all([SecureStore.getItemAsync(CLAVE_SONIDO), SecureStore.getItemAsync(CLAVE_VIBRA)])
    .then(([s, v]) => {
      if (s === '0') ajustes.sonido = false;
      if (v === '0') ajustes.vibra = false;
      oyentes.forEach((f) => f({ ...ajustes }));
    }).catch(() => {});
}
function cambiar(clave, valor) {
  ajustes[clave] = valor;
  SecureStore.setItemAsync(clave === 'sonido' ? CLAVE_SONIDO : CLAVE_VIBRA, valor ? '1' : '0').catch(() => {});
  if (clave === 'sonido' && !valor) callarTodo();
  oyentes.forEach((f) => f({ ...ajustes }));
}

/** Los dos interruptores, para el botón de cada juego. */
export function useAjustesSensaciones() {
  const [a, setA] = useState(() => ({ ...ajustes }));
  useEffect(() => {
    leerAjustes();
    oyentes.add(setA);
    return () => { oyentes.delete(setA); };
  }, []);
  return {
    sonido: a.sonido, vibra: a.vibra,
    alternarSonido: () => cambiar('sonido', !ajustes.sonido),
    alternarVibra: () => cambiar('vibra', !ajustes.vibra),
  };
}

// ── Sonido ──────────────────────────────────────────────────────────────────
let ctx = null;
let salida = null;
const buffers = {}; // nombre → AudioBuffer ya decodificado
const cargando = {}; // nombre → promesa, para no decodificar dos veces
const sonando = {}; // nombre → [{ nodo, fin }]
let relojDormir = null;

function contexto() {
  if (ctx || !AudioAPI) return ctx;
  try {
    // En iPhone: suena aunque el interruptor de silencio esté puesto (es un
    // juego que el cliente abrió a propósito) y se MEZCLA con su música en vez
    // de cortarla. En Android la música sigue sola: no se pide el foco de audio.
    if (Platform.OS === 'ios') {
      AudioAPI.AudioManager?.setSystemOptions?.({ ios: { category: 'playback', options: ['mixWithOthers'] } });
    }
    ctx = new AudioAPI.AudioContext();
    salida = ctx.createGain();
    salida.gain.value = 0.9;
    salida.connect(ctx.destination);
  } catch {
    ctx = null;
  }
  return ctx;
}

function cargar(nombre) {
  const c = contexto();
  if (!c || buffers[nombre] || cargando[nombre] || !ARCHIVOS[nombre]) return cargando[nombre];
  cargando[nombre] = AudioAPI.decodeAudioData(ARCHIVOS[nombre])
    .then((b) => { buffers[nombre] = b; })
    .catch(() => {})
    .finally(() => { delete cargando[nombre]; });
  return cargando[nombre];
}

function despertar() {
  clearTimeout(relojDormir);
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}

/** Deja decodificados los sonidos de un juego al entrar, para que el primero no llegue tarde. */
export function precargar(nombres) {
  leerAjustes();
  if (!contexto()) return;
  despertar();
  nombres.forEach(cargar);
}

/**
 * Suena un efecto. `volumen` de 0 a 1; `tono` cambia la velocidad (1 = igual).
 * Cada llamada es un nodo nuevo: los sonidos se SUMAN, ninguno corta a otro.
 */
export function sonar(nombre, { volumen = 1, tono = 1 } = {}) {
  if (!ajustes.sonido) return;
  const c = contexto();
  const b = buffers[nombre];
  if (!c || !b) { cargar(nombre); return; }
  despertar();
  try {
    const lista = (sonando[nombre] ??= []);
    const t = c.currentTime;
    // Fuera los que ya terminaron; si hay demasiados, se apaga el más viejo.
    for (let i = lista.length - 1; i >= 0; i--) if (lista[i].fin <= t) lista.splice(i, 1);
    if (lista.length >= MAX_A_LA_VEZ) { try { lista.shift().nodo.stop(); } catch { /* ya paró */ } }
    const nodo = c.createBufferSource();
    nodo.buffer = b;
    if (tono !== 1) nodo.playbackRate.value = tono;
    const ganancia = c.createGain();
    ganancia.gain.value = volumen;
    nodo.connect(ganancia);
    ganancia.connect(salida);
    nodo.start();
    lista.push({ nodo, fin: t + b.duration / tono + 0.05 });
  } catch { /* un sonido que no sale no puede romper el juego */ }
}

function pararLista(lista) {
  (lista ?? []).forEach(({ nodo }) => { try { nodo.stop(); } catch { /* ya paró */ } });
  if (lista) lista.length = 0;
}
function callarTodo() { Object.values(sonando).forEach(pararLista); }

/**
 * Al salir de un juego: que no quede nada sonando. Un rato después el motor de
 * audio se duerme, para no gastar batería con el juego cerrado.
 */
export function callar(nombres) {
  nombres.forEach((n) => pararLista(sonando[n]));
  clearTimeout(relojDormir);
  relojDormir = setTimeout(() => { if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {}); }, 4000);
}

// ── Vibración ───────────────────────────────────────────────────────────────
const ANDROID = Platform.OS === 'android';
const SEPARACION = 30; // ms mínimos entre dos toques
let ultimoToque = 0;
function rapido(hacer) {
  if (!ajustes.vibra) return;
  const ahora = Date.now();
  if (ahora - ultimoToque < SEPARACION) return;
  ultimoToque = ahora;
  hacer().catch(() => {});
}
const sistema = (tipo) => () => Haptics.performAndroidHapticsAsync(tipo);
const impacto = (estilo) => () => Haptics.impactAsync(estilo);
export const tacto = {
  /** Un roce: voltear una carta, cambiar una opción, un segundo de la respiración. */
  roce: () => rapido(ANDROID ? sistema(Haptics.AndroidHaptics.Clock_Tick) : impacto(Haptics.ImpactFeedbackStyle.Light)),
  /** Un toque claro: reventar, contar, soltar un bloque. */
  toque: () => rapido(ANDROID ? sistema(Haptics.AndroidHaptics.Keyboard_Tap) : impacto(Haptics.ImpactFeedbackStyle.Rigid)),
  /** Un golpe firme: un bloque perfecto, la torre que se cae. */
  golpe: () => rapido(ANDROID ? sistema(Haptics.AndroidHaptics.Long_Press) : impacto(Haptics.ImpactFeedbackStyle.Heavy)),
  /** Algo salió bien. */
  exito: () => { if (ajustes.vibra) (ANDROID ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Confirm) : Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)).catch(() => {}); },
  /** No era: avisa sin regañar. */
  aviso: () => { if (ajustes.vibra) (ANDROID ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Reject) : Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)).catch(() => {}); },
};
