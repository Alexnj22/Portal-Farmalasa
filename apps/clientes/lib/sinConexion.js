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
]);

const DIR = FS.documentDirectory ? `${FS.documentDirectory}sin-conexion/` : null;

export const useConexion = create((set) => ({
  sinConexion: false,
  desde: null, // cuándo se guardó lo que se está mostrando
  marcar: (sinConexion, desde = null) => set((e) => (
    sinConexion ? { sinConexion: true, desde: e.desde && desde ? Math.min(e.desde, desde) : desde ?? e.desde }
      : e.sinConexion ? { sinConexion: false, desde: null } : e)),
}));

// La llave: la acción y sus datos, sin el token (cambia en cada sesión).
function llave(accion, datos) {
  const { token: _t, ...resto } = datos ?? {};
  const texto = `${accion}|${JSON.stringify(resto, Object.keys(resto).sort())}`;
  let h = 5381;
  for (let i = 0; i < texto.length; i++) h = ((h << 5) + h + texto.charCodeAt(i)) | 0;
  return `${accion}-${(h >>> 0).toString(36)}`;
}

export async function guardar(accion, datos, respuesta) {
  if (!DIR || !LECTURAS.has(accion) || !respuesta?.ok) return;
  try {
    await FS.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
    await FS.writeAsStringAsync(`${DIR}${llave(accion, datos)}.json`, JSON.stringify({ en: Date.now(), r: respuesta }));
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

export async function olvidarTodo() {
  if (!DIR) return;
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
