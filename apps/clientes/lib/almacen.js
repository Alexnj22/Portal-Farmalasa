// Lo que la app guarda en el teléfono y NO es secreto (2026-10-15): el
// carrito, los productos vistos, las historias. Antes iba a SecureStore, que es
// para llaves — tope de 2048 bytes por valor y cifrado en cada escritura —, y
// un carrito lleno o la lista de vistos lo pasaban. Acá va en archivos, igual
// que la copia sin conexión (`sinConexion.js`), uno por clave.
//
// Nunca lanza: leer devuelve null si no hay nada (o no se puede leer), y
// guardar falla en silencio — es comodidad, no un dato que se pueda perder.
import * as FS from 'expo-file-system/legacy';

const DIR = FS.documentDirectory ? `${FS.documentDirectory}almacen/` : null;

// La carpeta se crea UNA vez; si falla, el próximo intento vuelve a probar.
let carpeta = null;
function asegurarCarpeta() {
  if (!carpeta) {
    carpeta = FS.makeDirectoryAsync(DIR, { intermediates: true })
      .catch((e) => { carpeta = null; throw e; });
  }
  return carpeta;
}

// La clave va al nombre del archivo: sólo letras, números, «-» y «_».
const ruta = (clave) => `${DIR}${String(clave).replace(/[^A-Za-z0-9_-]/g, '_')}.json`;

/** El valor guardado bajo `clave`, ya interpretado, o null si no hay. */
export async function leer(clave) {
  if (!DIR) return null;
  try {
    return JSON.parse(await FS.readAsStringAsync(ruta(clave))) ?? null;
  } catch { return null; }
}

// Las escrituras de una misma clave van EN FILA: tocar «+» tres veces seguidas
// en el carrito no puede dejar guardada la segunda porque terminó última.
const fila = new Map();

/** Guarda `valor` como JSON bajo `clave`; con `valor == null`, lo borra. */
export async function guardar(clave, valor) {
  if (!DIR) return;
  const texto = valor == null ? null : JSON.stringify(valor);
  const antes = fila.get(clave) ?? Promise.resolve();
  const esta = antes.then(async () => {
    try {
      if (texto == null) {
        await FS.deleteAsync(ruta(clave), { idempotent: true });
        return;
      }
      await asegurarCarpeta();
      await FS.writeAsStringAsync(ruta(clave), texto);
    } catch { /* sin espacio: no pasa nada */ }
  });
  fila.set(clave, esta);
  await esta;
  if (fila.get(clave) === esta) fila.delete(clave);
}
