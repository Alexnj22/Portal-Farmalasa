// ── La percepción y la retención de una compra: número Y proveedor (2026-10-26) ─
//
// Mismo defecto que el sello (`selloDeCompra.ts`), en las dos columnas de al
// lado. El backfill rápido leía la percepción del libro de compras (col 21) y
// la retención de su anexo (col 8) en un mapa por NÚMERO de documento a secas,
// y la única guarda era «¿el número trae más de un valor?». Pero el origen
// trunca el número a 20 caracteres, y varios proveedores numeran igual
// (`DTE-03-M001P001-0000` lo comparten seis proveedores en una misma sucursal).
// Si el libro trae ese número una sola vez —de OTRO emisor— el valor pasaba sin
// guarda a la compra equivocada: percepción de un proveedor en el libro de
// compras y en el anexo de percepción de otro.
//
// La regla:
//
//  1. El renglón vale para la compra si coinciden el número Y el emisor (NIT o
//     NRC del proveedor de la compra, comparados sólo por dígitos).
//  2. Si el proveedor no se puede identificar (sin NIT ni NRC) y el número es
//     ÚNICO —un solo emisor en el archivo y una sola compra con ese número en el
//     lote—, se conserva el comportamiento de siempre: el valor del número.
//  3. Todo lo demás —número compartido sin emisor que lo resuelva, emisor que
//     no coincide, dos valores para el mismo documento— NO se asigna: queda
//     `valor: null` con su motivo, y quien llama lo resuelve con el detalle
//     autoritativo del día. Un monto fiscal no se elige a ciegas.
//
// Pura a propósito: la prueba (`tests/unit/montoDeCompra.test.js`) la corre sin
// red.

import { normNum, soloDigitos, type CompraParaSellar } from './selloDeCompra.ts';

export type LineaDeMonto = { numero: string; emisor: string; valor: number };

export type MotivoSinMonto =
  | 'numero-compartido'
  | 'emisor-no-coincide'
  | 'varios-valores';

export type MontoDecidido = { valor: number | null; motivo: MotivoSinMonto | null };

const aNumero = (s: string | undefined) => {
  const v = Number((s ?? '').trim());
  return Number.isFinite(v) ? v : 0;
};

/**
 * Los renglones de un CSV del origen con número normalizado, emisor en dígitos
 * y el monto. Libro de compras: número 3, NIT 4, percepción 21. Anexo de
 * retención (mismo formato que el de percepción): NIT 3, número 5, monto 8.
 */
export function lineasDeMonto(csv: string, colNumero: number, colEmisor: number, colValor: number): LineaDeMonto[] {
  const out: LineaDeMonto[] = [];
  for (const linea of csv.split('\n')) {
    if (!linea.trim()) continue;
    const c = linea.split(';');
    if (c.length <= Math.max(colNumero, colEmisor, colValor)) continue;
    const numero = normNum(c[colNumero]);
    if (!numero) continue;
    out.push({ numero, emisor: soloDigitos(c[colEmisor]), valor: aNumero(c[colValor]) });
  }
  return out;
}

/** Un solo valor distinto → ése; ninguno o varios → null. */
function unico(lineas: LineaDeMonto[]): number | null {
  const vals = new Set(lineas.map((l) => l.valor));
  return vals.size === 1 ? [...vals][0] : null;
}

/**
 * Decide el monto (percepción o retención) de cada compra. id → { valor, motivo }.
 *
 * - Sin renglón en el archivo: `{ valor: 0, motivo: null }` (lo de siempre: el
 *   documento no lleva ese monto).
 * - `valor: null` con motivo: no se pudo decidir sin el detalle del día.
 */
export function montosDeLasCompras(
  compras: CompraParaSellar[],
  lineas: LineaDeMonto[],
): Map<number, MontoDecidido> {
  const porNumero = new Map<string, LineaDeMonto[]>();
  for (const l of lineas) {
    if (!porNumero.has(l.numero)) porNumero.set(l.numero, []);
    porNumero.get(l.numero)!.push(l);
  }
  // Proveedores distintos que traen el mismo número en este lote.
  const proveedoresPorNumero = new Map<string, Set<string>>();
  for (const c of compras) {
    const n = normNum(c.numero);
    if (!n) continue;
    if (!proveedoresPorNumero.has(n)) proveedoresPorNumero.set(n, new Set());
    proveedoresPorNumero.get(n)!.add(String(c.proveedor ?? `sin-proveedor:${c.id}`));
  }

  const out = new Map<number, MontoDecidido>();
  for (const c of compras) {
    const n = normNum(c.numero);
    const delNumero = n ? (porNumero.get(n) ?? []) : [];
    if (delNumero.length === 0) { out.set(c.id, { valor: 0, motivo: null }); continue; }

    const ids = new Set(c.identificaciones.map(soloDigitos).filter(Boolean));
    if (ids.size > 0) {
      const suyas = delNumero.filter((l) => ids.has(l.emisor));
      if (suyas.length === 0) { out.set(c.id, { valor: null, motivo: 'emisor-no-coincide' }); continue; }
      const v = unico(suyas);
      out.set(c.id, v === null ? { valor: null, motivo: 'varios-valores' } : { valor: v, motivo: null });
      continue;
    }

    // Proveedor sin NIT ni NRC: sólo un número único conserva el cruce de siempre.
    const emisores = new Set(delNumero.map((l) => l.emisor));
    const compartido = emisores.size > 1 || (proveedoresPorNumero.get(n)?.size ?? 0) > 1;
    if (compartido) { out.set(c.id, { valor: null, motivo: 'numero-compartido' }); continue; }
    const v = unico(delNumero);
    out.set(c.id, v === null ? { valor: null, motivo: 'varios-valores' } : { valor: v, motivo: null });
  }
  return out;
}
