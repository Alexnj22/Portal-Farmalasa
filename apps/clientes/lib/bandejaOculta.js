// Los avisos que la persona BORRÓ de su bandeja (2026-10-09). Se guardan en el
// teléfono y no en el servidor, a propósito: `app_cliente_avisos` es además la
// bitácora que impide mandar dos veces el mismo aviso (UNIQUE customer_id,
// tipo, ref), así que borrar la fila haría que el aviso se volviera a mandar.
// Ocultarlo acá no toca esa bitácora.
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
