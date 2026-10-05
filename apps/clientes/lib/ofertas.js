// Las ofertas que la lista ya trajo, para que el detalle abra al instante (y
// la transición de zoom tenga qué mostrar) sin volver a pedirlas.
import { create } from 'zustand';
import { useSesion } from './sesion';

export const useOfertas = create((set) => ({
  datos: null,
  cargar: async () => {
    const r = await useSesion.getState().pedir('ofertas');
    set({ datos: r });
    return r;
  },
}));
