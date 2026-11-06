// Aplicar en la caja las diferencias de un conteo que la corrige (2026-11-05).
//
// Pedido del usuario: un tipo de inventario que, al aprobarse, «modifique y
// cambie» la existencia —en particular la que no tiene lote asignado—, primero
// en Bodega y después en cada sala. Decidido: asignar Y ajustar.
//
// ── Por qué diferencias y no una foto ─────────────────────────────────────
// `ajuste_inventario.php` declara la cantidad real de cada lote y deja en 0 el
// que no se llena: aplicada después de aprobar, deshace toda venta hecha entre
// el conteo y la aprobación. El conteo en vivo guarda lo que el sistema decía
// en el momento en que se contó cada renglón, así que su diferencia es lo que
// de verdad sobra o falta, y eso es lo que se mueve:
//   · lo que sobra de un lote → una CARGA con su lote y vencimiento;
//   · lo que falta de un lote → un DESCARGO de ese lote.
// Lo sin lote asignado que se contó con su lote real es exactamente las dos
// cosas: falta en GENERICO y sobra en el lote nuevo.
//
// ── Orden ────────────────────────────────────────────────────────────────
// Primero las cargas y después los descargos, igual que la asignación del lote
// de la caja: si algo se corta en el medio, es mejor que sobre a que falte.
// Cada línea anota si ya se hizo, para que un reintento no la repita.
import { BASE, pedir, leerRespuesta } from "./erp-dte.ts";
import { descartarUnaLinea } from "./erp-descarte.ts";
import { esLoteGenerico, resolverPresentacion, traerFila, type Fila } from "./erp-traslado.ts";
import { fechaRegistradaQueChoca, validarLoteEscrito } from "./erp-asignar-lote.ts";

const INGRESO = `${BASE}/ingreso_inventario.php`;
const norm = (s: string) => String(s ?? "").replace(/\s+/g, " ").trim().toUpperCase();
const dia = (s: string | null | undefined) => String(s ?? "").slice(0, 10);

