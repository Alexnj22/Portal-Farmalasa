// Entrar con Face ID (2026-10-06). Después de entrar una vez con el DUI y el
// teléfono (o el código del ticket), esos datos quedan en el llavero del
// teléfono —cifrados, sólo en este aparato— y la próxima vez basta con Face
// ID / Touch ID: sin volver a escribir nada. La sesión sigue durando 180 días;
// esto es para cuando se cerró (a propósito o porque venció).
import * as SecureStore from 'expo-secure-store';
import { conBiometria, nombreBiometria, verificar } from './bloqueo';

const CLAVE = 'puntos_salud_entrada';

export async function guardarEntrada(datos) {
  await SecureStore.setItemAsync(CLAVE, JSON.stringify(datos)).catch(() => {});
}

// El nombre de quien entró (2026-11-11): para que el botón diga de QUIÉN es la
// cuenta guardada («Entrar como Ana con huella») y quien quiere entrar con otra
// sepa que ése no es el suyo. Lo anota el resumen al llegar (lib/cuenta.js).
export async function recordarNombreDeEntrada(nombre) {
  if (!nombre) return;
  const v = await SecureStore.getItemAsync(CLAVE).catch(() => null);
  if (!v) return;
  try {
    const d = JSON.parse(v);
    if (d?.nombre !== nombre) await SecureStore.setItemAsync(CLAVE, JSON.stringify({ ...d, nombre })).catch(() => {});
  } catch { /* lo guardado no se lee: se deja como está */ }
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
  const ok = await verificar(`Entrar a Puntos Salud ${conBiometria(biometria)}`);
  if (!ok) return null;
  const v = await SecureStore.getItemAsync(CLAVE).catch(() => null);
  try { return v ? JSON.parse(v) : null; } catch { return null; }
}
