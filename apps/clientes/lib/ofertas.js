// Las ofertas que la lista ya trajo, para que el detalle abra al instante (y
// la transición de zoom tenga qué mostrar) sin volver a pedirlas.
import { create } from 'zustand';
import { useSesion } from './sesion';
import { llamar } from './api';
import { datosDePrueba } from './exclusiva';

// Se vuelven a pedir a lo sumo cada 5 minutos: cada pedido firma de nuevo las
// fotos, y una URL nueva hace que el teléfono vuelva a bajar la misma imagen.
const VIGENCIA_MS = 5 * 60_000;

export const useOfertas = create((set, get) => ({
  datos: null,
  cargadoAt: 0,
  cargar: async ({ forzar = false } = {}) => {
    const { datos, cargadoAt, de, prueba } = get();
    const ahora = useSesion.getState().token ? 'sesion' : 'publica';
    // Modo de prueba (2026-10-14): con otro nivel elegido, `disponible_para_ti`
    // cambia, así que se vuelve a pedir.
    const extra = ahora === 'sesion' ? datosDePrueba() : {};
    const clavePrueba = JSON.stringify(extra);
    // Lo de la vitrina pública no sirve después de entrar (faltan exclusivas y
    // muestras), ni al revés: si cambió quién mira, se vuelve a pedir.
    if (!forzar && datos?.ok && de === ahora && prueba === clavePrueba && Date.now() - cargadoAt < VIGENCIA_MS) return datos;
    // Sin sesión, la vitrina pública (lo exclusivo se anuncia sin detalle).
    const r = useSesion.getState().token
      ? await useSesion.getState().pedir('ofertas', extra)
      : await llamar('ofertas_publicas');
    // Si falla y ya había ofertas de este mismo «quién mira», se conservan.
    if (!r?.ok && datos?.ok && de === ahora) return datos;
    set({ datos: r, de: ahora, prueba: clavePrueba, cargadoAt: r?.ok ? Date.now() : 0 });
    return r;
  },
  limpiar: () => set({ datos: null, cargadoAt: 0 }),
}));
