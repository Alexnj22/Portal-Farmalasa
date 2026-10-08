// La sesión del cliente: un token en el llavero del teléfono (SecureStore).
// En la web —sólo para probar— cae a localStorage.
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { olvidarSincronizacion } from './avisos';
import { llamar } from './api';
import { olvidarTodo } from './sinConexion';

const CLAVE = 'puntos_salud_sesion';

const almacen = Platform.OS === 'web'
  ? {
      leer: async () => { try { return localStorage.getItem(CLAVE); } catch { return null; } },
      guardar: async (v) => { try { localStorage.setItem(CLAVE, v); } catch { /* sin almacenamiento */ } },
      borrar: async () => { try { localStorage.removeItem(CLAVE); } catch { /* idem */ } },
    }
  : {
      leer: () => SecureStore.getItemAsync(CLAVE),
      guardar: (v) => SecureStore.setItemAsync(CLAVE, v),
      borrar: () => SecureStore.deleteItemAsync(CLAVE),
    };

// La lectura del llavero es asíncrona y las pantallas piden datos al montarse.
// Sin esperar a esa lectura, la primera llamada salía SIN token, el servidor
// contestaba «sin sesión» y la app borraba la sesión guardada: quien recargaba
// o volvía a abrir la app quedaba afuera. Por eso `pedir` espera esta promesa.
let lectura = null;

export const useSesion = create((set, get) => ({
  token: null,
  lista: false,

  cargar: () => {
    if (!lectura) {
      lectura = almacen.leer().catch(() => null).then((token) => {
        set({ token: token || null, lista: true });
      });
    }
    return lectura;
  },

  abrir: async (token) => {
    await almacen.guardar(token);
    olvidarSincronizacion(); // la sesión nueva retoma los avisos del teléfono
    set({ token, lista: true, motivoCierre: null });
  },

  cerrar: async () => {
    await almacen.borrar().catch(() => {});
    await olvidarTodo();
    set({ token: null });
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
    return r;
  },
}));

export const plataforma = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web';
