// Lote y vencimiento de un renglón de compra, leídos del texto del proveedor.
//
// ── Por qué esto vive APARTE y con pruebas ─────────────────────────────────
// Es lógica de expresiones regulares sobre texto que escriben quince empresas
// distintas, y lo que produce entra al inventario como **fecha de vencimiento
// de un medicamento**. Un lote inventado o un mes corrido no dan error: se
// descubren contando, o no se descubren.
//
// Por eso son funciones puras, sin `fetch` ni base de datos, y por eso
// `tests/unit/loteVencimiento.test.js` las ejercita con cadenas LITERALES de
// producción — las mismas que mandan COFARSAL, GAMMA, LETERAGO y los demás.
//
// ── La regla que lo simplifica todo ────────────────────────────────────────
// **El vencimiento se guarda como MES Y AÑO, día 1.** Confirmado contra los
// datos: de las 24,776 líneas de compra de los últimos diez meses, las 24,776
// tienen día 1 (las 483 con otro día son de antes de nov-2025, de una
// convención muerta). Así que el día que imprime el proveedor es ruido:
// `01/01/2030`, `31/10/2027`, `04/2028` y `(V-12-27)` terminan todos igual.

export const norm = (s: string) => (s ?? "").replace(/\s+/g, " ").trim();
export const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const MES_ES = /^(0?[1-9]|1[0-2])$/;

/**
 * Cualquier fecha que escriba un proveedor → `AAAA-MM-01`, o null.
 *
 * `anioRef` es el año contra el que se juzga si la fecha es creíble; se pasa
 * para que las pruebas no dependan del reloj.
 */
export function aMesYAnio(bruto: string | null, anioRef = new Date().getUTCFullYear()): string | null {
  if (!bruto) return null;
  const p = String(bruto).trim().split(/[\/\-.]/).filter(Boolean);
  let mes: string, anio: string;

  if (p.length === 3) {            // dd/mm/aaaa — el día se descarta
    [, mes, anio] = p;
  } else if (p.length === 2) {     // mm/aaaa  o  mm/aa
    [mes, anio] = p;
  } else return null;

  if (!MES_ES.test(mes)) return null;
  if (anio.length === 2) anio = String(2000 + Number(anio));
  if (!/^\d{4}$/.test(anio)) return null;

  // La ventana importa MÁS de lo que parece. Con `2000..2100`, el precio
  // `12.00` de LETERAGO se leía como diciembre del 2000 —mes 12, año 00— y eso
  // corría el ancla un campo: devolvía `false` como número de lote, que es
  // literalmente lo que ese proveedor manda como descripción.
  const a = Number(anio);
  if (a < anioRef - 5 || a > anioRef + 20) return null;

  return `${anio}-${String(Number(mes)).padStart(2, "0")}-01`;
}

