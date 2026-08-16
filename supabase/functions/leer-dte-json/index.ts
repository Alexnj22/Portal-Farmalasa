import { createClient } from "npm:@supabase/supabase-js@2";
import { extractText, getDocumentProxy } from "npm:unpdf@1.6.2";
import { requireInvokeSecret, requireActiveEmployeeUser, getCorsHeaders } from "../_shared/security.ts";
import { loteYVence, nombreLimpio } from "../_shared/loteVencimiento.ts";

// Leer el JSON de un DTE de compra — la pieza que le faltaba a todo lo demás.
//
// POR QUÉ EXISTE. El portal guarda el JSON de cada documento en el bucket
// PRIVADO `purchase-dte`, y hasta hoy nadie lo leía: lo único que se consultaba
// era `purchase_dte_documents.items_text`, que es el mismo JSON **aplanado en
// una sola cadena** por `extractItemsText` — sólo `codigo + descripcion`, unidos
// con ` | `, y **descartando la descripción repetida**.
//
// Esa pérdida está medida (`docs/AUDITORIA-MATCH-DTE-PRODUCTOS-2026-08-16.md`):
// sólo COFARSAL pierde 177 renglones, y le falta alguno a 81 de sus 209
// compras. Y peor: al quedarse con dos campos, el texto **no puede mostrar** lo
// que el proveedor manda en los demás. La factura de GAMMA lo dejó a la vista —
// su representación gráfica trae columnas `Lote` y `Vence` que en `items_text`
// no aparecen por ningún lado.
//
// La lectura de lote y vencimiento vive en `_shared/loteVencimiento.ts`, que es
// puro y tiene pruebas con cadenas reales (`tests/unit/loteVencimiento.test.js`).
// Acá NO se duplica: una copia con pruebas al lado prueba la copia.
//
// AUTENTICACIÓN. Secreto de invocación (`ADMIN_INVOKE_SECRET`), no JWT: la
// llama Postgres con `net.http_post` leyendo el secreto de Vault, igual que los
// crons. Por eso se despliega con `--no-verify-jwt` — sin el flag, la
// plataforma rechaza la llamada antes de ejecutar una línea.
//
// NO ESCRIBE NADA. Lee de Storage y de la base, y devuelve.

const MAX_DOCS  = 40;   // el cuerpo de la respuesta viaja por net._http_response
const MAX_ITEMS = 10;

/** El sobre viejo: `{selloRecibido, firmaElectronica, dteJson}`. */
function desenvolver(j: any): any {
  return j?.dteJson ?? j?.documento ?? j;
}

/** El path dentro del bucket, sacado de la URL formato-public que se guarda. */
function pathDeStorage(url: string | null): string | null {
  if (!url) return null;
  const i = url.indexOf("/purchase-dte/");
  return i < 0 ? null : decodeURIComponent(url.slice(i + "/purchase-dte/".length));
}

// `unpdf` extrae texto sin DOM ni canvas — el mismo paquete con el que
// `sync-purchase-emails` detecta el código de generación de un PDF huérfano.
async function textoDelPdf(bytes: Uint8Array): Promise<string> {
  const doc = await getDocumentProxy(bytes);
  const { text } = await extractText(doc, { mergePages: true });
  return text;
}

/**
 * ¿El rol de esta persona puede ver facturas de compra?
 *
 * Se resuelve contra `role_permissions` con la llave de servicio y NO con
 * `auth_has_module_permission`, porque esa función saca al empleado del JWT y
 * acá la conexión es de servicio: no hay JWT que resolver y devolvería falso
 * para todos.
 */
async function tienePermiso(admin: any, emp: any): Promise<boolean> {
  // `requireActiveEmployeeUser` devuelve sólo id/status/code/name — el rol NO
  // viene, así que hay que ir por él. Sin este paso `roles` quedaba vacío y la
  // función negaba el paso a todo el mundo con un 401 que parecía de sesión.
  const { data: ficha } = await admin
    .from("employees").select("role_id, secondary_role_id").eq("id", emp?.id).maybeSingle();
  const roles = [ficha?.role_id, ficha?.secondary_role_id].filter(Boolean);
  if (!roles.length) return false;
  const { data } = await admin
    .from("role_permissions")
    .select("module_key, can_view")
    .in("role_id", roles)
    .in("module_key", ["compras", "facturas_compra", "cuentas_por_pagar"])
    .eq("can_view", true);
  return (data ?? []).length > 0;
}

const norm20 = (s: string) =>
  s.replace(/\s/g, "").replace(/\./g, "").replace(/O/gi, "0").toUpperCase();

