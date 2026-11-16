// ─── La preventa en el sistema de la caja — el ADAPTADOR ────────────────────
//
// La venta la arma el portal (`src/utils/preventa.js`, `armarVenta`). Acá sólo
// se traduce a lo que entiende la caja de hoy y se lee de vuelta su número. El
// día que se facture en el portal, esto se va entero y la venta sigue igual.
//
// Lo que se midió a mano el 2026-10-21 (Salud 4, cliente genérico, vendedor
// 1000) y que esto repite:
//   · `venta.php?preventa=1` trae la fecha de la sesión (`id="fecha"`).
//   · `consultar_stock` arma el renglón: existencia, si es exento, los lotes
//     (sólo exige lote el producto regulado) y las listas de precio.
//   · `getpresentacion` dice cuántas unidades lleva una presentación; con eso
//     se elige la que coincide con el factor de la reserva.
//   · `insert_preventa` contesta `{typeinfo, referencia, tot}`. La REFERENCIA es
//     el número corto que ve la caja en su lista («29|CLIENTE|$47.50»), no el
//     de la venta.
//   · `get_referencias` lista las preventas vivas de la sala con su número de
//     venta (`value='396300'`). Con ese número se factura: la factura CONSERVA
//     el id (medido: la preventa 396306 de Salud 2 llegó a `sales_invoices`
//     como `erp_invoice_id = 396306`, mismo cliente y total, 2 min después).
//   · `cargar_data` con ese número devuelve la preventa: se relee para
//     confirmar que es la nuestra antes de guardar el enlace.
//
// ⚠️ La sucursal vive en la SESIÓN: un login por envío y en serie.

import { PAGOS_DE_CAJA } from "../../../src/utils/preventa.js";

export const BASE = "https://clientesdte3.oss.com.sv/farma_salud/";

export interface Http {
  post(path: string, datos: Record<string, string>): Promise<string>;
  get(path: string): Promise<string>;
}

export interface RenglonVenta {
  reserva_id: number; producto_id: number; nombre: string; cantidad: number; factor: number;
  precio: number; precio_normal: number | null; lista_precio: string | null; subtotal: number;
  /** El lote que eligió quien vende (2026-11-16): va primero. Sin él, el orden de caja. */
  lote?: { nombre: string; vence: string | null } | null;
}
export interface Venta {
  codigo: string; documento: string; pago?: string; puntos?: number; descuento_puntos?: number; vendedor: string; nota: string; total: number;
  cliente: { id: string; generico: boolean; motivo: string | null };
  renglones: RenglonVenta[];
}

export interface ResultadoCaja {
  referencia: string;
  externo_id: string | null;
  total_caja: number;
  renglones_caja: Record<string, unknown>[];
  avisos: string[];
}

/** Una sesión nueva en el sistema de la caja, con la sala ya fijada. */
export async function sesionDeCaja(usuario: string, clave: string, erpSucursal: number): Promise<Http> {
  const login = await fetch(BASE + "login.php", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: usuario, password: clave, m: "1" }).toString(),
    redirect: "manual", signal: AbortSignal.timeout(20_000),
  });
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("No se pudo entrar a la caja.");
  const http: Http = {
    async post(path, datos) {
      const r = await fetch(BASE + path, {
        method: "POST", headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(datos).toString(), signal: AbortSignal.timeout(30_000),
      });
      return r.text();
    },
    async get(path) {
      const r = await fetch(BASE + path, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(30_000) });
      return r.text();
    },
  };
  let ok = false;
  try { ok = Boolean(JSON.parse(await http.post("cambio_sesion.php", { process: "set_sucursal", id_sucursal: String(erpSucursal) }))?.success); }
  catch { ok = false; }
  if (!ok) throw new Error(`No se pudo abrir la sala ${erpSucursal} en la caja.`);
  return http;
}

const num = (s: unknown) => Number(String(s ?? "").replace(/,/g, ""));
const igual = (a: number, b: number | null) => b != null && Math.abs(a - b) < 0.005;

