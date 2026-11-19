import { api } from './api';
import { t } from './idioma';

/*
 * Cola de subidas del álbum que sobrevive a cerrar la página. Cada foto se
 * guarda en IndexedDB ANTES de subirla y se borra al terminar: si el invitado
 * cierra el navegador a mitad (o se queda sin batería), la próxima vez que
 * abra el sitio las que faltan se suben solas.
 * Usa api.subirFoto tal cual; los reintentos por señal débil siguen acá.
 */
const DB = 'boda-subidas';
const ALMACEN = 'cola';

function abrir() {
  return new Promise((ok, mal) => {
    if (typeof indexedDB === 'undefined') { mal(new Error('Sin IndexedDB')); return; }
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(ALMACEN, { keyPath: 'id' });
    r.onsuccess = () => ok(r.result);
    r.onerror = () => mal(r.error);
  });
}
async function conAlmacen(modo, fn) {
  const db = await abrir();
  try {
    return await new Promise((ok, mal) => {
      const tx = db.transaction(ALMACEN, modo);
      const res = fn(tx.objectStore(ALMACEN));
      tx.oncomplete = () => ok(res?.result ?? res);
      tx.onerror = () => mal(tx.error);
      tx.onabort = () => mal(tx.error);
    });
  } finally { db.close(); }
}

const nuevoId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Guarda los archivos en la cola. Devuelve los registros (con id). Si IndexedDB falla, sigue sin persistir. */
export async function encolar(archivos, { autor, momento, clave }) {
  const items = [...archivos].map((file) => ({ id: nuevoId(), file, autor, momento, clave, creado: Date.now() }));
  try {
    await conAlmacen('readwrite', (s) => { items.forEach((it) => s.put(it)); });
  } catch (e) {
    console.warn('No se pudo guardar la cola de subidas (se sube igual)', e);
    items.forEach((it) => { it.sinGuardar = true; });
  }
  return items;
}

export async function pendientes() {
  try {
    const todas = await conAlmacen('readonly', (s) => s.getAll());
    return (todas || []).sort((a, b) => a.creado - b.creado);
  } catch { return []; }
}

export async function quitar(id) {
  try { await conAlmacen('readwrite', (s) => s.delete(id)); } catch (e) { console.warn('Cola de subidas', e); }
}

// ── Subir ───────────────────────────────────────────────────────────────────
// La señal del salón se cae: un error de red se reintenta solo (y si el
// teléfono quedó sin conexión, se espera a que vuelva). Un error que no se
// arregla reintentando —clave mala, archivo no permitido— no se reintenta.
const PERMANENTE = /clave|tipo de archivo|pesado|demasiad[oa]s|no se pueden subir|límite de espacio|limite de espacio|mime|size|exceeded|demo/i;
const ESPERAS = [2000, 5000, 12000];
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const hayRed = () => new Promise((r) => {
  if (navigator.onLine !== false) { r(); return; }
  window.addEventListener('online', () => r(), { once: true });
});
export const esPermanente = (e) => PERMANENTE.test(e?.message || '');

async function subirUna(it, alReintentar) {
  for (let intento = 0; ; intento++) {
    try {
      await hayRed();
      // Con el id de la cola, la subida se reanuda tras recargar y nunca se duplica.
      return await api.subirFoto(it.file, { autor: it.autor, momento: it.momento, clave: it.clave, id: it.id });
    } catch (e) {
      if (esPermanente(e) || intento >= ESPERAS.length) throw e;
      alReintentar?.();
      await dormir(ESPERAS[intento]);
    }
  }
}

let corridas = 0;
let enCurso = null; // una sola corrida a la vez (Álbum y el arranque no se pisan)
const oyentes = new Set();
let progreso = null; // { total, hechas, fallas, reintentando, error }
const avisar = () => oyentes.forEach((f) => f(progreso));
export function escuchar(f) { oyentes.add(f); f(progreso); return () => oyentes.delete(f); }

/**
 * Sube los registros (de a 3 en paralelo: rápido sin ahogar el wifi del
 * salón). Lo que se sube o falla para siempre sale de la cola; lo que falla
 * por red queda para la próxima.
 */
const tomados = new Set(); // ids ya en camino: nunca se suben dos veces
export function procesar(todos) {
  const items = todos.filter((it) => !tomados.has(it.id));
  items.forEach((it) => tomados.add(it.id));
  const anterior = enCurso || Promise.resolve();
  enCurso = anterior.then(async () => {
    if (!items.length) return;
    const esta = ++corridas;
    progreso = { total: items.length, hechas: 0, fallas: 0, reintentando: 0, error: '' };
    avisar();
    const cola = [...items];
    const trabajador = async () => {
      while (cola.length) {
        const it = cola.shift();
        try {
          if (it.file.size > 25 * 1024 * 1024 && (it.file.type || '').startsWith('video/')) {
            throw Object.assign(new Error(t('Video muy pesado (máx. 25 MB)', 'Video too large (max. 25 MB)')), { permanente: true });
          }
          await subirUna(it, () => { progreso = { ...progreso, reintentando: progreso.reintentando + 1 }; avisar(); });
          await quitar(it.id);
          progreso = { ...progreso, hechas: progreso.hechas + 1 };
          tomados.delete(it.id);
        } catch (e) {
          console.error('Subida', e);
          if (e.permanente || esPermanente(e)) await quitar(it.id);
          tomados.delete(it.id); // si fue por red, queda en la cola para la próxima
          progreso = { ...progreso, fallas: progreso.fallas + 1, error: e.message };
        }
        avisar();
      }
    };
    await Promise.all([trabajador(), trabajador(), trabajador()]);
    // El «¡Listo!» se ve unos segundos y se va.
    setTimeout(() => { if (esta === corridas) { progreso = null; avisar(); } }, 4000);
  });
  return enCurso;
}

/** Al abrir el sitio: si quedó algo de una visita anterior, se sube. */
export async function reanudarSiHay() {
  const p = await pendientes();
  if (p.length) await procesar(p);
  return p.length;
}
