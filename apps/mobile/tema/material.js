// La paleta de Material 3 de la app en Android (opción B, 2026-11-12: forma y
// movimiento de Material 3 Expressive con los colores de la MARCA, no los del
// fondo de pantalla de cada teléfono).
//
// Sin semilla, todo <Host> de Compose toma la paleta del fondo de pantalla
// (Material You, Android 12+): la barra de abajo salía rosada y las fichas
// celestes según el teléfono, al lado de piezas con los colores fijos de la
// marca. Con la semilla, Material genera la paleta tonal completa desde UN
// color y queda igual en todos los teléfonos.
import { useColorScheme } from 'react-native';
import { getMaterialColors } from '@expo/ui/jetpack-compose';

export const SEMILLA = '#0052CC'; // el azul de la marca: el de botones y enlaces (opción elegida 2026-11-12)

export function usePaleta() {
  const oscuro = useColorScheme() === 'dark';
  return getMaterialColors({ seedColor: SEMILLA, scheme: oscuro ? 'dark' : 'light' });
}