/** El renglón que devuelve `consultar_stock`, leído. */
export function leerRenglonDeStock(tr: string) {
  const stock = num(tr.match(/id='cant_stock'>([^<]*)</)?.[1]);
  const exento = tr.match(/id='exento' name='exento' value='(\d)'/)?.[1] ?? null;
  const unidades = num(tr.match(/id='unidades' name='unidades' value='([^']*)'/)?.[1] ?? "1") || 1;
  const regulado = /data-regulado='1'/.test(tr);
  const lotes = [...tr.matchAll(/<option data-stock='([\d.]+)' data-vencimiento='([^']*)' value='(\d+)'\s*>([^<]*)</g)]
    .map((m) => ({ stock: num(m[1]), vence: m[2], id: m[3], nombre: m[4].trim() }));
  const selPres = tr.match(/<select class=\\?"sel form-control\\?">(.*?)<\/select>/s)?.[1] ?? "";
  const presentaciones = [...selPres.matchAll(/<option([^>]*)value=\\?"(\d+)\\?"([^>]*)>([^<]*)</g)]
    .map((m) => ({ id: m[2], elegida: /selected/.test(m[1] + m[3]), texto: m[4].trim() }));
  return { stock, exento, unidades, regulado, lotes, presentaciones, precios: leerPrecios(tr) };
}

