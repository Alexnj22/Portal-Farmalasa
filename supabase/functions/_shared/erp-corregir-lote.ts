// Corregir el lote o el vencimiento de existencia que ya está en la sala, sin
// sumar ni restar unidades (2026-11-16).
//
// ── Por qué existe ────────────────────────────────────────────────────────
// Pedido del usuario con un caso real: Salud 2 recibió 20 ZALDIAR de Salud 1
// con el lote LJ2506901 pero vencimiento 2026-10 —el bueno es 2028-09, el que
// tiene el resto de la red— y las 20 aparecían vencidas. Para arreglarlo, la
// sala pidió un DESCARTE de las 20 y planeaba pedir una CARGA de las mismas:
// dos solicitudes, dos aprobaciones y un kardex que dice que se botaron 20
// cajas que nunca salieron. «Sin necesidad de hacer descartes, envío o cosas
// raras. Solo se ajustaría lote / vence.» Decisión del usuario: la sala lo hace
// DIRECTO, sin aprobación; el rastro queda en el kardex (concepto con quién y
// por qué) y en la bitácora del portal.
//
// ── Cómo: el mismo par de movimientos que `erp-asignar-lote.ts` ───────────
// El sistema no tiene «editar lote». `ajuste_inventario.php` es una FOTO de
// todos los lotes (ver la cabecera de `erp-asignar-lote.ts`), así que se hace
// por diferencia, siempre en la presentación de UNA unidad:
//   1. CARGA  de N unidades con el lote y vencimiento correctos.
//   2. DESCARGO de las mismas N del lote equivocado — por número Y fecha.
// El total de la sala no cambia y ningún otro lote se toca. Si el lote de
// origen es «sin lote asignado» (GENERICO), es exactamente
// `asignarLoteAGenerico` y se delega en él.
//
// El orden es el mismo y por lo mismo: si algo se corta en el medio, mejor que
// sobre a que falte; un rechazo claro del descargo deshace la carga.
//
// ── Las dos trampas propias de este caso ──────────────────────────────────
//  · Cambiar SOLO la fecha deja el mismo número en dos renglones. El descargo
//    tiene que ir por número + fecha (`LineaDescarte.vence`), o podría salir
//    del renglón recién cargado.
//  · Y por eso mismo, si el número no cambia se corrige el renglón ENTERO: un
//    lote físico tiene una sola fecha, y dejar la mitad con cada una es crear
//    el problema que se está arreglando.
//
// ── Tres fechas o más para el mismo número (auditoría, 2026-11-16) ────────
// El freno «ese número ya existe con otra fecha» protege de un número mal
// TECLEADO que choca con un lote ajeno. Si el número no cambia no hay tecleo
// que proteger: la persona afirma la fecha de ESE lote. Frenarlo ahí trababa
// el caso de tres fechas —A y B mal, C la buena y todavía sin existencia—:
// corregir A→C chocaba con B y B→C con A, para siempre. Con el mismo número se
// corrige y las otras fechas que queden se DEVUELVEN como aviso, para seguir
// con ellas. Se corrige un renglón por vez.
//
// ── Un mismo lote en varios renglones ─────────────────────────────────────
// El portal suma por número + fecha; el sistema puede tener el mismo par en
// más de un renglón. Se suma igual (`par`), y el descargo ya sabe completar
// de varios renglones del mismo par (`lotesDelDescargo`, paso 2).
import { BASE, login, pedir, leerRespuesta } from "./erp-dte.ts";
import { descartarUnaLinea, conceptoDe } from "./erp-descarte.ts";
import { esLoteGenerico, resolverPresentacion, sesionEn, traerFila, type LoteErp } from "./erp-traslado.ts";
import { asignarLoteAGenerico, validarLoteEscrito } from "./erp-asignar-lote.ts";

const INGRESO = `${BASE}/ingreso_inventario.php`;

const norm = (s: string) => String(s ?? "").replace(/\s+/g, " ").trim().toUpperCase();
const dia = (s: string | null | undefined) => String(s ?? "").slice(0, 10);

