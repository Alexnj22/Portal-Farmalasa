// Las ofertas que la lista ya trajo, para que el detalle abra al instante (y
// la transición de zoom tenga qué mostrar) sin volver a pedirlas.
import { create } from 'zustand';
import { useSesion } from './sesion';
import { llamar } from './api';
import { datosDePrueba } from './exclusiva';
import { copiaParaEmpezar } from './sinConexion';

// Se vuelven a pedir a lo sumo cada 5 minutos: cada pedido firma de nuevo las
// fotos, y una URL nueva hace que el teléfono vuelva a bajar la misma imagen.
const VIGENCIA_MS = 5 * 60_000;

// El pedido EN CURSO (2026-10-14): la pestaña y el carrusel de la Tienda lo
// piden a la vez al abrir; sin esto salían dos pedidos idénticos.
let enCurso = null;

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
    if (enCurso && !forzar) return enCurso;
    const accion = ahora === 'sesion' ? 'ofertas' : 'ofertas_publicas';
    const pedido = (async () => {
      // En frío, lo de la vez anterior se pinta YA (2026-10-14): la pestaña
      // esperaba a la red con la ruedita, que con mala señal eran segundos.
      if (!datos || de !== ahora) {
        const copia = await copiaParaEmpezar(accion, extra);
        if (copia && !get().datos?.ok) set({ datos: copia, de: ahora, prueba: clavePrueba, cargadoAt: 0 });
      }
      // Sin sesión, la vitrina pública (lo exclusivo se anuncia sin detalle).
      const r = ahora === 'sesion'
        ? await useSesion.getState().pedir('ofertas', extra)
        : await llamar('ofertas_publicas');
      const previo = get();
      // Si falla y ya había ofertas de este mismo «quién mira», se conservan.
      if (!r?.ok && previo.datos?.ok && previo.de === ahora) return previo.datos;
      set({ datos: r, de: ahora, prueba: clavePrueba, cargadoAt: r?.ok && !r.sinConexion ? Date.now() : 0 });
      return r;
    })();
    enCurso = pedido;
    try { return await pedido; } finally { if (enCurso === pedido) enCurso = null; }
  },
  limpiar: () => set({ datos: null, cargadoAt: 0 }),
}));
