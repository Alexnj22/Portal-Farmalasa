// Apple Wallet desde la app (módulo nativo local: modules/wallet/ios).
// Fuera de iPhone no existe: todo contesta «no disponible».
import { Platform } from 'react-native';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';

const N = Platform.OS === 'ios' ? requireOptionalNativeModule('Wallet') : null;
export const TIPO_PASE = 'pass.lat.farmasalud.puntos';

// El botón oficial de Apple (PKAddPassButton). Null si el módulo no está.
let VistaBoton = null;
if (N) { try { VistaBoton = requireNativeViewManager('Wallet'); } catch { VistaBoton = null; } }
export const BotonWalletNativo = VistaBoton;

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

/**
 * Directo a Wallet (2026-10-08): baja la tarjeta y presenta la hoja de Apple
 * en una ventana propia. true = agregada, false = la cerró sin agregar,
 * null = no se pudo (sin módulo, sin red o error): el que llama usa Safari.
 */
export async function agregarDirecto(pedir, nivelPrueba) {
  if (!N) return null;
  try {
    const r = await pedir('wallet_pase', nivelPrueba ? { nivel_prueba: nivelPrueba } : {});
    if (!r?.ok || !r.pase) return null;
    return !!(await N.agregar(r.pase));
  } catch { return null; }
}
