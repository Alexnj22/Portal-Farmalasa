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
import { sesionEn } from "../_shared/erp-traslado.ts";
import {
  type Decision, type LineaSobre, type Problema, type ProductoDelSistema, type RenglonDoc,
  lineaDelSobre, tipoDocDe, totalDelDocumento, totalesDelSobre, leerModelo, sobreDeProductoNuevo, repartirRegalos,
} from "../_shared/compraSobre.ts";

const COMPRAS = `${BASE}/compras.php`;
const ERP_BODEGA = 6;
const BODEGA_BRANCH_ID = 30; // la de `sync-erp-purchases`
const TOLERANCIA = 0.05;

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

  // Freno 2b: que Bodega no la tenga YA. `purchase_receipts` (freno de la
  // revisión) es un espejo que va hasta 10 minutos atrás, y Bodega carga con el
  // día de la carga mientras el portal manda la emisión: se mira en vivo, de la
  // emisión a hoy, en la lista liviana. Si no se puede mirar, no se manda.
  const yaEsta = await yaEnBodega(x.cookie, String(x.sobre.fecha), String(x.sobre.numero_doc))
    .catch((e) => ({ error: String(e?.message ?? e) }));
  if ("error" in yaEsta) return { enviada: false, error: `No se pudo comprobar si Bodega ya la tiene: ${yaEsta.error}` };
  if (yaEsta.compra) return { enviada: false, error: `Bodega ya la tiene cargada (compra ${yaEsta.compra}): no se mandó.` };

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
    await marcar("sin_verificar", { error: `Respuesta ilegible: ${texto.slice(0, 300)}` });
    return { enviada: null, error: "El sistema contestó algo que no se entiende. Puede haber entrado: NO la mandes de nuevo." };
  }
  if (String(j.typeinfo).toLowerCase() !== "success") {
    await marcar("fallida", { error: String(j.msg ?? "rechazada") });
    return { enviada: false, error: `El sistema no la aceptó: ${j.msg ?? "sin motivo"}` };
  }

  // ── Leerla de vuelta ───────────────────────────────────────────────────────
  const verif = await leerDeVuelta(x.cookie, x.sobre, x.lineas, x.erpProveedor).catch((e) => ({ ok: false, compra: null, notas: [`No se pudo leer de vuelta: ${e?.message ?? e}`] }));
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
  return { enviada: true, verificada: verif.ok, erp_compra_id: verif.compra, notas: verif.notas, msg: j.msg ?? null };
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
function textoElegido(html: string, id: string): string | null {
  const m = new RegExp(`<select[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)</select>`).exec(html);
  const o = m && /<option[^>]*\bselected\b[^>]*>([^<]*)</.exec(m[1]);
  return o ? o[1].trim() : null;
}

/**
 * Producto nuevo copiando a uno parecido — SIMULACRO. Lee la pantalla de
 * edición del modelo (un GET) y arma el alta tal como la mandaría el
 * formulario del sistema, sin mandarla.
 */
