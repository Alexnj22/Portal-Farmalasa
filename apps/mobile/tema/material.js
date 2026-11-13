// La paleta de Material 3 de la app en Android: la del SISTEMA (Material You,
// Android 12+), que sale del fondo de pantalla de cada teléfono — lo nativo de
// Android (decisión del usuario, 2026-11-12: «que el tono principal lo tome del
// color del SO»). En Android 11 o anterior, Material da su paleta base.
//
// Todo <Host> de Compose sin `seedColor` ya toma esa paleta; las piezas de
// React Native (tarjetas, barra de abajo, acento de botones y enlaces) la leen
// de acá para verse igual que las de Compose.
//
// `SEMILLA` queda en undefined a propósito: si algún día se quiere la paleta
// fija de la marca, se pone aquí un color y todos los Host y piezas la siguen.
import { useColorScheme } from 'react-native';
import { getMaterialColors } from '@expo/ui/jetpack-compose';

export const SEMILLA = undefined;

const cache = {};
// Sin hook, para los colores que se leen fuera de un componente (colorSistema).
export function paletaDe(oscuro) {
  const k = oscuro ? 'dark' : 'light';
  if (!cache[k]) {
    try { cache[k] = getMaterialColors({ scheme: k, ...(SEMILLA ? { seedColor: SEMILLA } : {}) }); } catch { cache[k] = null; }
  }
  return cache[k];
}

export function usePaleta() {
  return paletaDe(useColorScheme() === 'dark');
}
