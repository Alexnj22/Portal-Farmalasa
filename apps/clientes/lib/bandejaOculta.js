// Los avisos que la persona BORRÓ de su bandeja (2026-10-09). Borrar es
// OCULTAR: `app_cliente_avisos` es además la bitácora que impide mandar dos
// veces el mismo aviso (UNIQUE customer_id, tipo, ref), así que la fila nunca
// se borra. El servidor la marca con `oculto_at` (acción `bandeja_ocultar`) y
// deja de devolverla en todos los teléfonos de la persona.
//
// Esta lista local es el lado OPTIMISTA y el respaldo: el aviso desaparece al
// instante, y si el servidor no confirma (sin conexión, o la columna todavía no
// existe) sigue oculto acá y se reintenta en la próxima carga. Cuando el
// servidor confirma, el ID se olvida (`olvidar`).
//
// Se guardan los ID de las filas (únicos en toda la tabla, así que en un
// teléfono compartido no se mezclan cuentas). Con tope: el servidor sólo
// devuelve los 50 más recientes, así que los ID viejos ya no vuelven a salir y
// guardarlos para siempre sólo engordaría el llavero (que avisa pasados 2 KB).
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const CLAVE = 'puntos_salud_bandeja_ocultas';
const TOPE = 150;

const almacen = Platform.OS === 'web'
  ? {
      leer: async () => { try { return localStorage.getItem(CLAVE); } catch { return null; } },
      guardar: async (v) => { try { localStorage.setItem(CLAVE, v); } catch { /* sin almacenamiento */ } },
    }
  : {
      leer: () => SecureStore.getItemAsync(CLAVE),
      guardar: (v) => SecureStore.setItemAsync(CLAVE, v),
    };

let cache = null;

/** El conjunto de ID ocultos (de memoria después de la primera lectura). */
export async function leerOcultas() {
  if (cache) return cache;
  try {
    const crudo = await almacen.leer();
    const lista = crudo ? JSON.parse(crudo) : [];
    cache = new Set(Array.isArray(lista) ? lista.map(Number).filter(Number.isFinite) : []);
  } catch {
    cache = new Set();
  }
  return cache;
}

/** Oculta estos ID y lo guarda. Devuelve el conjunto nuevo. */
export async function ocultar(ids) {
  const actual = await leerOcultas();
  const nuevo = new Set(actual);
  for (const id of ids) { const n = Number(id); if (Number.isFinite(n)) nuevo.add(n); }
  // Los más nuevos primero: son los únicos que el servidor todavía puede devolver.
  const recortado = [...nuevo].sort((a, b) => b - a).slice(0, TOPE);
  cache = new Set(recortado);
  await almacen.guardar(JSON.stringify(recortado)).catch(() => {});
  return cache;
}

/** Saca estos ID de la lista local: el servidor ya los ocultó. */
export async function olvidar(ids) {
  const actual = await leerOcultas();
  const quitar = new Set([...ids].map(Number));
  if (![...quitar].some((id) => actual.has(id))) return actual;
  const quedan = [...actual].filter((id) => !quitar.has(id));
  cache = new Set(quedan);
  await almacen.guardar(JSON.stringify(quedan)).catch(() => {});
  return cache;
}