/** Las listas de precio de un renglón (`<select class="sel_r">`). */
export function leerPrecios(html: string) {
  const sel = html.match(/class=["']?[^"'>]*sel_r[^>]*>(.*?)<\/select>/s)?.[1] ?? "";
  return [...sel.matchAll(/<option([^>]*)>([^<]*)</g)].map((m) => ({
    clave: m[1].match(/data-key-precio=\\?"(\w+)\\?"/)?.[1] ?? null,
    valor: num(m[1].match(/value=\\?"([\d.]+)\\?"/)?.[1]),
  })).filter((p) => p.clave && p.valor > 0.001);
}

/**
 * La lista de precio con que va el renglón: la que da EL PRECIO DE LA RESERVA;
 * si ninguna (una oferta), la del precio normal; si no, «precio». Cuando no es
 * el de la reserva se avisa: la caja la cobra a su precio y lo que la reserva
 * promete se lo dice la nota.
 */
export function elegirPrecio(precios: { clave: string | null; valor: number }[], r: RenglonVenta) {
  return precios.find((p) => igual(p.valor, r.precio))
    ?? precios.find((p) => igual(p.valor, r.precio_normal))
    ?? precios.find((p) => p.clave === "precio")
    ?? null;
}

/** Las preventas vivas de la sala: `{ id, referencia, cliente, total }`. */
export function leerReferencias(respuesta: string) {
  let opciones = "";
  try { opciones = JSON.parse(respuesta)?.options ?? ""; } catch { opciones = ""; }
  return [...opciones.matchAll(/value='(\d+)'>([^<]*)</g)].map((m) => {
    const [ref, cliente, total] = m[2].split("|");
    return { id: m[1], referencia: String(ref ?? "").trim(), cliente: String(cliente ?? "").trim(), total: num(String(total ?? "").replace("$", "")) };
  });
}

/**
 * De qué lotes sale una reserva, en presentaciones ENTERAS (2026-11-05).
 *
 * Desde ese día todo medicamento es «regulado» (lleva lote) y su existencia
 * vieja vive en el lote GENERICO. Antes esta función pedía UN lote que
 * alcanzara solo, y la existencia que comparaba era la del lote que la caja
 * preselecciona (`cant_stock`), no la del producto: con 2 en GENERICO y 3 en
 * un lote real, una reserva de 4 fallaba con «en la caja hay 2». Ahora se
 * reparte en el MISMO orden en que la caja ofrece los lotes (primero el que
 * vence antes; GENERICO va primero porque su fecha es 0000-00-00), y cada lote
 * es un renglón, como lo haría quien vende a mano.
 *
 * Una presentación no se parte entre lotes (una caja es de un lote). Si con
 * presentaciones enteras no se completa, devuelve lo que falta y no inventa.
 */
export function repartirEnLotesDeVenta(
  lotes: { id: string; stock: number }[], cantidad: number, unidades: number,
): { partes: { id: string; cantidad: number }[]; faltan: number } {
  const partes: { id: string; cantidad: number }[] = [];
  let faltan = cantidad;
  for (const l of lotes) {
    if (faltan <= 0) break;
    const caben = Math.floor((l.stock + 1e-9) / unidades);
    const toma = Math.min(caben, faltan);
    if (toma > 0) { partes.push({ id: l.id, cantidad: toma }); faltan -= toma; }
  }
  return { partes, faltan };
}

/** Una fecha de caja (`2028-03-01`, `01/03/2028`, `01-03-2028`, `0000-00-00`) en `YYYY-MM-DD`, o null. */
export function fechaDeLote(s: string | null | undefined): string | null {
  const t = String(s ?? "").trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] === "0000" ? null : `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{2})[/-](\d{2})[/-](\d{4})/);
  if (m) return m[3] === "0000" ? null : `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

/**
 * El lote que eligió quien vende, primero (2026-11-16, usuario: «¿cómo
 * selecciono otro lote?»). Se reconoce por nombre y vencimiento; el resto
 * sigue en el orden de caja, así que si el elegido no alcanza, lo que falta
 * sale de los otros. Si no está en caja, queda el orden de caja y se avisa.
 */
export function ponerPrimeroElLote<T extends { nombre?: string; vence: string }>(
  lotes: T[], elegido: { nombre: string; vence: string | null } | null | undefined,
): { lotes: T[]; hallado: boolean } {
  if (!elegido?.nombre) return { lotes, hallado: true };
  const n = elegido.nombre.trim().toUpperCase();
  const v = fechaDeLote(elegido.vence);
  const i = lotes.findIndex((l) => {
    const t = String(l.nombre ?? "").trim().toUpperCase();
    return (t === n || t.startsWith(`${n} `)) && fechaDeLote(l.vence) === v;
  });
  if (i < 0) return { lotes, hallado: false };
  return { lotes: [lotes[i], ...lotes.slice(0, i), ...lotes.slice(i + 1)], hallado: true };
}

/**
 * La caja que ningún lote completa, en unidades (2026-11-16, pedido del usuario:
 * «vender siempre la caja aunque sea de diferente lote, al mismo precio»).
 *
 * Primero las presentaciones enteras, igual que `repartirEnLotesDeVenta`; lo
 * que falta sale en la presentación BASE, de lo que le queda a cada lote, en
 * el mismo orden. Medido en Salud 5 ese día (preventa de prueba, borrada): la
 * caja acepta un renglón por lote en blísteres a «precio de caja ÷ 10» y lo
 * guarda tal cual, con el total de una caja.
 */
export function repartirCajaEnUnidades(
  lotes: { id: string; stock: number }[], cantidad: number, unidades: number,
): { partes: { id: string; cantidad: number }[]; sueltas: { id: string; cantidad: number }[]; faltan: number } {
  const enteras = repartirEnLotesDeVenta(lotes, cantidad, unidades);
  if (enteras.faltan === 0 || unidades <= 1) return { partes: enteras.partes, sueltas: [], faltan: enteras.faltan };
  const quedan = lotes.map((l) => ({
    id: l.id, stock: l.stock - (enteras.partes.find((x) => x.id === l.id)?.cantidad ?? 0) * unidades,
  }));
  const sueltas = repartirEnLotesDeVenta(quedan, enteras.faltan * unidades, 1);
  if (sueltas.faltan > 0) return { partes: enteras.partes, sueltas: [], faltan: enteras.faltan };
  return { partes: enteras.partes, sueltas: sueltas.partes, faltan: 0 };
}

/**
 * ¿Sigue viva en la caja la preventa `id`, y es la nuestra? Antes de corregirla
 * o borrarla (2026-11-16): si ya no está en la lista de la sala, se facturó o
 * alguien la borró en caja, y escribir encima sería crear otra cosa.
 */
export async function preventaVivaEnLaCaja(http: Http, id: string, vendedor: string | null) {
  const lista = leerReferencias(await http.post("venta.php", { process: "get_referencias" }));
  const fila = lista.find((p) => p.id === id);
  if (!fila) return { viva: false as const, motivo: "Esa preventa ya no está en caja: se facturó o la borraron allá." };
  const pagina = await http.get("venta.php?preventa=1");
  const fecha = pagina.match(/id="fecha" value="([^"]+)"/)?.[1] ?? "";
  let j: Record<string, unknown> = {};
  try { j = JSON.parse(await http.post("venta.php", { process: "cargar_data", n_ref: id, fecha })); } catch { j = {}; }
  if (String(j.id_factura ?? "") !== id) return { viva: false as const, motivo: "La caja no devolvió esa preventa." };
  if (vendedor && String(j.codvende ?? "") !== vendedor)
    return { viva: false as const, motivo: "En caja esa preventa tiene otro vendedor: no se toca." };
  return { viva: true as const, referencia: fila.referencia, total: fila.total };
}

/**
 * Mandar la venta a la caja. Con `idFactura`, CORRIGE esa preventa en vez de
 * crear otra (medido en Salud 5 el 2026-11-16: `insert_preventa` con su
 * `id_factura` reemplaza los renglones y conserva número y referencia).
 */
export async function enviarPreventaALaCaja(http: Http, venta: Venta, opc: { idFactura?: string | null } = {}): Promise<ResultadoCaja> {
  const avisos: string[] = [];
  const pagina = await http.get("venta.php?preventa=1");
  const fecha = pagina.match(/id="fecha" value="([^"]+)"/)?.[1];
  if (!fecha) throw new Error("La caja no devolvió la fecha de la sesión.");

  const renglonesCaja: Record<string, unknown>[] = [];
  let gravado = 0, exenta = 0;
  for (const [i, r] of venta.renglones.entries()) {
    const st = JSON.parse(await http.post("venta.php", {
      process: "consultar_stock", id_producto: String(r.producto_id), id_factura: "0", tipo: "D", precio_aut: "", numero_fila: String(i + 1),
    }));
    const tr = String(st?.tr ?? "");
    if (!tr) throw new Error(`La caja no encontró «${r.nombre}».`);
    const fila = leerRenglonDeStock(tr);
    if (fila.exento == null) throw new Error(`La caja no dijo si «${r.nombre}» es exento.`);

    // La presentación: la que lleva tantas unidades como el factor de la reserva.
    let pres = fila.presentaciones.find((p) => p.elegida) ?? fila.presentaciones[0];
    let unidades = fila.unidades;
    let precios = fila.precios;
    if (!pres) throw new Error(`«${r.nombre}» no tiene presentación en la caja.`);
    // Dos presentaciones con las mismas unidades y distinta viñeta (2026-11-16:
    // CAJA $10.61 y CAJA $10.65 del mismo producto) se distinguen por sus
    // precios: va la que tiene el precio de la reserva Y su viñeta. Sin
    // ninguna que tenga las dos, la que tenga el precio; si no, la primera.
    const encaja = (ps: { valor: number }[]) =>
      (ps.some((x) => igual(x.valor, r.precio)) ? 1 : 0) + (ps.some((x) => igual(x.valor, r.precio_normal)) ? 1 : 0);
    if (unidades !== r.factor || encaja(precios) < 2) {
      let mejor: { pres: typeof pres; unidades: number; precios: typeof precios; puntos: number } | null =
        unidades === r.factor ? { pres, unidades, precios, puntos: encaja(precios) } : null;
      for (const p of fila.presentaciones) {
        if (mejor && p.id === mejor.pres.id) continue;
        const d = JSON.parse(await http.post("venta.php", {
          process: "getpresentacion", id_presentacion: p.id, cant: String(r.cantidad), precio_aut: "",
        }));
        if (num(d?.unidad) !== r.factor) continue;
        const ps = leerPrecios(String(d?.select_rank ?? ""));
        const puntos = encaja(ps);
        if (!mejor || puntos > mejor.puntos) mejor = { pres: p, unidades: num(d.unidad), precios: ps, puntos };
        if (puntos === 2) break;
      }
      if (!mejor) throw new Error(`«${r.nombre}» no tiene en la caja una presentación de ${r.factor} unidades.`);
      pres = mejor.pres; unidades = mejor.unidades; precios = mejor.precios;
    }

    const necesarias = r.cantidad * unidades;
    // En un regulado `cant_stock` es la existencia del lote preseleccionado, no
    // la del producto: la de verdad es la suma de sus lotes.
    const hay = fila.regulado ? fila.lotes.reduce((t, l) => t + l.stock, 0) : fila.stock;
    if (hay + 1e-9 < necesarias) {
      throw new Error(`En la caja hay ${hay} de «${r.nombre}» y la reserva pide ${necesarias}.`);
    }
    let partes: { id: string; cantidad: number }[] = [{ id: "0", cantidad: r.cantidad }];
    let sueltas: { id: string; cantidad: number }[] = [];
    if (fila.regulado) {
      const orden = ponerPrimeroElLote(fila.lotes, r.lote);
      if (!orden.hallado) avisos.push(`«${r.nombre}»: el lote ${r.lote?.nombre} ya no está en caja; sale en el orden de caja.`);
      const rep = repartirCajaEnUnidades(orden.lotes, r.cantidad, unidades);
      if (rep.faltan > 0) {
        throw new Error(`«${r.nombre}»: hay ${hay} unidades, pero repartidas en lotes no completan ${r.cantidad} de ${unidades}.`);
      }
      partes = rep.partes;
      sueltas = rep.sueltas;
    }

    const precio = elegirPrecio(precios, r);
    if (!precio) throw new Error(`«${r.nombre}» no tiene precio en la caja.`);
    if (!igual(precio.valor, r.precio)) {
      avisos.push(`«${r.nombre}»: la caja lo tiene a $${precio.valor.toFixed(2)} y la reserva es a $${r.precio.toFixed(2)}.`);
    }
    // Lo que va suelto, en la presentación de 1 y al precio de la presentación
    // entera ÷ sus unidades, con la MISMA lista: así la caja armada de dos
    // lotes cuesta lo mismo que una caja de un lote.
    if (sueltas.length) {
      let base: { id: string } | null = null;
      for (const p of fila.presentaciones) {
        const d = JSON.parse(await http.post("venta.php", {
          process: "getpresentacion", id_presentacion: p.id, cant: "1", precio_aut: "",
        }));
        if (num(d?.unidad) === 1) { base = p; break; }
      }
      if (!base) throw new Error(`«${r.nombre}»: ningún lote completa la presentación y la caja no la vende por unidad.`);
      const unitario = Math.round((precio.valor / unidades) * 10000) / 10000;
      for (const s of sueltas) {
        const sub = Math.round(s.cantidad * unitario * 100) / 100;
        if (fila.exento === "0") gravado += sub; else exenta += sub;
        renglonesCaja.push({
          id_detalle: "", id: String(r.producto_id), precio: unitario.toFixed(4), cantidad: String(s.cantidad),
          unidades: "1", subtotal: sub.toFixed(2), id_presentacion: base.id, exento: fila.exento,
          id_lote: Number(s.id), precio_seleccionado: precio.clave,
        });
      }
      avisos.push(`«${r.nombre}»: ningún lote completa la presentación; sale en unidades de varios lotes al mismo precio.`);
    }
    for (const parte of partes) {
      const sub = Math.round(parte.cantidad * precio.valor * 100) / 100;
      if (fila.exento === "0") gravado += sub; else exenta += sub;
      renglonesCaja.push({
        id_detalle: "", id: String(r.producto_id), precio: precio.valor.toFixed(2), cantidad: String(parte.cantidad),
        unidades: String(unidades), subtotal: sub.toFixed(2), id_presentacion: pres.id, exento: fila.exento,
        id_lote: Number(parte.id), precio_seleccionado: precio.clave,
      });
    }
  }

  // El descuento por puntos, como lo arma la caja: un renglón «-999» a $0.01
  // por punto que la caja RESTA de lo gravado (venta.js, `addDiscountList`).
  // El canje se registra solo cuando llega la factura.
  const descPuntos = Math.round(Number(venta.descuento_puntos ?? 0) * 100) / 100;
  if (descPuntos > 0) {
    gravado -= descPuntos;
    renglonesCaja.push({
      id_detalle: "", id: "-999", precio: descPuntos.toFixed(2), cantidad: "1", unidades: "1",
      subtotal: descPuntos.toFixed(2), exento: "0", id_lote: 0,
    });
  }
  const total = Math.round((gravado + exenta) * 100) / 100;
  const g = (Math.round(gravado * 100) / 100).toFixed(2), x = (Math.round(exenta * 100) / 100).toFixed(2);
  // Consumidor final (COF): el precio ya trae el IVA; la caja deja cambiar el
  // documento al facturar, y si la reserva pide crédito fiscal lo dice la nota.
  const datos = {
    process: "insert_preventa", cuantos: String(renglonesCaja.length), fecha_movimiento: fecha,
    id_cliente: venta.cliente.id, total: total.toFixed(2), id_vendedor: "",
    json_arr: "[" + renglonesCaja.map((r) => JSON.stringify(r)).join(",") + "]",
    retencion: "0.00", total_percepcion: "0", iva: "0.00", items: String(renglonesCaja.length),
    subtotal: g, sumas: total.toFixed(2), venta_exenta: x, suma_gravada: g, tipo_impresion: venta.documento === "credito_fiscal" ? "CCF" : "COF", id_factura: opc.idFactura || "0",
    precio_aut: "", clave: "", codvende: venta.vendedor, datos_extras: venta.nota, credito: (PAGOS_DE_CAJA as Record<string, string>)[venta.pago ?? "contado"] ?? "0", medico: "",
  };
  const crudo = await http.post("venta.php", datos);
  let resp: { typeinfo?: string; referencia?: unknown; tot?: unknown; msg?: string } = {};
  try { resp = JSON.parse(crudo); } catch { throw new Error("La caja contestó algo que no se entiende al crear la preventa."); }
  if (resp.typeinfo !== "Success") throw new Error(`La caja no aceptó la preventa: ${resp.msg ?? "sin motivo"}`);
  const referencia = String(resp.referencia ?? "").trim();

  // Una corrección conserva su número: se relee para confirmar que quedó.
  if (opc.idFactura) {
    let j: Record<string, unknown> = {};
    try { j = JSON.parse(await http.post("venta.php", { process: "cargar_data", n_ref: opc.idFactura, fecha })); } catch { j = {}; }
    const quedo = String(j.id_factura ?? "") === opc.idFactura
      && venta.renglones.every((r) => new RegExp(`\\b${r.producto_id}\\b`).test(String(j.lista ?? "")));
    if (!quedo) avisos.push("No se pudo confirmar la corrección en la caja: revísala allá.");
    return { referencia, externo_id: opc.idFactura, total_caja: total, renglones_caja: renglonesCaja, avisos };
  }

  // El número de la venta: por la referencia en la lista de la sala, y se relee.
  let externo: string | null = null;
  const lista = leerReferencias(await http.post("venta.php", { process: "get_referencias" }));
  const candidatas = lista.filter((p) => p.referencia === referencia).sort((a, b) => Number(b.id) - Number(a.id));
  if (!lista.length) avisos.push("La lista de preventas de la caja salió vacía: no se pudo leer el número de la venta.");
  for (const c of candidatas) {
    let j: Record<string, unknown> = {};
    try { j = JSON.parse(await http.post("venta.php", { process: "cargar_data", n_ref: c.id, fecha })); } catch { j = {}; }
    const esLaNuestra = String(j.id_factura ?? "") === c.id && String(j.codvende ?? "") === venta.vendedor
      && venta.renglones.every((r) => new RegExp(`\\b${r.producto_id}\\b`).test(String(j.lista ?? "")));
    if (esLaNuestra) { externo = c.id; break; }
  }
  if (!externo && lista.length) avisos.push("No se pudo confirmar el número de la venta en la caja.");
  return { referencia, externo_id: externo, total_caja: total, renglones_caja: renglonesCaja, avisos };
}

/**
 * Borrar una preventa de la caja, SÓLO si al releerla es la que se espera.
 * Para la prueba de envío y para deshacer un envío que el portal no pudo
 * guardar. Nunca se usa sobre una venta ya facturada: el portal no la borra si
 * su número ya está en las facturas.
 */
export async function borrarPreventaDeLaCaja(http: Http, externoId: string, esperado: { vendedor: string; productos: number[] }) {
  const pagina = await http.get("venta.php?preventa=1");
  const fecha = pagina.match(/id="fecha" value="([^"]+)"/)?.[1] ?? "";
  const j = JSON.parse(await http.post("venta.php", { process: "cargar_data", n_ref: externoId, fecha }));
  const ok = String(j?.id_factura ?? "") === externoId && String(j?.codvende ?? "") === esperado.vendedor
    && esperado.productos.every((p) => new RegExp(`\\b${p}\\b`).test(String(j?.lista ?? "")));
  if (!ok) throw new Error("La preventa de la caja no es la esperada: no se borra.");
  return JSON.parse(await http.post("venta.php", { process: "borrar_preventa", id_factura: externoId }));
}
