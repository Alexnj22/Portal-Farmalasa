// Apple Wallet desde la app (módulo nativo local: modules/wallet/ios).
// Fuera de iPhone no existe: todo contesta «no disponible».
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

const N = Platform.OS === 'ios' ? requireOptionalNativeModule('Wallet') : null;
export const TIPO_PASE = 'pass.lat.farmasalud.puntos';

export const walletDisponible = () => { try { return !!N?.disponible(); } catch { return false; } };
export const tienePase = (serial) => { try { return !!N?.tiene(TIPO_PASE, serial); } catch { return false; } };
export const abrirPase = (serial) => { try { return !!N?.abrir(TIPO_PASE, serial); } catch { return false; } };
/** Presenta la hoja de Apple; resuelve true si quedó agregada. */
export const agregarPase = (base64) => (N ? N.agregar(base64) : Promise.resolve(false));

/**
 * Agregar a Wallet por Safari (2026-10-07): la app pide un enlace firmado y lo
 * abre; Safari baja el .pkpass y iOS muestra SU pantalla para agregarlo. Es el
 * camino que no depende de presentar la hoja de Apple dentro de la app (que
 * salía negra sobre las pestañas nativas). Devuelve false si no hubo enlace.
 */
export async function agregarPorSafari(pedir, nivelPrueba) {
  const { Linking } = require('react-native');
  const r = await pedir('wallet_enlace', nivelPrueba ? { nivel_prueba: nivelPrueba } : {});
  if (!r?.ok || !r.url) return false;
  await Linking.openURL(r.url);
  return true;
}
