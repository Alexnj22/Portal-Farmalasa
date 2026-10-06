// Entrar con Face ID (2026-10-06). Después de entrar una vez con el DUI y el
// teléfono (o el código del ticket), esos datos quedan en el llavero del
// teléfono —cifrados, sólo en este aparato— y la próxima vez basta con Face
// ID / Touch ID: sin volver a escribir nada. La sesión sigue durando 180 días;
// esto es para cuando se cerró (a propósito o porque venció).
import * as SecureStore from 'expo-secure-store';
import { nombreBiometria, verificar } from './bloqueo';

const CLAVE = 'puntos_salud_entrada';

export async function guardarEntrada(datos) {
  await SecureStore.setItemAsync(CLAVE, JSON.stringify(datos)).catch(() => {});
}

export async function olvidarEntrada() {
  await SecureStore.deleteItemAsync(CLAVE).catch(() => {});
}

/** `{ biometria, datos }` si se puede entrar con la cara o la huella; si no, null. */
export async function entradaDisponible() {
  const [biometria, v] = await Promise.all([nombreBiometria(), SecureStore.getItemAsync(CLAVE).catch(() => null)]);
  if (!biometria || !v) return null;
  try { return { biometria, datos: JSON.parse(v) }; } catch { return null; }
}

/** Pide Face ID y, si pasa, devuelve los datos guardados. */
export async function datosConBiometria(biometria) {
  const ok = await verificar(`Entrar a Puntos Salud con ${biometria}`);
  if (!ok) return null;
  const v = await SecureStore.getItemAsync(CLAVE).catch(() => null);
  try { return v ? JSON.parse(v) : null; } catch { return null; }
}