// De la más específica a la más suelta. El orden importa: `dd/mm/aaaa` tiene
// que probarse antes que `mm/aaaa`, o la primera mitad se leería como mes y año.
const FECHAS = [
  /(?:fecha\s*exp\.?|vence|vencimiento|caducidad|v)\s*[:.]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
  /\(\s*v\s*-\s*(\d{1,2}\s*-\s*\d{2,4})\s*\)/i,          // VIJOSA: (V-12-27)
  /(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/,
  /(\d{1,2}[\/\-.]\d{4})\b/,                              // GAMMA: 04/2028
];

const LOTES = [
  /(?:n[uú]mero\s+de\s+)?lote\s*[:.]?\s*([A-Za-z0-9._\-\/]+)/i,
  /\bl0te\s*[:.]?\s*([A-Za-z0-9._\-\/]+)/i,
];

/**
 * Un lote de verdad tiene al menos dos caracteres alfanuméricos.
 *
 * Sin esto, IMBERTON —que rotula «cantidad - lote - fecha caducidad»— devolvía
 * el guion como número de lote: un dato que parece válido y no lo es entra al
 * inventario sin que nada avise.
 */
export const loteValido = (s: string | null): string | null =>
  s && s.replace(/[^A-Za-z0-9]/g, "").length >= 2 ? s : null;

/**
 * El lote SIN rótulo, que es como lo manda casi la mitad de los proveedores.
 *
 * Se apoya en el vencimiento: el lote es lo que está **pegado antes** de la
 * fecha. No se busca «algo que parezca un lote» —eso devuelve presentaciones y
 * gramajes—; se usa la fecha como ancla, que sí se reconoce sola.
 */
export function loteSinRotulo(t: string, anioRef?: number): string | null {
  // (0) IMBERTON escribe el ENCABEZADO y después los valores en ese orden:
  //     `… cantidad - lote - fecha caducidad 2 - 790748N11 - 18-07-2027`
  const imb = t.match(/cantidad\s*-\s*lote\s*-\s*fecha\s+caducidad\s+\S+\s*-\s*(\S+)\s*-/i);
  if (imb) { const c = loteValido(imb[1]); if (c) return c; }

  // (a) Entre `|`: el campo justo antes del que es una fecha.
  //     `OVESTIN CREMA 1MG. X 15GR.|B22625K|30/11/2027|7.000000`
  const partes = t.split("|").map((x) => x.trim());
  if (partes.length >= 3) {
    for (let i = 1; i < partes.length; i++) {
      if (aMesYAnio(partes[i], anioRef) && partes[i].split(/[\/\-.]/).length >= 2) {
        const cand = loteValido(partes[i - 1]);
        // El nombre del producto también va entre `|`, pero lleva espacios;
        // un número de lote no.
        if (cand && !/\s/.test(cand)) return cand;
      }
    }
  }

  // (b) Sin separadores y con la fecha rotulada: el token pegado antes del
  //     rótulo. Se exige que mezcle letra y dígito para no traerse el `30` de
  //     «X 30».  `GASTROFLUX 10MG X 30 L138601 V. 01-11-2028`
  const m = t.match(/([A-Za-z0-9][A-Za-z0-9._\-\/]{2,})\s+(?:v\.|vence|vencimiento|f\.?\s*exp)/i);
  if (m && /[A-Za-z]/.test(m[1]) && /\d/.test(m[1])) return loteValido(m[1]);

  return null;
}

/** Lote y vencimiento escondidos en el texto libre de un renglón. */
export function deTextoLibre(s: string, anioRef?: number): { lote: string | null; vence: string | null } {
  const t = norm(s);
  let vence: string | null = null;
  for (const re of FECHAS) {
    const m = t.match(re);
    if (m) { vence = aMesYAnio(m[1], anioRef); if (vence) break; }
  }
  let lote: string | null = null;
  for (const re of LOTES) {
    const m = t.match(re);
    if (m) { lote = loteValido(m[1]); if (lote) break; }
  }
  if (!lote) lote = loteSinRotulo(t, anioRef);
  return { lote, vence };
}

/**
 * El NOMBRE del producto, sin lo que el proveedor le pegó alrededor.
 *
 * Hace falta para emparejar: buscar el producto con la descripción cruda le
 * mete al parecido de nombre el lote, la fecha y la cantidad, que son ruido
 * distinto en cada renglón. Medido: pasar la descripción cruda deja **28% de
 * renglones sin ningún candidato**; con el nombre limpio, 9%.
 *
 * Dos limpiezas, en este orden:
 *   1. El tramo con más letras de los separados por `|`. El `|` va al revés
 *      según el proveedor —COFARSAL escribe `LAB|NOMBRE` y DROGUERÍA AMERICANA
 *      `NOMBRE|lote|fecha|cant`—, y el tramo más largo es el nombre en los dos.
 *   2. La cola administrativa (lote, vencimiento, cantidad), que cada uno
 *      rotula a su manera.
 */
export function nombreLimpio(descripcion: string): string {
  const t = norm(descripcion);
  if (!t) return "";
  const tramo = t.split("|")
    .map((x) => x.trim())
    .sort((a, b) => b.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, "").length
                  - a.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, "").length)[0] ?? t;
  return norm(
    tramo
      .replace(/(?:^|\s)(?:lote|l0te)\s*[:.].*$/i, "")
      .replace(/(?:^|\s)(?:vence|vencimiento|fecha\s*exp\.?|caducidad)\s*[:.].*$/i, "")
      .replace(/(?:^|\s)cant(?:idad)?\s*[:.].*$/i, "")
      .replace(/\s*cantidad\s*-\s*lote.*$/i, "")
      .replace(/\s*\(\s*v\s*-\s*\d{1,2}\s*-\s*\d{2,4}\s*\).*$/i, "")
      .replace(/\s+v\.\s+\d{1,2}[-/]\d{1,2}[-/]\d{2,4}.*$/i, "")
      .replace(/\s*\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\s*$/, "")
      // La cantidad suelta al final tiene que ser un token propio: sin el
      // `\s+`, `L60640` perdía su cola y quedaba `L6`.
      .replace(/\s+\d{1,4}(\.\d+)?\s*$/, ""),
  );
}

