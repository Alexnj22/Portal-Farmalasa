// Un identificador ALEATORIO de este teléfono, para contar vistas de quien usa
// la app sin cuenta (2026-10-06). No sale de ningún dato del teléfono ni de la
// persona: se inventa la primera vez y se guarda acá.
import * as SecureStore from 'expo-secure-store';

const CLAVE = 'puntos_salud_dispositivo';
let cache = null;

export async function idDispositivo() {
  if (cache) return cache;
  let v = await SecureStore.getItemAsync(CLAVE).catch(() => null);
  if (!v) {
    v = Array.from({ length: 24 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
    await SecureStore.setItemAsync(CLAVE, v).catch(() => {});
  }
  cache = v;
  return v;
}
