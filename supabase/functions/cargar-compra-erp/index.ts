// ── Cargar una compra en Bodega desde el portal (2026-10-29) ─────────────────
//
// Plan: docs/PLAN-CARGAR-COMPRAS-EN-BODEGA-2026-10-29.md.
//
// Por omisión, SIMULACRO. Arma el formulario exacto que el sistema de la caja
// recibiría (`_shared/compraSobre.ts`), lo revisa y lo deja escrito en
// `compra_carga` con estado `simulada`. Del sistema sólo LEE: las presentaciones
// de cada producto (`consultar_stock`, `getpresentacion`) y la tasa de
// percepción del proveedor (`datos_proveedores`). Ninguna de las tres escribe.
//
// El envío real (`enviar: true`, POST `compras.php` `process=insert`) es
// irreversible desde acá —sólo se deshace anulando la compra allá—. Está
// detrás del secreto `CARGA_COMPRA_ENVIO=on` y de los frenos de
// `enviarCompra`; sin el secreto contesta 409.
//
// La función confía en el navegador sólo para las DECISIONES (qué producto es
// cada renglón y su lote/vencimiento). Cantidades, costos y totales los vuelve a
// leer del documento guardado: así el formulario no puede llevar un número que
// el documento no dice.

import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, permisoDeModulo, requireActiveEmployeeUser } from "../_shared/security.ts";
import { BASE, login, pedir } from "../_shared/erp-dte.ts";
import { descartarUnaLinea } from "../_shared/erp-descarte.ts";
import {
  sesionEn, existenciasDeUbicacion, traerFila, pendientesDeOrigen, identificarTrasladoNuevo, armarConcepto, hoySV,
  TRASLADO, RECIBIR,
} from "../_shared/erp-traslado.ts";
import {
  type Decision, type LineaSobre, type Problema, type ProductoDelSistema, type RenglonDoc,
  lineaDelSobre, tipoDocDe, totalDelDocumento, totalesDelSobre, leerModelo, sobreDeProductoNuevo, repartirRegalos,
} from "../_shared/compraSobre.ts";

const COMPRAS = `${BASE}/compras.php`;
const ERP_BODEGA = 6;
const BODEGA_BRANCH_ID = 30; // la de `sync-erp-purchases`
const TOLERANCIA = 0.05;
/** El genérico con el que entra lo que un proveedor mandó por error y no
 * tenemos en el catálogo. Creado el 2026-10-30 con OK del usuario, una sola
 * vez; lo que era de verdad queda en `compra_renglon_erroneo`. */
const PRODUCTO_ERRONEO = 5307;

/**
 * La UBICACIÓN de Bodega donde entra la compra: el campo `destino` del
 * formulario. En la sesión de Bodega el formulario ofrece «1 BODEGA» y
 * «2 BODEGA DE VENCIDOS».
 *
 * Estuvo escrito a mano como "3", que es la ubicación de SALUD 1 (copiado de
 * una página guardada con la sesión en esa sala). El sistema lo aceptó sin
 * quejarse: la primera compra real (6472, C. Imberton, 29-oct) dejó 150
 * unidades en «sucursal 6 · ubicación 3», un lugar que no es ni el estante de
 * Bodega ni Salud 1 — no se ven en ninguno de los dos inventarios.
 *
 * Por eso sale de `erp_sucursal_map`, la misma tabla que usan los traslados, y
 * si no se encuentra NO se manda.
 */
async function ubicacionDeBodega(admin: any, vencidos = false): Promise<number | null> {
  const { data, error } = await admin.from("erp_sucursal_map")
    .select("inv_ubicaciones").eq("erp_sucursal_id", ERP_BODEGA).maybeSingle();
  if (error) throw error;
  const lista = Array.isArray(data?.inv_ubicaciones) ? data.inv_ubicaciones as { id: number; isVencidos: boolean }[] : [];
  const id = Number(lista.find((u) => Boolean(u.isVencidos) === vencidos)?.id ?? 0);
  return id > 0 ? id : null;
}

// Las dos, iguales a las de `leer-dte-json`.
function desenvolver(j: any): any {
  return j?.dteJson ?? j?.documento ?? j;
}
function pathDeStorage(url: string | null): string | null {
  if (!url) return null;
  const i = url.indexOf("/purchase-dte/");
  return i < 0 ? null : decodeURIComponent(url.slice(i + "/purchase-dte/".length));
}
const normNum = (s: string) => s.replace(/\s/g, "").replace(/\./g, "").replace(/O/gi, "0").toUpperCase();

