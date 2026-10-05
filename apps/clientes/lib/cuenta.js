// Lo que el servidor sabe de esta persona, cacheado para que Puntos y Cuenta
// lean lo mismo sin pedirlo dos veces.
import { create } from 'zustand';
import { useSesion } from './sesion';

// `generacion` sube con cada resumen nuevo: la lista paginada de movimientos
// se reinicia SÓLO cuando cambia, y una página pedida antes de un refresco se
// descarta al llegar.
const VIGENCIA_MS = 60_000;

export const useCuenta = create((set, get) => ({
  resumen: null,
  error: null,
  cargando: false,
  cargadoAt: 0,
  generacion: 0,
  /** Pide el resumen. Sin `forzar`, no vuelve a pedir si el que hay tiene menos de un minuto. */
  cargar: async ({ forzar = false } = {}) => {
    const { resumen, cargadoAt } = get();
    if (!forzar && resumen && Date.now() - cargadoAt < VIGENCIA_MS) return resumen;
    set({ cargando: true, error: null });
    const r = await useSesion.getState().pedir('resumen');
    if (r?.ok) set((x) => ({ resumen: r, cargando: false, cargadoAt: Date.now(), generacion: x.generacion + 1 }));
    else set({ error: r?.mensaje ?? 'No se pudo consultar.', cargando: false });
    return r;
  },
  limpiar: () => set({ resumen: null, error: null, cargadoAt: 0 }),
}));
