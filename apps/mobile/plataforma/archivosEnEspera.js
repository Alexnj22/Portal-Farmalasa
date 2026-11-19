// Archivos en espera — el gemelo de la APP. Ver `src/plataforma/archivosEnEspera.js`.
//
// Una foto que no se pudo subir porque el servicio de archivos no respondía se
// guarda ACÁ, en el disco del teléfono, hasta que responda. Es lo mismo que
// hace el navegador con IndexedDB desde el 2026-11-02 (Salud 1, 40 minutos sin
// poder anotar ingresos del POS). Hasta el 2026-11-19 la app lanzaba
// `pendiente(...)` y la sala quedaba sin poder anotar ni cobrar con mala señal.
//
// Cada foto son dos archivos en `documentos/fotos-en-espera/`: los bytes
// (`.bin`) y sus datos (`.json`). El `.json` se escribe AL FINAL: una foto a
// medio guardar (sin `.json`) no aparece en `listar` y nunca se sube rota.
// `documentos` y no `cache`: el sistema puede vaciar la caché, y esta foto es
// el respaldo de un movimiento que ya se anotó con su URL.
//
// Contrato (el mismo del navegador):
//   guardar(item)  → item = { id, bucket, path, archivo: ArrayBuffer|Uint8Array, contentType, creado }
//   listar()       → los items, el más viejo primero (`archivo` como ArrayBuffer)
//   quitar(id)
import { Directory, File, Paths } from 'expo-file-system';

function carpeta() {
  const d = new Directory(Paths.document, 'fotos-en-espera');
  if (!d.exists) d.create();
  return d;
}

// El id es `bucket/path`: con barras, no sirve de nombre de archivo.
const nombreDe = (id) => encodeURIComponent(String(id));

function aBytes(archivo) {
  if (archivo instanceof Uint8Array) return archivo;
  if (archivo instanceof ArrayBuffer) return new Uint8Array(archivo);
  throw new Error('La foto no tiene un formato que se pueda guardar.');
}

/** Lanza si no se pudo guardar: quien llama decide qué hacer sin la cola. */
export async function guardar(item) {
  const d = carpeta();
  const n = nombreDe(item.id);
  const datos = new File(d, `${n}.bin`);
  const meta = new File(d, `${n}.json`);
  if (datos.exists) datos.delete();
  if (meta.exists) meta.delete();
  datos.create();
  datos.write(aBytes(item.archivo));
  meta.create();
  meta.write(JSON.stringify({
    id: item.id, bucket: item.bucket, path: item.path,
    contentType: item.contentType || 'image/jpeg', creado: item.creado ?? Date.now(),
  }));
}

export async function listar() {
  const d = carpeta();
  const items = [];
  for (const f of d.list()) {
    if (!(f instanceof File) || !f.name.endsWith('.json')) continue;
    try {
      const meta = JSON.parse(await f.text());
      const datos = new File(d, `${nombreDe(meta.id)}.bin`);
      if (!datos.exists) { f.delete(); continue; }   // sin bytes no hay nada que subir
      const bytes = datos.bytesSync();
      items.push({ ...meta, archivo: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
    } catch { /* un archivo ilegible no frena a los demás */ }
  }
  return items.sort((a, b) => (a.creado ?? 0) - (b.creado ?? 0));
}

export async function quitar(id) {
  const d = carpeta();
  const n = nombreDe(id);
  for (const nombre of [`${n}.json`, `${n}.bin`]) {
    const f = new File(d, nombre);
    if (f.exists) f.delete();
  }
}

// Los ingresos en espera de la caja no se recuerdan en la app: el ingreso
// igual queda anotado, y si no llega a la caja en 20 minutos
// `vigilar_servicios()` avisa para mandarlo desde Mi caja.
export async function guardarIngreso() {}
export async function listarIngresos() { return []; }
export async function quitarIngreso() {}
