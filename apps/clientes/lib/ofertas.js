// Las ofertas que la lista ya trajo, para que el detalle abra al instante (y
// la transición de zoom tenga qué mostrar) sin volver a pedirlas.
import { create } from 'zustand';
import { useSesion } from './sesion';

// Se vuelven a pedir a lo sumo cada 5 minutos: cada pedido firma de nuevo las
// fotos, y una URL nueva hace que el teléfono vuelva a bajar la misma imagen.
const VIGENCIA_MS = 5 * 60_000;

export const useOfertas = create((set, get) => ({
  datos: null,
  cargadoAt: 0,
  cargar: async ({ forzar = false } = {}) => {
    const { datos, cargadoAt } = get();
    if (!forzar && datos?.ok && Date.now() - cargadoAt < VIGENCIA_MS) return datos;
    const r = await useSesion.getState().pedir('ofertas');
    set({ datos: r, cargadoAt: r?.ok ? Date.now() : 0 });
    return r;
  },
  limpiar: () => set({ datos: null, cargadoAt: 0 }),
}));
