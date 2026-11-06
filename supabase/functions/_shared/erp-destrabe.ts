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
import { estadoDeRecepcion, RECIBIR } from "./erp-traslado.ts";

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

// ── El destrabe entero, para quien recibe ───────────────────────────────────
//
// Pedidos y solicitudes lo escribieron cada uno en su archivo, y los envíos de
// producto, las devoluciones de pedido y los repartos de compra se quedaron sin
// él: el 2026-11-06 FOSKROL TRANQUILO no se pudo aceptar en Salud 4 ni en La
// Popular («No se proporcionó un lote») tres días después de que se dijera que
// el arreglo estaba en todos lados. Los tres caminos que faltaban usan esto.

/** Dónde guarda quien recibe la marca del destrabe, y cuánto tiempo le queda. */
export interface Trabas {
  /** Anota la marca ANTES de tocar una ficha (vacía = borrarla). `false` = no se pudo, y no se toca nada. */
  anotar: (d: Destrabe) => Promise<boolean>;
  /** ¿Alcanza para quitar, recibir y devolver antes de que corten la llamada? */
  hayTiempo: () => boolean;
}

/** Lo que tarda el destrabe de punta a punta (leer, quitar, recibir, devolver, verificar). */
export const MARGEN_DESTRABE_MS = 45_000;

/** Los renglones (`<tr>` con `id_p`) de la pantalla de recibir. */
export function filasDeRecibir(html: string): string[] {
  return [...html.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/g)].map((m) => m[0]).filter((tr) => /class="id_p"/.test(tr));
}

