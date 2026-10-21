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

export const BASE = "https://clientesdte3.oss.com.sv/farma_salud/";

export interface Http {
  post(path: string, datos: Record<string, string>): Promise<string>;
  get(path: string): Promise<string>;
}

export interface RenglonVenta {
  reserva_id: number; producto_id: number; nombre: string; cantidad: number; factor: number;
  precio: number; precio_normal: number | null; lista_precio: string | null; subtotal: number;
}
export interface Venta {
  codigo: string; documento: string; vendedor: string; nota: string; total: number;
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
    .map((m) => ({ stock: num(m[1]), vence: m[2], id: m[3] }));
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

export async function enviarPreventaALaCaja(http: Http, venta: Venta): Promise<ResultadoCaja> {
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
    if (unidades !== r.factor) {
      let hallada = false;
      for (const p of fila.presentaciones) {
        const d = JSON.parse(await http.post("venta.php", {
          process: "getpresentacion", id_presentacion: p.id, cant: String(r.cantidad), precio_aut: "",
        }));
        if (num(d?.unidad) === r.factor) {
          pres = p; unidades = num(d.unidad); precios = leerPrecios(String(d?.select_rank ?? "")); hallada = true; break;
        }
      }
      if (!hallada) throw new Error(`«${r.nombre}» no tiene en la caja una presentación de ${r.factor} unidades.`);
    }

    const necesarias = r.cantidad * unidades;
    if (fila.stock + 1e-9 < necesarias) {
      throw new Error(`En la caja hay ${fila.stock} de «${r.nombre}» y la reserva pide ${necesarias}.`);
    }
    const lote = fila.regulado ? fila.lotes.find((l) => l.stock + 1e-9 >= necesarias) : { id: "0" };
    if (!lote) throw new Error(`Ningún lote de «${r.nombre}» alcanza para ${necesarias}.`);

    const precio = elegirPrecio(precios, r);
    if (!precio) throw new Error(`«${r.nombre}» no tiene precio en la caja.`);
    if (!igual(precio.valor, r.precio)) {
      avisos.push(`«${r.nombre}»: la caja lo tiene a $${precio.valor.toFixed(2)} y la reserva es a $${r.precio.toFixed(2)}.`);
    }
    const sub = Math.round(r.cantidad * precio.valor * 100) / 100;
    if (fila.exento === "0") gravado += sub; else exenta += sub;
    renglonesCaja.push({
      id_detalle: "", id: String(r.producto_id), precio: precio.valor.toFixed(2), cantidad: String(r.cantidad),
      unidades: String(unidades), subtotal: sub.toFixed(2), id_presentacion: pres.id, exento: fila.exento,
      id_lote: Number(lote.id), precio_seleccionado: precio.clave,
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
    subtotal: g, sumas: total.toFixed(2), venta_exenta: x, suma_gravada: g, tipo_impresion: "COF", id_factura: "0",
    precio_aut: "", clave: "", codvende: venta.vendedor, datos_extras: venta.nota, credito: "0", medico: "",
  };
  const crudo = await http.post("venta.php", datos);
  let resp: { typeinfo?: string; referencia?: unknown; tot?: unknown; msg?: string } = {};
  try { resp = JSON.parse(crudo); } catch { throw new Error("La caja contestó algo que no se entiende al crear la preventa."); }
  if (resp.typeinfo !== "Success") throw new Error(`La caja no aceptó la preventa: ${resp.msg ?? "sin motivo"}`);
  const referencia = String(resp.referencia ?? "").trim();

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
