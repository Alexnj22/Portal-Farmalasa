// Asignarle su lote real a existencia que el sistema guarda como «GENERICO»,
// SOLO por las unidades que van a salir en un traslado (2026-11-05).
//
// ── Por qué existe ────────────────────────────────────────────────────────
// Desde el 05-nov los medicamentos llevan lote («regulado» en la ficha), pero
// la existencia que ya estaba quedó bajo «GENERICO»: medido ese día, 6,456 de
// 11,872 pares producto·sala de regulados SÓLO tenían GENERICO (65% de las
// unidades). Un traslado de esa existencia salía como GENERICO mientras de la
// sala salía una caja con su lote impreso: la sala que recibe no tiene el
// lote, y el control por lote no cuadra en ningún lado.
//
// ── Por qué NO es un ajuste ───────────────────────────────────────────────
// `ajuste_inventario.php` lo permite, pero es una FOTO: se declara la cantidad
// real de cada lote del producto y el que no se llena queda en 0 (su propio
// cuadro lo dice). Habría que reescribir TODOS los lotes para mover unos pocos,
// y una venta en el medio quedaría deshecha. Decisión del usuario, 2026-11-05:
// mover sólo lo que viaja.
//
// ── Cómo: dos movimientos por diferencia ──────────────────────────────────
//   1. CARGA  de N paquetes con el lote y vencimiento que trae la caja
//      (`ingreso_inventario.php`: el lote viaja como TEXTO; si ya existe con
//      ese número y fecha, se SUMA a él — verificado el 2026-08-06).
//   2. DESCARGO de los mismos N paquetes del lote GENERICO
//      (`descargo_inventario.php`, por `descartarUnaLinea`).
// El total de la sala no cambia y ningún otro lote se toca.
//
// El ORDEN es a propósito: si algo se corta en el medio, es mejor que sobre
// mercadería (una carga sin su descargo) que que falte. Y si el descargo falla
// con un rechazo claro, se DESHACE la carga descargando ese mismo lote.
import { BASE, pedir, leerRespuesta } from "./erp-dte.ts";
import { descartarUnaLinea, conceptoDe } from "./erp-descarte.ts";
import { esLoteGenerico, traerFila, type LoteErp } from "./erp-traslado.ts";

const INGRESO = `${BASE}/ingreso_inventario.php`;

const norm = (s: string) => String(s ?? "").replace(/\s+/g, " ").trim().toUpperCase();
const dia = (s: string) => String(s ?? "").slice(0, 10);

