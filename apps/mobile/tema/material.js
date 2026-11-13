// La paleta de Material 3 de la app en Android: la del SISTEMA (Material You,
// Android 12+), que sale del fondo de pantalla de cada teléfono — lo nativo de
// Android (decisión del usuario, 2026-11-12: «que el tono principal lo tome del
// color del SO»). En Android 11 o anterior, Material da su paleta base.
//
// Todo <Host> de Compose sin `seedColor` ya toma esa paleta; las piezas de
// React Native (tarjetas, barras, acento de botones y enlaces) la leen de acá
// para verse igual que las de Compose.
//
// La paleta se guarda en memoria, pero se VUELVE A LEER al volver a la app
// (`refrescarPaleta`, desde app/_layout.js): si la persona cambió el fondo de
// pantalla o los colores del sistema, la app los toma sin cerrarla (usuario,
// 2026-11-12: «si cambio el tema en android, al volver a la app no se cambia»).
//
// `SEMILLA` queda en undefined a propósito: si algún día se quiere la paleta
// fija de la marca, se pone aquí un color y todos los Host y piezas la siguen.
import { useColorScheme } from 'react-native';
import { create } from 'zustand';
import { getMaterialColors } from '@expo/ui/jetpack-compose';

export const SEMILLA = undefined;

let cache = {};
// Cuántas veces cambió la paleta: los componentes que la usan se vuelven a
// dibujar cuando sube.
export const useVersionDePaleta = create(() => ({ v: 0 }));

// Sin hook, para los colores que se leen fuera de un componente (colorSistema).
export function paletaDe(oscuro) {
  const k = oscuro ? 'dark' : 'light';
  if (!cache[k]) {
    try { cache[k] = getMaterialColors({ scheme: k, ...(SEMILLA ? { seedColor: SEMILLA } : {}) }); } catch { cache[k] = null; }
  }
  return cache[k];
}

// Relee la paleta del sistema. Devuelve true si cambió.
export function refrescarPaleta() {
  const antes = JSON.stringify([cache.light?.primary, cache.dark?.primary, cache.light?.surface, cache.dark?.surface]);
  cache = {};
  paletaDe(false); paletaDe(true);
  const ahora = JSON.stringify([cache.light?.primary, cache.dark?.primary, cache.light?.surface, cache.dark?.surface]);
  if (antes === ahora) return false;
  useVersionDePaleta.setState((s) => ({ v: s.v + 1 }));
  return true;
}

export function usePaleta() {
  useVersionDePaleta((s) => s.v);
  return paletaDe(useColorScheme() === 'dark');
}
