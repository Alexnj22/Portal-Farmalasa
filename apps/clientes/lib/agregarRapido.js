// El botón de agregar de la Tienda. Antes agregaba directo cuando el producto
// tenía una sola presentación y mandaba a la ficha cuando tenía varias
// (usuario, 2026-11-09: «solo se agrega pero no pregunta presentación»). Ahora
// siempre abre la hoja de abajo (componentes/HojaAgregar.js), que muestra
// presentación, precio y cantidad sin sacar al cliente de la Tienda.
import { create } from 'zustand';
import * as Haptics from 'expo-haptics';

export const useHojaAgregar = create((set) => ({
  // El producto de la tarjeta tocada; null = hoja cerrada.
  producto: null,
  // El último agregado, para el aviso «Agregado · Ver carrito».
  agregado: null,
  abrir: (producto) => set({ producto }),
  cerrar: () => set({ producto: null }),
  avisar: (agregado) => set({ agregado: { ...agregado, id: Date.now() } }),
  soltarAviso: () => set({ agregado: null }),
}));

/** Abre la hoja de presentaciones para el producto `p` de una tarjeta. */
export function agregarRapido(p) {
  if (!p?.id) return;
  Haptics.selectionAsync().catch(() => {});
  useHojaAgregar.getState().abrir(p);
}
