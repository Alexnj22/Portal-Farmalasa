// ── Cargar una compra en Bodega desde el portal (2026-10-29) ─────────────────
//
// Plan: docs/PLAN-CARGAR-COMPRAS-EN-BODEGA-2026-10-29.md.
//
// Por ahora SÓLO SIMULACRO. Arma el formulario exacto que el sistema de la caja
// recibiría (`_shared/compraSobre.ts`), lo revisa y lo deja escrito en
// `compra_carga` con estado `simulada`. Del sistema sólo LEE: las presentaciones
// de cada producto (`consultar_stock`, `getpresentacion`) y la tasa de
// percepción del proveedor (`datos_proveedores`). Ninguna de las tres escribe.
//
// El envío real (POST `compras.php` `process=insert`) es irreversible desde acá
// —sólo se deshace anulando la compra allá— y queda apagado hasta que el
// usuario dé el OK para la primera compra con Bodega mirando.
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
  lineaDelSobre, tipoDocDe, totalDelDocumento, totalesDelSobre, leerModelo, sobreDeProductoNuevo,
} from "../_shared/compraSobre.ts";

const COMPRAS = `${BASE}/compras.php`;
const ERP_BODEGA = 6;
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
  const opciones = [...String(j.select ?? "").matchAll(/value=['"]?(\d+)['"]?/g)].map((m) => m[1]);
  const presentaciones = [];
  for (const id_presentacion of opciones) {
    const p = await pedir(cookie, COMPRAS, new URLSearchParams({ process: "getpresentacion", id_presentacion }),
      { extra: { Referer: COMPRAS } });
    try {
      const jp = JSON.parse(p);
      presentaciones.push({ id: id_presentacion, unidad: Number(jp.unidad), costo: Number(jp.costo), precio: Number(jp.precio) });
    } catch { /* una presentación ilegible no tumba las otras */ }
  }
  return {
    id, nombre: String(j.descrip ?? id),
    perecedero: String(j.perecedero) === "1", regulado: String(j.regulado) === "1",
    presentaciones,
  };
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
  if (!m.categoria || !m.laboratorio || !m.proveedor) problemas.push(`El modelo «${m.nombre}» no tiene categoría, laboratorio o proveedor: elegí otro.`);
  if (!m.precios) problemas.push(`El modelo «${m.nombre}» no tiene presentación de 1 unidad activa: elegí otro.`);
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
  if (!permiso.puede) return responder({ error: "No tenés permiso para cargar compras." }, 403);

  try {
    const body = await req.json().catch(() => ({}));
    const documentId = Number(body?.document_id);
    const uso = body?.uso === "consumo" ? "consumo" : "venta";
    const decisiones: Record<string, { product_id?: number; factor?: number; lote?: string; vence?: string }> =
      body?.renglones ?? {};
    const diasCredito = Number.isFinite(Number(body?.dias_credito)) ? Math.max(0, Math.trunc(Number(body.dias_credito))) : null;
    if (body?.enviar === true) {
      return responder({ error: "El envío real todavía no está habilitado: por ahora sólo el simulacro." }, 409);
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
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const r: RenglonDoc = {
        descripcion: String(it?.descripcion ?? ""),
        cantidad: Number(it?.cantidad), precio: Number(it?.precioUni),
        descuento: Number(it?.montoDescu ?? 0),
        exento: Number(it?.ventaExenta ?? 0) > 0,
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
      if (res.linea) lineas.push(res.linea);
      detalle.push({ renglon: i, descripcion: r.descripcion, linea: res.linea, ...(res.detalle ?? {}) });
    }

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
      total: tot.total, fecha: d.fecha_emision,
      concepto: uso === "consumo" ? "COMPRA PARA CONSUMO" : "COMPRA DE PRODUCTO",
      destino: "3", proveedor: String(erpProveedor ?? ""),
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

    const revision = {
      problemas, listo: problemas.length === 0,
      total_documento: totalDoc, total_armado: Number(tot.total), diferencia,
      percepcion_proveedor: tasa, renglones: detalle,
    };
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
