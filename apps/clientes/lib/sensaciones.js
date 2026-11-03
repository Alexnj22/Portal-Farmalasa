// Sonido y vibración de la zona anti estrés (2026-11-03), en UN solo sitio.
//
// «Los juegos están bien, pero no vibran, no tienen sonido»: cada juego
// llamaba a `expo-haptics` por su cuenta, con golpes «Light» y «selección» —los
// más tenues que hay; en Android el de selección casi no se siente— y no había
// un solo sonido. Acá viven los dos, con dos interruptores que el cliente ve en
// cada juego y que quedan guardados en el teléfono.
//
// Los sonidos están sintetizados en `scripts/app-clientes-sonidos.mjs` (sin
// licencia de terceros). Se mezclan con la música que el cliente tenga puesta
// (`mixWithOthers`) en vez de cortarla: un juego para bajar el estrés no le
// apaga la canción a nadie.
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Haptics from 'expo-haptics';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';

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
// Los que pueden sonar encima de sí mismos (reventar rápido) llevan varios
// reproductores y se turnan; con uno solo, el segundo «pop» cortaría al primero.
const VOCES = { 'pop-1': 2, 'pop-2': 2, 'pop-3': 2, 'pop-4': 2, 'pop-5': 2, 'pop-6': 2, voltear: 2, 'toque-1': 2, 'toque-2': 2, 'toque-3': 2, 'toque-4': 2, 'toque-5': 2, 'toque-6': 2, bloque: 3 };

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
const reproductores = {};
const turno = {};
let modoListo = false;
function preparar(nombre) {
  if (!reproductores[nombre]) {
    reproductores[nombre] = Array.from({ length: VOCES[nombre] ?? 1 }, () => {
      try { return createAudioPlayer(ARCHIVOS[nombre]); } catch { return null; }
    }).filter(Boolean);
    turno[nombre] = 0;
  }
  return reproductores[nombre];
}
function modo() {
  if (modoListo) return;
  modoListo = true;
  setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers', shouldPlayInBackground: false })
    .catch(() => { modoListo = false; });
}

/** Deja cargados los sonidos de un juego al entrar, para que el primero no llegue tarde. */
export function precargar(nombres) {
  leerAjustes();
  modo();
  nombres.forEach(preparar);
}

/**
 * Suena un efecto. `volumen` de 0 a 1; `tono` cambia la velocidad (1 = igual),
 * útil para que dos «pop» seguidos no suenen idénticos.
 */
export function sonar(nombre, { volumen = 1, tono = 1 } = {}) {
  if (!ajustes.sonido || !ARCHIVOS[nombre]) return;
  modo();
  const lista = preparar(nombre);
  if (!lista.length) return;
  const p = lista[turno[nombre] % lista.length];
  turno[nombre] += 1;
  // Cada propiedad que se toca es una llamada nativa —en Android, en el hilo
  // de la interfaz—: sólo se toca lo que cambió desde la vez anterior.
  try {
    if (p._vol !== volumen) { p.volume = volumen; p._vol = volumen; }
    const rate = p._rate ?? 1;
    if (rate !== tono) { p.shouldCorrectPitch = false; p.setPlaybackRate(tono); p._rate = tono; }
    p.seekTo(0).catch(() => {});
    p.play();
  } catch { /* un sonido que no sale no puede romper el juego */ }
}

function callarTodo() {
  Object.values(reproductores).flat().forEach((p) => { try { p.pause(); } catch { /* nada */ } });
}
/** Al salir de un juego: que no quede nada sonando. */
export function callar(nombres) {
  nombres.forEach((n) => (reproductores[n] ?? []).forEach((p) => { try { p.pause(); } catch { /* nada */ } }));
}

// ── Vibración ───────────────────────────────────────────────────────────────
// En Android `expo-haptics` usa el vibrador con amplitudes bajas para «Light»
// y «selección»: en muchos teléfonos no se siente nada. Ahí se sube un escalón.
const ANDROID = Platform.OS === 'android';
const golpe = (estilo) => { if (ajustes.vibra) Haptics.impactAsync(estilo).catch(() => {}); };
export const tacto = {
  /** Un roce: voltear una carta, cambiar una opción. */
  roce: () => golpe(ANDROID ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light),
  /** Un toque claro: reventar, contar. */
  toque: () => golpe(ANDROID ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Rigid),
  /** Un golpe firme: un bloque perfecto, la torre que se cae. */
  golpe: () => golpe(Haptics.ImpactFeedbackStyle.Heavy),
  /** Algo salió bien. */
  exito: () => { if (ajustes.vibra) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); },
  /** No era (la pareja equivocada): avisa sin regañar. */
  aviso: () => { if (ajustes.vibra) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}); },
};
