// ─────────────────────────────────────────────────────────────────────────────
// La configuración del portal — la versión de VITE.
// ─────────────────────────────────────────────────────────────────────────────
//
// `import.meta.env` es de Vite: la lógica no puede nombrarlo si se va a llevar
// a una app nativa, donde la configuración llega por `expo-constants`. Su
// gemelo `config.native.js` exportará los mismos nombres. Ver `almacen.js`.
//
// Se leen al cargar el módulo, igual que antes se leían al evaluar cada
// expresión: Vite las reemplaza por texto al compilar, así que no hay
// diferencia entre leerlas acá una vez o en cada sitio.

export const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const VAPID_PUBLIC_KEY  = import.meta.env.VITE_VAPID_PUBLIC_KEY;
export const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
