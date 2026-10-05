// Lo que el servidor sabe de esta persona, cacheado para que Puntos y Cuenta
// lean lo mismo sin pedirlo dos veces.
import { create } from 'zustand';
import { useSesion } from './sesion';

export const useCuenta = create((set) => ({
  resumen: null,
  error: null,
  cargando: false,
  cargar: async () => {
    set({ cargando: true, error: null });
    const r = await useSesion.getState().pedir('resumen');
    if (r?.ok) set({ resumen: r, cargando: false });
    else set({ error: r?.mensaje ?? 'No se pudo consultar.', cargando: false });
    return r;
  },
  limpiar: () => set({ resumen: null, error: null }),
}));
