import * as SecureStore from 'expo-secure-store';
import { guardar, leer } from './almacen';

// Lo que comparten el catálogo y la ficha de un producto (2026-10-07).

/** «ACETAMINOFEN 500MG X 100 TAB» → «Acetaminofen 500mg x 100 Tab». Con número, en minúscula. */
export function nombreProducto(s) {
  return String(s ?? '').toLowerCase().split(/\s+/).filter(Boolean).map((w) => {
    if (/\d/.test(w) || w.length <= 1) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

/** Las iniciales para el producto sin foto. */
export const iniciales = (s) => String(s ?? '').replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ ]/g, ' ').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

/** Un color estable por producto, para que el que no tiene foto no se vea igual a todos. */
const TONOS = [['#5B1E9C', '#B5308C'], ['#0A7C66', '#2BB673'], ['#1F5FAD', '#4CA3E8'], ['#B4560A', '#F0A23A'], ['#7A1F3D', '#D9486F'], ['#2E3D8F', '#6B7FE0']];
export const tonoDe = (id) => TONOS[Math.abs(Number(id) || 0) % TONOS.length];

/** Búsquedas rápidas: lo que la gente suele venir a buscar. */
export const BUSQUEDAS = [
  { q: 'acetaminofen', texto: 'Dolor y fiebre', sf: 'thermometer.medium' },
  { q: 'antigripal', texto: 'Gripe', sf: 'wind' },
  { q: 'vitamina', texto: 'Vitaminas', sf: 'leaf.fill' },
  { q: 'suero oral', texto: 'Hidratación', sf: 'drop.fill' },
  { q: 'pañal', texto: 'Bebé', sf: 'figure.and.child.holdinghands' },
  { q: 'glucometro', texto: 'Diabetes', sf: 'heart.text.square.fill' },
  { q: 'crema', texto: 'Piel', sf: 'hand.raised.fill' },
  { q: 'omeprazol', texto: 'Estómago', sf: 'cross.case.fill' },
];

// Vistos recientemente (2026-10-07): los últimos 12 productos abiertos, en el
// teléfono, para volver a ellos desde la Tienda. En `almacen` desde el
// 2026-10-15 (SecureStore tiene tope de 2048 bytes y doce productos con su foto
// firmada lo pasan); la primera vez se muda lo que había allá.
const CLAVE_VISTOS = 'puntos_salud_vistos';
// La copia en MEMORIA (2026-10-20, «a veces al entrar a la tienda se ve un
// movimiento de un producto en vistos recientemente»): la fila se leía del
// disco DESPUÉS de pintar la Tienda —vacía primero, llena un instante
// después— y empujaba todo hacia abajo. Con la copia, la pantalla nace con la
// fila ya puesta y la lectura del disco sólo confirma.
let enMemoria = null;
export const vistosEnMemoria = () => enMemoria ?? [];
// Quien muestra la fila se entera AL MOMENTO de abrir un producto (con la
// ficha encima), no al volver: así el reacomodo no se ve.
const oyentes = new Set();
export function alCambiarVistos(fn) { oyentes.add(fn); return () => oyentes.delete(fn); }
const avisar = () => oyentes.forEach((fn) => fn(enMemoria ?? []));
export async function leerVistos() {
  if (enMemoria) return enMemoria;
  const lista = await leer(CLAVE_VISTOS);
  if (Array.isArray(lista)) { enMemoria = lista; return lista; }
  try {
    const viejo = await SecureStore.getItemAsync(CLAVE_VISTOS);
    if (!viejo) return [];
    const mudada = JSON.parse(viejo);
    if (!Array.isArray(mudada)) return [];
    await guardar(CLAVE_VISTOS, mudada);
    enMemoria = mudada;
    await SecureStore.deleteItemAsync(CLAVE_VISTOS).catch(() => {});
    return mudada;
  } catch { return []; }
}
export async function recordarVisto(p) {
  if (!p?.id) return;
  const lista = (await leerVistos()).filter((x) => x.id !== p.id);
  lista.unshift({ id: p.id, nombre: p.nombre, foto: p.foto ?? null, precio: p.precio ?? null, precio_vip: p.precio_vip ?? null });
  enMemoria = lista.slice(0, 12);
  avisar();
  await guardar(CLAVE_VISTOS, enMemoria);
}

export async function olvidarVistos() {
  enMemoria = [];
  avisar();
  await guardar(CLAVE_VISTOS, null);
  await SecureStore.deleteItemAsync(CLAVE_VISTOS).catch(() => {});
}