Deno.serve(async (req: Request) => {
  const cors = { ...getCorsHeaders(req), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response(null, { headers: getCorsHeaders(req) });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // DOS puertas, porque son dos llamadores distintos:
  //   · Postgres, con el secreto de Vault (los barridos y las mediciones).
  //   · El navegador, con la sesión de quien mira la pantalla de carga — y ahí
  //     además se le exige el permiso del módulo, porque esto lee facturas de
  //     compra con su detalle completo.
  let autorizado = requireInvokeSecret(req);
  if (!autorizado) {
    const emp = await requireActiveEmployeeUser(req, admin);
    if (emp) autorizado = await tienePermiso(admin, emp);
  }
  if (!autorizado) {
    return new Response(JSON.stringify({ error: "no autorizado" }), { status: 401, headers: cors });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const {
      document_ids = null, emisor_nit = null, emisor_like = null,
      limit = 3, max_items = MAX_ITEMS, modo = "items",
      desde = null,
    } = body ?? {};

    let q = admin
      .from("purchase_dte_documents")
      .select("id, emisor_nombre, emisor_nit, codigo_generacion, fecha_emision, json_path, pdf_path, sello_recibido")
      .not("json_path", "is", null)
      .order("id", { ascending: false })
      .limit(Math.min(Number(limit) || 3, MAX_DOCS));

    if (Array.isArray(document_ids) && document_ids.length > 0) q = q.in("id", document_ids.slice(0, MAX_DOCS));
    if (emisor_nit)  q = q.eq("emisor_nit", emisor_nit);
    if (emisor_like) q = q.ilike("emisor_nombre", `%${emisor_like}%`);
    if (desde)       q = q.gte("fecha_emision", desde);

    const { data: docs, error } = await q;
    if (error) throw new Error(`purchase_dte_documents: ${error.message}`);

    const salida: any[] = [];

    for (const d of docs ?? []) {
      const path = pathDeStorage(d.json_path);
      if (!path) { salida.push({ id: d.id, error: "json_path sin ruta de bucket" }); continue; }

      const { data: blob, error: dlErr } = await admin.storage.from("purchase-dte").download(path);
      if (dlErr || !blob) { salida.push({ id: d.id, error: `descarga: ${dlErr?.message}` }); continue; }

      let dte: any;
      try { dte = desenvolver(JSON.parse(await blob.text())); }
      catch (e: any) { salida.push({ id: d.id, error: `json ilegible: ${e.message}` }); continue; }

      const items: any[] = Array.isArray(dte?.cuerpoDocumento) ? dte.cuerpoDocumento : [];
      const claves = [...new Set(items.flatMap((it) => Object.keys(it ?? {})))].sort();

      const base = {
        id: d.id, emisor: d.emisor_nombre, emisor_nit: d.emisor_nit,
        fecha: d.fecha_emision, renglones: items.length,
        claves_del_renglon: claves,
        tiene_extension: !!dte?.extension,
        extension: dte?.extension ?? null,
        apendice: dte?.apendice ?? null,
        otros_documentos: dte?.otrosDocumentos ?? null,
        claves_raiz: Object.keys(dte ?? {}).sort(),
        // El encabezado de la compra: condición de operación (1 contado /
        // 2 crédito / 3 otro) y el plazo, que el estándar pone en
        // `resumen.pagos[].plazo` (catálogo: 01 días, 02 meses, 03 años) con
        // `periodo` como número.
        condicion_operacion: dte?.resumen?.condicionOperacion ?? null,
        pagos: dte?.resumen?.pagos ?? null,
        numero_control: dte?.identificacion?.numeroControl ?? null,
        sello: dte?.selloRecibido ?? null,
      };

      if (modo === "claves") { salida.push(base); continue; }

      // ── Modos que necesitan el PDF ──────────────────────────────────────
      let txtPdf = "";
      if (modo === "pdf" || modo === "lotes" || modo === "verificar" || modo === "propuesta") {
        const pPdf = pathDeStorage(d.pdf_path);
        if (pPdf) {
          const { data: pdfBlob } = await admin.storage.from("purchase-dte").download(pPdf);
          if (pdfBlob) {
            try { txtPdf = await textoDelPdf(new Uint8Array(await pdfBlob.arrayBuffer())); }
            catch { /* PDF escaneado o sin capa de texto: se sigue sin él */ }
          }
        }
      }

      if (modo === "pdf") {
        const desdeC = Number(body?.pdf_desde ?? 0);
        salida.push({ ...base, pdf_caracteres: txtPdf.length,
          pdf_texto: txtPdf.slice(desdeC, desdeC + Number(body?.pdf_largo ?? 2500)) });
        continue;
      }

      const leidos = items.map((it) => {
        const r = loteYVence(txtPdf, it);
        return {
          codigo: it?.codigo ?? null, descripcion: it?.descripcion ?? null,
          cantidad: it?.cantidad ?? null, precioUni: it?.precioUni ?? null,
          lote: r.lote, vence: r.vence, de: r.de,
        };
      });

      if (modo === "lotes") {
        salida.push({
          ...base,
          con_lote: leidos.filter((x) => x.lote).length,
          con_vence: leidos.filter((x) => x.vence).length,
          renglones_leidos: leidos.slice(0, Math.min(Number(max_items) || MAX_ITEMS, 25)),
        });
        continue;
      }

      // ── `verificar`: contra lo que una persona escribió ────────────────
      //
      // La prueba de fuego. Cada compra ya registrada tiene sus renglones con
      // el vencimiento que alguien tecleó mirando la caja. Se compara el
      // CONJUNTO de fechas leídas contra el conjunto tecleado — así no hace
      // falta emparejar renglón con renglón (que metería el error del matcher
      // de productos en una medición que es sólo del extractor de fechas).
      if (modo === "verificar") {
        const norm = norm20(String(d.codigo_generacion ?? ""));
        const variantes = [norm, norm.replace(/-/g, "").slice(0, 20), norm.slice(0, 20)];
        let recibo: any = null;

        if (d.sello_recibido) {
          const { data } = await admin.from("purchase_receipts")
            .select("id").eq("sello_recibido", d.sello_recibido).limit(1);
          recibo = data?.[0] ?? null;
        }
        if (!recibo) {
          const { data } = await admin.from("purchase_receipts")
            .select("id, documento_numero")
            .in("documento_numero", variantes).limit(1);
          recibo = data?.[0] ?? null;
        }
        if (!recibo) { salida.push({ id: d.id, emisor: d.emisor_nombre, sin_compra: true }); continue; }

        const { data: reng } = await admin.from("purchase_receipt_items")
          .select("fecha_vencimiento, lote").eq("receipt_id", recibo.id);

        const mias = leidos.map((x) => x.vence).filter(Boolean).sort();
        const suyas = (reng ?? []).map((x: any) => x.fecha_vencimiento).filter(Boolean).sort();
        const cuenta = (a: string[]) => a.reduce((m: any, v) => (m[v] = (m[v] ?? 0) + 1, m), {});
        const ca = cuenta(mias), cb = cuenta(suyas);
        const claves2 = [...new Set([...Object.keys(ca), ...Object.keys(cb)])];
        const iguales = claves2.filter((k) => (ca[k] ?? 0) === (cb[k] ?? 0));
        const difieren = claves2.filter((k) => (ca[k] ?? 0) !== (cb[k] ?? 0))
          .map((k) => ({ fecha: k, leidas: ca[k] ?? 0, tecleadas: cb[k] ?? 0 }));

        salida.push({
          id: d.id, emisor: d.emisor_nombre, fecha: d.fecha_emision,
          renglones_dte: items.length, renglones_compra: (reng ?? []).length,
          fechas_leidas: mias.length, fechas_tecleadas: suyas.length,
          fechas_que_coinciden: iguales.length,
          difieren,
        });
        continue;
      }

      // ── `propuesta`: la compra armada, SIN escribir en ningún lado ─────
      //
      // Es la pantalla antes de la pantalla: dice qué se cargaría y de dónde
      // salió cada dato, para que una persona lo mire. No toca el sistema de
      // origen ni la base — sólo lee.
      if (modo === "propuesta") {
        const { data: prov } = await admin
          .from("proveedores_maestro")
          .select("nombre, supplier_id, f07_tipo_operacion, f07_clasificacion, f07_tipo_costo_gasto, clasificacion_estado, iva_deducible")
          .eq("nit", d.emisor_nit).maybeSingle();

        // El plazo: el estándar lo pone en `resumen.pagos[].periodo` con
        // `plazo` del catálogo (01 días, 02 meses, 03 años). Cuando el emisor
        // no lo manda —la mitad no lo hace— queda nulo y lo pone la persona.
        const pago = (dte?.resumen?.pagos ?? [])[0] ?? null;
        let diasCredito: number | null = null;
        if (pago?.periodo != null) {
          const n = Number(pago.periodo);
          if (Number.isFinite(n) && n > 0) {
            diasCredito = pago.plazo === "02" ? n * 30 : pago.plazo === "03" ? n * 365 : n;
            // Un plazo de más de un año no es un plazo: es un código mal
            // puesto. DROGUERÍA AMERICANA manda `plazo:02, periodo:75` —
            // 75 meses son seis años—. Se devuelve el número crudo y se marca.
            if (diasCredito > 365) diasCredito = n;
          }
        }

        const renglones = [];
        for (const it of items) {
          // Al emparejador va el NOMBRE LIMPIO, no la descripción cruda: el
          // lote y la fecha metidos adentro son ruido distinto en cada renglón
          // y hunden el parecido. Medido: con la cruda, 28% de los renglones
          // quedan sin ningún candidato; con el nombre limpio, 9%.
          const limpio = nombreLimpio(String(it?.descripcion ?? ""));
          const { data: m } = await admin.rpc("emparejar_producto_dte", {
            p_emisor_nit: d.emisor_nit, p_codigo_prov: it?.codigo ?? null,
            // El código de barras vive en la descripción CRUDA de algunos
            // proveedores, así que se manda entera cuando trae dígitos largos.
            p_texto: /\d{12,14}/.test(String(it?.descripcion ?? "")) ? String(it?.descripcion) : limpio,
          });
          const match = Array.isArray(m) ? m[0] : m;
          const lv = loteYVence(txtPdf, it);
          const sim = Number(match?.similitud ?? 0);
          const seguro = match?.origen === "codigo_barras" || match?.origen === "aprendido" || sim >= 0.75;

          renglones.push({
            codigo_proveedor: it?.codigo ?? null,
            descripcion: it?.descripcion ?? null,
            cantidad: it?.cantidad ?? null,
            costo: it?.precioUni ?? null,
            descuento: it?.montoDescu ?? 0,
            total_linea: it?.ventaGravada ?? it?.ventaExenta ?? it?.ventaNoSuj ?? null,
            exento: Number(it?.ventaExenta ?? 0) > 0,
            producto_id: match?.product_id ?? null,
            producto: match?.nombre ?? null,
            match_origen: match?.origen ?? "sin candidato",
            match_similitud: match?.similitud ?? null,
            lote: lv.lote, vence: lv.vence, lote_origen: lv.de,
            listo: !!(seguro && lv.vence && lv.lote),
            falta: [
              !match?.product_id ? "producto" : (!seguro ? "confirmar producto" : null),
              !lv.lote ? "lote" : null,
              !lv.vence ? "vencimiento" : null,
            ].filter(Boolean),
          });
        }

        salida.push({
          documento: {
            id: d.id, codigo_generacion: d.codigo_generacion,
            numero_control: dte?.identificacion?.numeroControl ?? null,
            sello: d.sello_recibido ?? dte?.selloRecibido ?? null,
            fecha: d.fecha_emision, emisor: d.emisor_nombre, emisor_nit: d.emisor_nit,
            tipo_dte: dte?.identificacion?.tipoDte ?? null,
            total: dte?.resumen?.montoTotalOperacion ?? dte?.resumen?.totalPagar ?? null,
          },
          encabezado: {
            proveedor: prov?.nombre ?? d.emisor_nombre,
            erp_supplier_id: prov?.supplier_id ?? null,
            dias_credito: diasCredito,
            dias_credito_origen: pago ? `resumen.pagos (plazo ${pago.plazo}, periodo ${pago.periodo})` : "el documento no lo trae",
            condicion_operacion: dte?.resumen?.condicionOperacion ?? null,
            tipo_operacion: prov?.f07_tipo_operacion ?? null,
            clasificacion: prov?.f07_clasificacion ?? null,
            tipo_costo_gasto: prov?.f07_tipo_costo_gasto ?? null,
            proveedor_clasificado: prov?.clasificacion_estado ?? "sin ficha",
          },
          resumen: {
            renglones: renglones.length,
            listos: renglones.filter((r) => r.listo).length,
            sin_producto: renglones.filter((r) => !r.producto_id).length,
            a_confirmar: renglones.filter((r) => r.producto_id && !r.listo).length,
            sin_lote: renglones.filter((r) => !r.lote).length,
            sin_vencimiento: renglones.filter((r) => !r.vence).length,
          },
          renglones: renglones.slice(0, Math.min(Number(max_items) || MAX_ITEMS, 30)),
        });
        continue;
      }

      salida.push({ ...base, items: items.slice(0, Math.min(Number(max_items) || MAX_ITEMS, 25)) });
    }

    return new Response(JSON.stringify({ documentos: salida }, null, 1), { headers: cors });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: cors,
    });
  }
});
