// Modo de prueba (2026-10-07): sólo en la cuenta de prueba —la que tiene
// muestras—, para ver cómo se ven la tarjeta, el nivel, el cupón y la tarjeta
// de Wallet en cada nivel sin tener que comprar. No cambia nada en el servidor
// salvo la tarjeta de Wallet que se pide (con el nivel elegido).
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

const CLAVE = 'puntos_salud_modo_prueba';

export const NIVELES_PRUEBA = [
  // Reglamento v2: el nivel de entrada se llama Bronce.
  { clave: 'bronce', nombre: 'Bronce', factor: 1, desde: 0, cumpleanos: 50 },
  { clave: 'plata', nombre: 'Plata', factor: 1.25, desde: 500, cumpleanos: 75 },
  { clave: 'oro', nombre: 'Oro', factor: 1.5, desde: 1000, cumpleanos: 100 },
  { clave: 'platino', nombre: 'Platino', factor: 2, desde: 2000, cumpleanos: 100 },
];

export const useModoPrueba = create((set) => ({
  activo: false,
  nivel: 'oro',
  // Rango de Cliente Mayorista de muestra (null = no es mayorista).
  mayorista: null,
  // Ver la app como empleado (tarjeta de Equipo).
  empleado: false,
  // El logo central: 'color' (velo de la marca) o 'material' (sólo relieve), para comparar.
  logo: 'color',
  // Cambia con «Volver a tapar el cupón»: un id nuevo se puede raspar otra vez.
  semilla: Date.now().toString(36),
  reiniciarCupon: () => set({ semilla: Date.now().toString(36), cuponUsado: false }),
  // «Ver cupón usado» y «Ver animación» (2026-10-08).
  cuponUsado: false,
  demoCupon: 0,
  // «Simular: ganar / usar puntos» (2026-10-08): sólo mueve el saldo que se ve.
  ajuste: 0,
  simularPuntos: (n) => set((e) => ({ ajuste: e.ajuste + n })),
  verCuponUsado: (v) => set({ cuponUsado: v }),
  verAnimacionCupon: () => set((e) => ({ cuponUsado: false, demoCupon: e.demoCupon + 1 })),
  cargar: async () => {
    try {
      const v = JSON.parse((await SecureStore.getItemAsync(CLAVE)) ?? 'null');
      if (v) set({ activo: !!v.activo, nivel: v.nivel ?? 'oro', mayorista: v.mayorista ?? null, empleado: !!v.empleado, logo: v.logo === 'material' ? 'material' : 'color' });
    } catch { /* sin guardar */ }
  },
  poner: (cambio) => set((x) => {
    const nuevo = { ...x, ...cambio };
    SecureStore.setItemAsync(CLAVE, JSON.stringify({ activo: nuevo.activo, nivel: nuevo.nivel, mayorista: nuevo.mayorista, empleado: nuevo.empleado, logo: nuevo.logo })).catch(() => {});
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
    clave: n.clave, nombre: n.nombre, factor: n.factor, cumpleanos: n.cumpleanos, horas_reserva: 24, activos: true,
    cupon_mensual: n.clave === 'platino' ? 500 : 0, compra,
    siguiente: s ? { clave: s.clave, nombre: s.nombre, desde: s.desde, factor: s.factor, falta: Math.round((s.desde - compra) * 100) / 100 } : null,
  };
}

// Los premios de la raspable del Reglamento v2 (cláusula 5), con su probabilidad.
const PREMIOS = {
  oro: [[45, { puntos: 25 }], [30, { puntos: 50 }], [15, { puntos: 100 }], [8, { descuento: 5, tope: 5 }], [2, { puntos: 250 }]],
  platino: [[40, { puntos: 100 }], [30, { puntos: 200 }], [15, { puntos: 300 }], [10, { descuento: 15, tope: 10 }], [5, { puntos: 1000 }]],
};

/** Un cupón de muestra (Oro o Platino, premios del v2). `semilla` cambia con «Volver a tapar». */
export function cuponDePrueba(nivel, semilla, usado = false) {
  const hoy = new Date();
  const fin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
  const vence = `${fin.getFullYear()}-${String(fin.getMonth() + 1).padStart(2, '0')}-${String(fin.getDate()).padStart(2, '0')}`;
  const tabla = PREMIOS[nivel === 'oro' ? 'oro' : 'platino'];
  let r = Math.random() * 100; let premio = tabla[0][1];
  for (const [peso, p] of tabla) { if (r < peso) { premio = p; break; } r -= peso; }
  const puntos = premio.puntos ?? 0;
  return {
    id: `prueba-${nivel}-${semilla}`, puntos, restantes: usado ? 0 : (puntos || 1), vence,
    descuento: premio.descuento ?? null, tope: premio.tope ?? null,
    titulo: `Raspable ${nivel === 'oro' ? 'Oro' : 'Platino'} del mes`,
  };
}

// Se lee lo guardado al abrir la app.
useModoPrueba.getState().cargar();
