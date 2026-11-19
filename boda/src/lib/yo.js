// Identidad anónima de este teléfono para votar canciones y jugar. No
// identifica a nadie; sólo evita votos dobles.
//   · miId(): uuid local. Es el que usa el modo demo.
//   · token: con Supabase, el que emite la base (emitir_token_dispositivo); la
//     base sólo acepta votos y respuestas con un token que ella misma creó.
//     Lo pide y lo usa supabaseApi; acá sólo se guarda.
const LS = 'boda-yo';
const LS_TOKEN = 'boda-token';
const LS_NOMBRE = 'boda-autor';
function nuevo() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export function miId() {
  try {
    let v = localStorage.getItem(LS);
    if (!v) { v = nuevo(); localStorage.setItem(LS, v); }
    return v;
  } catch { return nuevo(); }
}
export const miNombre = () => { try { return localStorage.getItem(LS_NOMBRE) || ''; } catch { return ''; } };
export const guardarMiNombre = (n) => { try { localStorage.setItem(LS_NOMBRE, n.trim()); } catch { /* privado */ } };
export const tokenGuardado = () => { try { return localStorage.getItem(LS_TOKEN) || ''; } catch { return ''; } };
export const guardarToken = (t) => {
  try { if (t) localStorage.setItem(LS_TOKEN, t); else localStorage.removeItem(LS_TOKEN); } catch { /* privado: vive en memoria */ }
};
