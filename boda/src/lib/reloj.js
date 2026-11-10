// La hora "de hoy" del sitio y la fase forzada, con lugar para las PRUEBAS.
// En modo demo, el panel de pruebas puede fingir otra fecha (para ver el plazo
// vencido, el día de la boda, etc.) y fijar una fase; queda guardado en este
// navegador. Con Supabase conectado esto no hace nada: manda la hora real.
const demo = !(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
const K_HOY = 'boda-prueba-hoy';
const K_FASE = 'boda-prueba-fase';
const leer = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const escribir = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* modo privado */ } };

export const pruebasDisponibles = demo;

/** 'AAAA-MM-DD' fingida, o '' si se usa la fecha real. */
export const fechaFingida = () => (demo ? leer(K_HOY) : '');
export const fingirFecha = (aaaammdd) => escribir(K_HOY, aaaammdd);

/** Ahora: la fecha fingida con la hora real del día, o la hora real. */
export function ahora() {
  const f = fechaFingida();
  const real = new Date();
  if (!f) return real;
  const [y, m, d] = f.split('-').map(Number);
  const r = new Date(real);
  r.setFullYear(y, m - 1, d);
  return r;
}

export const faseFingida = () => (demo ? leer(K_FASE) : '');
export const fingirFase = (fase) => escribir(K_FASE, fase);
