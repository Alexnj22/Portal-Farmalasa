// Modo de prueba (2026-10-07): sólo en la cuenta de prueba —la que tiene
// muestras—, para ver cómo se ven la tarjeta, el nivel, el cupón y la tarjeta
// de Wallet en cada nivel sin tener que comprar. No cambia nada en el servidor
// salvo la tarjeta de Wallet que se pide (con el nivel elegido).
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

const CLAVE = 'puntos_salud_modo_prueba';

export const NIVELES_PRUEBA = [
  { clave: 'vip', nombre: 'Cliente VIP', factor: 1, desde: 0, cumpleanos: 50 },
  { clave: 'plata', nombre: 'Plata', factor: 1.25, desde: 500, cumpleanos: 75 },
  { clave: 'oro', nombre: 'Oro', factor: 1.5, desde: 1000, cumpleanos: 100 },
  { clave: 'platino', nombre: 'Platino', factor: 2, desde: 2000, cumpleanos: 100 },
];

export const useModoPrueba = create((set) => ({
  activo: false,
  nivel: 'oro',
  cargar: async () => {
    try {
      const v = JSON.parse((await SecureStore.getItemAsync(CLAVE)) ?? 'null');
      if (v) set({ activo: !!v.activo, nivel: v.nivel ?? 'oro' });
    } catch { /* sin guardar */ }
  },
  poner: (cambio) => set((x) => {
    const nuevo = { ...x, ...cambio };
    SecureStore.setItemAsync(CLAVE, JSON.stringify({ activo: nuevo.activo, nivel: nuevo.nivel })).catch(() => {});
    return nuevo;
  }),
}));

/** El objeto `nivel` del resumen, armado para el nivel de prueba (con una compra a mitad de camino). */
export function nivelDePrueba(clave) {
  const i = Math.max(0, NIVELES_PRUEBA.findIndex((n) => n.clave === clave));
  const n = NIVELES_PRUEBA[i];
  const s = NIVELES_PRUEBA[i + 1];
  const compra = s ? Math.round((n.desde + (s.desde - n.desde) * 0.7) * 100) / 100 : 2850;
  return {
    clave: n.clave, nombre: n.nombre, factor: n.factor, cumpleanos: n.cumpleanos, horas_reserva: i >= 2 ? 48 : 24,
    cupon_mensual: n.clave === 'platino' ? 500 : 0, compra,
    siguiente: s ? { clave: s.clave, nombre: s.nombre, desde: s.desde, factor: s.factor, falta: Math.round((s.desde - compra) * 100) / 100 } : null,
  };
}

const idDePrueba = Date.now().toString(36);

/** Un cupón de muestra para el nivel Platino. */
export function cuponDePrueba() {
  const hoy = new Date();
  const fin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
  const vence = `${fin.getFullYear()}-${String(fin.getMonth() + 1).padStart(2, '0')}-${String(fin.getDate()).padStart(2, '0')}`;
  // Un id NUEVO por apertura: en modo de prueba el cupón siempre se puede raspar.
  const premios = [300, 500, 1000];
  const puntos = premios[Math.floor(Math.random() * premios.length)];
  return { id: `prueba-${idDePrueba}`, puntos, restantes: puntos, vence, titulo: 'Cupón Platino del mes' };
}

// Se lee lo guardado al abrir la app.
useModoPrueba.getState().cargar();