export type Leido = { lote: string | null; vence: string | null; de: string };

/**
 * Lote y vencimiento de un renglón: primero de su propia descripción, y sólo
 * si no están, del texto del PDF.
 *
 * En el PDF NO se busca a ciegas: se ancla en lo que el JSON ya dice de ese
 * renglón —la descripción y la cantidad— y se lee lo que queda en medio. Los
 * dos extremos son conocidos, así que no hay que adivinar cuál número de la
 * línea es cuál.
 *
 * Devuelve nulo cuando ninguna ancla aparece. **Que la pantalla lo pida es
 * preferible a inventar un vencimiento**, que es un dato sanitario.
 */
export function loteYVence(textoPdf: string, item: any, anioRef?: number): Leido {
  const desc = norm(String(item?.descripcion ?? ""));
  if (!desc) return { lote: null, vence: null, de: "sin descripción" };

  // (0) La propia descripción del JSON. Diez de los quince proveedores meten
  //     ahí el lote y el vencimiento, así que ni hace falta abrir el PDF.
  const enDesc = deTextoLibre(desc, anioRef);
  if (enDesc.lote || enDesc.vence) return { ...enDesc, de: "descripcion" };

  const t = norm(textoPdf ?? "");
  if (!t) return { lote: null, vence: null, de: "no encontrado" };

  // (A) Columnas sin rótulo — GAMMA: `código descripción LOTE VENCE cant precio`.
  const cant = Number(item?.cantidad ?? 0);
  const cantTxt = Number.isFinite(cant) && cant > 0 ? cant.toFixed(2) : null;
  const re = new RegExp(
    escapar(desc) + "\\s+(.{0,40}?)\\s*" + (cantTxt ? escapar(cantTxt) : "\\d+\\.\\d{2}") + "\\b",
  );
  const m = t.match(re);
  if (m) {
    const medio = norm(m[1]);
    const f = medio.match(/(\d{1,2}[\/\-.]\d{2,4}(?:[\/\-.]\d{2,4})?)\s*$/);
    const vence = f ? aMesYAnio(f[1], anioRef) : null;
    const lote = loteValido(norm(f ? medio.slice(0, f.index) : medio) || null);
    if (lote || vence) return { lote, vence, de: "pdf/columnas" };
  }

  // (B) Rótulos explícitos — MENFAR: `descripción Lote: X Vencimiento: Y`.
  //     Ventana corta para no traerse el lote del renglón siguiente.
  const i = t.indexOf(desc);
  if (i >= 0) {
    const ventana = t.slice(i + desc.length, i + desc.length + 120);
    const r = deTextoLibre(ventana, anioRef);
    if (r.lote || r.vence) return { ...r, de: "pdf/rotulos" };
  }

  return { lote: null, vence: null, de: "no encontrado" };
}
