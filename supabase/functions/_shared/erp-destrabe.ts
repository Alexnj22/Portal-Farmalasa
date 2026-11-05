// Destrabar la RECEPCIÓN de un traslado cuando la ficha del producto cambió
// después de despacharlo. Lo usan `trasladar-pedido-erp` (pedidos) y
// `aplicar-traslado-inventario` (solicitudes); escrito dos veces, el día que
// el sistema cambie un detalle una copia se queda vieja.
//
// Son dos trampas, las dos del 2026-11-05:
//
//  1. CONTROL DE LOTE («regulado») activado después del despacho: el renglón
//     salió sin lote y el sistema no recibe un producto regulado sin lote.
//     Se le quita, se recibe y se le vuelve a activar (`cambiarRegulado`).
//  2. PRESENTACIÓN OCULTA después del despacho: NOR CLAMIDA salió de Bodega en
//     caja de 30 y a las 2:44 p. m. alguien ocultó esa presentación. La
//     pantalla de recibir pinta el `<select>` de presentación VACÍO y no hay
//     forma de recibirlo, ni a mano. Se muestra, se recibe y se vuelve a
//     ocultar — es lo que se hizo a mano ese día, con el OK del usuario.
//
// Las dos tocan la ficha de un producto, que es UNA para todas las salas. Por
// eso el orden de protección es siempre el mismo:
//   - no se empieza sin tiempo para terminar (lo decide quien llama);
//   - lo que se va a tocar se ANOTA antes de tocarlo (la «marca» de abajo):
//     un `finally` no protege contra que maten el proceso — así quedó AMBROXOL
//     sin lote el 2026-11-05;
//   - cada cambio se VERIFICA releyendo la ficha;
//   - lo que quede anotado lo deshace la siguiente llamada (`deshacerDestrabe`).

import { BASE, pedir } from "./erp-dte.ts";
import { cambiarRegulado, leerFichaDe } from "./erp-regulado.ts";

const EDITAR = `${BASE}/editar_producto.php`;

/** Lo que una recepción le cambió a las fichas y hay que devolver. */
export type Destrabe = { lote: number[]; pres: { prod: number; pres: string }[] };
export const destrabeVacio = (): Destrabe => ({ lote: [], pres: [] });
export const hayDestrabe = (d: Destrabe | null | undefined) => !!d && (d.lote.length + d.pres.length) > 0;

/** La marca que va en `pedido_traslado_linea.aviso` mientras haya algo que devolver. */
export const MARCA_DESTRABE = "DESTRABE: ";
export const marcaDe = (d: Destrabe) => MARCA_DESTRABE + JSON.stringify(d);
export function leerMarca(texto: string | null | undefined): Destrabe | null {
  if (!texto?.startsWith(MARCA_DESTRABE)) return null;
  try {
    const d = JSON.parse(texto.slice(MARCA_DESTRABE.length));
    return { lote: (d.lote ?? []).map(Number).filter(Boolean), pres: (d.pres ?? []).filter((p: { prod?: number; pres?: string }) => p?.prod && p?.pres) };
  } catch { return null; }
}

/** Renglones de la pantalla de recibir cuyo `<select>` de presentación vino vacío. */
export function filasSinPresentacion(filas: string[]): { prod: number; unidad: number; nombre: string }[] {
  const out: { prod: number; unidad: number; nombre: string }[] = [];
  for (const tr of filas) {
    const prod = Number(tr.match(/class="id_p">\s*(\d+)/)?.[1] ?? 0);
    if (!prod) continue;
    if (/<select[^>]*class=['"]sel['"][^>]*>\s*<option/.test(tr)) continue;
    const unidad = Number(tr.match(/class=['"]unidad['"][^>]*value=['"](\d+)/)?.[1] ?? 1);
    const celdas = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    out.push({ prod, unidad, nombre: (celdas[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() });
  }
  return out;
}

/**
 * Para cada renglón sin presentación, LA presentación oculta de su ficha con
 * esa misma unidad. Si no hay exactamente una, no se adivina: devuelve el
 * motivo, y el renglón se queda para una persona.
 */
export async function presentacionesParaMostrar(
  cookie: string, sinPres: { prod: number; unidad: number; nombre: string }[],
): Promise<{ ok: true; pres: { prod: number; pres: string }[] } | { ok: false; motivo: string }> {
  const pres: { prod: number; pres: string }[] = [];
  for (const s of sinPres) {
    const ficha = await leerFichaDe(cookie, s.prod);
    const candidatas = ficha.presentaciones.filter((p) => p.oculta && p.exis && Number(p.unidad) === s.unidad);
    if (candidatas.length !== 1)
      return { ok: false, motivo: `${s.nombre || s.prod}: la presentación de ${s.unidad} con que salió no está en su ficha`
        + (candidatas.length ? " (hay más de una oculta)" : "") + ". Hay que revisarla en el catálogo." };
    pres.push({ prod: s.prod, pres: candidatas[0].id_prp });
  }
  return { ok: true, pres };
}

/** Muestra u oculta una presentación de la ficha, y lo VERIFICA releyéndola. */
export async function mostrarPresentacion(cookie: string, prod: number, pres: string, visible: boolean): Promise<void> {
  const ver = async () => (await leerFichaDe(cookie, prod)).presentaciones.find((p) => p.id_prp === pres);
  const antes = await ver();
  if (!antes) throw new Error(`La presentación ${pres} no está en la ficha ${prod}.`);
  if (antes.oculta === !visible) return;
  let resp = "";
  try {
    // Una escritura: un solo intento. Si la conexión se cae, decide la relectura.
    resp = await pedir(cookie, EDITAR, new URLSearchParams({ process: visible ? "active" : "deactive", id_pres: pres }),
      { extra: { Referer: `${EDITAR}?id_producto=${prod}` }, reintentos: 1 });
  } catch { /* se decide abajo */ }
  const despues = await ver();
  if (!despues || despues.oculta === visible)
    throw new Error(`El sistema no ${visible ? "mostró" : "ocultó"} la presentación ${pres} de ${prod}: ${resp.slice(0, 120) || "sin respuesta"}`);
}

/**
 * Devuelve las fichas a como estaban: control de lote activado y
 * presentaciones ocultas otra vez. Un reintento por cada una. Devuelve lo que
 * NO se pudo devolver (vacío = todo bien), en la misma forma, para re-anotarlo.
 */
export async function deshacerDestrabe(cookie: string, d: Destrabe): Promise<{ pendiente: Destrabe; errores: string[] }> {
  const pendiente = destrabeVacio();
  const errores: string[] = [];
  const dosVeces = async (fn: () => Promise<unknown>) => {
    try { await fn(); return null; } catch { /* uno más */ }
    try { await fn(); return null; } catch (e) { return (e as Error).message; }
  };
  for (const id of d.lote) {
    const e = await dosVeces(() => cambiarRegulado(cookie, id, true));
    if (e) { pendiente.lote.push(id); errores.push(`lote de ${id}: ${e}`); }
  }
  for (const p of d.pres) {
    const e = await dosVeces(() => mostrarPresentacion(cookie, p.prod, p.pres, false));
    if (e) { pendiente.pres.push(p); errores.push(`presentación ${p.pres} de ${p.prod}: ${e}`); }
  }
  return { pendiente, errores };
}
