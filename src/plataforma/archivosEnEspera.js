// ─────────────────────────────────────────────────────────────────────────────
// Archivos en espera — la versión del NAVEGADOR (IndexedDB).
// ─────────────────────────────────────────────────────────────────────────────
//
// Una foto que no se pudo subir porque el servicio de archivos no respondía se
// guarda ACÁ hasta que responda. Nació del 2026-11-02: Salud 1 pasó 40 minutos
// sin poder anotar ingresos del POS porque la foto de la boleta no subía.
//
// IndexedDB y no `localStorage`: guarda el `Blob` tal cual (una foto pesa
// 300-600 kB, y `localStorage` sólo guarda texto con un tope de ~5 MB), y
// sobrevive a la recarga y al cierre de sesión — que en sala es a los 5
// minutos sin usar la pantalla.
//
// Contrato (el gemelo de la app tiene los mismos nombres):
//   guardar(item)  → item = { id, bucket, path, archivo: Blob, contentType, creado }
//   listar()       → los items, el más viejo primero
//   quitar(id)

const BASE = 'portal-archivos-en-espera';
const TABLA = 'archivos';

let abriendo = null;
function abrir() {
    if (!abriendo) {
        abriendo = new Promise((resolve, reject) => {
            const pedido = indexedDB.open(BASE, 1);
            pedido.onupgradeneeded = () => {
                const db = pedido.result;
                if (!db.objectStoreNames.contains(TABLA)) db.createObjectStore(TABLA, { keyPath: 'id' });
            };
            pedido.onsuccess = () => resolve(pedido.result);
            pedido.onerror = () => reject(pedido.error);
        }).catch((err) => { abriendo = null; throw err; });   // reintentar la próxima vez, no quedar roto
    }
    return abriendo;
}

async function transaccion(modo, fn) {
    const db = await abrir();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(TABLA, modo);
        const tabla = tx.objectStore(TABLA);
        let resultado;
        const pedido = fn(tabla);
        if (pedido) pedido.onsuccess = () => { resultado = pedido.result; };
        tx.oncomplete = () => resolve(resultado);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

/** Lanza si no se pudo guardar: quien llama decide qué hacer sin la cola. */
export const guardar = (item) => transaccion('readwrite', (t) => t.put(item));

export async function listar() {
    const todos = (await transaccion('readonly', (t) => t.getAll())) ?? [];
    return todos.sort((a, b) => (a.creado ?? 0) - (b.creado ?? 0));
}

export const quitar = (id) => transaccion('readwrite', (t) => t.delete(id));
