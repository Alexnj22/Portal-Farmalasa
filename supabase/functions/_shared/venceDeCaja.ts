// El vencimiento que trae la caja, para un perecedero SIN control de lote
// (2026-11-13, decisión del usuario: «si un producto no tiene regulado pero es
// perecedero, debe solicitar el vence si no viene activo»).
//
// Un regulado sin lote ya tenía su camino: el lote y el vencimiento de la caja
// se le asignan a lo «sin lote asignado» antes de salir (`erp-asignar-lote.ts`).
// Un perecedero sin regulado no tiene lotes: el sistema guarda UNA fecha por
// existencia, y el traslado la lleva en su casilla «vence». Si la existencia de
// origen no tiene fecha, esa casilla iba vacía y la sala que recibe quedaba sin
// vencimiento. Ahora quien arma el movimiento escribe la de la caja, y viaja en
// el renglón como `lotes[].caja.vence` (mismo lugar que el lote de la caja).

// deno-lint-ignore no-explicit-any
type Cliente = any;

/** Fecha de El Salvador, AAAA-MM-DD. */
const hoySV = () => new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString().slice(0, 10);

/**
 * Cuáles de estos productos son perecederos SIN control de lote. Lanza si no
 * se puede leer: decidir a ciegas dejaría salir sin fecha lo que la exige.
 */
export async function perecederosSinLote(admin: Cliente, ids: number[]): Promise<Set<number>> {
  const unicos = [...new Set(ids.map(Number).filter(Boolean))];
  if (!unicos.length) return new Set();
  const { data, error } = await admin.from("products").select("id, regulado, perecedero").in("id", unicos);
  if (error) throw new Error(`No se pudo leer qué productos son perecederos: ${error.message}`);
  return new Set(
    (data ?? []).filter((p: { regulado: boolean | null; perecedero: boolean | null }) =>
      p.perecedero === true && p.regulado !== true).map((p: { id: number }) => Number(p.id)),
  );
}

/**
 * El vencimiento escrito para el renglón, o "" si no hay. Acepta
 * `lotes[].caja.vence` y, por compatibilidad, `vence_caja` del renglón.
 */
export function venceEscrito(linea: { lotes?: unknown; vence_caja?: unknown }): string {
  const lotes = Array.isArray(linea?.lotes) ? linea.lotes as { caja?: { vence?: unknown } }[] : [];
  const v = String(lotes.find((r) => r?.caja?.vence)?.caja?.vence ?? linea?.vence_caja ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
}

/**
 * El vence que lleva el renglón al sistema: el de la existencia si lo tiene,
 * si no el escrito. `{ error }` si es perecedero y no hay ninguno, o si el
 * escrito ya venció.
 */
export function venceParaMover(
  perecedero: boolean, venceExistencia: string, escrito: string, nombre: string,
): { vence: string } | { error: string } {
  // Cualquier fecha que traiga la existencia vale (el formato lo pone el
  // sistema); sólo «nada», ceros o NULL cuentan como sin fecha.
  const propio = String(venceExistencia ?? "").trim();
  const tiene = propio !== "" && !/^0{4}|^null$/i.test(propio);
  if (!perecedero || tiene) return { vence: venceExistencia || "" };
  if (!escrito) {
    return {
      error: `${nombre} no tiene vencimiento registrado. `
        + `Hay que armarlo de nuevo y escribir el vencimiento que trae la caja.`,
    };
  }
  if (escrito <= hoySV()) return { error: `${nombre}: el vencimiento escrito (${escrito}) ya pasó.` };
  return { vence: escrito };
}