function hoySV(): string {
  return new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export type ResultadoCorreccion =
  | { ok: true; lote: string; vence: string; unidades: number; concepto: string; avisos: string[] }
  | { ok: false; codigo: string; error: string; descuadre?: string };

/**
 * Lo que se pide, revisado antes de tocar nada. Puro, para anclarlo en
 * pruebas: recibe el lote de origen tal como el sistema lo tiene.
 */
export function revisarCorreccion(opc: {
  origen: { numero: string; vence: string; stock: number };
  unidades: number;
  loteNuevo: string;
  venceNuevo: string;
}): { ok: true } | { ok: false; codigo: string; error: string } {
  const { origen, unidades, loteNuevo, venceNuevo } = opc;
  if (!Number.isInteger(unidades) || unidades <= 0)
    return { ok: false, codigo: "SIN_UNIDADES", error: "Indica cuántas unidades se corrigen." };
  if (unidades > origen.stock)
    return { ok: false, codigo: "NO_ALCANZA", error: `Ese lote tiene ${origen.stock} unidades y se piden ${unidades}.` };
  const mismoNumero = norm(origen.numero) === norm(loteNuevo);
  if (mismoNumero && dia(origen.vence) === dia(venceNuevo))
    return { ok: false, codigo: "SIN_CAMBIO", error: "El lote y el vencimiento son los mismos: no hay nada que corregir." };
  if (mismoNumero && unidades !== origen.stock)
    return {
      ok: false, codigo: "LOTE_PARTIDO",
      error: `Si sólo cambia el vencimiento, se corrige el lote completo (${origen.stock} unidades): `
        + "un mismo lote no puede quedar con dos fechas.",
    };
  return { ok: true };
}

/**
 * ¿El número nuevo ya está registrado con OTRA fecha en alguna sala? Igual que
 * `fechaRegistradaQueChoca`, pero sin contar la fecha que se está corrigiendo
 * cuando el número es el mismo: en el caso que dio origen a esto, otras salas
 * pueden arrastrar el mismo error y eso no es un lote distinto. Lanza si no
 * puede leer.
 */
export async function fechaQueChocaAlCorregir(
  // deno-lint-ignore no-explicit-any
  sb: any, erpProductId: number, loteNuevo: string, venceNuevo: string, ignorar: string | null,
  /** Para el aviso: las otras salas, sin la propia (ésa la avisa `corregirLote`). */
  excluirSucursal: number | null = null,
): Promise<string | null> {
  let q = sb.from("inventory")
    .select("fecha_vencimiento")
    .eq("erp_product_id", erpProductId)
    .eq("lote", loteNuevo)
    .gt("cantidad", 0)
    .not("fecha_vencimiento", "is", null)
    .limit(200);
  if (excluirSucursal != null) q = q.neq("erp_sucursal_id", excluirSucursal);
  const { data, error } = await q;
  if (error) throw new Error(`No se pudo revisar si el lote ${loteNuevo} ya existe: ${error.message}`);
  const fechas = [...new Set((data ?? []).map((r: { fecha_vencimiento: string }) => dia(r.fecha_vencimiento)))]
    .filter((f) => f !== venceNuevo && f !== ignorar);
  return fechas.length ? (fechas.sort()[0] as string) : null;
}

/**
 * Un lote es número + fecha; el sistema puede tenerlo en varios renglones.
 * Devuelve el par con su stock SUMADO (y el número tal como lo escribe el
 * sistema, que es lo que el descargo compara), o null.
 */
export function par(
  lotes: LoteErp[], numero: string, vence: string | null,
): { numero: string; vence: string; stock: number } | null {
  const del = lotes.filter((x) => norm(x.numero) === norm(numero) && dia(x.vence) === dia(vence));
  if (!del.length) return null;
  return { numero: del[0].numero, vence: del[0].vence, stock: del.reduce((n, x) => n + Number(x.stock || 0), 0) };
}

/**
 * El número nuevo con OTRAS fechas en la sala (sin contar la que se corrige).
 * Con otro número es un lote distinto y bloquea —salvo que el par destino ya
 * exista—; con el mismo número sólo avisa (ver la cabecera: tres fechas).
 */
export function choqueEnLaSala(
  lotes: LoteErp[], origen: { numero: string; vence: string }, loteNuevo: string, venceNuevo: string,
): { bloquea: string | null; avisos: string[] } {
  const mismoNumero = norm(origen.numero) === norm(loteNuevo);
  const otras = [...new Set(lotes
    .filter((x) => norm(x.numero) === norm(loteNuevo) && Number(x.stock) > 0)
    .map((x) => dia(x.vence))
    .filter((f) => f !== venceNuevo && f !== dia(origen.vence)))].sort();
  if (!otras.length) return { bloquea: null, avisos: [] };
  if (mismoNumero)
    return { bloquea: null, avisos: [`En la sucursal el lote ${loteNuevo} sigue también con vencimiento ${otras.join(", ")}: corrígelo igual si es el mismo.`] };
  return { bloquea: par(lotes, loteNuevo, venceNuevo) ? null : otras[0], avisos: [] };
}

export async function corregirLote(opc: {
  erpSucursal: number;
  erpUbicacion: number;
  erpProductId: number;
  descripcion: string;
  loteViejo: string;
  venceViejo: string | null;
  unidades: number;
  loteNuevo: string;
  venceNuevo: string;
  /** Lo que identifica el movimiento en el kardex: quién y por qué. */
  referencia: string;
}): Promise<ResultadoCorreccion> {
  const o = opc;
  const nombre = o.descripcion || `el producto ${o.erpProductId}`;
  const v = validarLoteEscrito(o.loteNuevo, o.venceNuevo);
  if (!v.ok) return { ok: false, codigo: "LOTE_NUEVO_INVALIDO", error: v.error };
  const loteNuevo = v.lote, venceNuevo = v.vence;

  const cookie = await sesionEn(o.erpSucursal, login);
  const antes = await traerFila(cookie, o.erpProductId, o.erpUbicacion);
  if (!antes.encontrado)
    return { ok: false, codigo: "SIN_EXISTENCIA", error: `${nombre} no tiene existencia en esta sucursal.` };
  if (!antes.regulado)
    return { ok: false, codigo: "SIN_CONTROL_DE_LOTE", error: `${nombre} no lleva control de lote.` };

  // Todo en la presentación de una unidad: las cantidades del lote ya vienen
  // en unidades base y así no hay paquetes que partir.
  const pres = await resolverPresentacion(cookie, antes, "UNIDAD", 1, { porFactor: true });
  if (!pres)
    return { ok: false, codigo: "SIN_PRESENTACION_DE_UNO", error: `${nombre} no tiene presentación de una unidad.` };

  // ── Lo sin lote asignado: es la asignación que ya existe ────────────────
  if (esLoteGenerico(o.loteViejo)) {
    const sinLote = antes.lotes.filter((x) => esLoteGenerico(x.numero)).reduce((n, x) => n + Number(x.stock || 0), 0);
    if (!Number.isInteger(o.unidades) || o.unidades <= 0)
      return { ok: false, codigo: "SIN_UNIDADES", error: "Indica cuántas unidades se corrigen." };
    if (o.unidades > sinLote)
      return { ok: false, codigo: "NO_ALCANZA", error: `${nombre}: sin lote asignado hay ${sinLote} unidades y se piden ${o.unidades}.` };
    const r = await asignarLoteAGenerico({
      cookie, erpSucursal: o.erpSucursal, erpUbicacion: o.erpUbicacion, erpProductId: o.erpProductId,
      descripcion: nombre, presentacionTipo: "", factor: 1, idPresentacion: pres.id,
      costo: pres.costo, precio: pres.precio, unidad: "1", paquetes: o.unidades,
      lote: loteNuevo, vence: venceNuevo, referencia: o.referencia,
    });
    return r.ok
      ? { ok: true, lote: r.lote, vence: r.vence, unidades: o.unidades, concepto: r.concepto, avisos: [] }
      : { ok: false, codigo: r.codigo, error: r.error, descuadre: r.descuadre };
  }

  // ── El lote de origen, por número Y fecha ───────────────────────────────
  const origen = par(antes.lotes, o.loteViejo, o.venceViejo);
  if (!origen)
    return {
      ok: false, codigo: "LOTE_NO_EXISTE",
      error: `${nombre}: el lote ${o.loteViejo}${o.venceViejo ? ` (vence ${dia(o.venceViejo)})` : ""} ya no está en esta sucursal.`,
    };
  const rev = revisarCorreccion({ origen, unidades: o.unidades, loteNuevo, venceNuevo });
  if (!rev.ok) return { ...rev, error: `${nombre}: ${rev.error}` };

  const destinoPrevio = par(antes.lotes, loteNuevo, venceNuevo);
  const choque = choqueEnLaSala(antes.lotes, origen, loteNuevo, venceNuevo);
  if (choque.bloquea)
    return {
      ok: false, codigo: "LOTE_OTRA_FECHA",
      error: `${nombre}: el lote ${loteNuevo} ya está en la sucursal con vencimiento ${choque.bloquea}. Revisa la caja.`,
    };
  const avisos = choque.avisos;
  const previo = destinoPrevio?.stock ?? 0;
  const concepto = conceptoDe([
    `CORRIGE LOTE ${origen.numero} ${dia(origen.vence)} A ${loteNuevo} ${venceNuevo}`, o.referencia,
  ]);

  // ── 1. La carga, con el lote correcto ───────────────────────────────────
  const crudo = await pedir(cookie, INGRESO, new URLSearchParams({
    process: "insert",
    datos: [o.erpProductId, pres.costo, pres.precio, o.unidades, "1", venceNuevo, pres.id, loteNuevo].join("|") + "#",
    cuantos: "1",
    total: (Number(pres.costo || 0) * o.unidades).toFixed(4),
    fecha: hoySV(),
    concepto,
    destino: String(o.erpUbicacion),
    // Una sola vez: una carga reenviada tras un corte carga dos veces.
  }), { extra: { Referer: INGRESO }, reintentos: 1 });
  const carga = leerRespuesta(crudo);

  // Lo que manda es el lote releído, no la respuesta (ver erp-asignar-lote).
  const despues = await traerFila(cookie, o.erpProductId, o.erpUbicacion);
  const nuevo = par(despues.lotes, loteNuevo, venceNuevo);
  if (!nuevo || nuevo.stock - previo < o.unidades) {
    if (nuevo && nuevo.stock > previo)
      return {
        ok: false, codigo: "CARGA_INCOMPLETA",
        error: `${nombre}: el lote ${loteNuevo} no entró completo.`,
        descuadre: `El lote ${loteNuevo} (vence ${venceNuevo}) de ${nombre} subió ${nuevo.stock - previo} `
          + `unidades y se esperaban ${o.unidades}. El lote ${origen.numero} no se tocó.`,
      };
    return {
      ok: false, codigo: "CARGA_RECHAZADA",
      error: `${nombre}: no se aceptó el lote ${loteNuevo}: ${carga.msg || "sin detalle"}`,
    };
  }

  // ── 2. El descargo del lote equivocado, por número y fecha ──────────────
  const linea = { erp_product_id: o.erpProductId, presentacion_tipo: "", factor: 1, cantidad: o.unidades, descripcion: nombre };
  const desc = await descartarUnaLinea({
    erpSucursal: o.erpSucursal, erpUbicacion: o.erpUbicacion,
    linea: { ...linea, lote: origen.numero, vence: origen.vence }, concepto, iden: "DESCARTE",
  });
  if (desc.ok) return { ok: true, lote: loteNuevo, vence: venceNuevo, unidades: o.unidades, concepto, avisos };

  if (desc.codigo === "INCIERTO")
    return {
      ok: false, codigo: "DESCARGO_INCIERTO", error: `${nombre}: ${desc.error}`,
      descuadre: `Se cargaron ${o.unidades} unidades al lote ${loteNuevo} (vence ${venceNuevo}) de ${nombre} y no se `
        + `sabe si salieron del lote ${origen.numero} (vence ${dia(origen.vence)}). Revisar el kardex antes de reintentar.`,
    };

  // Rechazo claro: se deshace la carga para que la sala quede como estaba.
  const deshacer = await descartarUnaLinea({
    erpSucursal: o.erpSucursal, erpUbicacion: o.erpUbicacion,
    linea: { ...linea, lote: nuevo.numero, vence: nuevo.vence },
    concepto: conceptoDe([`DESHACE CORRECCION LOTE ${loteNuevo}`, o.referencia]), iden: "DESCARTE",
  });
  if (deshacer.ok)
    return { ok: false, codigo: "DESCARGO_RECHAZADO", error: `${nombre}: ${desc.error} (no se cambió nada).` };
  return {
    ok: false, codigo: "DESCARGO_RECHAZADO", error: `${nombre}: ${desc.error}`,
    descuadre: `Quedaron ${o.unidades} unidades DE MÁS en el lote ${loteNuevo} (vence ${venceNuevo}) de ${nombre}: `
      + `entró la carga, no salieron del lote ${origen.numero} y deshacerla falló (${deshacer.error}).`,
  };
}
