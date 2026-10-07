// La misma validación que `supabase/functions/_shared/fiscal.ts`, para avisar
// mientras se escribe. La que vale es la del servidor.
const soloDigitos = (s) => String(s ?? '').replace(/\D/g, '');

export function duiValido(dui) {
  const d = soloDigitos(dui);
  if (d.length !== 9) return false;
  const suma = d.slice(0, 8).split('').reduce((s, c, i) => s + Number(c) * (9 - i), 0);
  return (10 - (suma % 10)) % 10 === Number(d[8]);
}

/** El primer problema de los datos, o null si están bien. */
export function errorFiscal(x) {
  if (String(x?.nombre ?? '').trim().length < 3) return 'Escribe el nombre o la razón social.';
  const nit = soloDigitos(x?.nit);
  if (!(nit.length === 14 || (nit.length === 9 && duiValido(nit)))) return 'El NIT tiene 14 dígitos (o tu DUI de 9, si es tu NIT).';
  const nrc = soloDigitos(x?.nrc);
  if (nrc.length < 2 || nrc.length > 8) return 'El NRC tiene de 2 a 8 dígitos, como 123456-7.';
  if (String(x?.giro ?? '').trim().length < 3) return 'Escribe tu actividad económica (giro).';
  if (String(x?.direccion ?? '').trim().length < 10) return 'Escribe la dirección completa.';
  return null;
}

/** Mientras se escribe: 0614-010190-101-3 y 123456-7. */
export const nitEscrito = (v) => {
  const d = soloDigitos(v).slice(0, 14);
  if (d.length <= 9) return d;
  return [d.slice(0, 4), d.slice(4, 10), d.slice(10, 13), d.slice(13)].filter(Boolean).join('-');
};
export const nrcEscrito = (v) => { const d = soloDigitos(v).slice(0, 8); return d.length > 1 ? `${d.slice(0, -1)}-${d.slice(-1)}` : d; };
