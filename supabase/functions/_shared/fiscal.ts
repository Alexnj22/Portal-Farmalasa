// Validar los datos de un crédito fiscal (CCF) que el cliente escribe en la app
// (2026-10-07). Lo que se puede comprobar sin consultar a Hacienda:
//   · NIT: 14 dígitos (0614-010190-101-3), o el DUI homologado (9 dígitos) con
//     su dígito verificador.
//   · NRC: de 1 a 7 dígitos, guion y un dígito verificador (123456-7).
//   · Nombre o razón social, actividad económica (giro) y dirección.
// La sucursal confirma lo demás al facturar.

const soloDigitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");

/** El dígito verificador del DUI: pesos 9..2 sobre los 8 primeros. */
export function duiValido(dui: string): boolean {
  const d = soloDigitos(dui);
  if (d.length !== 9) return false;
  const suma = d.slice(0, 8).split("").reduce((s, c, i) => s + Number(c) * (9 - i), 0);
  return (10 - (suma % 10)) % 10 === Number(d[8]);
}

export type DatosFiscales = { nombre: string; nit: string; nrc: string; giro: string; direccion: string };

/** Normaliza y valida. Devuelve los datos limpios o el primer error en palabras. */
export function validarFiscales(x: any): { ok: true; datos: DatosFiscales } | { ok: false; mensaje: string } {
  const nombre = String(x?.nombre ?? "").trim().replace(/\s+/g, " ");
  const nitD = soloDigitos(x?.nit);
  const nrcD = soloDigitos(x?.nrc);
  const giro = String(x?.giro ?? "").trim().replace(/\s+/g, " ");
  const direccion = String(x?.direccion ?? "").trim().replace(/\s+/g, " ");
  if (nombre.length < 3) return { ok: false, mensaje: "Escribe el nombre o la razón social como aparece en tu tarjeta de IVA." };
  let nit: string;
  if (nitD.length === 14) nit = `${nitD.slice(0, 4)}-${nitD.slice(4, 10)}-${nitD.slice(10, 13)}-${nitD.slice(13)}`;
  else if (nitD.length === 9 && duiValido(nitD)) nit = `${nitD.slice(0, 8)}-${nitD.slice(8)}`;
  else return { ok: false, mensaje: "El NIT debe tener 14 dígitos (o tu DUI de 9, si es tu NIT)." };
  if (nrcD.length < 2 || nrcD.length > 8) return { ok: false, mensaje: "El NRC tiene de 2 a 8 dígitos, como 123456-7." };
  const nrc = `${nrcD.slice(0, -1)}-${nrcD.slice(-1)}`;
  if (giro.length < 3) return { ok: false, mensaje: "Escribe tu actividad económica (giro), como aparece en tu tarjeta de IVA." };
  if (direccion.length < 10) return { ok: false, mensaje: "Escribe la dirección completa del contribuyente." };
  return { ok: true, datos: { nombre: nombre.slice(0, 200), nit, nrc, giro: giro.slice(0, 200), direccion: direccion.slice(0, 300) } };
}
