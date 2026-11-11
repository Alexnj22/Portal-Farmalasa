// El carrito (2026-10-07): productos del catálogo que se reservan JUNTOS para
// retirar en una sucursal. Vive en el teléfono (sobrevive a cerrar la app); el
// precio que se ve es el de cuando se agregó, y el servidor lo vuelve a
// calcular al reservar (`reservar_carrito`).
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { guardar as guardarEnAlmacen, leer as leerDelAlmacen } from './almacen';

const CLAVE = 'puntos_salud_carrito';
export const MAX_PRODUCTOS = 10;
// Era 5 hasta el 2026-10-19: la cantidad pasó a ser libre (decisión del
// usuario) y lo «no habitual» se le pregunta al cliente al reservar. Esto es
// sólo una red contra un número absurdo.
export const MAX_UNIDADES = 99;

// Vive en `almacen` (archivos) desde el 2026-10-15: en SecureStore cada toque
// de «+» reescribía el carrito entero cifrado, y uno lleno pasaba su tope de
// 2048 bytes. La primera vez se muda lo que había allá y se borra de allá.
const guardar = (items) => guardarEnAlmacen(CLAVE, items);
async function leerGuardado() {
  const items = await leerDelAlmacen(CLAVE);
  if (items) return items;
  try {
    const viejo = await SecureStore.getItemAsync(CLAVE);
    if (!viejo) return [];
    const lista = JSON.parse(viejo);
    await guardarEnAlmacen(CLAVE, lista);
    await SecureStore.deleteItemAsync(CLAVE).catch(() => {});
    return lista;
  } catch { return []; }
}
const llave = (x) => `${x.id}|${x.factor}`;

export const useCarrito = create((set, get) => ({
  items: [],
  cargar: async () => {
    const items = await leerGuardado();
    // Si mientras se leía ya se agregó algo, gana lo de la pantalla.
    if (Array.isArray(items) && !get().items.length) set({ items });
  },
  /** Agrega (o suma) un producto en una presentación. Devuelve false si no cabe. */
  agregar: (p, cantidad = 1) => {
    const items = [...get().items];
    const i = items.findIndex((x) => llave(x) === llave(p));
    if (i >= 0) items[i] = { ...items[i], cantidad: Math.min(MAX_UNIDADES, items[i].cantidad + cantidad) };
    else if (items.length >= MAX_PRODUCTOS) return false;
    else items.push({ ...p, cantidad: Math.min(MAX_UNIDADES, cantidad) });
    set({ items }); guardar(items);
    return true;
  },
  cantidad: (p, n) => {
    const items = get().items.map((x) => (llave(x) === llave(p) ? { ...x, cantidad: Math.max(1, Math.min(MAX_UNIDADES, n)) } : x));
    set({ items }); guardar(items);
  },
  // Lo último que se quitó, para «Deshacer» (2026-11-11): el producto tal
  // cual (con su cantidad) y en qué lugar estaba.
  quitado: null,
  quitar: (p) => {
    const antes = get().items;
    const indice = antes.findIndex((x) => llave(x) === llave(p));
    const items = antes.filter((x) => llave(x) !== llave(p));
    set({ items, quitado: indice >= 0 ? { item: antes[indice], indice, en: Date.now() } : get().quitado }); guardar(items);
  },
  deshacer: () => {
    const q = get().quitado; if (!q) return;
    const items = get().items.filter((x) => llave(x) !== llave(q.item));
    items.splice(Math.min(q.indice, items.length), 0, q.item);
    set({ items, quitado: null }); guardar(items);
  },
  soltarQuitado: () => set({ quitado: null }),
  // Al cerrar sesión también se borra la copia VIEJA de SecureStore, si quedó:
  // si no, la mudanza la traería de vuelta para la cuenta siguiente.
  vaciar: () => { set({ items: [], quitado: null }); guardar(null); SecureStore.deleteItemAsync(CLAVE).catch(() => {}); },
}));

useCarrito.getState().cargar();
