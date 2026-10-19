// La sesión del cliente: un token en el llavero del teléfono (SecureStore).
// En la web —sólo para probar— cae a localStorage.
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { olvidarSincronizacion } from './avisos';
import { llamar } from './api';
import { olvidarTodo } from './sinConexion';
import { useCarrito } from './carrito';
import { olvidarTomas } from './tomas';
import { olvidarVistos } from './catalogo';

const CLAVE = 'puntos_salud_sesion';
// El ALCANCE de la sesión (2026-10-19): 'codigo' si se entró con el código de
// 7 letras del ticket (sólo puntos, saldo, tarjeta, nivel y ofertas), 'completo'
// con DUI y teléfono. Quien decide es el SERVIDOR (lista blanca en
// app-clientes); esto es sólo lo que la app sabe para no ofrecer lo que le
// van a negar, y se corrige solo con cada respuesta (`pedir`).
const CLAVE_ALCANCE = 'puntos_salud_alcance';
const ALCANCES = new Set(['codigo', 'completo']);

const almacenDe = (clave) => (Platform.OS === 'web'
  ? {
      leer: async () => { try { return localStorage.getItem(clave); } catch { return null; } },
      guardar: async (v) => { try { localStorage.setItem(clave, v); } catch { /* sin almacenamiento */ } },
      borrar: async () => { try { localStorage.removeItem(clave); } catch { /* idem */ } },
    }
  : {
      leer: () => SecureStore.getItemAsync(clave),
      guardar: (v) => SecureStore.setItemAsync(clave, v),
      borrar: () => SecureStore.deleteItemAsync(clave),
    });
const almacen = almacenDe(CLAVE);
const almacenAlcance = almacenDe(CLAVE_ALCANCE);

// La lectura del llavero es asíncrona y las pantallas piden datos al montarse.
// Sin esperar a esa lectura, la primera llamada salía SIN token, el servidor
// contestaba «sin sesión» y la app borraba la sesión guardada: quien recargaba
// o volvía a abrir la app quedaba afuera. Por eso `pedir` espera esta promesa.
let lectura = null;

export const useSesion = create((set, get) => ({
  token: null,
  lista: false,
  alcance: null,
  // «Para ver esto, entra con tu DUI y teléfono» (2026-10-19): mientras se
  // completa la entrada, la sesión de código sigue abierta y la guardia deja
  // estar en «Entrar» con sesión.
  completando: false,

  cargar: () => {
    if (!lectura) {
      lectura = Promise.all([
        almacen.leer().catch(() => null),
        almacenAlcance.leer().catch(() => null),
      ]).then(([token, alcance]) => {
        set({ token: token || null, alcance: token && ALCANCES.has(alcance) ? alcance : null, lista: true });
      });
    }
    return lectura;
  },

  abrir: async (token, alcance = null) => {
    await almacen.guardar(token);
    const a = ALCANCES.has(alcance) ? alcance : null;
    if (a) await almacenAlcance.guardar(a).catch(() => {});
    else await almacenAlcance.borrar().catch(() => {});
    olvidarSincronizacion(); // la sesión nueva retoma los avisos del teléfono
    set({ token, alcance: a, completando: false, lista: true, motivoCierre: null });
  },

  /** Ir a completar la entrada con DUI y teléfono, sin cerrar la sesión de código. */
  completar: () => set({ completando: true }),
  dejarDeCompletar: () => set({ completando: false }),

  cerrar: async () => {
    await almacen.borrar().catch(() => {});
    await olvidarTodo();
    // El carrito vive en el teléfono (2026-10-12): en un teléfono compartido,
    // quien entra después heredaba lo que había agregado la cuenta anterior.
    // Si sólo venció la sesión es la misma persona: el carrito se queda.
    if (get().motivoCierre !== 'vencida') {
      useCarrito.getState().vaciar();
      // Los recordatorios de tomas, igual (2026-10-12): en un teléfono
      // compartido, a quien entra después no le suena la medicina del anterior.
      await olvidarTomas();
      // Y los productos vistos: son de quien los buscó, no del teléfono.
      await olvidarVistos().catch(() => {});
    }
    await almacenAlcance.borrar().catch(() => {});
    set({ token: null, alcance: null, completando: false });
  },

  /**
   * Llama a la función con la sesión. Si el servidor rechaza ESE token, la
   * sesión se cierra; si entretanto se abrió otra (o nunca hubo), no se toca.
   */
  pedir: async (accion, datos = {}) => {
    await get().cargar();
    const token = get().token;
    if (!token) return { ok: false, sinSesion: true, mensaje: 'Vuelve a entrar.' };
    const r = await llamar(accion, { ...datos, token });
    if (r?.sinSesion && get().token === token) { set({ motivoCierre: 'vencida' }); await get().cerrar(); }
    // El servidor dice el alcance en el resumen y al negar algo al código.
    const a = r?.motivo === 'requiere_documento' ? 'codigo' : r?.alcance;
    if (ALCANCES.has(a) && get().token === token && get().alcance !== a) {
      set({ alcance: a });
      almacenAlcance.guardar(a).catch(() => {});
    }
    return r;
  },
}));

export const plataforma = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web';

/** ¿La sesión es de CÓDIGO (limitada)? Lo que no se sabe todavía cuenta como completa: el servidor igual lo niega. */
export const useConCodigo = () => useSesion((s) => !!s.token && s.alcance === 'codigo');
/** Lo que se le dice a quien entró con el código, en cualquier pantalla. */
export const MENSAJE_CODIGO = 'Para ver esto, entra con tu DUI y teléfono.';
