// Fechas y montos como los lee una persona en El Salvador.
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** '2026-10-05' o ISO → «5 oct 2026». */
export function fecha(v) {
  if (!v) return '';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(v);
  return `${Number(m[3])} ${MESES[Number(m[2]) - 1]} ${m[1]}`;
}

const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** '2026-10-31' → «31 de octubre» (con el año sólo si no es el de hoy). (2026-10-14) */
export function fechaLarga(v) {
  const m = String(v ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return v ? String(v) : '';
  const anio = new Date(Date.now() - 6 * 3600_000).getUTCFullYear();
  return `${Number(m[3])} de ${MESES_LARGOS[Number(m[2]) - 1]}${Number(m[1]) !== anio ? ` de ${m[1]}` : ''}`;
}

/** El último día del mes de una fecha 'YYYY-MM-DD' (así vence el cupón del mes). */
export function finDeMes(v) {
  const m = String(v ?? '').match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0));
  return d.toISOString().slice(0, 10);
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
 * El DUI mientras se escribe: sólo números, 9 como máximo (8 y el
 * verificador), y el guion antes del último (12345678-9). Sólo DUI: el NIT ya
 * no se acepta para entrar ni para registrarse (decisión del dueño, 2026-10-20).
 */
/**
 * El teléfono mientras se escribe (2026-10-20): 8 números con el guion en el
 * medio (7015-3222). El 503 de un número pegado se quita.
 */
export function telefonoEscrito(v) {
  let d = String(v ?? '').replace(/\D/g, '');
  if (d.length > 8 && d.startsWith('503')) d = d.slice(3);
  d = d.slice(0, 8);
  return d.length > 4 ? `${d.slice(0, 4)}-${d.slice(4)}` : d;
}

/** Un teléfono de El Salvador: fijo (2…) o celular (6…, 7…). La misma regla que `telValido` del servidor. */
export const telefonoValido = (v) => /^[267]\d{7}$/.test(String(v ?? '').replace(/\D/g, ''));

export function documentoEscrito(v) {
  const d = String(v ?? '').replace(/\D/g, '').slice(0, 9);
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
