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
