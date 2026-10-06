// Fechas y montos como los lee una persona en El Salvador.
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** '2026-10-05' o ISO → «5 oct 2026». */
export function fecha(v) {
  if (!v) return '';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(v);
  return `${Number(m[3])} ${MESES[Number(m[2]) - 1]} ${m[1]}`;
}

export const dolares = (n) => `$${Number(n ?? 0).toFixed(2)}`;
export const entero = (n) => Math.round(Number(n ?? 0)).toLocaleString('en-US');

/** Días entre hoy (El Salvador) y una fecha 'YYYY-MM-DD'. */
export function diasHasta(v) {
  const m = String(v ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const hoy = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
  return Math.round((Date.parse(`${m[0]}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86400_000);
}

/** «CARLOS MARÍA PÉREZ ROMERO» → «Carlos María Pérez Romero»: la ficha guarda mayúsculas. */
export function nombrePropio(v) {
  return String(v ?? '').toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, sep, l) => sep + l.toUpperCase());
}

/**
 * El documento mientras se escribe. Con exactamente 9 dígitos es un DUI y se
 * pone el guion (12345678-9); con más (un NIT tiene 14) se deja tal cual. Antes
 * se cortaba a 9 y quien se registró con NIT no podía entrar nunca.
 */
export function documentoEscrito(v) {
  if (/[A-Za-z]/.test(v)) return v.toUpperCase().slice(0, 20);
  const d = v.replace(/\D/g, '').slice(0, 14);
  return d.length === 9 ? `${d.slice(0, 8)}-${d.slice(8)}` : d;
}

/** 'DD/MM/AAAA' → 'AAAA-MM-DD' si es una fecha REAL entre 1900 y hoy; '' si vacía; null si inválida. */
export function fechaDeNacimiento(texto) {
  const t = String(texto ?? '').trim();
  if (!t) return '';
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [d, mes, a] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const f = new Date(Date.UTC(a, mes - 1, d));
  const real = f.getUTCFullYear() === a && f.getUTCMonth() === mes - 1 && f.getUTCDate() === d;
  if (!real || a < 1900 || f.getTime() > Date.now()) return null;
  return `${a}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
