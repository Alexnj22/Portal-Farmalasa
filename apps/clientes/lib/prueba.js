// Modo de prueba (2026-10-07): sólo en la cuenta de prueba —la que tiene
// muestras—, para ver cómo se ven la tarjeta, el nivel, el cupón y la tarjeta
// de Wallet en cada nivel sin tener que comprar. No cambia nada en el servidor
// salvo la tarjeta de Wallet que se pide (con el nivel elegido).
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

const CLAVE = 'puntos_salud_modo_prueba';

// Sólo las claves y el rótulo para elegir el nivel de muestra. Los números
// (umbral, factor, cumpleaños, raspable) NO van acá desde el 2026-10-19: salen
// de `resumen.programa`, lo configurado en el portal, para que la muestra sea
// lo mismo que vería un cliente real de ese nivel.
export const NIVELES_PRUEBA = [
  // Reglamento v2: el nivel de entrada se llama Bronce (en la base, 'vip').
  { clave: 'bronce', nombre: 'Bronce' },
  { clave: 'plata', nombre: 'Plata' },
  { clave: 'oro', nombre: 'Oro' },
  { clave: 'platino', nombre: 'Platino' },
];
const claveServidor = (c) => (c === 'bronce' ? 'vip' : c);

// Lo del demo que vive sólo en memoria, apagado.
const DEMO_INICIAL = { saldoFavor: 'no', reservasMuestra: false, cambiosReservas: {}, vistaCodigo: false };

export const useModoPrueba = create((set) => ({
  activo: false,
  nivel: 'oro',
  // Rango de Cliente Mayorista de muestra (null = no es mayorista).
  mayorista: null,
  // Ver la app como empleado (tarjeta de Equipo).
  empleado: false,
  // Precios de mayoreo en el catálogo (2026-10-12): null = según el rango de
  // muestra; 'no' | 'mayoreo' | 'mayoreo_plus' = elegido a mano (lib/precioTuyo.js).
  precio: null,
  // El logo central: 'color' (velo de la marca) o 'material' (sólo relieve), para comparar.
  logo: 'material',
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
  // ── El demo (2026-10-20): todo en MEMORIA, nada se guarda ni se manda. ──
  // ¿El último resumen dijo `prueba: true`? Lo pone lib/cuenta.js con cada
  // resumen. Sin eso, lo de abajo no se aplica en ninguna pantalla (lib/demo.js)
  // y, si estaba encendido, se apaga: otra cuenta en el mismo teléfono —la del
  // revisor de las tiendas, por ejemplo— no hereda nada.
  cuentaDePrueba: false,
  // Saldo a favor de muestra: 'no' | 'vigente' | 'usado'.
  saldoFavor: 'no',
  // Una reserva de muestra en cada paso (lib/demo.js).
  reservasMuestra: false,
  // Lo que se «hizo» en Mis reservas sobre las de muestra: { id: cambio }.
  cambiosReservas: {},
  // Desde cuándo corren sus horas (la cuenta regresiva de «lista»).
  baseMuestra: Date.now(),
  // Ver la app como quien entró con el código del ticket, sin cerrar la sesión.
  vistaCodigo: false,
  reconocer: (esPrueba) => set((x) => {
    if (esPrueba) return x.cuentaDePrueba ? x : { cuentaDePrueba: true };
    if (!x.cuentaDePrueba && !x.vistaCodigo && !x.reservasMuestra && x.saldoFavor === 'no') return x;
    return { cuentaDePrueba: false, ...DEMO_INICIAL };
  }),
  ponerDemo: (cambio) => set((x) => ({ ...cambio,
    // Al encender las reservas de muestra, nacen otra vez desde ahora.
    ...(cambio.reservasMuestra && !x.reservasMuestra ? { baseMuestra: Date.now(), cambiosReservas: {} } : {}) })),
  cambiarReservas: (cambios) => set((x) => {
    const nuevo = { ...x.cambiosReservas };
    for (const [id, c] of Object.entries(cambios)) nuevo[id] = { ...nuevo[id], ...c };
    return { cambiosReservas: nuevo };
  }),
  reiniciarReservas: () => set({ cambiosReservas: {}, baseMuestra: Date.now() }),
  /** Todo el modo de prueba a como estaba: lo guardado y lo del demo. */
  reiniciarTodo: () => {
    const guardado = { activo: false, nivel: 'oro', mayorista: null, empleado: false, logo: 'material', precio: null };
    SecureStore.setItemAsync(CLAVE, JSON.stringify(guardado)).catch(() => {});
    set({ ...guardado, ...DEMO_INICIAL, ajuste: 0, cuponUsado: false, demoCupon: 0, semilla: Date.now().toString(36) });
  },
  cargar: async () => {
    try {
      const v = JSON.parse((await SecureStore.getItemAsync(CLAVE)) ?? 'null');
      if (v) set({ activo: !!v.activo, nivel: v.nivel ?? 'oro', mayorista: v.mayorista ?? null, empleado: !!v.empleado, logo: v.logo === 'color' ? 'color' : 'material',
        precio: ['no', 'mayoreo', 'mayoreo_plus'].includes(v.precio) ? v.precio : null });
    } catch { /* sin guardar */ }
  },
  poner: (cambio) => set((x) => {
    const nuevo = { ...x, ...cambio };
    SecureStore.setItemAsync(CLAVE, JSON.stringify({ activo: nuevo.activo, nivel: nuevo.nivel, mayorista: nuevo.mayorista, empleado: nuevo.empleado, logo: nuevo.logo, precio: nuevo.precio })).catch(() => {});
    return nuevo;
  }),
}));

