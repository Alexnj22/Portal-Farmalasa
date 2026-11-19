// Elige el backend: Supabase si hay variables de entorno, si no el modo demo
// (todo en el navegador). Ambos exponen exactamente la misma interfaz.
//
// El backend se carga APARTE (import dinámico): supabase-js pesa ~55 kB y la
// portada no lo necesita para pintarse. La descarga arranca en cuanto se
// evalúa este módulo, en paralelo con el primer render; `api.x(...)` espera a
// que llegue. Una vez cargado, `api.x` es la función real (también las
// sincrónicas, como `urlAudio`).
export const modoDemo = !(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);

let modulo = null;
let promesa = null;
export function cargarApi() {
  if (!promesa) {
    promesa = (modoDemo ? import('./localApi') : import('./supabaseApi'))
      .then((m) => { modulo = m; return m; })
      .catch((err) => { promesa = null; throw err; });
  }
  return promesa;
}
cargarApi().catch((e) => console.error('No se pudo cargar el backend', e));

export const api = new Proxy({}, {
  get(_, k) {
    if (typeof k !== 'string' || k === 'then') return undefined;
    if (modulo) return modulo[k];
    // Suscripciones: devuelven al instante la función para cancelar.
    if (k.startsWith('suscribir')) {
      return (...args) => {
        let cancelar = null; let cancelado = false;
        cargarApi().then((m) => { if (!cancelado) cancelar = m[k](...args); })
          .catch((e) => console.error(`api.${k}`, e));
        return () => { cancelado = true; cancelar?.(); };
      };
    }
    if (k === 'urlAudio') return () => null; // sólo se pide después de listar mensajes
    return async (...args) => {
      const m = await cargarApi();
      if (typeof m[k] !== 'function') throw new Error(`api.${k} no existe`);
      return m[k](...args);
    };
  },
});

export const esVideo = (ruta = '') => /\.(mp4|mov|webm)$/i.test(ruta);