/** Productos de los renglones que llegan SIN lote (9.ª celda: … Esperado · Recibido · Lote · Vence). */
function productosSinLote(filas: string[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const tr of filas) {
    const prod = Number(tr.match(/class="id_p">\s*(\d+)/)?.[1] ?? 0);
    if (!prod) continue;
    const celdas = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (!(celdas[8] ?? "").replace(/<[^>]+>/g, "").trim())
      out.set(prod, (celdas[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  }
  return out;
}

export type Respuesta = { ok: boolean; msg: string; /** `false` = quien llama no mandó nada (validación propia). */ enviado?: boolean };

/**
 * Recibe un movimiento destrabando la ficha si hace falta.
 *
 * `recibir(filas)` es la parte de cada llamador: arma el sobre con SUS reglas
 * (qué vencimiento, qué validar) a partir de los renglones que se le pasan, y
 * lo manda. Se llama una vez, y otra más si hubo que quitar el control de lote.
 *
 * 1. Presentación oculta (el `<select>` vino vacío): se muestra, se relee la
 *    pantalla y recién ahí se recibe.
 * 2. Control de lote activado después del despacho: si la recepción falló, no
 *    quedó recibida igual y el producto sin lote HOY es regulado, se le quita,
 *    se vuelve a recibir y se le devuelve.
 *
 * Los frenos son los de siempre: sin tiempo no se empieza, la marca va ANTES
 * de tocar la ficha, cada cambio se verifica releyendo, y lo que no se pudo
 * devolver queda en la marca para el barrido de quien llama.
 */
export async function recibirConDestrabe(o: {
  cookie: string;
  idMov: string;
  filas: string[];
  trabas: Trabas;
  recibir: (filas: string[]) => Promise<Respuesta>;
}): Promise<{ resp: Respuesta; destrabado: string | null }> {
  const { cookie, idMov, trabas } = o;
  const destrabe = destrabeVacio();
  const nombres = new Map<number, string>();
  let filas = o.filas;
  let resp: Respuesta | null = null;

  const sinPres = filasSinPresentacion(filas);
  if (sinPres.length) {
    for (const s of sinPres) nombres.set(s.prod, s.nombre);
    if (!trabas.hayTiempo()) {
      resp = { ok: false, enviado: false, msg: "Una presentación del producto está oculta en la ficha y no quedaba tiempo para destrabarla. Vuelve a intentarlo." };
    } else {
      const r = await presentacionesParaMostrar(cookie, sinPres)
        .catch((e) => ({ ok: false as const, motivo: `No se pudo leer la ficha: ${(e as Error).message}` }));
      if (!r.ok) resp = { ok: false, enviado: false, msg: r.motivo };
      else {
        destrabe.pres = r.pres;
        if (!(await trabas.anotar(destrabe))) {
          destrabe.pres = [];
          resp = { ok: false, enviado: false, msg: "No se pudo anotar el destrabe de la presentación. Vuelve a intentarlo." };
        } else {
          try {
            for (const p of r.pres) await mostrarPresentacion(cookie, p.prod, p.pres, true);
            filas = filasDeRecibir(await pedir(cookie, `${RECIBIR}?id_movimiento=${encodeURIComponent(idMov)}`,
              undefined, { extra: { Referer: `${BASE}/admin_traslados.php` } }));
            // Si sigue sin presentación, no se recibe a medias.
            if (filasSinPresentacion(filas).length)
              resp = { ok: false, enviado: false, msg: "La presentación con que salió sigue sin aparecer en la ficha; no se recibe a medias." };
          } catch (e) {
            resp = { ok: false, enviado: false, msg: `No se pudo mostrar la presentación oculta: ${(e as Error).message}` };
          }
        }
      }
    }
  }

  if (!resp) resp = await o.recibir(filas);

  const sinLote = productosSinLote(filas);
  if (!resp.ok && resp.enviado !== false && sinLote.size > 0) {
    if (!trabas.hayTiempo()) {
      resp = { ...resp, msg: `${resp.msg || "No se proporcionó un lote"} (vuelve a intentarlo: no quedaba tiempo para destrabar el lote)` };
    } else if (await estadoDeRecepcion(cookie, idMov) !== "recibido") {
      const regulados: number[] = [];
      for (const id of sinLote.keys()) {
        try { if ((await leerFichaDe(cookie, id)).regulado) regulados.push(id); }
        catch { /* sin ficha legible no se toca */ }
      }
      if (regulados.length) {
        for (const id of regulados) nombres.set(id, sinLote.get(id) ?? String(id));
        destrabe.lote = regulados;
        if (!(await trabas.anotar(destrabe))) {
          destrabe.lote = [];
          resp = { ok: false, msg: "No se pudo anotar el destrabe del lote. Vuelve a intentarlo." };
        } else {
          try {
            for (const id of regulados) await cambiarRegulado(cookie, id, false);
            resp = await o.recibir(filas);
          } catch (e) {
            resp = { ok: false, msg: `No se pudo destrabar el control de lote: ${(e as Error).message}` };
          }
        }
      }
    }
  }

  // Se devuelven las fichas; lo que no se pueda queda en la marca.
  let destrabado: string | null = null;
  if (hayDestrabe(destrabe)) {
    const { pendiente, errores } = await deshacerDestrabe(cookie, destrabe);
    if (errores.length) console.error(`[destrabe] ${idMov}: ficha sin devolver: ${errores.join("; ")}`);
    await trabas.anotar(pendiente);
    const n = (id: number) => nombres.get(id) ?? String(id);
    destrabado = [
      destrabe.lote.length ? `control de lote de ${destrabe.lote.map(n).join(", ")}` : "",
      destrabe.pres.length ? `presentación oculta de ${destrabe.pres.map((p) => n(p.prod)).join(", ")}` : "",
    ].filter(Boolean).join("; ") || null;
  }
  return { resp, destrabado };
}

// ── La marca en `detalle.destrabe` de la fila que se recibe ─────────────────
// `envio_linea` y `pedido_devolucion` tienen `detalle` (jsonb) y su `aviso` ya
// lleva texto que la pantalla muestra, así que la marca no va ahí (en pedidos
// sí va en `aviso`, que es anterior a esto).

// deno-lint-ignore no-explicit-any
type ConTablas = { from: (relacion: string) => any };
type FilaConDetalle = { id: string; detalle: Record<string, unknown> | null };

/** Las trabas de una fila: la marca en `detalle.destrabe` de `tabla`. */
export function trabasEnDetalle(admin: ConTablas, tabla: string, fila: FilaConDetalle, hayTiempo: () => boolean): Trabas {
  return {
    hayTiempo,
    anotar: async (d) => {
      const { destrabe: _vieja, ...resto } = (fila.detalle ?? {}) as Record<string, unknown>;
      const detalle = hayDestrabe(d) ? { ...resto, destrabe: { ...d, at: new Date().toISOString() } } : resto;
      const { error } = await admin.from(tabla).update({ detalle, updated_at: new Date().toISOString() }).eq("id", fila.id);
      if (error) {
        console.error(`[destrabe] marca de ${tabla} ${fila.id}: ${error.message}`);
        return false;
      }
      fila.detalle = detalle;
      return true;
    },
  };
}

/**
 * Fichas que una llamada muerta dejó cambiadas: se devuelven y se borra la
 * marca. Sólo marcas de hace más de 3 minutos, para no pisar un destrabe que
 * otra llamada está haciendo ahora. La ficha es una para todas las salas, así
 * que cualquier sesión sirve.
 */
export async function devolverFichasHuerfanas(admin: ConTablas, tabla: string, cookie: string): Promise<void> {
  const { data, error } = await admin.from(tabla)
    .select("id, detalle")
    .not("detalle->destrabe", "is", null)
    .lt("updated_at", new Date(Date.now() - 3 * 60_000).toISOString())
    .limit(50);
  if (error) { console.error(`[destrabe] no se pudieron leer las marcas de ${tabla}: ${error.message}`); return; }
  for (const fila of (data ?? []) as FilaConDetalle[]) {
    const m = (fila.detalle?.destrabe ?? {}) as { lote?: unknown[]; pres?: { prod?: number; pres?: string }[] };
    const marca: Destrabe = {
      lote: (m.lote ?? []).map(Number).filter(Boolean),
      pres: (m.pres ?? []).filter((p) => p?.prod && p?.pres) as { prod: number; pres: string }[],
    };
    const { pendiente, errores } = await deshacerDestrabe(cookie, marca);
    if (errores.length) console.error(`[destrabe] ${tabla} ${fila.id}: ficha sin devolver: ${errores.join("; ")}`);
    await trabasEnDetalle(admin, tabla, fila, () => true).anotar(pendiente);
  }
}
