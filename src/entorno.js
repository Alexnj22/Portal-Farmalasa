// src/entorno.js
//
// Contra qué base está corriendo el portal.
//
// Se DERIVA de la URL de Supabase en vez de leer una bandera propia
// (`VITE_ENTORNO=pruebas`). Una bandera aparte se puede olvidar al armar un
// `.env` nuevo, y olvidarla significa creer que estás en pruebas mientras
// escribís en producción — el error caro es exactamente ese, y en esa dirección.
// La URL no se puede olvidar: sin ella el cliente ni arranca. Así el aviso viaja
// pegado al dato que de verdad decide a dónde van los escritos.
//
// Mismo criterio que `AUTH_STORAGE_KEY` en `supabaseClient.js`, que también sale
// del subdominio: como la clave de sesión cambia con el proyecto, las sesiones de
// pruebas y de producción no se pisan en `localStorage`.

const REF_PRODUCCION = 'sacecdkdmsdvgqnrsett';

/** Ref del proyecto al que apunta este build ('' si la URL falta o es inválida). */
export const REF_SUPABASE = (() => {
  try {
    return new URL(import.meta.env.VITE_SUPABASE_URL).hostname.split('.')[0];
  } catch {
    return '';
  }
})();

export const ES_PRODUCCION = REF_SUPABASE === REF_PRODUCCION;

// Una URL ausente o rota cae acá y enciende el aviso. Es a propósito: ante la
// duda conviene el falso positivo ("creí que era producción y era pruebas")
// antes que el silencio.
export const ES_PRUEBAS = !ES_PRODUCCION;
