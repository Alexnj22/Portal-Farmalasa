// src/supabaseClient.js
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, ALMACEN_DE_SESION } from '@plataforma/config';

// La URL, la llave y dónde se guarda la sesión los pone cada app: la web los
// lee de Vite y guarda en `localStorage` (el default de auth-js, por eso
// ALMACEN_DE_SESION viene vacío); el teléfono, de su configuración y de su
// almacén. Así este archivo es el mismo en las dos.
const supabaseUrl = SUPABASE_URL;
const supabaseKey = SUPABASE_ANON_KEY;

/** @type {import('@supabase/supabase-js').SupabaseClient<import('./types/database').Database>} */
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    ...(ALMACEN_DE_SESION ? { storage: ALMACEN_DE_SESION } : {}),
  },
});

// La clave de `localStorage` donde auth-js guarda la sesión (access token +
// refresh token). No se configura `storageKey`, así que es la que arma él por
// defecto: `sb-<ref>-auth-token`, con el `<ref>` del subdominio del proyecto.
//
// Se exporta porque **`signOut()` no siempre la borra**: si la llamada de
// revocación falla por algo que no sea 401/403/404, auth-js retorna antes de
// `_removeSession()` (`_signOut` en GoTrueClient.js). Un corte de red deja el
// token puesto con su refresh token vivo, así que quien cierre sesión tiene que
// poder borrarla a mano. Ver `doLogout` en `AuthContext.jsx`.
export const AUTH_STORAGE_KEY = (() => {
  try {
    return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
  } catch {
    return 'sb-auth-token';   // URL ausente o inválida: el cliente ya no funciona igual
  }
})();