/* ── La lista CRUZA los renglones de un producto con sus lotes ─────────────
 *
 * Cuando un producto viene en k renglones, `descargar_compras_json.php` no
 * devuelve k: devuelve k×k, cada cantidad combinada con cada lote. Medido el
 * 2026-11-03: 1,022 grupos en 707 compras desde may-2025, y los 1,022 encajan
 * EXACTO en ese cruce (cantidades y lotes, cada uno repetido k veces). La
 * compra 150 lo muestra sin vueltas: (1, M41855) (19, M43046) (19, M41855)
 * (1, M43046) — nadie tecleó eso. Sin deshacerlo, la copia duplicaba las
 * unidades y el monto de esos renglones (libro bajo receta, costo de venta,
 * proveedor principal).
 *
 * Las cantidades se recuperan exactas. QUÉ lote va con QUÉ cantidad, no: la
 * lista no trae ningún número de renglón. Cuando hay más de una cantidad y más
 * de un lote, se emparejan en orden y la fila sale con `lote_aproximado` —
 * el lote es uno de los de esa compra, pero no se sabe si es el de esa fila.
 *
 * Un grupo que no encaja en el cruce se deja tal cual vino. */
// deno-lint-ignore no-explicit-any
type RenglonCompra = any;
const claveCant = (p: RenglonCompra) =>
  `${Number(p.cantidad ?? 0)}\u0000${Number(p.precios?.subtotal_linea ?? p.total_linea ?? p.total ?? 0)}`;
const claveLote = (p: RenglonCompra) =>
  `${String((p.trazabilidad?.lote ?? p.lote) ?? '')}\u0000${String(p.trazabilidad?.fecha_vencimiento ?? p.fecha_vencimiento ?? p.vencimiento ?? '')}`;
const menor = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function deshacerCruce(items: RenglonCompra[]): { p: RenglonCompra; aproximado: boolean }[] {
  const porProducto = new Map<string, RenglonCompra[]>();
  for (const p of items) {
    const id = String(p.producto_id ?? p.id ?? p.id_producto ?? '');
    const g = porProducto.get(id) ?? [];
    g.push(p); porProducto.set(id, g);
  }
  const out: { p: RenglonCompra; aproximado: boolean }[] = [];
  for (const g of porProducto.values()) {
    const k = Math.round(Math.sqrt(g.length));
    if (g.length < 4 || k * k !== g.length) { for (const p of g) out.push({ p, aproximado: false }); continue; }
    const cuenta = (f: (p: RenglonCompra) => string) => {
      const m = new Map<string, number>();
      for (const p of g) m.set(f(p), (m.get(f(p)) ?? 0) + 1);
      return m;
    };
    const cants = cuenta(claveCant), lotes = cuenta(claveLote);
    const encaja = [...cants.values(), ...lotes.values()].every((n) => n % k === 0);
    if (!encaja) { for (const p of g) out.push({ p, aproximado: false }); continue; }
    // Cada cantidad y cada lote, tantas veces como renglones reales trae.
    const expandir = (m: Map<string, number>) => [...m.entries()].sort(([a], [b]) => menor(a, b))
      .flatMap(([c, n]) => Array(n / k).fill(c));
    const cs = expandir(cants), ls = expandir(lotes);
    const aproximado = cants.size > 1 && lotes.size > 1;
    // Del cruce existe toda combinación: se toma una fila real por par.
    const usadas = new Set<RenglonCompra>();
    for (let j = 0; j < k; j++) {
      const fila = g.find((p) => !usadas.has(p) && claveCant(p) === cs[j] && claveLote(p) === ls[j]);
      if (!fila) { usadas.clear(); out.length -= j; for (const p of g) out.push({ p, aproximado: false }); break; }
      usadas.add(fila); out.push({ p: fila, aproximado });
    }
  }
  return out;
}
