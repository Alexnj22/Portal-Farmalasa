// «Valor en letras» del resumen (`totalLetras`, 8–200 caracteres).
//
// El manual no fija una redacción: sus propios ejemplos dicen «Sesenta y ocho
// con 70/100 dólares» y los DTE reales de las droguerías, «trescientos noventa y
// tres dólares con cinco centavos». Se usa la forma de cheque — «CIENTO VEINTE
// 50/100 DÓLARES» — porque es la que ya imprime el sistema de las farmacias y la
// que lee sin dudar quien recibe el papel. Sólo ASCII no hace falta aquí: esto
// va en el JSON, no en la ticketera.

const UNIDADES = [
  "", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE",
  "DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISÉIS", "DIECISIETE",
  "DIECIOCHO", "DIECINUEVE", "VEINTE", "VEINTIUNO", "VEINTIDÓS", "VEINTITRÉS",
  "VEINTICUATRO", "VEINTICINCO", "VEINTISÉIS", "VEINTISIETE", "VEINTIOCHO",
  "VEINTINUEVE",
];
const DECENAS = ["", "", "", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
const CENTENAS = [
  "", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS",
  "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS",
];

function hasta999(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "CIEN";
  const c = Math.floor(n / 100);
  const r = n % 100;
  let t = "";
  if (r < 30) t = UNIDADES[r];
  else {
    const d = Math.floor(r / 10);
    const u = r % 10;
    t = DECENAS[d] + (u ? " Y " + UNIDADES[u] : "");
  }
  return [CENTENAS[c], t].filter(Boolean).join(" ");
}

/** «UNO» delante de un sustantivo: «VEINTIÚN MIL», «CIENTO UN DÓLARES». */
const apocopar = (s: string) => s.replace(/VEINTIUNO$/, "VEINTIÚN").replace(/UNO$/, "UN");

/** Entero ≥ 0 en letras. «UNO» se apocopa a «UN» delante de MIL/MILLONES. */
export function enteroEnLetras(n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new Error(`entero inválido: ${n}`);
  if (n === 0) return "CERO";
  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;

  const partes: string[] = [];
  if (millones) partes.push(millones === 1 ? "UN MILLÓN" : `${apocopar(enteroEnLetras(millones))} MILLONES`);
  if (miles) partes.push(miles === 1 ? "MIL" : `${apocopar(hasta999(miles))} MIL`);
  if (resto) partes.push(hasta999(resto));
  return partes.join(" ");
}

/** 120.5 → «CIENTO VEINTE 50/100 DÓLARES». Recibe el total ya en centavos. */
export function totalEnLetras(totalCentavos: bigint): string {
  if (totalCentavos < 0n) throw new Error("un total a pagar no puede ser negativo");
  const dolares = Number(totalCentavos / 100n);
  const centavos = Number(totalCentavos % 100n);
  const d = enteroEnLetras(dolares);
  const unidad = dolares === 1 ? "DÓLAR" : "DÓLARES";
  const base = apocopar(d);
  return `${base} ${String(centavos).padStart(2, "0")}/100 ${unidad}`;
}
