// ── El NIT que el libro le ofrece a la ficha del proveedor: número Y emisor ────
//
// (2026-10-26) Tercera columna del mismo defecto que el sello y la percepción.
// El backfill rápido completa —o crea— la ficha del proveedor con el NIT y el
// nombre del emisor que el libro de compras trae en el renglón (cols 4 y 5).
// Cruzaba la compra con el renglón sólo por NÚMERO, y el origen trunca el número
// a 20 caracteres: `DTE-03-M001P001-0000` lo comparten seis proveedores en una
// sucursal. Si el archivo traía ese número una sola vez, de otro emisor, el NIT
// de un proveedor iba a parar a la ficha de otro — y una ficha con NIT ajeno
// después cruza sellos, percepciones y DTE con el proveedor equivocado.
//
// La regla:
//
//  1. Si la ficha ya se identifica (NIT o NRC), no se le ofrece nada: el único
//     renglón que le valdría es el de su propio emisor, que no completa nada,
//     y uno de otro emisor sería justo el NIT ajeno.
//  2. Si no se identifica, el número tiene que ser ÚNICO: un solo emisor en el
//     archivo y un solo proveedor con ese número en el lote (cuenta también el
//     que sí tiene NIT). Si no, nada.
//  3. Un proveedor al que el lote le ofrece DOS NIT distintos no recibe ninguno.
//
// Pura a propósito: la prueba (`tests/unit/nitDeProveedor.test.js`) la corre sin
// red. Lo que esto devuelve es una PROPUESTA: `completar_nit_proveedores` igual
// se niega a pisar un NIT existente o a repetir uno de otra ficha.

import { normNum, soloDigitos, type CompraParaSellar } from './selloDeCompra.ts';

export type LineaDeEmisor = { numero: string; emisor: string; nombre: string };

export type NitPropuesto = { supplier_id: number; nit: string; nombre: string | null };

/** Renglones del libro de compras: número 3, NIT 4, nombre 5. */
export function emisoresDelLibro(csv: string, colNumero = 3, colEmisor = 4, colNombre = 5): LineaDeEmisor[] {
  const out: LineaDeEmisor[] = [];
  for (const linea of csv.split('\n')) {
    if (!linea.trim()) continue;
    const c = linea.split(';');
    if (c.length <= Math.max(colNumero, colEmisor, colNombre)) continue;
    const numero = normNum(c[colNumero]);
    if (!numero) continue;
    out.push({ numero, emisor: soloDigitos(c[colEmisor]), nombre: (c[colNombre] ?? '').trim() });
  }
  return out;
}

/** Un proveedor → el NIT (y nombre) que el libro respalda sin ambigüedad. */
export function nitsParaLasFichas(
  compras: CompraParaSellar[],
  lineas: LineaDeEmisor[],
): NitPropuesto[] {
  const porNumero = new Map<string, LineaDeEmisor[]>();
  for (const l of lineas) {
    if (!porNumero.has(l.numero)) porNumero.set(l.numero, []);
    porNumero.get(l.numero)!.push(l);
  }
  const proveedoresPorNumero = new Map<string, Set<string>>();
  for (const c of compras) {
    const n = normNum(c.numero);
    if (!n) continue;
    if (!proveedoresPorNumero.has(n)) proveedoresPorNumero.set(n, new Set());
    proveedoresPorNumero.get(n)!.add(String(c.proveedor ?? `sin-proveedor:${c.id}`));
  }

  // null = el lote le ofreció dos NIT distintos: no se le manda ninguno.
  const porProveedor = new Map<number, { nit: string; nombres: Set<string> } | null>();
  for (const c of compras) {
    if (c.proveedor == null) continue;
    const sid = Number(c.proveedor);
    if (!Number.isFinite(sid)) continue;
    const n = normNum(c.numero);
    const delNumero = (n ? porNumero.get(n) : undefined)?.filter((l) => l.emisor) ?? [];
    if (delNumero.length === 0) continue;

    // Ficha que ya se identifica: el único renglón que le valdría es el de su
    // propio NIT/NRC, o sea nada que completar (y la RPC no pisa un NIT).
    if (c.identificaciones.some((x) => soloDigitos(x))) continue;
    const emisores = new Set(delNumero.map((l) => l.emisor));
    const compartido = emisores.size > 1 || (proveedoresPorNumero.get(n)?.size ?? 0) > 1;
    const elegidas = compartido ? [] : delNumero;
    const nits = new Set(elegidas.map((l) => l.emisor));
    if (nits.size !== 1) continue;
    const nit = [...nits][0];

    const previo = porProveedor.get(sid);
    if (previo === null) continue;
    if (previo === undefined) {
      porProveedor.set(sid, { nit, nombres: new Set(elegidas.map((l) => l.nombre).filter(Boolean)) });
    } else if (previo.nit !== nit) {
      porProveedor.set(sid, null);
    } else {
      for (const l of elegidas) if (l.nombre) previo.nombres.add(l.nombre);
    }
  }

  const out: NitPropuesto[] = [];
  for (const [supplier_id, v] of porProveedor) {
    if (!v) continue;
    out.push({ supplier_id, nit: v.nit, nombre: v.nombres.size === 1 ? [...v.nombres][0] : null });
  }
  return out;
}