function hoySV(): string {
  return new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export interface LineaDeAjuste {
  lote: string;
  vence: string | null;
  /** + entra, − sale; en unidades base. */
  unidades: number;
  factor_desconocido?: boolean;
  hecho?: boolean;
  incierto?: boolean;
  error?: string | null;
}

export interface Plan {
  /** `is`: las líneas que ese movimiento salda (sin lote pueden ser varias). */
  cargas: { is: number[]; lote: string; vence: string; unidades: number }[];
  descargos: { is: number[]; lote: string; unidades: number }[];
  rechazos: { i: number; error: string }[];
  /** Líneas que se compensan entre sí: no hay nada que mover. */
  saldadas: number[];
}

/**
 * Qué se hace con cada línea, sin tocar nada. Puro, para poder anclarlo.
 * `regulado`: el producto lleva lote; si no, todo va sin lote.
 * `exigeVence`: el producto es perecedero —una carga sin fecha la rechaza la
 * caja—.
 *
 * Sin lote, las líneas (que sólo se distinguen por la fecha) se SUMAN en un
 * movimiento (2026-11-06): con una carga por línea, la relectura no podía
 * repartir lo que subió entre dos cargas iguales y el producto quedaba en
 * «revisar» aunque hubiera entrado bien; y +3 en una fecha con −3 en otra
 * cargaba y descargaba lo mismo.
 */
export function planDelAjuste(lineas: LineaDeAjuste[], regulado: boolean, exigeVence = false): Plan {
  const plan: Plan = { cargas: [], descargos: [], rechazos: [], saldadas: [] };
  if (!regulado) {
    const vivas = lineas.map((l, i) => ({ l, i })).filter(({ l }) => !l.hecho && Number(l.unidades));
    if (!vivas.length) return plan;
    // Una presentación sin contenido conocido arruina la suma entera.
    if (vivas.some(({ l }) => l.factor_desconocido)) {
      for (const { i } of vivas) plan.rechazos.push({ i, error: "No se sabe cuántas unidades trae una de sus presentaciones: se ajusta a mano." });
      return plan;
    }
    const is = vivas.map(({ i }) => i);
    const neto = vivas.reduce((n, { l }) => n + Number(l.unidades), 0);
    if (neto === 0) { plan.saldadas.push(...is); return plan; }
    if (neto < 0) { plan.descargos.push({ is, lote: "", unidades: -neto }); return plan; }
    // La fecha de lo que entra: la de la línea que más sobra.
    const vence = vivas.filter(({ l }) => Number(l.unidades) > 0 && dia(l.vence))
      .sort((a, b) => Number(b.l.unidades) - Number(a.l.unidades))[0]?.l.vence;
    if (exigeVence && !dia(vence)) {
      for (const i of is) plan.rechazos.push({ i, error: `Sobran ${neto} unidades sin vencimiento: no se pueden cargar.` });
      return plan;
    }
    plan.cargas.push({ is, lote: "", vence: dia(vence), unidades: neto });
    return plan;
  }
  lineas.forEach((l, i) => {
    if (l.hecho || !Number(l.unidades)) return;
    if (l.factor_desconocido) {
      plan.rechazos.push({ i, error: "No se sabe cuántas unidades trae esa presentación: se ajusta a mano." });
      return;
    }
    const lote = regulado ? norm(l.lote) : "";
    const u = Number(l.unidades);
    if (u < 0) {
      // Un regulado sin número no se puede descargar: sin lote, el descargo
      // elegiría cualquiera.
      if (regulado && !lote) { plan.rechazos.push({ i, error: `Faltan ${-u} unidades de una línea sin lote: se ajusta a mano.` }); return; }
      plan.descargos.push({ is: [i], lote, unidades: -u });
      return;
    }
    if (!lote || esLoteGenerico(lote)) {
      plan.rechazos.push({ i, error: `Hay ${u} unidades sin lote de más: no se cargan sin lote. Cuéntalas en su lote.` });
      return;
    }
    if (!dia(l.vence)) {
      plan.rechazos.push({ i, error: `El lote ${lote} no tiene vencimiento: no se puede cargar.` });
      return;
    }
    plan.cargas.push({ is: [i], lote, vence: dia(l.vence), unidades: u });
  });
  return plan;
}

export interface Movimiento {
  id: string;
  conteo_id: string;
  erp_product_id: number;
  is_vencidos: boolean;
  lineas: LineaDeAjuste[];
  producto: string | null;
  sala: string | null;
  erp_sucursal_id: number | null;
  /** El producto exige fecha de vencimiento (perecedero o con lote). */
  perecedero?: boolean;
  ubicaciones: { id: number; isVencidos?: boolean }[] | null;
}

export interface ResultadoAjuste {
  estado: "HECHO" | "ERROR" | "INCIERTO";
  lineas: LineaDeAjuste[];
  error: string | null;
  resultado: Record<string, unknown>;
}

/** Aplica un producto. `cookie` es una sesión YA abierta en su sucursal. */
export async function aplicarAjusteDeConteo(
  // deno-lint-ignore no-explicit-any
  sb: any, cookie: string, m: Movimiento,
): Promise<ResultadoAjuste> {
  const lineas: LineaDeAjuste[] = m.lineas.map((l) => ({ ...l, error: null }));
  const nombre = m.producto || `el producto ${m.erp_product_id}`;
  const fallo = (error: string): ResultadoAjuste =>
    ({ estado: "ERROR", lineas, error, resultado: { at: new Date().toISOString() } });

  const ubic = (m.ubicaciones ?? []).find((u) => Boolean(u.isVencidos) === Boolean(m.is_vencidos))?.id;
  if (!m.erp_sucursal_id || !ubic) return fallo("La sala no tiene ubicación para este renglón.");

  const concepto = `CONTEO ${m.conteo_id.slice(0, 8).toUpperCase()} ${norm(m.sala ?? "")}`.slice(0, 120);
  let f: Fila;
  try { f = await traerFila(cookie, m.erp_product_id, ubic); }
  catch (e) { return fallo(`No se pudo leer ${nombre}: ${(e as Error).message}`); }

  const plan = planDelAjuste(lineas, f.regulado, Boolean(m.perecedero));
  for (const r of plan.rechazos) lineas[r.i].error = r.error;
  for (const i of plan.saldadas) lineas[i].hecho = true;
  const marcar = (is: number[], cambio: Partial<LineaDeAjuste>) => { for (const i of is) Object.assign(lineas[i], cambio); };
  const resultado: Record<string, unknown> = { at: new Date().toISOString(), concepto, regulado: f.regulado };

  // ── 1. Cargas ──────────────────────────────────────────────────────────
  if (plan.cargas.length) {
    const base = await resolverPresentacion(cookie, f, "UNIDAD", 1, { porFactor: true });
    if (!base) {
      for (const c of plan.cargas) marcar(c.is, { error: `${nombre} no tiene presentación de una unidad: no se puede cargar.` });
    } else {
      const validas: typeof plan.cargas = [];
      for (const c of plan.cargas) {
        if (f.regulado) {
          const existe = f.lotes.some((x) => norm(x.numero) === c.lote && dia(x.vence) === c.vence);
          if (!existe) {
            const v = validarLoteEscrito(c.lote, c.vence);
            if (!v.ok) { marcar(c.is, { error: v.error }); continue; }
            let choca: string | null = null;
            try { choca = await fechaRegistradaQueChoca(sb, m.erp_product_id, v.lote, v.vence); }
            catch (e) { marcar(c.is, { error: (e as Error).message }); continue; }
            if (choca) { marcar(c.is, { error: `El lote ${c.lote} ya está registrado con vencimiento ${choca}.` }); continue; }
          }
        }
        validas.push(c);
      }
      if (validas.length) {
        const previo = (c: { lote: string; vence: string }, fila: Fila) => f.regulado
          ? fila.lotes.filter((x) => norm(x.numero) === c.lote && dia(x.vence) === c.vence)
            .reduce((n, x) => n + Number(x.stock || 0), 0)
          : Number(fila.existencia || 0);
        const antes = validas.map((c) => previo(c, f));
        const crudo = await pedir(cookie, INGRESO, new URLSearchParams({
          process: "insert",
          datos: validas.map((c) => [m.erp_product_id, base.costo, base.precio, c.unidades, base.unidad,
            c.vence, base.id, f.regulado ? c.lote : ""].join("|")).join("#") + "#",
          cuantos: String(validas.length),
          total: validas.reduce((s, c) => s + Number(base.costo || 0) * c.unidades, 0).toFixed(4),
          fecha: hoySV(),
          concepto,
          destino: String(ubic),
        }), { extra: { Referer: INGRESO }, reintentos: 1 });
        const resp = leerRespuesta(crudo);
        // Lo que manda es la existencia releída: el sistema contesta 200 aunque
        // rechace, y a veces algo ilegible aunque haya entrado.
        let despues: Fila | null = null;
        try { despues = await traerFila(cookie, m.erp_product_id, ubic); } catch { despues = null; }
        // Sin lote hay a lo sumo UNA carga (el plan las suma), así que la
        // existencia releída siempre se le puede atribuir entera.
        validas.forEach((c, k) => {
          if (!despues) { marcar(c.is, { incierto: true, error: "No se pudo releer la existencia: revisar." }); return; }
          const subio = previo(c, despues) - antes[k];
          if (subio >= c.unidades) { marcar(c.is, { hecho: true }); return; }
          if (subio > 0) {
            marcar(c.is, { incierto: true, error: `La carga del lote ${c.lote || "—"} no se pudo comprobar completa (subió ${subio} de ${c.unidades}).` });
            return;
          }
          marcar(c.is, { error: `El sistema no aceptó la carga: ${resp.msg || "sin detalle"}` });
        });
        resultado.carga = { msg: resp.msg, renglones: validas.length };
      }
    }
  }

  // ── 2. Descargos, de a un lote ─────────────────────────────────────────
  const descargos: unknown[] = [];
  for (const d of plan.descargos) {
    const r = await descartarUnaLinea({
      erpSucursal: m.erp_sucursal_id, erpUbicacion: ubic,
      linea: { erp_product_id: m.erp_product_id, presentacion_tipo: "", factor: 1, cantidad: d.unidades,
               descripcion: nombre, lote: f.regulado ? (d.lote || null) : null },
      concepto, iden: "DESCARTE",
    });
    if (r.ok) { marcar(d.is, { hecho: true }); descargos.push(r.aplicado); continue; }
    marcar(d.is, { error: r.error, ...(r.codigo === "INCIERTO" ? { incierto: true } : {}) });
  }
  if (descargos.length) resultado.descargos = descargos;

  const pendientes = lineas.filter((l) => Number(l.unidades) && !l.hecho);
  const estado = pendientes.some((l) => l.incierto) ? "INCIERTO" : pendientes.length ? "ERROR" : "HECHO";
  const error = pendientes.length
    ? pendientes.map((l) => `${l.lote || "sin lote"}: ${l.error ?? "no se aplicó"}`).join(" · ")
    : null;
  return { estado, lineas, error, resultado };
}
