import { createClient } from "npm:@supabase/supabase-js@2";
import { extractText, getDocumentProxy } from "npm:unpdf@1.6.2";
import { requireInvokeSecret } from "../_shared/security.ts";
import { loteYVence } from "../_shared/loteVencimiento.ts";

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

const norm20 = (s: string) =>
  s.replace(/\s/g, "").replace(/\./g, "").replace(/O/gi, "0").toUpperCase();

Deno.serve(async (req: Request) => {
  if (!requireInvokeSecret(req)) {
    return new Response(JSON.stringify({ error: "no autorizado" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const {
      document_ids = null, emisor_nit = null, emisor_like = null,
      limit = 3, max_items = MAX_ITEMS, modo = "items",
      desde = null,
    } = body ?? {};

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

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
      };

      if (modo === "claves") { salida.push(base); continue; }

      // ── Modos que necesitan el PDF ──────────────────────────────────────
      let txtPdf = "";
      if (modo === "pdf" || modo === "lotes" || modo === "verificar") {
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

      salida.push({ ...base, items: items.slice(0, Math.min(Number(max_items) || MAX_ITEMS, 25)) });
    }

    return new Response(JSON.stringify({ documentos: salida }, null, 1), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
