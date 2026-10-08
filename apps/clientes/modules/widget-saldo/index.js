// El widget de saldo en Android (2026-10-08): el gemelo de targets/saldo (iOS).
// La app le deja el MISMO JSON que en iOS va al App Group; acá va a las
// preferencias de la app y el widget se vuelve a dibujar en el acto.
// Fuera de Android no existe: todo contesta false.
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

const N = Platform.OS === 'android' ? requireOptionalNativeModule('WidgetSaldo') : null;

export const guardarEnWidget = (json) => { try { return !!N?.guardar(json); } catch { return false; } };
export const borrarWidget = () => { try { return !!N?.borrar(); } catch { return false; } };
