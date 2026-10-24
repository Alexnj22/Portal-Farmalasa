// Sin internet (2026-10-08): lo último que se vio se guarda en el teléfono y,
// si la red falla, se muestra eso con un aviso arriba («Sin conexión · lo que
// ves es de hace 5 min»). Sólo lecturas: reservar, pagar o canjear nunca se
// hacen con datos guardados, ésas siguen diciendo «Sin conexión».
//
// Se guarda en archivos (expo-file-system) y no en SecureStore: los catálogos
// y las listas pasan por mucho su tope de tamaño. Al cerrar sesión se borra
// todo, para que otra cuenta en el mismo teléfono no vea lo de la anterior.
import * as FS from 'expo-file-system/legacy';
import { create } from 'zustand';

export const LECTURAS = new Set([
  'resumen', 'mis_reservas', 'mis_encargos', 'mis_facturas', 'mis_tratamientos', 'mis_encuestas',
  'bandeja', 'catalogo', 'catalogo_producto', 'banners', 'ofertas', 'ofertas_publicas', 'historias',
  'historias_publicas', 'salas', 'movimientos', 'compras', 'inyecciones', 'textos', 'reserva_terminos',
  'mis_creditos', // lo que se debe: se consulta también sin señal (2026-10-15)
]);

const DIR = FS.documentDirectory ? `${FS.documentDirectory}sin-conexion/` : null;

export const useConexion = create((set) => ({
  sinConexion: false,
  desde: null, // cuándo se guardó lo que se está mostrando
  marcar: (sinConexion, desde = null) => set((e) => (
    sinConexion ? { sinConexion: true, desde: e.desde && desde ? Math.min(e.desde, desde) : desde ?? e.desde }
      : e.sinConexion ? { sinConexion: false, desde: null } : e)),
}));

// JSON con las llaves ordenadas en TODOS los niveles (2026-10-15). Con
// `JSON.stringify(x, llavesDeArriba)` la lista de llaves filtra también las
// anidadas: `antes: { created_at, id }` salía `{}` y todas las páginas de una
// lista caían en el mismo archivo.
function ordenado(v) {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : ordenado(x))).join(',')}]`;
  if (v && typeof v === 'object' && typeof v.toJSON !== 'function') {
    return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${ordenado(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

function hash(texto) {
  let h = 5381;
  for (let i = 0; i < texto.length; i++) h = ((h << 5) + h + texto.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// La llave: la acción y sus datos, sin el token (cambia en cada sesión).
function llave(accion, datos) {
  const { token: _t, ...resto } = datos ?? {};
  return `${accion}-${hash(`${accion}|${ordenado(resto)}`)}`;
}

// La carpeta se crea UNA vez por arranque (y otra después de `olvidarTodo`),
// no en cada lectura. Al crearla se podan las copias que nadie volvió a
// escribir en un mes: con una página por cursor, la lista de movimientos deja
// archivos que ya no se piden, y los del formato de llave anterior también.
const PODAR_MS = 30 * 24 * 60 * 60_000;
let carpeta = null;
function asegurarCarpeta() {
  if (!carpeta) {
    carpeta = FS.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
    carpeta.then(podar);
  }
  return carpeta;
}

async function podar() {
  try {
    const limite = Date.now() - PODAR_MS;
    for (const nombre of await FS.readDirectoryAsync(DIR)) {
      const info = await FS.getInfoAsync(`${DIR}${nombre}`).catch(() => null);
      // `modificationTime` viene en SEGUNDOS.
      if (info?.exists && info.modificationTime && info.modificationTime * 1000 < limite) {
        await FS.deleteAsync(`${DIR}${nombre}`, { idempotent: true }).catch(() => {});
      }
    }
  } catch { /* sin carpeta: nada que podar */ }
}

// Lo último que se escribió por llave (largo + hash, no el texto: el catálogo
// pesa). Si la respuesta es idéntica no se reescribe el archivo — salvo que la
// copia tenga más de 10 min, para que «guardado hace…» no envejezca de más.
const escrito = new Map();
const REFRESCAR_MS = 10 * 60_000;

export async function guardar(accion, datos, respuesta) {
  if (!DIR || !LECTURAS.has(accion) || !respuesta?.ok) return;
  try {
    const k = llave(accion, datos);
    const texto = JSON.stringify(respuesta);
    const firma = `${texto.length}:${hash(texto)}`;
    const previo = escrito.get(k);
    if (previo && previo.firma === firma && Date.now() - previo.en < REFRESCAR_MS) return;
    await asegurarCarpeta();
    const en = Date.now();
    await FS.writeAsStringAsync(`${DIR}${k}.json`, `{"en":${en},"r":${texto}}`);
    escrito.set(k, { firma, en });
  } catch { /* sin espacio: no pasa nada */ }
}

export async function leer(accion, datos) {
  if (!DIR || !LECTURAS.has(accion)) return null;
  try {
    const t = await FS.readAsStringAsync(`${DIR}${llave(accion, datos)}.json`);
    const { en, r } = JSON.parse(t);
    return { ...r, sinConexion: true, guardadoEn: en };
  } catch { return null; }
}

// La copia guardada para PINTAR AL INSTANTE (2026-10-14, «las ofertas tardan
// en cargar»): una pestaña abierta en frío esperaba a la red con la ruedita
// aunque el teléfono tuviera lo de la vez anterior. Se pinta la copia y la
// respuesta fresca la reemplaza al llegar. A diferencia de `leer`, NO marca
// «sin conexión»: todavía no se sabe si la hay.
export async function copiaParaEmpezar(accion, datos) {
  if (!DIR || !LECTURAS.has(accion)) return null;
  try {
    const { r } = JSON.parse(await FS.readAsStringAsync(`${DIR}${llave(accion, datos)}.json`));
    return r?.ok ? r : null;
  } catch { return null; }
}

// Retoca la copia guardada de una lectura (2026-10-12). Lo que el servidor ya
// borró no puede volver a salir de la copia sin conexión: los avisos borrados
// de la bandeja reaparecían sin señal, porque la copia era de antes de borrar.
// `cambiar` recibe la respuesta guardada y devuelve la nueva.
export async function retocar(accion, datos, cambiar) {
  if (!DIR || !LECTURAS.has(accion)) return;
  const ruta = `${DIR}${llave(accion, datos)}.json`;
  try {
    const { en, r } = JSON.parse(await FS.readAsStringAsync(ruta));
    // La copia ya no es la última que se escribió: la próxima respuesta,
    // aunque sea igual a aquélla, se vuelve a guardar.
    escrito.delete(llave(accion, datos));
    await FS.writeAsStringAsync(ruta, JSON.stringify({ en, r: cambiar(r) }));
  } catch { /* no había copia: nada que retocar */ }
}

export async function olvidarTodo() {
  if (!DIR) return;
  escrito.clear();
  carpeta = null;
  await FS.deleteAsync(DIR, { idempotent: true }).catch(() => {});
}

export function haceCuanto(ms) {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} día${d === 1 ? '' : 's'}`;
}
