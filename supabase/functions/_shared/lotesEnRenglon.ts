// Un renglón de la factura que trae VARIOS lotes (2026-11-13).
//
// Santa Lucía, cuando una línea sale de dos lotes, no la parte: deja el campo
// del lote en `+`, el vencimiento vacío, y mete la tabla en la descripción:
//
//   CONCOR 5 MG x 30 TAB 7702418000872* LOTE VENCIMIENTO CANTIDAD UM*
//   M55492 30/06/2028 1 CJ*M60396 31/05/2028 6 CJ*|+||CJ|10.00
//
// Leído como venía, la carga armaba UN renglón de 7 cajas sin lote (y con la
// fecha del primero para todas), y no se podía mandar. Acá el renglón se
// convierte en uno por lote, con la descripción reescrita en el formato normal
// del proveedor (`NOMBRE|LOTE|DD/MM/AAAA|UM|...`) para que el lector de lotes
// de siempre lo lea sin saber nada de esto.
//
// Lo corren las dos funciones que leen la factura (dentro de
// `aplicarParticiones`), así que ven la misma lista. Si las cantidades de la
// tabla no suman lo facturado, NO se parte: un reparto inventado sería peor
// que el aviso de «falta el lote».

const TABLA = /\*\s*LOTE\s+VENCIMIENTO\s+CANTIDAD\s+UM\s*\*(.*?)\*?\s*$/i;
const FILA = /^([A-Za-z0-9][A-Za-z0-9._\-\/]*)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d+(?:\.\d+)?)\s+(\S+)$/;

const r2 = (n: number) => Math.round(n * 100) / 100;
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

export type LoteDeTabla = { lote: string; vence: string; cantidad: number; um: string };

/** La tabla de lotes de la descripción, o null si no la trae o no se lee entera. */
export function lotesDeLaDescripcion(descripcion: string): { nombre: string; lotes: LoteDeTabla[]; resto: string[] } | null {
  const campos = String(descripcion ?? "").split("|");
  const m = campos[0].match(TABLA);
  if (!m) return null;
  const filas = m[1].split("*").map((s) => s.trim()).filter(Boolean);
  const lotes: LoteDeTabla[] = [];
  for (const f of filas) {
    const x = f.match(FILA);
    if (!x) return null;            // una fila que no se entiende: no se adivina
    lotes.push({ lote: x[1], vence: x[2], cantidad: Number(x[3]), um: x[4] });
  }
  if (!lotes.length) return null;
  // Los campos que siguen al nombre: `+` (lote), `` (vence), y lo demás.
  return { nombre: campos[0].slice(0, m.index).trim(), lotes, resto: campos.slice(3) };
}

/** Reparte un monto por cantidad, en centavos; el último se queda con el redondeo. */
function repartir(monto: number, pesos: number[]): number[] {
  const total = pesos.reduce((a, b) => a + b, 0);
  let queda = r2(monto);
  return pesos.map((p, k) => {
    if (k === pesos.length - 1) return r2(queda);
    const v = r2(monto * p / total);
    queda = r2(queda - v);
    return v;
  });
}

/** Pura: el renglón partido por lote, o null si no corresponde partirlo. */
export function partirPorLotes(it: any): any[] | null {
  const t = lotesDeLaDescripcion(String(it?.descripcion ?? ""));
  if (!t) return null;
  const cant = Number(it?.cantidad);
  const suma = t.lotes.reduce((a, l) => a + l.cantidad, 0);
  if (!(cant > 0) || Math.abs(suma - cant) > 1e-6) return null;
  const pesos = t.lotes.map((l) => l.cantidad);
  const reparto = (campo: string) => repartir(Number(it?.[campo] ?? 0), pesos);
  const gravada = reparto("ventaGravada"), exenta = reparto("ventaExenta"), noSuj = reparto("ventaNoSuj");
  const descu = reparto("montoDescu"), iva = reparto("ivaItem");
  return t.lotes.map((l, k) => ({
    ...it,
    descripcion: [t.nombre, l.lote, l.vence, ...t.resto].join("|"),
    cantidad: r6(l.cantidad),
    ventaGravada: gravada[k], ventaExenta: exenta[k], ventaNoSuj: noSuj[k],
    montoDescu: descu[k], ivaItem: iva[k],
    _lote: { lote: l.lote, indice: k + 1, total: t.lotes.length, cantidad_factura: cant },
  }));
}

/** Pura: expande todos los renglones; la firma cambia si se partió alguno. */
export function expandirLotes(items: any[]): { items: any[]; firma: string } {
  const salida: any[] = [];
  const partidos: string[] = [];
  items.forEach((it, i) => {
    const p = partirPorLotes(it);
    if (!p) { salida.push(it); return; }
    salida.push(...p);
    partidos.push(`L${i}:${p.map((x) => `${x._lote.lote}x${x.cantidad}`).join(",")}`);
  });
  return { items: salida, firma: partidos.join(";") };
}