async function productoNuevo(admin: any, body: any) {
  const problemas: string[] = [];
  const nombre = String(body?.nombre ?? "").replace(/\s+/g, " ").trim().toUpperCase();
  const barcode = String(body?.barcode ?? "").trim();
  const modeloId = Number(body?.modelo_id);
  const costo = Number(body?.costo);
  const precio = Number(body?.precio);

  if (nombre.length < 4 || nombre.length > 120) problemas.push("El nombre tiene que tener entre 4 y 120 letras.");
  if (barcode && !/^\d{8,14}$/.test(barcode)) problemas.push("El código de barras son de 8 a 14 dígitos.");
  if (!(costo > 0)) problemas.push("Falta el costo por unidad.");
  if (!(precio > 0)) problemas.push("Falta el precio de venta.");
  else if (costo > 0 && precio <= costo) problemas.push(`El precio ($${precio.toFixed(2)}) no es mayor que el costo ($${costo.toFixed(4)}).`);
  if (!Number.isFinite(modeloId)) return { error: "Falta el producto modelo." };

  // Que no exista ya: el mismo código de barras, o el mismo nombre.
  const { data: iguales, error: eI } = await admin.from("products").select("id, nombre, codigo_barras")
    .or([barcode ? `codigo_barras.eq.${barcode}` : null, `nombre.ilike.${nombre.replace(/[,()]/g, " ")}`].filter(Boolean).join(","))
    .limit(3);
  if (eI) throw eI;
  for (const x of iguales ?? []) problemas.push(`Ya existe: ${x.nombre} (${x.id}).`);

  const cookie = await sesionEn(ERP_BODEGA, login);
  const html = await pedir(cookie, `${BASE}/editar_producto.php?id_producto=${modeloId}`, undefined, { extra: { Referer: `${BASE}/admin_producto.php` } });
  const m = leerModelo(modeloId, html);
  if (!m.nombre) return { error: `El producto ${modeloId} no existe en el sistema.` };
  if (!m.categoria || !m.laboratorio || !m.proveedor) problemas.push(`El modelo «${m.nombre}» no tiene categoría, laboratorio o proveedor: elige otro.`);
  if (!m.precios) problemas.push(`El modelo «${m.nombre}» no tiene presentación de 1 unidad activa: elige otro.`);
  // Un producto controlado no se da de alta copiando: lo que lo hace
  // controlado es justo lo que hay que decidir con cuidado.
  if (m.regulado || m.antibiotico) problemas.push(`El modelo «${m.nombre}» es regulado o antibiótico: ese tipo de producto se da de alta a mano.`);

  const sobre = sobreDeProductoNuevo(m, { nombre, barcode, costo: costo > 0 ? costo : 0, precio: precio > 0 ? precio : 0 });
  return {
    simulacro: true, sobre,
    revision: {
      problemas, listo: problemas.length === 0,
      nombre, barcode: barcode || null,
      modelo: {
        id: m.id, nombre: m.nombre,
        categoria: textoElegido(html, "id_categoria"),
        laboratorio: textoElegido(html, "id_laboratorio"),
        proveedor: textoElegido(html, "proveedor"),
        perecedero: m.perecedero, exento: m.exento,
      },
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
    if (body?.accion === "producto_nuevo") return responder(await productoNuevo(admin, body));
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
        const pid = Number(x.product_id);
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
        dec = { tipo: "producto", producto, factor: Number(x.factor) || 1, lote: x.lote ?? null, vence: x.vence ?? null };
      }
      const res = lineaDelSobre(i, r, dec);
      problemas.push(...res.problemas);
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

    const sobre = {
      process: "insert", datos: "", json_arr: JSON.stringify(lineas), cuantos: 0,
      // La fecha de EMISIÓN del documento (usuario, 2026-10-29). El sistema
      // la devuelve como `documento.fecha_emision` y el libro de compras va
      // por ella. Bodega venía poniendo el día de la carga —el default del
      // formulario: 688 de 710 compras desde agosto, 1 a 7 días después—, lo
      // que corre la factura de mes cuando llega a fin de mes.
      total: tot.total, fecha: String(d.fecha_emision).slice(0, 10),
      concepto: uso === "consumo" ? "COMPRA PARA CONSUMO" : "COMPRA DE PRODUCTO",
      destino: "3", proveedor: String(erpProveedor ?? ""),
      // El código COMPLETO (usuario, 2026-10-29). Ojo: el sistema hoy guarda
      // 20 caracteres —616 de 710 compras desde septiembre miden exactamente
      // 20, ninguna más—, o sea que probablemente lo recorte; por eso la
      // verificación compara por el comienzo y no por igualdad.
      tipo_doc: tipoDoc, numero_doc: cod,
      sumas_sin_iva: tot.sumas_sin_iva, subtotal: tot.subtotal, iva: tot.iva,
      venta_exenta: tot.venta_exenta, total_percepcion: tot.total_percepcion,
      dias_credito: diasCredito ?? 0, id_compra: "", total_renta_retenida: "0.00",
      json_imp_arr: [],
      // Consumo: Gasto de administración. Venta: Costo, costo interno — lo que
      // el propio formulario pone solo al elegir «Gravada».
      tipo_operacion: "1",
      clasificacion: uso === "consumo" ? "2" : "1",
      tipo_costo_gasto: uso === "consumo" ? "2" : "5",
      total_fovial: 0, total_cotrans: 0,
      clase_documento_tributario: "4", numero_serie: "",
    };

    const revision = { regalos,
      problemas, listo: problemas.length === 0,
      total_documento: totalDoc, total_armado: Number(tot.total), diferencia,
      percepcion_proveedor: tasa, renglones: detalle,
    };
    if (enviar) return responder(await enviarCompra(admin, {
      cookie, documentId, cargaId: Number(body?.carga_id), sobre, revision, lineas, erpProveedor: erpProveedor!,
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