/**
 * El objeto `nivel` del resumen, armado para el nivel de prueba (con una compra
 * a mitad de camino), desde `programa` (lo que manda el servidor). Sin
 * `programa` —una versión vieja de la función— no se inventa nada: null.
 */
export function nivelDePrueba(clave, programa) {
  const lista = programa?.niveles ?? [];
  if (!lista.length) return null;
  const i = Math.max(0, lista.findIndex((n) => n.clave === claveServidor(clave)));
  const n = lista[i];
  const s = lista[i + 1];
  const compra = s ? Math.round((n.desde + (s.desde - n.desde) * 0.7) * 100) / 100 : Math.round(Number(n.desde) * 140) / 100;
  return {
    clave: n.clave, nombre: n.nombre, factor: n.factor, cumpleanos: n.cumpleanos, horas_reserva: 24, activos: true,
    raspable: !!n.raspable, cupon_mensual: n.cupon_mensual ?? 0, compra, beneficios: n.beneficios ?? [],
    siguiente: s ? { clave: s.clave, nombre: s.nombre, desde: s.desde, factor: s.factor,
      falta: Math.round((s.desde - compra) * 100) / 100, beneficios: s.beneficios ?? [] } : null,
  };
}

/**
 * De dónde sale el raspable de muestra: el nivel elegido o, si se mira como
 * Cliente Mayorista, su rango. Null si ese nivel o rango no tiene raspable
 * configurado.
 */
export function raspableDePrueba(programa, { nivel, mayorista }) {
  const fuente = mayorista
    ? (programa?.mayoreo?.rangos ?? []).find((r) => r.clave === mayorista)
    : (programa?.niveles ?? []).find((n) => n.clave === claveServidor(nivel));
  return fuente?.raspable ? fuente : null;
}

/**
 * Un raspable de muestra con los premios CONFIGURADOS (2026-10-19; antes, una
 * tabla escrita acá que ya no coincidía con la base y que además ofrecía
 * descuentos que el motor no sabe dar). Sólo puntos, igual que el servidor.
 * `semilla` cambia con «Volver a tapar».
 */
export function cuponDePrueba(fuente, semilla, usado = false) {
  if (!fuente) return null;
  const hoy = new Date();
  const fin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
  const vence = `${fin.getFullYear()}-${String(fin.getMonth() + 1).padStart(2, '0')}-${String(fin.getDate()).padStart(2, '0')}`;
  const premios = (fuente.premios ?? []).filter((x) => Number(x.peso) > 0 && Number(x.puntos) > 0);
  let puntos = Number(fuente.cupon_mensual ?? 0);
  if (premios.length) {
    // Igual que `puntos_premio_al_azar`: cada premio con su peso.
    const total = premios.reduce((a, x) => a + Number(x.peso), 0);
    let r = Math.random() * total;
    puntos = Number(premios[premios.length - 1].puntos);
    for (const x of premios) { if (r <= Number(x.peso)) { puntos = Number(x.puntos); break; } r -= Number(x.peso); }
  }
  if (!(puntos > 0)) return null;
  return {
    id: `prueba-${fuente.clave}-${semilla}`, puntos, restantes: usado ? 0 : puntos, vence,
    descuento: null, tope: null,
    titulo: `Raspable ${fuente.nombre} del mes`,
  };
}

// Se lee lo guardado al abrir la app.
useModoPrueba.getState().cargar();
