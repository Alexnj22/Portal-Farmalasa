// La paleta de Material You del sistema, VIGENTE (ver
// android/…/ColoresSistemaModule.kt). Fuera de Android, o en un binario que
// todavía no trae el módulo, devuelve null y quien llama usa la de @expo/ui.
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

const Modulo = Platform.OS === 'android' ? requireOptionalNativeModule('ColoresSistema') : null;

export function paletaDelSistema(oscuro) {
  if (!Modulo) return null;
  try { return Modulo.paleta(!!oscuro) ?? null; } catch { return null; }
}
