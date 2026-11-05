/* ── Cuánto le queda al WORKER, no al pedido ─────────────────────────────────
 *
 * El reloj de pared de una Edge Function son 400 s (plan Pro) y corre desde
 * que ARRANCA el worker, no desde que llega cada pedido: la plataforma reusa
 * un worker vivo para el pedido siguiente. Medido el 2026-11-04 en
 * `trasladar-pedido-erp`: el worker arrancó a las 15:55:35 para el simulacro,
 * el despacho real cayó en ese mismo worker a las 15:58:29 y lo mataron a las
 * 16:02:15,5 —400 s exactos desde su arranque, `reason: WallClockTime`— con
 * la corrida en el segundo 226 de un presupuesto de 240. Murió a mitad de un
 * producto: el traslado se creó y su número no se anotó.
 *
 * Por eso el presupuesto efectivo es el MENOR de los dos: el del pedido, y lo
 * que le queda al worker menos un margen del tamaño del paso más lento (un
 * producto puede tardar ~90 s con dos esperas de 45 s del sistema de origen).
 *
 * `NACIO_EL_WORKER` se evalúa una vez, al cargar el módulo — o sea, al
 * arrancar el worker.
 */
const NACIO_EL_WORKER = Date.now();
export const RELOJ_DE_PARED_MS = 400_000;

export function presupuestoDelWorker(
  arranque: number,
  presupuesto: number,
  margenMs: number,
  nacio: number = NACIO_EL_WORKER,
): { ms: number; recortado: boolean } {
  const queda = nacio + RELOJ_DE_PARED_MS - margenMs - arranque;
  return { ms: Math.max(0, Math.min(presupuesto, queda)), recortado: queda < presupuesto };
}
