// Identidad anónima de este teléfono para votar canciones y jugar: un uuid
// guardado en el navegador. No identifica a nadie; sólo evita votos dobles.
const LS = 'boda-yo';
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