/** Las presentaciones de un producto en Bodega, con su tamaño. Sólo lectura. */
async function productoDelSistema(cookie: string, id: number): Promise<ProductoDelSistema | null> {
  const t = await pedir(cookie, COMPRAS, new URLSearchParams({
    process: "consultar_stock", tipo: "D", id_producto: String(id),
  }), { extra: { Referer: COMPRAS } });
  let j: any;
  try { j = JSON.parse(t); } catch { return null; }
  if (j?.typeinfo !== "Success") return null;
  // El texto de cada opción es el nombre de la presentación tal como lo ve
  // Bodega («UNIDAD», «CAJA X 30»): la pantalla lo muestra para que se sepa
  // EN QUÉ se carga, no sólo cuántas unidades entran.
  const opciones = [...String(j.select ?? "").matchAll(/<option[^>]*value=['"]?(\d+)['"]?[^>]*>([^<]*)/g)]
    .map((m) => ({ id: m[1], nombre: m[2].replace(/\s+/g, " ").trim() }));
  const presentaciones = [];
  for (const { id: id_presentacion, nombre } of opciones) {
    const p = await pedir(cookie, COMPRAS, new URLSearchParams({ process: "getpresentacion", id_presentacion }),
      { extra: { Referer: COMPRAS } });
    try {
      const jp = JSON.parse(p);
      presentaciones.push({ id: id_presentacion, unidad: Number(jp.unidad), costo: Number(jp.costo), precio: Number(jp.precio), nombre: nombre || undefined });
    } catch { /* una presentación ilegible no tumba las otras */ }
  }
  return {
    id, nombre: String(j.descrip ?? id),
    perecedero: String(j.perecedero) === "1", regulado: String(j.regulado) === "1",
    presentaciones,
  };
}


/** JSON con las claves ordenadas a todo nivel: igual para el mismo contenido. */
function canonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as Record<string, unknown>).sort()
      .map((k) => `${JSON.stringify(k)}:${canonico((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/**
 * El envío real. Cinco frenos antes del POST, y ninguno sobra:
 * 1. la revisión de ESTA llamada no tiene problemas;
 * 2. lo que se manda es IDÉNTICO a lo que la persona revisó (`carga_id`): si
 *    entre la revisión y el clic cambió un precio o una presentación, se
 *    revisa de nuevo — nunca se manda algo que nadie vio;
 * 3. la fila pasa de `simulada` a `enviando` con el índice único de
 *    `compra_carga`: un doble clic o dos pestañas no mandan dos compras;
 * 4. el POST va UNA vez, sin reintento — `pedir()` reintenta, y reintentar un
 *    alta que quizá entró es duplicar la compra;
 * 5. si no se sabe qué pasó (se cortó la red), queda `sin_verificar` y no
 *    `fallida`: `fallida` deja volver a mandar, y eso sólo vale si el sistema
 *    DIJO que no.
 */
async function enviarCompra(admin: any, x: {
  cookie: string; documentId: number; cargaId: number; sobre: Record<string, unknown>;
  revision: any; lineas: LineaSobre[]; erpProveedor: number;
  quien: string; emisor: { nit: string | null; nombre: string | null };
}) {
  if (!x.revision.listo) return { enviada: false, revision: x.revision, error: "La revisión tiene problemas: no se mandó." };
  if (!Number.isFinite(x.cargaId)) return { enviada: false, error: "Falta la revisión que se aprobó." };

  const { data: rev, error: eR } = await admin.from("compra_carga").select("id, document_id, estado, sobre, created_at")
    .eq("id", x.cargaId).maybeSingle();
  if (eR) throw eR;
  if (!rev || rev.document_id !== x.documentId || rev.estado !== "simulada") {
    return { enviada: false, error: "Esa revisión ya no vale: revisa la carga de nuevo." };
  }
  if (Date.now() - new Date(rev.created_at).getTime() > 30 * 60_000) {
    return { enviada: false, error: "La revisión tiene más de 30 minutos: revisa la carga de nuevo." };
  }
  // Con las claves ORDENADAS: `jsonb` guarda el objeto con su propio orden
  // (largo de la clave, después alfabético), así que comparar el texto tal
  // cual daba «algo cambió» siempre — pasó en la primera prueba, 29-oct.
  if (canonico(rev.sobre) !== canonico(x.sobre)) {
    return { enviada: false, error: "Algo cambió desde la revisión (un precio, una presentación): revisa la carga de nuevo." };
  }
  // Freno de la ubicación: una revisión guardada antes del arreglo trae
  // `destino` "3" (Salud 1). Se compara contra la ubicación VIVA de Bodega.
  const estante = await ubicacionDeBodega(admin, false);
  if (!estante) return { enviada: false, error: "No se conoce la ubicación de Bodega: no se mandó." };
  if (String(x.sobre.destino) !== String(estante)) {
    return { enviada: false, error: "La revisión apunta a otra ubicación: revisa la carga de nuevo." };
  }

  // Freno 2b: que Bodega no la tenga YA. `purchase_receipts` (freno de la
  // revisión) es un espejo que va hasta 10 minutos atrás, y Bodega carga con el
  // día de la carga mientras el portal manda la emisión: se mira en vivo, de la
  // emisión a hoy, en la lista liviana. Si no se puede mirar, no se manda.
  const yaEsta = await yaEnBodega(x.cookie, String(x.sobre.fecha), String(x.sobre.numero_doc))
    .catch((e) => ({ error: String(e?.message ?? e) }));
  if ("error" in yaEsta) return { enviada: false, error: `No se pudo comprobar si Bodega ya la tiene: ${yaEsta.error}` };
  if (yaEsta.compra) return { enviada: false, error: `Bodega ya la tiene cargada (compra ${yaEsta.compra}): no se mandó.` };

  // Freno 2c: la existencia del ESTANTE antes de mandar, para comprobar después
  // que la compra entró AHÍ. El «Success» del sistema y leer la compra de
  // vuelta no lo dicen: la 6472 pasó las dos verificaciones con sus 150
  // unidades en una ubicación que no era la de Bodega. Sin esta lectura no se
  // manda — no habría cómo saber dónde quedó.
  const estanteAntes = await existenciasDeUbicacion(x.cookie, ERP_BODEGA, estante);
  if (!estanteAntes) return { enviada: false, error: "No se pudo leer la existencia de Bodega para comprobar la carga: no se mandó." };

  const { data: tomada, error: eT } = await admin.from("compra_carga")
    .update({ estado: "enviando", updated_at: new Date().toISOString() })
    .eq("id", x.cargaId).eq("estado", "simulada").select("id");
  if (eT) {
    if (eT.code === "23505") return { enviada: false, error: "Esta compra ya se mandó desde el portal." };
    throw eT;
  }
  if (!tomada?.length) return { enviada: false, error: "Esa revisión ya se usó." };

  const marcar = (estado: string, extra: Record<string, unknown> = {}) =>
    admin.from("compra_carga").update({ estado, updated_at: new Date().toISOString(), ...extra }).eq("id", x.cargaId);

  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(x.sobre)) {
    if (Array.isArray(v)) { if (v.length) form.set(k, JSON.stringify(v)); continue; } // jQuery omite el arreglo vacío
    form.set(k, String(v));
  }

  let texto: string;
  try {
    const res = await fetch(COMPRAS, {
      method: "POST",
      headers: {
        Cookie: x.cookie, "User-Agent": "Mozilla/5.0", "X-Requested-With": "XMLHttpRequest",
        Referer: COMPRAS, "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
      signal: AbortSignal.timeout(90_000),
    });
    texto = await res.text();
  } catch (e: any) {
    await marcar("sin_verificar", { error: `Sin respuesta del sistema: ${e?.message ?? e}` });
    return { enviada: null, error: "El sistema no contestó. Puede haber entrado: NO la mandes de nuevo; avisa a Bodega para que la busque." };
  }

  let j: any = null;
  try { j = JSON.parse(texto); } catch { /* abajo */ }
  if (!j) {
    // Entero (hasta 4000): en la primera prueba sólo se guardaron 300
    // caracteres y la parte que decía qué consulta falló quedó afuera.
    await marcar("sin_verificar", { error: `Respuesta ilegible: ${texto.slice(0, 4000)}` });
    return { enviada: null, error: "El sistema contestó algo que no se entiende. Puede haber entrado: NO la mandes de nuevo." };
  }
  if (String(j.typeinfo).toLowerCase() !== "success") {
    await marcar("fallida", { error: String(j.msg ?? "rechazada") });
    return { enviada: false, error: `El sistema no la aceptó: ${j.msg ?? "sin motivo"}` };
  }

  // ── Leerla de vuelta ───────────────────────────────────────────────────────
  const verif = await leerDeVuelta(x.cookie, x.sobre, x.lineas, x.erpProveedor).catch((e) => ({ ok: false, compra: null, notas: [`No se pudo leer de vuelta: ${e?.message ?? e}`] }));
  // ¿Entró al estante? Cada producto tiene que haber subido al menos lo que se
  // cargó (en unidades). Una venta o un traslado en el medio puede dar un
  // falso aviso; preferible a no enterarse de que la mercadería no está.
  const estanteDespues = await existenciasDeUbicacion(x.cookie, ERP_BODEGA, estante);
  if (!estanteDespues) {
    verif.ok = false; verif.notas.push("No se pudo leer la existencia de Bodega después de cargar: comprobar que entró al estante.");
  } else {
    const esperado = new Map<number, number>();
    for (const l of JSON.parse(String(x.sobre.json_arr)) as { id_producto: string; cant: string; unidad: string }[]) {
      const id = Number(l.id_producto);
      esperado.set(id, (esperado.get(id) ?? 0) + Number(l.cant) * (Number(l.unidad) || 1));
    }
    const faltan = [...esperado].filter(([id, u]) => (estanteDespues.get(id) ?? 0) - (estanteAntes.get(id) ?? 0) < u);
    if (faltan.length) {
      verif.ok = false;
      verif.notas.push(`No entró al estante de Bodega: ${faltan.map(([id, u]) => `producto ${id} debía subir ${u} y subió ${(estanteDespues.get(id) ?? 0) - (estanteAntes.get(id) ?? 0)}`).join("; ")}.`);
    }
  }
  await marcar(verif.ok ? "verificada" : "sin_verificar", {
    erp_compra_id: verif.compra, error: verif.notas.length ? verif.notas.join(" · ") : null,
  });
  // Traerla al portal ya. El cron de compras mira ayer y hoy por la fecha de
  // la compra, y ésta lleva la de EMISIÓN: sin esto entraba recién con el
  // barrido del domingo (10 días) o nunca. Después de responder, sin esperarla.
  EdgeRuntime.waitUntil(fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/sync-erp-purchases`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("ADMIN_INVOKE_SECRET") ?? ""}` },
    body: JSON.stringify({ fini: x.sobre.fecha, ffin: x.sobre.fecha, branchId: BODEGA_BRANCH_ID }),
    signal: AbortSignal.timeout(140_000),
  }).then((r) => { if (!r.ok) console.error("[cargar-compra-erp] traerla al portal:", r.status); })
    .catch((e) => console.error("[cargar-compra-erp] traerla al portal:", e?.message ?? e)));
  // El costo subió y el precio de venta ya no deja margen: avisar a quien ve
  // costos. Sin esperar, y sin que un fallo del aviso toque la carga.
  EdgeRuntime.waitUntil(avisarMargenBajo(admin, x.revision, x.emisor.nombre, verif.compra)
    .catch((e) => console.error("[cargar-compra-erp] aviso de margen:", e?.message ?? e)));

  // Lo marcado como error del proveedor: se anota y, si la compra se
  // comprobó en el estante, se pasa a Bodega de vencidos.
  let vencidos: unknown = null;
  const errs: Erroneo[] = x.revision.erroneos ?? [];
  if (errs.length) {
    vencidos = await apartarErroneos(admin, x.cookie, errs, {
      cargaId: x.cargaId, documentId: x.documentId, quien: x.quien, emisor: x.emisor,
      erpCompra: verif.compra, lineas: x.lineas, mover: verif.ok, estante,
    }).catch(async (e) => {
      console.error("[cargar-compra-erp] erróneos:", e?.message ?? e);
      return { movidos: 0, error: `No se pudieron pasar a vencidos: ${e?.message ?? e}` };
    });
  }
  return { enviada: true, verificada: verif.ok, erp_compra_id: verif.compra, notas: verif.notas, msg: j.msg ?? null, vencidos };
}

/**
 * ¿Bodega ya tiene este documento? Lista liviana de Admin Compras
 * (`admin_compras_fecha_dt.php`: id, tipo, número, … fecha) de la emisión a
 * hoy. La sucursal es estado de la sesión, y la de `sesionEn` ya es Bodega.
 * El número guardado son 20 caracteres del código de generación: con eso se
 * compara. Una anulada también frena — en la duda, no se manda.
 */
async function yaEnBodega(cookie: string, desde: string, numero: string): Promise<{ compra: number | null }> {
  const hoy = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
  const qs = `fechai=${desde}&fechaf=${hoy < desde ? desde : hoy}&draw=1&start=0&length=5000`;
  const t = await pedir(cookie, `${BASE}/admin_compras_fecha_dt.php?${qs}`, undefined, { timeoutMs: 60_000 });
  const filas: any[][] = JSON.parse(t)?.data;
  if (!Array.isArray(filas)) throw new Error("la lista de compras no vino");
  const buscado = numero.toUpperCase();
  const f = filas.find((r) => {
    const n = String(r[2] ?? "").replace(/<[^>]*>/g, "").trim().toUpperCase();
    return n.length >= 8 && buscado.startsWith(n);
  });
  return { compra: f ? Number(f[0]) || -1 : null };
}

/** Busca la compra recién hecha en la lista de su fecha y compara renglón por renglón. */
async function leerDeVuelta(cookie: string, sobre: Record<string, unknown>, lineas: LineaSobre[], erpProveedor: number) {
  const dia = String(sobre.fecha);
  const t = await pedir(cookie, `${BASE}/descargar_compras_json.php?fini=${dia}&ffin=${dia}&id_sucursal=${ERP_BODEGA}`,
    undefined, { timeoutMs: 90_000 });
  const compras: any[] = JSON.parse(t)?.compras ?? [];
  const numero = String(sobre.numero_doc).toUpperCase();
  const c = compras.find((k) => {
    const n = String(k.documento?.numero ?? "").trim().toUpperCase();
    return !k.anulada && Number(k.proveedor?.id) === erpProveedor && n.length >= 8 && numero.startsWith(n);
  });
  if (!c) return { ok: false, compra: null, notas: ["Entró, pero no aparece en la lista de compras de la fecha de la factura."] };

  const notas: string[] = [];
  const total = Number(c.totales?.total_operacion);
  if (!(Math.abs(total - Number(sobre.total)) <= TOLERANCIA)) notas.push(`Total en el sistema $${total} contra $${sobre.total}.`);
  const items: any[] = c.items ?? [];
  const productos = lineas.filter((l) => l.bandera === "PRODUCTO");
  // Los servicios (consumo) no se sabe todavía si salen en esta lista: el
  // conteo sólo se exige cuando la compra es toda de productos.
  if (productos.length === lineas.length && items.length !== lineas.length) {
    notas.push(`El sistema tiene ${items.length} renglones y se mandaron ${lineas.length}.`);
  }
  // Agrupado por producto (uno puede venir en dos renglones). Se acepta la
  // cantidad en unidades o en la presentación: la lista no dice en cuál está,
  // y las compras medidas eran todas de 1 unidad.
  const porProducto = new Map<string, { cant: number; unidades: number }>();
  for (const l of productos) {
    const a = porProducto.get(l.id_producto) ?? { cant: 0, unidades: 0 };
    a.cant += Number(l.cant); a.unidades += Number(l.cant) * Number(l.unidad);
    porProducto.set(l.id_producto, a);
  }
  for (const [id, e] of porProducto) {
    const delSistema = items.filter((it) => String(it.producto_id) === id).reduce((a, it) => a + Number(it.cantidad), 0);
    if (Math.abs(delSistema - e.unidades) > 0.001 && Math.abs(delSistema - e.cant) > 0.001) {
      notas.push(`Producto ${id}: ${delSistema} en el sistema, se esperaban ${e.unidades} unidades.`);
    }
  }
  return { ok: notas.length === 0, compra: Number(c.compra_id) || null, notas };
}

/** El texto de la opción elegida de un `<select>` de la pantalla del sistema. */

/**
 * Producto nuevo copiando a uno parecido — SIMULACRO. Lee la pantalla de
 * edición del modelo (un GET) y arma el alta tal como la mandaría el
 * formulario del sistema, sin mandarla.
 */
/**
 * Da de alta el producto en el sistema, con el MISMO sobre que se acaba de
 * revisar (se rearma en el servidor; nada viene del navegador).
 *
 * 1. Toma la fila en `producto_alta_portal` (nombre y código únicos): un doble
 *    clic o un reintento chocan ahí y no crean dos productos.
 * 2. Manda `agregar_producto.php` como lo hace su formulario.
 * 3. Lo LEE de vuelta en su ficha: el «Success» no alcanza (ver la compra
 *    6472, que dijo «Hecho» con la mercadería en otra ubicación).
 * 4. Lo agrega al catálogo del portal para poder elegirlo en la carga ya.
 */
async function crearProducto(
  admin: any, cookie: string, sobre: Record<string, string>,
  x: { nombre: string; barcode: string; modeloId: number; costo: number; precio: number; quien: string },
) {
  const { data: fila, error: eF } = await admin.from("producto_alta_portal").insert({
    nombre: x.nombre, barcode: x.barcode || null, modelo_id: x.modeloId,
    costo: x.costo, precio: x.precio, creado_por: x.quien,
  }).select("id").single();
  if (eF) {
    if (eF.code === "23505") return { error: "Ese producto ya se dio de alta desde el portal (o se está dando ahora)." };
    throw eF;
  }
  const marcar = (estado: string, extra: Record<string, unknown> = {}) =>
    admin.from("producto_alta_portal").update({ estado, updated_at: new Date().toISOString(), ...extra }).eq("id", fila.id);

  let texto: string;
  try {
    texto = await pedir(cookie, `${BASE}/agregar_producto.php`, new URLSearchParams(sobre),
      { extra: { Referer: `${BASE}/agregar_producto.php` } });
  } catch (e) {
    // No se sabe si llegó: la fila queda tomada para que no se mande a ciegas.
    await marcar("sin_verificar", { error: `Sin respuesta: ${(e as Error)?.message ?? e}` });
    return { error: "El sistema no contestó. Puede haberse creado: NO lo vuelvas a crear; búscalo primero." };
  }
  let j: any = null;
  try { j = JSON.parse(texto); } catch { /* abajo */ }
  if (!j) {
    await marcar("sin_verificar", { error: `Respuesta ilegible: ${texto.slice(0, 4000)}` });
    return { error: "El sistema contestó algo que no se entiende. Puede haberse creado: NO lo vuelvas a crear; búscalo primero." };
  }
  if (String(j.typeinfo).toLowerCase() !== "success") {
    await marcar("fallido", { error: String(j.msg ?? "rechazado") });
    return { error: `El sistema no lo aceptó: ${j.msg ?? "sin motivo"}` };
  }
  const id = Number(j.id_producto);
  if (!(id > 0)) {
    await marcar("sin_verificar", { error: `Sin número de producto: ${texto.slice(0, 500)}` });
    return { error: "Se creó pero el sistema no dijo con qué número. Búscalo por nombre antes de volver a crearlo." };
  }

  // Leerlo de vuelta: que exista con ese nombre y tenga su presentación.
  const html = await pedir(cookie, `${BASE}/editar_producto.php?id_producto=${id}`, undefined, { extra: { Referer: `${BASE}/admin_producto.php` } });
  const leido = leerModelo(id, html);
  const notas: string[] = [];
  if (leido.nombre.toUpperCase() !== x.nombre) notas.push(`la ficha dice «${leido.nombre}»`);
  if (!leido.precios) notas.push("no tiene presentación de 1 unidad activa");
  else if (Math.abs(leido.precios[0] - x.precio) > 0.005) notas.push(`el precio quedó en $${leido.precios[0].toFixed(2)}`);
  await marcar(notas.length ? "sin_verificar" : "creado", { erp_product_id: id, error: notas.length ? notas.join(" · ") : null });

  const { error: eP } = await admin.rpc("upsert_products_minimal", { p_rows: [{ id, nombre: leido.nombre || x.nombre }] });
  if (eP) throw eP;
  return { creado: true, verificado: notas.length === 0, producto: { id, nombre: leido.nombre || x.nombre }, notas };
}

/** Las opciones de un <select> del formulario del sistema, sin «Seleccione». */
function opcionesDe(html: string, id: string): { value: string; label: string }[] {
  const m = new RegExp(`<select[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)</select>`).exec(html);
  return [...(m?.[1] ?? "").matchAll(/<option[^>]*value=["']([^"']+)["'][^>]*>([^<]*)</g)]
    .map((o) => ({ value: o[1], label: o[2].trim() })).filter((o) => o.value);
}

/**
 * El alta de un producto que la compra trae y Bodega no tiene.
 *
 * Pide lo MISMO que `agregar_producto.php` —proveedor, categoría,
 * laboratorio, marca, si vence, si es exento, si se vende por fracción, y la
 * presentación de 1 unidad con su costo y precio— pero llega prellenado:
 * - el proveedor es el de la factura;
 * - si el renglón se parece a un producto que ya existe, se copian de él la
 *   categoría, el laboratorio, la marca y las casillas, y el precio sugerido
 *   guarda su mismo margen;
 * - nombre y código de barras salen del renglón.
 * Todo se puede cambiar. Con `crear` lo da de alta; sin él sólo revisa.
 * Un producto regulado o antibiótico no se da de alta desde acá.
 */
/** Margen bajo: la MISMA regla del catálogo (`marginLabel`): menos de 15 %. */
const MARGEN_MINIMO = 15;

/**
 * Los renglones de la compra recién cargada cuyo costo SUBIÓ y cuyo precio de
 * venta actual deja menos de 15 % de margen (o pérdida). Se avisa a quien
 * tiene el permiso de ver costos —que es quien puede decidir un precio—, con
 * la lista: producto, costo de antes y de ahora, precio y margen.
 */
async function avisarMargenBajo(admin: any, revision: any, proveedor: string | null, compra: number | null) {
  const malos: { producto: string; antes: number; ahora: number; venta: number; margen: number }[] = [];
  for (const x of revision?.renglones ?? []) {
    const l = x?.linea;
    if (!l || l.bandera !== "PRODUCTO" || Number(l.id_producto) === PRODUCTO_ERRONEO) continue;
    const ahora = Number(l.compra), venta = Number(l.venta), antes = Number(x.costo_anterior);
    if (!(ahora > 0) || !(venta > 0) || !(antes > 0)) continue;
    if ((ahora - antes) / antes * 100 < 0.5) continue;
    const margen = (venta - ahora) / venta * 100;
    if (margen >= MARGEN_MINIMO) continue;
    malos.push({ producto: String(x.descripcion ?? l.id_producto), antes, ahora, venta, margen: Math.round(margen * 10) / 10 });
  }
  if (!malos.length) return;

  const { data: perm, error: eP } = await admin.from("role_permissions").select("role_id")
    .eq("module_key", "productos_ver_costos").eq("can_view", true);
  if (eP) throw eP;
  const { data: roles, error: eR } = await admin.from("roles").select("id, name").in("id", (perm ?? []).map((p: any) => p.role_id));
  if (eR) throw eR;
  const ids = (roles ?? []).filter((r: any) => !/^QA\b/i.test(r.name)).map((r: any) => r.id);
  if (!ids.length) return;
  const { data: gente, error: eG } = await admin.from("employees").select("id")
    .eq("status", "ACTIVO").or(`role_id.in.(${ids.join(",")}),secondary_role_id.in.(${ids.join(",")})`)
    .or("tipo_ficha.is.null,tipo_ficha.eq.empleado");
  if (eG) throw eG;
  if (!gente?.length) return;

  const m = (n: number) => `$${n.toFixed(2)}`;
  const lista = malos.slice(0, 8).map((x) =>
    `${x.producto}: costo ${m(x.antes)} → ${m(x.ahora)}, precio ${m(x.venta)}, margen ${x.margen} %`).join("; ");
  const { error } = await admin.rpc("notify_employees", {
    p_recipients: gente.map((e: any) => e.id), p_type: "COMPRA_MARGEN_BAJO",
    p_title: malos.length === 1 ? `Subió un costo y el margen quedó bajo` : `Subieron ${malos.length} costos y el margen quedó bajo`,
    p_body: `En la compra${compra ? ` ${compra}` : ""} de ${proveedor ?? "un proveedor"}: ${lista}`
      + (malos.length > 8 ? ` y ${malos.length - 8} más` : "") + ". Revisa el precio de venta.",
    p_link: "/compras?tab=productos", p_metadata: { origen: "cargar-compra", compra, productos: malos },
    p_push: true, p_branch_id: BODEGA_BRANCH_ID,
  });
  if (error) throw error;
}

type Erroneo = {
  renglon: number; descripcion: string; codigo_proveedor: string | null;
  product_id: number; es_generico: boolean; unidades: number; costo_unitario: number;
};

/**
 * Anota cada renglón erróneo y lo pasa del estante de Bodega al área de
 * vencidos con un traslado dentro de Bodega (origen = estante, destino =
 * Bodega, recibido en vencidos). Es el mismo movimiento con el que se reparó
 * la compra 6472 el 2026-10-30, que se midió unidad por unidad.
 *
 * Sólo se mueve si la compra se COMPROBÓ en el estante; si no, las filas
 * quedan `por_mover` con la razón, y nadie mueve a ciegas. La recepción se
 * comprueba leyendo la existencia de vencidos antes y después.
 */
async function apartarErroneos(admin: any, cookie: string, errs: Erroneo[], x: {
  cargaId: number; documentId: number; quien: string; emisor: { nit: string | null; nombre: string | null };
  erpCompra: number | null; lineas: LineaSobre[]; mover: boolean; estante: number;
}) {
  const { error: eI } = await admin.from("compra_renglon_erroneo").upsert(errs.map((e) => ({
    compra_carga_id: x.cargaId, document_id: x.documentId, renglon: e.renglon,
    emisor_nit: x.emisor.nit, emisor_nombre: x.emisor.nombre, descripcion: e.descripcion,
    codigo_proveedor: e.codigo_proveedor, product_id: e.product_id, es_generico: e.es_generico,
    unidades: e.unidades, costo_unitario: e.costo_unitario, erp_compra_id: x.erpCompra,
    marcado_por: x.quien, estado: "por_mover",
    nota: x.mover ? null : "La compra no se pudo comprobar en el estante: pasarlo a vencidos a mano.",
  })), { onConflict: "compra_carga_id,renglon" });
  if (eI) throw eI;
  if (!x.mover) return { movidos: 0, error: "La compra no se comprobó: los erróneos quedan por mover." };

  const nota = (texto: string) => admin.from("compra_renglon_erroneo")
    .update({ nota: texto, updated_at: new Date().toISOString() }).eq("compra_carga_id", x.cargaId).eq("estado", "por_mover");
  const vencidosUbic = await ubicacionDeBodega(admin, true);
  if (!vencidosUbic) { await nota("No se conoce el área de vencidos de Bodega."); return { movidos: 0, error: "No se conoce el área de vencidos." }; }

  // Un renglón por producto, con la presentación y el lote con que entró.
  const partes: string[] = [];
  let total = 0;
  const esperado = new Map<number, number>();
  for (const e of errs) {
    const l = x.lineas.find((y) => Number(y.id_producto) === e.product_id && Math.abs(Number(y.cant) * (Number(y.unidad) || 1) - e.unidades) < 1e-6);
    if (!l) { await nota("No se encontró su renglón en la compra."); return { movidos: 0, error: "No se encontró el renglón en la compra." }; }
    const f = await traerFila(cookie, e.product_id, x.estante);
    if (!f.presentaciones.some((p) => p.id === String(l.id_presentacion))) {
      await nota("Su presentación no aparece en el estante."); return { movidos: 0, error: "Presentación no encontrada en el estante." };
    }
    let idLote = "0";
    if (f.regulado) {
      const lote = f.lotes.find((z) => z.numero === String(l.numero_lote));
      if (!lote) { await nota(`Lote ${l.numero_lote} no encontrado en el estante.`); return { movidos: 0, error: "Lote no encontrado." }; }
      idLote = lote.id;
    }
    partes.push([e.product_id, l.compra, l.venta, l.cant, l.unidad, l.vence === "NULL" ? (f.vence || "") : l.vence, l.id_presentacion, idLote].join("|"));
    total += Number(l.compra) * Number(l.cant);
    esperado.set(e.product_id, (esperado.get(e.product_id) ?? 0) + e.unidades);
  }

  const pagina = await pedir(cookie, TRASLADO, undefined, { extra: { Referer: `${BASE}/dashboard.php` } });
  const vale = pagina.match(/numero_vale["'][^>]*value=["']([^"']+)["']/)?.[1] ?? "";
  if (!vale) { await nota("El sistema no entregó el número de vale."); return { movidos: 0, error: "Sin vale." }; }
  const antesVenc = await existenciasDeUbicacion(cookie, ERP_BODEGA, vencidosUbic);
  const antes = await pendientesDeOrigen(cookie, x.estante);
  const r = await pedir(cookie, TRASLADO, new URLSearchParams({
    process: "insert", datos: partes.join("#") + "#", id_traslado_guardado: "0", cuantos: String(partes.length),
    total: total.toFixed(4), fecha: hoySV(),
    concepto: armarConcepto(`PORTAL ERROR DEL PROVEEDOR COMPRA ${x.erpCompra ?? ""} ${x.emisor.nombre ?? ""} A VENCIDOS`).concepto,
    origen: String(x.estante), id_suc_destino: String(ERP_BODEGA), id_ubicacion_destino: "0", numero_vale: vale,
  }), { extra: { Referer: TRASLADO } });
  let ok = false;
  try { ok = String(JSON.parse(r)?.typeinfo).toLowerCase() === "success"; } catch { /* abajo */ }
  if (!ok) { await nota(`El sistema no aceptó el traslado: ${r.slice(0, 300)}`); return { movidos: 0, error: "El traslado a vencidos no entró." }; }
  const despues = await pendientesDeOrigen(cookie, x.estante);
  const { id: idT } = await identificarTrasladoNuevo(cookie, antes, despues, pagina, ERP_BODEGA, []);
  if (!idT) {
    await nota("Salió el traslado a vencidos pero no se pudo identificar su número: recibirlo a mano en vencidos.");
    return { movidos: 0, error: "Traslado sin identificar: recibirlo a mano." };
  }
  await admin.from("compra_renglon_erroneo").update({ erp_traslado_id: idT, updated_at: new Date().toISOString() })
    .eq("compra_carga_id", x.cargaId);

  // Recibirlo en vencidos, con lo que la propia pantalla de recepción muestra.
  const rec = await pedir(cookie, `${RECIBIR}?id_movimiento=${idT}`, undefined, { extra: { Referer: `${BASE}/admin_traslados.php` } });
  const filas: string[] = []; let tot = 0;
  for (const tr of [...rec.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/g)].map((m) => m[0]).filter((t) => /class="id_p"/.test(t))) {
    const idProd = tr.match(/class="id_p">\s*(\d+)/)?.[1] ?? "";
    const idPres = tr.match(/<select[^>]*class=['"]sel['"][^>]*>\s*<option[^>]*value=['"](\d+)['"]/)?.[1] ?? "";
    const compra = tr.match(/class=['"][^'"]*precio_compra[^'"]*['"][^>]*value=['"]\s*([\d.]+)/)?.[1] ?? "0";
    const venta = tr.match(/class=['"][^'"]*precio_venta[^'"]*['"][^>]*value=['"]\s*([\d.]+)/)?.[1] ?? "0";
    const unidad = tr.match(/class=['"]unidad['"][^>]*value=['"](\d+)/)?.[1] ?? "1";
    const esp = tr.match(/class=['"][^'"]*\besp\b[^'"]*['"][^>]*value=['"]\s*([\d.]+)/)?.[1] ?? "0";
    const vence = tr.match(/class=['"][^'"]*\bvence\b[^'"]*['"][^>]*value=['"]([^'"]*)['"]/)?.[1] ?? "";
    if (!idProd || !idPres) continue;
    filas.push([idProd, compra, venta, esp, unidad, vence, idPres, esp].join("|"));
    tot += Number(compra) * Number(esp);
  }
  if (filas.length !== partes.length) {
    await nota(`El traslado ${idT} quedó sin recibir: recibirlo a mano en vencidos.`);
    return { movidos: 0, traslado: idT, error: "No se pudo leer la recepción." };
  }
  const r2 = await pedir(cookie, RECIBIR, new URLSearchParams({
    process: "insert", datos: filas.join("#") + "#", cuantos: String(filas.length), total: tot.toFixed(4),
    fecha: hoySV(), concepto: `PORTAL ERROR DEL PROVEEDOR (TRASLADO ${idT})`, destino: String(vencidosUbic), id_traslado: idT,
  }), { extra: { Referer: RECIBIR } });
  let ok2 = false;
  try { ok2 = String(JSON.parse(r2)?.typeinfo).toLowerCase() === "success"; } catch { /* abajo */ }

  // Comprobarlo en vencidos: cada producto tiene que haber subido lo marcado.
  const despuesVenc = await existenciasDeUbicacion(cookie, ERP_BODEGA, vencidosUbic);
  const entro = ok2 && antesVenc && despuesVenc && [...esperado].every(([id, u]) =>
    (despuesVenc.get(id) ?? 0) - (antesVenc.get(id) ?? 0) >= u - 1e-6);
  if (!entro) {
    await nota(`El traslado ${idT} no se pudo comprobar en vencidos: revisarlo.`);
    return { movidos: 0, traslado: idT, error: "No se comprobó en vencidos." };
  }
  const { error: eU } = await admin.from("compra_renglon_erroneo")
    .update({ estado: "en_vencidos", nota: null, updated_at: new Date().toISOString() }).eq("compra_carga_id", x.cargaId);
  if (eU) throw eU;
  return { movidos: errs.length, traslado: idT };
}

const NOTA_CREDITO = `${BASE}/nota_credito_compras.php`;

/**
 * Registra una nota de crédito de compra en el libro de compras del sistema,
 * como su pantalla «Nota crédito compras»: primero sube el JSON del documento
 * (`process=automatic`), que el propio sistema lee y devuelve campo por campo;
 * después manda `process=insertar` con lo que devolvió. Así los números salen
 * del lector del sistema y no de uno escrito acá.
 *
 * Se reproduce el envío del formulario TAL CUAL, defectos incluidos: su JS arma
 * `&numDocRelacionado` SIN «=» (la clave queda pegada al valor) y
 * `clase_documento_tributario ` con un espacio. Así queda igual que si la
 * cargara una persona.
 *
 * Se comprueba leyendo el libro (CSV) del mes de la nota y buscando su número.
 */
async function registrarNotaEnLibro(admin: any, cookie: string, notaId: number, quien: string) {
  const { data: previa, error: eP } = await admin.from("compra_nota_credito_libro").select("estado").eq("document_id", notaId).maybeSingle();
  if (eP) throw eP;
  if (previa?.estado === "registrada") return { ok: true, ya: true };
  if (previa && previa.estado !== "fallida") return { ok: false, error: "La nota quedó a medio registrar en el libro: revisarla a mano antes de seguir." };

  const { data: n, error: eN } = await admin.from("purchase_dte_documents")
    .select("id, tipo_dte, numero_control, codigo_generacion, fecha_emision, json_path").eq("id", notaId).maybeSingle();
  if (eN) throw eN;
  if (!n || n.tipo_dte !== "05") return { ok: false, error: "Eso no es una nota de crédito." };
  const path = pathDeStorage(n.json_path);
  if (!path) return { ok: false, error: "La nota no tiene su archivo." };
  const { data: blob, error: eB } = await admin.storage.from("purchase-dte").download(path);
  if (eB || !blob) throw new Error(`No se pudo leer el archivo de la nota: ${eB?.message}`);
  const dte = desenvolver(JSON.parse(await blob.text()));

  const fila = { document_id: notaId, erp_sucursal_id: ERP_BODEGA, estado: "enviando", registrada_por: quien, error: null, datos: null };
  const { error: eT } = previa
    ? await admin.from("compra_nota_credito_libro").update({ ...fila, updated_at: new Date().toISOString() }).eq("document_id", notaId).eq("estado", "fallida")
    : await admin.from("compra_nota_credito_libro").insert(fila);
  if (eT) {
    if (eT.code === "23505") return { ok: false, error: "Otra persona está registrando esta nota." };
    throw eT;
  }
  const marcar = (estado: string, extra: Record<string, unknown> = {}) =>
    admin.from("compra_nota_credito_libro").update({ estado, updated_at: new Date().toISOString(), ...extra }).eq("document_id", notaId);

  // 1. El sistema lee el JSON.
  const fd = new FormData();
  fd.set("json_ret", new Blob([JSON.stringify(dte)], { type: "application/json" }), `${n.codigo_generacion ?? notaId}.json`);
  fd.set("process", "automatic");
  fd.set("id_sucursal2", String(ERP_BODEGA));
  let leido: any;
  try {
    const r = await fetch(NOTA_CREDITO, {
      method: "POST", body: fd,
      headers: { Cookie: cookie, "User-Agent": "Mozilla/5.0", "X-Requested-With": "XMLHttpRequest", Referer: NOTA_CREDITO },
      signal: AbortSignal.timeout(60_000),
    });
    const t = await r.text();
    try { leido = JSON.parse(t); } catch { leido = null; }
    if (!leido?.numero_documento) {
      await marcar("fallida", { error: `El sistema no leyó la nota: ${t.slice(0, 1000)}` });
      return { ok: false, error: `El sistema no leyó la nota: ${String(leido?.msg ?? t.slice(0, 200))}` };
    }
  } catch (e) {
    await marcar("fallida", { error: `Sin respuesta al leerla: ${(e as Error)?.message ?? e}` });
    return { ok: false, error: "El sistema no contestó al leer la nota." };
  }
  if (!String(leido.numControl_DocRelacionado ?? "").trim()) {
    await marcar("fallida", { error: "La nota no trae el documento que corrige.", datos: leido });
    return { ok: false, error: "La nota no dice qué factura corrige: el sistema no la acepta así." };
  }

  // 2. Insertar con lo que el sistema leyó, como su formulario.
  const v = (x: unknown) => encodeURIComponent(String(x ?? ""));
  let cuerpo = "process=insertar" + "&fecha=" + v(leido.fecha_retencion);
  cuerpo += "&agente=" + v(leido.agente) + "&numero_doc=" + v(leido.numero_documento);
  cuerpo += "&numero_serie=" + v(leido.serie_documento);
  cuerpo += "&tipo_doc=" + v(leido.tipo_documento) + "&nit=" + v(leido.nit_agente) + "&nrc=" + v(leido.nrc);
  cuerpo += "&numDocRelacionado" + v(leido.numControl_DocRelacionado);
  cuerpo += "&subtotal=" + v(leido.subTotal);
  cuerpo += "&monto_total=" + v(leido.montoTotalOperacion);
  cuerpo += "&total_impuestos=" + v(leido.total_impuestos);
  cuerpo += "&tipo_operacion=1&clasificacion=1&tipo_costo_gasto=5";
  cuerpo += "&clase_documento_tributario%20=4";
  let resp = "";
  try {
    const r = await fetch(NOTA_CREDITO, {
      method: "POST", body: cuerpo,
      headers: { Cookie: cookie, "User-Agent": "Mozilla/5.0", "X-Requested-With": "XMLHttpRequest", Referer: NOTA_CREDITO,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      signal: AbortSignal.timeout(60_000),
    });
    resp = await r.text();
  } catch (e) {
    await marcar("sin_verificar", { datos: leido, error: `Sin respuesta al registrar: ${(e as Error)?.message ?? e}` });
    return { ok: false, error: "El sistema no contestó al registrar la nota: puede haber entrado, revisar el libro antes de reintentar." };
  }
  let j: any = null;
  try { j = JSON.parse(resp); } catch { /* abajo */ }
  if (j && String(j.typeinfo).toLowerCase() !== "success") {
    await marcar("fallida", { datos: leido, error: String(j.msg ?? resp.slice(0, 500)) });
    return { ok: false, error: `El sistema no aceptó la nota: ${j.msg ?? "sin motivo"}` };
  }

  // 3. Comprobarla en el libro del mes.
  const mes = String(n.fecha_emision).slice(0, 7);
  const fin = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).toISOString().slice(0, 10);
  let enLibro = false;
  try {
    const csv = await pedir(cookie, `${BASE}/libro_compras_iva_csv.php?fechaInicio=${mes}-01&fechaFin=${fin}`, undefined, { timeoutMs: 90_000 });
    const numero = String(leido.numero_documento).replace(/-/g, "").toUpperCase().slice(0, 16);
    enLibro = csv.split(/\r?\n/).some((l) => l.replace(/-/g, "").toUpperCase().includes(numero));
  } catch { /* abajo */ }
  await marcar(enLibro ? "registrada" : "sin_verificar", { datos: leido, error: enLibro ? null : `No apareció en el libro de ${mes}: ${resp.slice(0, 300)}` });
  return enLibro ? { ok: true } : { ok: false, error: "Se mandó la nota pero no aparece en el libro: revisarla antes de reintentar." };
}

/**
 * Le da salida a un producto erróneo cuando su nota de crédito ya está:
 * 1. registra la nota en el libro de compras (si no estaba);
 * 2. lo descarga de Bodega de vencidos como DESCARTE (usuario, 2026-10-30),
 *    con un concepto que dice proveedor, nota y compra;
 * 3. lo comprueba leyendo la existencia de vencidos antes y después.
 */
async function darSalidaErroneo(admin: any, id: number, quien: string) {
  if (!Number.isFinite(id)) return { error: "Falta el renglón." };
  const { data: tomadas, error: eT } = await admin.from("compra_renglon_erroneo")
    .update({ estado: "saliendo", updated_at: new Date().toISOString() })
    .eq("id", id).eq("estado", "con_nota").not("erp_traslado_id", "is", null).select("*");
  if (eT) throw eT;
  const e = tomadas?.[0];
  if (!e) return { error: "Ese producto no está listo para salir (tiene que estar en vencidos y con su nota de crédito)." };
  const volver = (nota: string) => admin.from("compra_renglon_erroneo")
    .update({ estado: "con_nota", nota, updated_at: new Date().toISOString() }).eq("id", id);

  try {
    const cookie = await sesionEn(ERP_BODEGA, login);
    const libro = await registrarNotaEnLibro(admin, cookie, Number(e.nota_credito_document_id), quien);
    if (!libro.ok) { await volver(libro.error ?? "No se pudo registrar la nota."); return { error: libro.error }; }

    const vencidos = await ubicacionDeBodega(admin, true);
    if (!vencidos) { await volver("No se conoce el área de vencidos."); return { error: "No se conoce el área de vencidos." }; }
    const antes = await existenciasDeUbicacion(cookie, ERP_BODEGA, vencidos);
    const { data: nc } = await admin.from("purchase_dte_documents").select("numero_control").eq("id", e.nota_credito_document_id).maybeSingle();
    const concepto = armarConcepto(
      `DEVOLUCION A ${e.emisor_nombre ?? "PROVEEDOR"} - NOTA DE CREDITO ${nc?.numero_control ?? ""} - COMPRA ${e.erp_compra_id ?? ""} - ${e.descripcion}`,
    ).concepto;
    const r = await descartarUnaLinea({
      erpSucursal: ERP_BODEGA, erpUbicacion: vencidos, concepto, iden: "DESCARTE",
      linea: { erp_product_id: Number(e.product_id), presentacion_tipo: "", factor: 1, cantidad: Number(e.unidades), descripcion: e.descripcion },
    });
    if (!r.ok) { await volver(r.error); return { error: r.error }; }
    const despues = await existenciasDeUbicacion(cookie, ERP_BODEGA, vencidos);
    const bajo = antes && despues ? (antes.get(Number(e.product_id)) ?? 0) - (despues.get(Number(e.product_id)) ?? 0) : null;
    const comprobado = bajo != null && bajo >= Number(e.unidades) - 1e-6;
    const { error: eU } = await admin.from("compra_renglon_erroneo").update({
      estado: "salio", salida: { ...r.aplicado, comprobado, bajo },
      nota: comprobado ? null : "Se descargó, pero la existencia de vencidos no bajó lo esperado: revisarlo.",
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    if (eU) throw eU;
    return { ok: true, comprobado };
  } catch (err) {
    await volver(`Falló: ${(err as Error)?.message ?? err}`);
    throw err;
  }
}

async function productoNuevo(admin: any, body: any, creaQuien: string | null = null) {
  const problemas: string[] = [];
  const nombre = String(body?.nombre ?? "").replace(/\s+/g, " ").trim().toUpperCase();
  const barcode = String(body?.barcode ?? "").trim();
  const modeloId = Number(body?.modelo_id) || null;
  const costo = Number(body?.costo);
  const precioPedido = Number(body?.precio);

  const cookie = await sesionEn(ERP_BODEGA, login);
  const form = await pedir(cookie, `${BASE}/agregar_producto.php`, undefined, { extra: { Referer: `${BASE}/admin_producto.php` } });
  const catalogos = {
    proveedores: opcionesDe(form, "proveedor"),
    categorias: opcionesDe(form, "id_categoria"),
    laboratorios: opcionesDe(form, "id_laboratorio"),
  };
  if (!catalogos.categorias.length) return { error: "No se pudo leer el formulario de productos del sistema." };

  // Lo que se sugiere: el parecido, y el proveedor de la factura.
  let m: any = null, html = "";
  if (modeloId) {
    html = await pedir(cookie, `${BASE}/editar_producto.php?id_producto=${modeloId}`, undefined, { extra: { Referer: `${BASE}/admin_producto.php` } });
    m = leerModelo(modeloId, html);
    if (!m.nombre) m = null;
  }
  let provFactura: string | null = null;
  if (body?.document_id) {
    const { data: d, error: eD } = await admin.from("purchase_dte_documents").select("emisor_nit").eq("id", Number(body.document_id)).maybeSingle();
    if (eD) throw eD;
    if (d?.emisor_nit) {
      const { data: pm, error: eP } = await admin.from("proveedores_maestro").select("supplier_id").eq("nit", d.emisor_nit).maybeSingle();
      if (eP) throw eP;
      if (pm?.supplier_id) {
        const { data: su, error: eS } = await admin.from("suppliers").select("erp_supplier_id").eq("id", pm.supplier_id).maybeSingle();
        if (eS) throw eS;
        if (su?.erp_supplier_id) provFactura = String(su.erp_supplier_id);
      }
    }
  }
  const sugerido = {
    proveedor: provFactura ?? m?.proveedor ?? "",
    categoria: m?.categoria ?? "",
    laboratorio: m?.laboratorio ?? "",
    marca: m?.marca ?? "",
    perecedero: m?.perecedero ?? true,
    exento: m?.exento ?? false,
    decimal: m?.decimal ?? false,
  };
  // El precio que guarda el margen del parecido (sólo si hay costo y precio leídos).
  const margenModelo = m?.precios?.[0] > 0 && m?.costo > 0 ? 1 - m.costo / m.precios[0] : null;
  const precioSugerido = costo > 0 && margenModelo != null && margenModelo > 0 && margenModelo < 0.9
    ? Math.round((costo / (1 - margenModelo)) * 100) / 100 : null;

  const dato = (k: keyof typeof sugerido) => (body?.[k] !== undefined && body?.[k] !== null ? body[k] : sugerido[k]);
  const valores = {
    proveedor: String(dato("proveedor") ?? ""), categoria: String(dato("categoria") ?? ""),
    laboratorio: String(dato("laboratorio") ?? ""), marca: String(dato("marca") ?? "").trim().toUpperCase(),
    perecedero: Boolean(dato("perecedero")), exento: Boolean(dato("exento")), decimal: Boolean(dato("decimal")),
  };
  const precio = precioPedido > 0 ? precioPedido : (precioSugerido ?? 0);

  if (nombre.length < 4 || nombre.length > 120) problemas.push("El nombre tiene que tener entre 4 y 120 letras.");
  if (barcode && !/^\d{8,14}$/.test(barcode)) problemas.push("El código de barras son de 8 a 14 dígitos.");
  if (!(costo > 0)) problemas.push("Falta el costo por unidad.");
  if (!(precio > 0)) problemas.push("Falta el precio de venta.");
  else if (costo > 0 && precio <= costo) problemas.push(`El precio ($${precio.toFixed(2)}) no es mayor que el costo ($${costo.toFixed(4)}).`);
  const en = (lista: { value: string }[], v: string) => lista.some((o) => o.value === v);
  if (!en(catalogos.proveedores, valores.proveedor)) problemas.push("Elige el proveedor.");
  if (!en(catalogos.categorias, valores.categoria)) problemas.push("Elige la categoría.");
  if (!en(catalogos.laboratorios, valores.laboratorio)) problemas.push("Elige el laboratorio.");
  // Un producto controlado no se da de alta copiando: lo que lo hace
  // controlado es justo lo que hay que decidir con cuidado.
  if (m && (m.regulado || m.antibiotico)) problemas.push(`«${m.nombre}» es regulado o antibiótico: un producto así se da de alta a mano.`);

  // Que no exista ya: el mismo código de barras, o el mismo nombre.
  const { data: iguales, error: eI } = await admin.from("products").select("id, nombre, codigo_barras")
    .or([barcode ? `codigo_barras.eq.${barcode}` : null, `nombre.ilike.${nombre.replace(/[,()]/g, " ")}`].filter(Boolean).join(","))
    .limit(3);
  if (eI) throw eI;
  const existentes = (iguales ?? []).map((x: any) => ({ id: x.id, nombre: x.nombre }));
  for (const x of existentes) problemas.push(`Ya existe: ${x.nombre} (${x.id}).`);

  const base = {
    id: 0, nombre: "", regulado: false, antibiotico: false, precios: m?.precios ?? null,
    proveedor: valores.proveedor, categoria: valores.categoria, laboratorio: valores.laboratorio,
    marca: valores.marca, perecedero: valores.perecedero, exento: valores.exento, decimal: valores.decimal,
  };
  const sobre = sobreDeProductoNuevo(base as any, { nombre, barcode, costo: costo > 0 ? costo : 0, precio: precio > 0 ? precio : 0 });
  if (creaQuien) {
    if (problemas.length) return { error: problemas.join(" ") };
    return await crearProducto(admin, cookie, sobre, { nombre, barcode, modeloId: modeloId ?? 0, costo, precio, quien: creaQuien });
  }
  return {
    simulacro: true,
    catalogos: body?.catalogos ? catalogos : undefined,
    revision: {
      problemas, listo: problemas.length === 0, existentes,
      nombre, barcode: barcode || null, valores, sugerido, precio, precio_sugerido: precioSugerido,
      modelo: m ? { id: m.id, nombre: m.nombre } : null,
      precios: sobre.lista.split(",").slice(7).join(",").replace(/;$/, "").split("#").filter(Boolean).map(Number),
    },
  };
}

Deno.serve(async (req: Request) => {
  const cors = { ...getCorsHeaders(req), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response(null, { headers: getCorsHeaders(req) });
  const responder = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: cors });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const quien = await requireActiveEmployeeUser(req, admin);
  if (!quien) return responder({ error: "Sesión no válida." }, 401);
  const permiso = await permisoDeModulo(admin, quien.id, "cargar_compra", "can_edit");
  if (permiso.roto) return responder({ error: permiso.roto }, 500);
  if (!permiso.puede) return responder({ error: "No tienes permiso para cargar compras." }, 403);

  try {
    const body = await req.json().catch(() => ({}));
    const documentId = Number(body?.document_id);
    const uso = body?.uso === "consumo" ? "consumo" : "venta";
    const decisiones: Record<string, { product_id?: number; factor?: number; lote?: string; vence?: string }> =
      body?.renglones ?? {};
    const diasCredito = Number.isFinite(Number(body?.dias_credito)) ? Math.max(0, Math.trunc(Number(body.dias_credito))) : null;
    const enviar = body?.enviar === true;
    if (enviar && Deno.env.get("CARGA_COMPRA_ENVIO") !== "on") {
      return responder({ error: "El envío a Bodega todavía no está encendido." }, 409);
    }
    if (body?.accion === "erroneo_salida") return responder(await darSalidaErroneo(admin, Number(body?.id), quien.id));
    if (body?.accion === "producto_nuevo") return responder(await productoNuevo(admin, body, body?.crear === true ? quien.id : null));
    if (!Number.isFinite(documentId)) return responder({ error: "Falta el documento." }, 400);

    // ── El documento y su proveedor ──────────────────────────────────────────
    const { data: d, error: eD } = await admin.from("purchase_dte_documents")
      .select("id, codigo_generacion, numero_control, tipo_dte, emisor_nit, emisor_nombre, fecha_emision, json_path, sello_recibido, invalidado")
      .eq("id", documentId).maybeSingle();
    if (eD) throw eD;
    if (!d) return responder({ error: "Ese documento no existe." }, 404);

    const problemas: Problema[] = [];
    if (d.invalidado) problemas.push({ renglon: null, texto: "El emisor invalidó este documento." });
    const tipoDoc = tipoDocDe(d.tipo_dte);
    if (!tipoDoc) return responder({ error: `Tipo de documento ${d.tipo_dte} no se carga como compra.` }, 400);

    // ¿Ya está cargado? Las mismas cuatro igualdades de `get_documentos_sin_cargar`.
    const cod = String(d.codigo_generacion ?? "").toUpperCase();
    const candidatos = [...new Set([cod, cod.slice(0, 20), cod.replace(/-/g, "").slice(0, 20)])];
    const { data: recibos, error: eR } = await admin.from("purchase_receipts")
      .select("id, erp_purchase_id, documento_numero, sello_recibido, estado")
      .or([
        d.sello_recibido ? `sello_recibido.eq.${d.sello_recibido}` : null,
        ...candidatos.map((c) => `documento_numero.ilike.${c}`),
      ].filter(Boolean).join(","));
    if (eR) throw eR;
    const yaCargada = (recibos ?? []).filter((r: any) => (r.estado ?? "") !== "anulada"
      && ((d.sello_recibido && r.sello_recibido === d.sello_recibido) || candidatos.includes(normNum(r.documento_numero ?? ""))));
    if (yaCargada.length) {
      problemas.push({ renglon: null, texto: `Ya está registrada (compra ${yaCargada.map((r: any) => r.erp_purchase_id).join(", ")}).` });
    }
    const { data: viva, error: eV } = await admin.from("compra_carga").select("id, estado")
      .eq("document_id", documentId).in("estado", ["enviando", "verificada", "sin_verificar"]).maybeSingle();
    if (eV) throw eV;
    if (viva) problemas.push({ renglon: null, texto: "Ya se mandó desde el portal." });

    const { data: prov, error: eP } = await admin.from("proveedores_maestro")
      .select("nombre, supplier_id").eq("nit", d.emisor_nit).maybeSingle();
    if (eP) throw eP;
    let erpProveedor: number | null = null;
    if (prov?.supplier_id) {
      const { data: s, error: eS } = await admin.from("suppliers").select("erp_supplier_id").eq("id", prov.supplier_id).maybeSingle();
      if (eS) throw eS;
      erpProveedor = s?.erp_supplier_id ?? null;
    }
    if (!erpProveedor) problemas.push({ renglon: null, texto: "El proveedor no está registrado en el catálogo de proveedores." });

    const path = pathDeStorage(d.json_path);
    if (!path) return responder({ error: "El documento no tiene su archivo." }, 400);
    const { data: blob, error: eB } = await admin.storage.from("purchase-dte").download(path);
    if (eB || !blob) throw new Error(`No se pudo leer el archivo: ${eB?.message}`);
    const dte = desenvolver(JSON.parse(await blob.text()));
    const items: any[] = Array.isArray(dte?.cuerpoDocumento) ? dte.cuerpoDocumento : [];
    if (!items.length) return responder({ error: "El documento no trae renglones." }, 400);

    // ── El sistema: sólo lecturas ────────────────────────────────────────────
    const cookie = await sesionEn(ERP_BODEGA, login);
    let tasa = 0;
    if (erpProveedor) {
      const t = await pedir(cookie, COMPRAS, new URLSearchParams({ process: "datos_proveedores", id_proveedor: String(erpProveedor) }),
        { extra: { Referer: COMPRAS } });
      try { tasa = Number(JSON.parse(t)?.percepcion) || 0; } catch { problemas.push({ renglon: null, texto: "No se pudo leer la percepción del proveedor." }); }
    }

    const cache = new Map<number, ProductoDelSistema | null>();
    const lineas: LineaSobre[] = [];
    const detalle: unknown[] = [];
    const cobrado: number[] = [];
    const erroneos: Erroneo[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const r: RenglonDoc = {
        descripcion: String(it?.descripcion ?? ""),
        cantidad: Number(it?.cantidad), precio: Number(it?.precioUni),
        descuento: Number(it?.montoDescu ?? 0),
        exento: Number(it?.ventaExenta ?? 0) > 0,
        subtotal: Number(it?.ventaGravada ?? 0) + Number(it?.ventaExenta ?? 0) + Number(it?.ventaNoSuj ?? 0),
      };
      let dec: Decision;
      if (uso === "consumo") dec = { tipo: "consumo" };
      else {
        const x = decisiones[String(i)] ?? {};
        // Error del proveedor: entra igual (la factura lo cobra) y después se
        // pasa a vencidos. Sin producto propio, como el genérico.
        const erroneo = (x as any).erroneo === true;
        const elegido = Number(x.product_id);
        const pid = erroneo && !(elegido > 0) ? PRODUCTO_ERRONEO : elegido;
        if (!Number.isFinite(pid) || pid <= 0) {
          problemas.push({ renglon: i, texto: `«${r.descripcion}» no tiene producto elegido.` });
          detalle.push({ renglon: i, descripcion: r.descripcion, error: "sin producto" });
          continue;
        }
        if (!cache.has(pid)) cache.set(pid, await productoDelSistema(cookie, pid));
        const producto = cache.get(pid);
        if (!producto) {
          problemas.push({ renglon: i, texto: `El producto ${pid} no existe en Bodega.` });
          detalle.push({ renglon: i, descripcion: r.descripcion, error: "producto inexistente" });
          continue;
        }
        dec = {
          tipo: "producto", producto, factor: pid === PRODUCTO_ERRONEO ? 1 : (Number(x.factor) || 1),
          lote: x.lote ?? null, vence: x.vence ?? null,
        };
      }
      const res = lineaDelSobre(i, r, dec);
      problemas.push(...res.problemas);
      if (res.linea && dec.tipo === "producto" && (decisiones[String(i)] as any)?.erroneo === true) {
        const u = Number(res.linea.unidad) || 1;
        erroneos.push({
          renglon: i, descripcion: r.descripcion, codigo_proveedor: String(it?.codigo ?? "") || null,
          product_id: Number(res.linea.id_producto), es_generico: Number(res.linea.id_producto) === PRODUCTO_ERRONEO,
          unidades: Number(res.linea.cant) * u, costo_unitario: Math.round((Number(res.linea.compra) / u) * 1e4) / 1e4,
        });
      }
      if (res.linea) { lineas.push(res.linea); cobrado.push(Number(r.subtotal) || 0); }
      detalle.push({ renglon: i, descripcion: r.descripcion, linea: res.linea, ...(res.detalle ?? {}) });
    }

    const regalos = repartirRegalos(lineas, cobrado);
    const tot = totalesDelSobre(lineas, tipoDoc, tasa);
    const totalDoc = totalDelDocumento(dte?.resumen);
    const diferencia = totalDoc == null ? null : Math.round((Number(tot.total) - totalDoc) * 100) / 100;
    if (diferencia == null) problemas.push({ renglon: null, texto: "El documento no trae su total." });
    // Sólo con TODOS los renglones armados: con uno sin producto el total
    // sale corto por construcción, y decirlo repite el problema de arriba.
    else if (lineas.length === items.length && Math.abs(diferencia) > TOLERANCIA) {
      problemas.push({ renglon: null, texto: `El total armado ($${tot.total}) no cuadra con el del documento ($${totalDoc.toFixed(2)}).` });
    }

    const estanteBodega = await ubicacionDeBodega(admin, false);
    if (!estanteBodega) problemas.push({ renglon: null, texto: "No se conoce la ubicación de Bodega donde entra la compra." });
    const sobre = {
      process: "insert", datos: "", json_arr: JSON.stringify(lineas), cuantos: 0,
      // La fecha de EMISIÓN del documento (usuario, 2026-10-29). El sistema
      // la devuelve como `documento.fecha_emision` y el libro de compras va
      // por ella. Bodega venía poniendo el día de la carga —el default del
      // formulario: 688 de 710 compras desde agosto, 1 a 7 días después—, lo
      // que corre la factura de mes cuando llega a fin de mes.
      total: tot.total, fecha: String(d.fecha_emision).slice(0, 10),
      concepto: uso === "consumo" ? "COMPRA PARA CONSUMO" : "COMPRA DE PRODUCTO",
      destino: String(estanteBodega ?? ""), proveedor: String(erpProveedor ?? ""),
      // El código COMPLETO (usuario, 2026-10-29). Ojo: el sistema hoy guarda
      // 20 caracteres —616 de 710 compras desde septiembre miden exactamente
      // 20, ninguna más—, o sea que probablemente lo recorte; por eso la
      // verificación compara por el comienzo y no por igualdad.
      tipo_doc: tipoDoc, numero_doc: cod,
      // `subtotal` viaja VACÍO: el formulario lo lee de `#subtotal`, que no
      // existe en la página, y jQuery lo manda como cadena vacía.
      sumas_sin_iva: tot.sumas_sin_iva, subtotal: "", iva: tot.iva,
      venta_exenta: tot.venta_exenta, total_percepcion: tot.total_percepcion,
      // `id_compra` va en "0", como el campo oculto `id_compra_g` del
      // formulario. Vacío, el sistema arma consultas que terminan en `=` y
      // revienta con «error in your SQL syntax near ''» — fue la primera
      // prueba real (29-oct, C. Imberton): no se creó ninguna compra.
      dias_credito: diasCredito ?? 0, id_compra: "0", total_renta_retenida: "0.00",
      json_imp_arr: [],
      // Consumo: Gasto de administración. Venta: Costo, costo interno — lo que
      // el propio formulario pone solo al elegir «Gravada».
      tipo_operacion: "1",
      clasificacion: uso === "consumo" ? "2" : "1",
      tipo_costo_gasto: uso === "consumo" ? "2" : "5",
      total_fovial: 0, total_cotrans: 0,
      clase_documento_tributario: "4", numero_serie: "",
    };

    // Los totales lado a lado, para que la persona los compare con la factura
    // y no sólo vea «cuadra»: lo que dice el documento contra lo que se carga.
    const res = dte?.resumen ?? {};
    const n2 = (v: unknown) => (v == null || v === "" ? null : Math.round(Number(v) * 100) / 100);
    const ivaDoc = Array.isArray(res.tributos)
      ? res.tributos.filter((t: any) => String(t?.codigo) === "20").reduce((a: number, t: any) => a + Number(t?.valor ?? 0), 0)
      : null;
    const totales = {
      documento: {
        gravada: n2(res.totalGravada), exenta: n2(Number(res.totalExenta ?? 0) + Number(res.totalNoSuj ?? 0)),
        descuento: n2(res.totalDescu), iva: n2(ivaDoc ?? res.totalIva),
        percepcion: n2(res.ivaPerci1 ?? 0), retencion: n2(Number(res.ivaRete1 ?? 0) + Number(res.reteRenta ?? 0)),
        total: totalDoc,
      },
      carga: {
        gravada: n2(tot.sumas_sin_iva), exenta: n2(tot.venta_exenta), descuento: null,
        iva: n2(tot.iva), percepcion: n2(tot.total_percepcion), retencion: null,
        total: n2(tot.total),
      },
    };

    const revision = { regalos, totales,
      problemas, listo: problemas.length === 0,
      total_documento: totalDoc, total_armado: Number(tot.total), diferencia,
      percepcion_proveedor: tasa, renglones: detalle, erroneos,
    };
    if (enviar) return responder(await enviarCompra(admin, {
      cookie, documentId, cargaId: Number(body?.carga_id), sobre, revision, lineas, erpProveedor: erpProveedor!,
      quien: quien.id, emisor: { nit: d.emisor_nit, nombre: d.emisor_nombre },
    }));

    const { data: fila, error: eI } = await admin.from("compra_carga").insert({
      document_id: documentId, estado: "simulada", uso, sobre, revision, creado_por: quien.id,
    }).select("id").single();
    if (eI) throw eI;

    return responder({ simulacro: true, carga_id: fila.id, sobre, revision });
  } catch (e: any) {
    console.error("[cargar-compra-erp]", e?.message ?? e);
    return responder({ error: e?.message ?? String(e) }, 500);
  }
});
