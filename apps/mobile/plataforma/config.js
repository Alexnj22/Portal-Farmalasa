// La configuración — la versión del TELÉFONO. Las variables `EXPO_PUBLIC_*`
// las inyecta Expo al compilar (apps/mobile/.env, fuera del repo).
import './almacen';

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
export const VAPID_PUBLIC_KEY = undefined;
export const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

// auth-js sólo usa `localStorage` solo si cree estar en un navegador; en el
// teléfono hay que dárselo, o la sesión vive en memoria y se pierde al cerrar.
export const ALMACEN_DE_SESION = globalThis.localStorage;

// El portal web: lo que la app todavía no tiene en nativo se abre ahí, dentro
// de la app y con la misma sesión (ver componentes/PortalIncrustado.js). Tiene
// que ser un portal que hable con la MISMA base que la app, o la sesión no
// sirve: producción con producción, pruebas con pruebas.
export const PORTAL_URL = (process.env.EXPO_PUBLIC_PORTAL_URL || 'https://portal.farmasalud.lat').replace(/\/$/, '');
