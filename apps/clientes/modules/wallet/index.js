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