/** La fecha de El Salvador (UTC-6 todo el año), en yyyy-mm-dd. */
function hoySV(): string {
  return new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Lo que la persona escribió, revisado. El lote va en ASCII y mayúsculas —el
 * sistema relee los bytes como Latin-1— y no puede ser «GENERICO», que es
 * justamente lo que se está reemplazando. El vencimiento tiene que ser una
 * fecha real y FUTURA: la pantalla del sistema tampoco acepta hoy ni antes.
 */
export function validarLoteEscrito(
  lote: unknown, vence: unknown,
): { ok: true; lote: string; vence: string } | { ok: false; error: string } {
  const l = String(lote ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
  if (!l) return { ok: false, error: "Falta el número de lote." };
  if (l.length > 40) return { ok: false, error: "El número de lote es demasiado largo." };
  if (esLoteGenerico(l)) return { ok: false, error: "«GENERICO» no es un lote: escribe el que trae la caja." };
  const v = dia(String(vence ?? ""));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T12:00:00Z`)))
    return { ok: false, error: "Falta el vencimiento, o no es una fecha." };
  if (v <= hoySV()) return { ok: false, error: `El vencimiento ${v} ya pasó: esa caja no puede salir.` };
  return { ok: true, lote: l, vence: v };
}

/**
 * ¿Ese número de lote ya está registrado con OTRO vencimiento en alguna sala?
 * (2026-11-05). El sistema identifica un lote por número + fecha exacta: con
 * otra fecha crearía un segundo lote con el mismo número — ya hay 74 así —, y
 * la pantalla lo frena pero no es la autoridad. Si el número ya existe CON
 * esta fecha, no hay choque (aunque otra fila vieja tenga otra).
 * Devuelve la fecha registrada que choca, o null. Lanza si no puede leer: un
 * freno que no pudo mirar no puede dejar pasar.
 */
export async function fechaRegistradaQueChoca(
  // deno-lint-ignore no-explicit-any
  sb: any, erpProductId: number, lote: string, vence: string,
): Promise<string | null> {
  const { data, error } = await sb.from("inventory")
    .select("fecha_vencimiento")
    .eq("erp_product_id", erpProductId)
    .eq("lote", lote)
    .not("fecha_vencimiento", "is", null)
    .limit(200);
  if (error) throw new Error(`No se pudo revisar si el lote ${lote} ya existe: ${error.message}`);
  const fechas = [...new Set((data ?? []).map((r: { fecha_vencimiento: string }) => dia(r.fecha_vencimiento)))];
  if (fechas.length === 0 || fechas.includes(vence)) return null;
  return fechas.sort()[0] as string;
}

export type ResultadoAsignacion =
  | {
    ok: true;
    /** El id del lote real en el sistema, para despachar de él. */
    idLote: string;
    lote: string;
    vence: string;
    paquetes: number;
    concepto: string;
  }
  | {
    ok: false;
    codigo: string;
    error: string;
    /** Algo quedó a medias en el inventario y hay que mirarlo a mano. */
    descuadre?: string;
  };

/**
 * Los trozos en que sale `total` de varios renglones GENERICO: del mayor al
 * menor, cada uno hasta lo que tiene ese renglón. Puro, para poder anclarlo.
 */
export function trozosDeGenerico(stocks: number[], total: number): number[] {
  let resto = Math.max(0, Number(total) || 0);
  const trozos: number[] = [];
  for (const s of [...stocks].map(Number).filter((n) => n > 0).sort((a, b) => b - a)) {
    if (resto <= 0) break;
    const t = Math.min(s, resto);
    trozos.push(t);
    resto -= t;
  }
  return resto > 0 ? [] : trozos;
}

export async function asignarLoteAGenerico(opc: {
  /** Sesión YA abierta en la sucursal de origen. */
  cookie: string;
  erpSucursal: number;
  erpUbicacion: number;
  erpProductId: number;
  descripcion: string;
  presentacionTipo: string;
  factor: number;
  /** De `getpresentacion`: la presentación con la que sale el traslado. */
  idPresentacion: string;
  costo: string;
  precio: string;
  unidad: string;
  paquetes: number;
  lote: string;
  vence: string;
  /** Lo que identifica el movimiento en el kardex (traslado, vale, quién). */
  referencia: string;
}): Promise<ResultadoAsignacion> {
  const o = opc;
  const nombre = o.descripcion || `el producto ${o.erpProductId}`;
  const enUnidades = Number(o.paquetes) * Number(o.unidad);
  const concepto = conceptoDe([`ASIGNA LOTE ${o.lote} A GENERICO`, o.referencia]);
  const delLote = (lotes: LoteErp[]) => lotes.find((x) =>
    norm(x.numero) === norm(o.lote) && dia(x.vence) === o.vence);

  // ── La foto de antes ────────────────────────────────────────────────────
  // Para saber DESPUÉS que la carga entró: el lote puede existir ya con ese
  // número y fecha (la carga se le suma), así que lo que se compara es su
  // stock, no su aparición.
  const antes = await traerFila(o.cookie, o.erpProductId, o.erpUbicacion);
  // Si UN renglón GENERICO alcanza, el descargo sale de él en la presentación
  // del traslado, como siempre. Si no, pero la SUMA sí (2026-11-05: FOLIMEN
  // 5 mg en Bodega, una caja partida en dos GENERICO de 2 blísteres), sale en
  // trozos por unidad base, uno por renglón (`trozosDeGenerico`).
  const genericos = antes.lotes.filter((x) => esLoteGenerico(x.numero));
  const mayor = Math.max(0, ...genericos.map((x) => x.stock));
  const suma = genericos.reduce((n, x) => n + Number(x.stock || 0), 0);
  if (suma < enUnidades)
    return {
      ok: false, codigo: "GENERICO_NO_ALCANZA",
      error: `${nombre}: sin lote asignado hay ${suma} unidades y salen ${enUnidades}.`,
    };
  const trozos = mayor >= enUnidades ? null : trozosDeGenerico(genericos.map((x) => x.stock), enUnidades);
  if (trozos && !trozos.length)
    return { ok: false, codigo: "GENERICO_NO_ALCANZA", error: `${nombre}: no se pudo repartir lo sin lote asignado.` };
  // El mismo número con otra fecha, en ESTA sala, según el sistema mismo.
  const otraFecha = antes.lotes.find((x) =>
    norm(x.numero) === norm(o.lote) && dia(x.vence) !== o.vence);
  if (otraFecha && !delLote(antes.lotes))
    return {
      ok: false, codigo: "LOTE_OTRA_FECHA",
      error: `${nombre}: el lote ${o.lote} ya está registrado con vencimiento ${dia(otraFecha.vence)}. Revisa la caja.`,
    };
  const previo = delLote(antes.lotes)?.stock ?? 0;

  // ── 1. La carga, con el lote de la caja ─────────────────────────────────
  const vence = o.vence;
  const crudo = await pedir(o.cookie, INGRESO, new URLSearchParams({
    process: "insert",
    datos: [o.erpProductId, o.costo, o.precio, o.paquetes, o.unidad, vence, o.idPresentacion, o.lote].join("|") + "#",
    cuantos: "1",
    total: (Number(o.costo || 0) * Number(o.paquetes)).toFixed(4),
    fecha: hoySV(),
    concepto,
    destino: String(o.erpUbicacion),
    // Una sola vez: una carga reenviada tras un corte carga dos veces.
  }), { extra: { Referer: INGRESO }, reintentos: 1 });
  const carga = leerRespuesta(crudo);

  // El sistema contesta 200 aunque rechace, y a veces algo ilegible aunque
  // haya entrado: lo que manda es el lote releído.
  const despues = await traerFila(o.cookie, o.erpProductId, o.erpUbicacion);
  const nuevo = delLote(despues.lotes);
  const entro = nuevo != null && nuevo.stock - previo >= enUnidades;
  if (!entro) {
    if (nuevo && nuevo.stock > previo)
      return {
        ok: false, codigo: "CARGA_INCOMPLETA",
        error: `${nombre}: la carga del lote ${o.lote} no entró completa.`,
        descuadre: `El lote ${o.lote} (vence ${o.vence}) de ${nombre} subió ${nuevo.stock - previo} `
          + `unidades y se esperaban ${enUnidades}. GENERICO no se tocó.`,
      };
    return {
      ok: false, codigo: "CARGA_RECHAZADA",
      error: `${nombre}: el sistema no aceptó el lote ${o.lote}: ${carga.msg || "sin detalle"}`,
    };
  }

  // ── 2. El descargo de GENERICO, por lo mismo ────────────────────────────
  const linea = {
    erp_product_id: o.erpProductId, presentacion_tipo: o.presentacionTipo,
    factor: Number(o.factor), cantidad: Number(o.paquetes), descripcion: o.descripcion,
  };
  if (trozos) {
    // Por unidad base (presentación de factor 1), un trozo por renglón: el
    // descargo elige el GENERICO que alcanza, y con los trozos del tamaño de
    // cada renglón —del mayor al menor— siempre hay uno.
    let salieron = 0;
    for (const t of trozos) {
      const d = await descartarUnaLinea({
        erpSucursal: o.erpSucursal, erpUbicacion: o.erpUbicacion,
        linea: { erp_product_id: o.erpProductId, presentacion_tipo: "", factor: 1, cantidad: t,
                 descripcion: o.descripcion, lote: "GENERICO" },
        concepto, iden: "DESCARTE",
      });
      if (d.ok) { salieron += t; continue; }
      if (d.codigo === "INCIERTO")
        return {
          ok: false, codigo: "DESCARGO_INCIERTO", error: `${nombre}: ${d.error}`,
          descuadre: `Se cargaron ${enUnidades} unidades al lote ${o.lote} de ${nombre}; de GENERICO salieron `
            + `${salieron} seguro y ${t} no se sabe. Revisar el kardex antes de volver a intentar.`,
        };
      // Rechazo claro: se saca del lote nuevo lo que NO salió de GENERICO.
      const falta = enUnidades - salieron;
      const des = await descartarUnaLinea({
        erpSucursal: o.erpSucursal, erpUbicacion: o.erpUbicacion,
        linea: { erp_product_id: o.erpProductId, presentacion_tipo: "", factor: 1, cantidad: falta,
                 descripcion: o.descripcion, lote: o.lote },
        concepto: conceptoDe([`DESHACE ASIGNACION LOTE ${o.lote}`, o.referencia]), iden: "DESCARTE",
      });
      if (des.ok && salieron === 0)
        return { ok: false, codigo: "DESCARGO_RECHAZADO", error: `${nombre}: ${d.error} (no se cambió nada).` };
      return {
        ok: false, codigo: "DESCARGO_RECHAZADO", error: `${nombre}: ${d.error}`,
        descuadre: des.ok
          ? `De GENERICO salieron ${salieron} de ${enUnidades} unidades de ${nombre}: esas ${salieron} quedaron `
            + `en el lote ${o.lote} (vence ${o.vence}) y lo demás se deshizo. Revisar si se quiere así.`
          : `Quedaron ${falta} unidades DE MÁS en el lote ${o.lote} (vence ${o.vence}) de ${nombre}: `
            + `no salieron de GENERICO y deshacerlas falló (${des.error}).`,
      };
    }
    return { ok: true, idLote: nuevo!.id, lote: o.lote, vence: o.vence, paquetes: o.paquetes, concepto };
  }

  const desc = await descartarUnaLinea({
    erpSucursal: o.erpSucursal, erpUbicacion: o.erpUbicacion,
    linea: { ...linea, lote: "GENERICO" }, concepto, iden: "DESCARTE",
  });
  if (desc.ok)
    return { ok: true, idLote: nuevo!.id, lote: o.lote, vence: o.vence, paquetes: o.paquetes, concepto };

  // Ilegible: pudo haber entrado. Deshacer la carga ahí podría dejar la sala
  // con de MENOS, que es peor; se dice exactamente qué mirar.
  if (desc.codigo === "INCIERTO")
    return {
      ok: false, codigo: "DESCARGO_INCIERTO", error: `${nombre}: ${desc.error}`,
      descuadre: `Se cargaron ${enUnidades} unidades al lote ${o.lote} de ${nombre} y no se sabe `
        + `si salieron de GENERICO. Revisar el kardex antes de volver a intentar.`,
    };

  // Rechazo claro: se deshace la carga para que la sala quede como estaba.
  const deshacer = await descartarUnaLinea({
    erpSucursal: o.erpSucursal, erpUbicacion: o.erpUbicacion,
    linea: { ...linea, lote: o.lote },
    concepto: conceptoDe([`DESHACE ASIGNACION LOTE ${o.lote}`, o.referencia]), iden: "DESCARTE",
  });
  if (deshacer.ok)
    return { ok: false, codigo: "DESCARGO_RECHAZADO", error: `${nombre}: ${desc.error} (no se cambió nada).` };
  return {
    ok: false, codigo: "DESCARGO_RECHAZADO", error: `${nombre}: ${desc.error}`,
    descuadre: `Quedaron ${enUnidades} unidades DE MÁS en el lote ${o.lote} (vence ${o.vence}) de `
      + `${nombre}: entró la carga y no salieron de GENERICO, y deshacerla falló (${deshacer.error}).`,
  };
}
