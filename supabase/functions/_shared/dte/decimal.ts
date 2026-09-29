// Aritmética decimal EXACTA para los DTE — enteros escalados a 8 decimales.
//
// ── Por qué no se usa `number` para calcular ───────────────────────────────
// Hacienda corre «procesos de validación aritméticos, los cuales pueden generar
// rechazo» (Manual Funcional v2.0 §XXI), y su regla es de papel y lápiz:
//
//   · cuerpo del documento: 8 decimales; la novena posición ≥5 sube la octava;
//   · resumen: 2 decimales; la tercera ≥5 sube la segunda (5.665 → 5.67);
//   · holgura de ±0.01 sólo en el resumen.
//
// Con `number`, `2.675.toFixed(2)` da «2.67» (el doble guardado es 2.67499…):
// el redondeo «hacia arriba en 5» falla justo en los casos que el manual pone de
// ejemplo, y una factura de 300 renglones acumula el error hasta pasarse de la
// holgura. Por eso todo se calcula en `bigint` escalado a 1e8 y sólo se vuelve a
// `number` al escribir el JSON — donde el número ya tiene como mucho 8 decimales
// y `JSON.stringify` lo imprime tal cual.
//
// ── El redondeo es «mitad hacia arriba» sobre el valor ABSOLUTO ────────────
// Es lo que describe el manual para positivos. Los negativos sólo aparecen en
// `noGravado` (un abono que no afecta la base), y ahí se redondea igual que su
// valor absoluto: -0.005 → -0.01, no -0.00.

export const ESCALA = 100_000_000n; // 1e8
const CENTAVO = 1_000_000n;         // 0.01 en la escala de 1e8

/** Un valor decimal exacto, escalado a 8 decimales. */
export type Dec = bigint;

/** Divide redondeando mitad hacia arriba sobre el valor absoluto. */
function dividirRedondeando(n: bigint, d: bigint): bigint {
  if (d === 0n) throw new Error("división entre cero");
  const neg = (n < 0n) !== (d < 0n);
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = an / ad;
  const r = an % ad;
  const q2 = r * 2n >= ad ? q + 1n : q;
  return neg ? -q2 : q2;
}

/**
 * Número o texto → decimal exacto a 8 decimales.
 *
 * Se parte del TEXTO del número (`String(2.9925)` = «2.9925»), no de su valor
 * binario: así `0.1` entra como 0.10000000 y no como 0.1000000000000000055…
 * Si trae más de 8 decimales, se redondea con la regla del manual.
 */
export function dec(x: number | string | bigint): Dec {
  if (typeof x === "bigint") return x * ESCALA;
  if (typeof x === "number" && !Number.isFinite(x)) {
    throw new Error(`valor no numérico: ${x}`);
  }
  let s = typeof x === "number" ? x.toString() : x.trim();
  // `1e-7` y compañía: `toString` usa notación exponencial debajo de 1e-6.
  if (/e/i.test(s)) s = Number(s).toFixed(20);
  const m = /^([+-])?(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) {
    throw new Error(`valor no numérico: «${x}»`);
  }
  const neg = m[1] === "-";
  const ent = BigInt(m[2] || "0");
  const frac = m[3] ?? "";
  let v: bigint;
  if (frac.length <= 8) {
    v = ent * ESCALA + BigInt((frac + "00000000").slice(0, 8));
  } else {
    const todo = BigInt(m[2] + frac || "0");
    v = dividirRedondeando(todo, 10n ** BigInt(frac.length - 8));
  }
  return neg ? -v : v;
}

export const suma = (...xs: Dec[]): Dec => xs.reduce((a, b) => a + b, 0n);
export const resta = (a: Dec, b: Dec): Dec => a - b;

/** a × b, redondeado a 8 decimales. */
export const mul = (a: Dec, b: Dec): Dec => dividirRedondeando(a * b, ESCALA);

/** a ÷ b, redondeado a 8 decimales. */
export const div = (a: Dec, b: Dec): Dec => dividirRedondeando(a * ESCALA, b);

/** Redondea a centavos (sigue en la escala de 1e8, múltiplo de 0.01). */
export const aCentavos = (a: Dec): Dec => dividirRedondeando(a, CENTAVO) * CENTAVO;

/** Decimal → `number` para el JSON. Exacto: como mucho 8 decimales. */
export function num(a: Dec): number {
  const neg = a < 0n;
  const abs = neg ? -a : a;
  const ent = abs / ESCALA;
  const frac = (abs % ESCALA).toString().padStart(8, "0").replace(/0+$/, "");
  return Number(`${neg ? "-" : ""}${ent}${frac ? "." + frac : ""}`);
}

/** Decimal → texto con exactamente `d` decimales (para la representación). */
export function fijo(a: Dec, d = 2): string {
  const r = d >= 8 ? a : dividirRedondeando(a, 10n ** BigInt(8 - d));
  const neg = r < 0n;
  const abs = neg ? -r : r;
  const esc = 10n ** BigInt(Math.min(d, 8));
  const ent = abs / esc;
  const frac = d > 0 ? "." + (abs % esc).toString().padStart(Math.min(d, 8), "0") : "";
  return `${neg ? "-" : ""}${ent}${frac}`;
}

export const CERO: Dec = 0n;
export const esCero = (a: Dec) => a === 0n;
