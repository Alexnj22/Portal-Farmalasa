// El carrito (2026-10-07): productos del catálogo que se reservan JUNTOS para
// retirar en una sucursal. Vive en el teléfono (sobrevive a cerrar la app); el
// precio que se ve es el de cuando se agregó, y el servidor lo vuelve a
// calcular al reservar (`reservar_carrito`).
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

const CLAVE = 'puntos_salud_carrito';
export const MAX_PRODUCTOS = 10;
export const MAX_UNIDADES = 5;

const guardar = (items) => SecureStore.setItemAsync(CLAVE, JSON.stringify(items)).catch(() => {});
const llave = (x) => `${x.id}|${x.factor}`;

export const useCarrito = create((set, get) => ({
  items: [],
  cargar: async () => {
    try { set({ items: JSON.parse((await SecureStore.getItemAsync(CLAVE)) ?? '[]') }); } catch { /* vacío */ }
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
  quitar: (p) => { const items = get().items.filter((x) => llave(x) !== llave(p)); set({ items }); guardar(items); },
  vaciar: () => { set({ items: [] }); guardar([]); },
}));

useCarrito.getState().cargar();
