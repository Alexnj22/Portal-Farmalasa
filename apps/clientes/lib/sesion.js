// La sesión del cliente: un token en el llavero del teléfono (SecureStore).
// En la web —sólo para probar— cae a localStorage.
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { llamar } from './api';

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

export const useSesion = create((set, get) => ({
  token: null,
  lista: false,

  cargar: async () => {
    const token = await almacen.leer().catch(() => null);
    set({ token: token || null, lista: true });
  },

  abrir: async (token) => {
    await almacen.guardar(token);
    set({ token });
  },

  cerrar: async () => {
    await almacen.borrar().catch(() => {});
    set({ token: null });
  },

  /** Llama a la función con la sesión; si el servidor la da por terminada, la cierra. */
  pedir: async (accion, datos = {}) => {
    const r = await llamar(accion, { ...datos, token: get().token });
    if (r?.sinSesion) await get().cerrar();
    return r;
  },
}));

export const plataforma = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web';
