import { createClient } from "npm:@supabase/supabase-js@2";
import { extractText, getDocumentProxy } from "npm:unpdf@1.6.2";
import { requireInvokeSecret } from "../_shared/security.ts";

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
// AUTENTICACIÓN. Secreto de invocación (`ADMIN_INVOKE_SECRET`), no JWT: la
// llama Postgres con `net.http_post` leyendo el secreto de Vault, igual que los
// crons. Por eso se despliega con `--no-verify-jwt` — sin el flag, la
// plataforma rechaza la llamada antes de ejecutar una línea.
//
// NO ESCRIBE NADA. Lee de Storage y devuelve; ni una escritura.

const MAX_DOCS  = 12;   // el cuerpo de la respuesta viaja por net._http_response
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

// ── El PDF ──────────────────────────────────────────────────────────────────
// Cinco proveedores (GAMMA, MENFAR, SAVONA, CONGELADOS, STEINER) NO mandan lote
// ni vencimiento en el JSON — verificado leyéndolos enteros, apéndice incluido.
// Pero su representación gráfica sí los imprime: la factura de GAMMA trae
// columnas «Lote» y «Vence». El PDF está guardado en el mismo bucket, así que
// el dato es alcanzable sin pedirle nada a nadie.
//
// `unpdf` extrae texto sin DOM ni canvas — es el mismo paquete con el que
// `sync-purchase-emails` detecta el código de generación de un PDF huérfano,
// así que ya está probado en este runtime.
async function textoDelPdf(bytes: Uint8Array): Promise<string> {
  const doc = await getDocumentProxy(bytes);
  const { text } = await extractText(doc, { mergePages: true });
  return text;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Lote y vencimiento de un renglón, leídos del PDF.
 *
 * NO se busca «un lote» a ciegas: se ancla en lo que el JSON ya dice de ese
 * renglón —el código y la descripción— y se lee **lo que queda entre la
 * descripción y la cantidad**. Los dos extremos son conocidos, así que el
 * hueco del medio es exactamente el dato que falta; no hay que adivinar cuál
 * de los números de la línea es cuál.
 *
 * Devuelve `null` cuando el ancla no aparece en el texto: es preferible que la
 * pantalla lo pida a inventar un vencimiento, que es un dato sanitario.
 */
function loteYVence(texto: string, item: any): { lote: string | null; vence: string | null; anclado: boolean } {
  const desc = norm(String(item?.descripcion ?? ""));
  if (!desc) return { lote: null, vence: null, anclado: false };

  // La cantidad tal como la imprime el papel («4.00»), para cerrar el hueco.
  const cant = Number(item?.cantidad ?? 0);
  const cantTxt = Number.isFinite(cant) ? cant.toFixed(2) : null;

  const t = norm(texto);

  // (A) Columnas sin rótulo — GAMMA: `código descripción LOTE VENCE cant precio`.
  //     El hueco queda encerrado entre la descripción y la cantidad.
  const re = new RegExp(
    escapar(desc) + "\\s+(.{0,40}?)\\s*" + (cantTxt ? escapar(cantTxt) : "\\d+\\.\\d{2}") + "\\b",
  );
  const m = t.match(re);
  if (m) {
    const medio = norm(m[1]);
    const f = medio.match(/(\d{2}\/\d{4}|\d{2}\/\d{2}\/\d{4})\s*$/);
    const vence = f ? f[1] : null;
    const lote  = norm(f ? medio.slice(0, f.index) : medio) || null;
    if (lote || vence) return { lote, vence, anclado: true };
  }

  // (B) Rótulos explícitos — MENFAR: `descripción Lote: X Vencimiento: Y`.
  //     Se busca sólo DESPUÉS de la descripción y en una ventana corta, para no
  //     traerse el lote del renglón siguiente.
  const i = t.indexOf(desc);
  if (i >= 0) {
    const ventana = t.slice(i + desc.length, i + desc.length + 120);
    const ml = ventana.match(/lote\s*:?\s*([A-Za-z0-9._\-\/]+)/i);
    const mv = ventana.match(/(?:vencimiento|vence|f\.?\s*exp\.?)\s*:?\s*(\d{2}[\/-]\d{2,4}(?:[\/-]\d{2,4})?)/i);
    if (ml || mv) return { lote: ml ? ml[1] : null, vence: mv ? mv[1] : null, anclado: true };
  }

  return { lote: null, vence: null, anclado: false };
}

Deno.serve(async (req: Request) => {
  if (!requireInvokeSecret(req)) {
    return new Response(JSON.stringify({ error: "no autorizado" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const {
      document_ids = null,
      emisor_nit   = null,
      emisor_like  = null,
      limit        = 3,
      max_items    = MAX_ITEMS,
      // `claves` devuelve sólo la forma (qué campos trae cada renglón) en vez
      // del contenido: sirve para barrer muchos proveedores sin traerse la
      // factura entera.
      modo         = "items",
    } = body ?? {};

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let q = admin
      .from("purchase_dte_documents")
      .select("id, emisor_nombre, emisor_nit, codigo_generacion, fecha_emision, json_path, pdf_path")
      .not("json_path", "is", null)
      .order("id", { ascending: false })
      .limit(Math.min(Number(limit) || 3, MAX_DOCS));

    if (Array.isArray(document_ids) && document_ids.length > 0) {
      q = q.in("id", document_ids.slice(0, MAX_DOCS));
    }
    if (emisor_nit)  q = q.eq("emisor_nit", emisor_nit);
    if (emisor_like) q = q.ilike("emisor_nombre", `%${emisor_like}%`);

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

      // La UNIÓN de claves de todos los renglones: si un proveedor manda un
      // campo sólo en algunos, igual aparece.
      const claves = [...new Set(items.flatMap((it) => Object.keys(it ?? {})))].sort();

      const base = {
        id: d.id,
        emisor: d.emisor_nombre,
        emisor_nit: d.emisor_nit,
        fecha: d.fecha_emision,
        renglones: items.length,
        claves_del_renglon: claves,
        // Extensiones y apartados donde algunos emisores meten datos propios.
        // `apendice` es el que importa: el estándar lo deja libre como lista de
        // {campo, etiqueta, valor}, y es el único sitio legal para mandar algo
        // que el esquema no tiene — por ejemplo lote y vencimiento.
        tiene_extension: !!dte?.extension,
        extension: dte?.extension ?? null,
        apendice: dte?.apendice ?? null,
        otros_documentos: dte?.otrosDocumentos ?? null,
        claves_raiz: Object.keys(dte ?? {}).sort(),
      };

      if (modo === "lotes") {
        const pPdf = pathDeStorage(d.pdf_path);
        if (!pPdf) { salida.push({ ...base, error: "sin pdf_path" }); continue; }
        const { data: pdfBlob, error: pdfErr } = await admin.storage.from("purchase-dte").download(pPdf);
        if (pdfErr || !pdfBlob) { salida.push({ ...base, error: `pdf: ${pdfErr?.message}` }); continue; }
        let txt = "";
        try { txt = await textoDelPdf(new Uint8Array(await pdfBlob.arrayBuffer())); }
        catch (e: any) { salida.push({ ...base, error: `pdf ilegible: ${e?.message ?? e}` }); continue; }

        const leidos = items.map((it) => {
          const r = loteYVence(txt, it);
          return {
            codigo: it?.codigo ?? null,
            descripcion: it?.descripcion ?? null,
            cantidad: it?.cantidad ?? null,
            precioUni: it?.precioUni ?? null,
            lote: r.lote, vence: r.vence, anclado: r.anclado,
          };
        });
        salida.push({
          ...base,
          con_lote:  leidos.filter((x) => x.lote).length,
          con_vence: leidos.filter((x) => x.vence).length,
          renglones_leidos: leidos.slice(0, Math.min(Number(max_items) || MAX_ITEMS, 25)),
        });
        continue;
      }

      if (modo === "pdf") {
        const pPdf = pathDeStorage(d.pdf_path);
        if (!pPdf) { salida.push({ ...base, pdf: "sin pdf_path" }); continue; }
        const { data: pdfBlob, error: pdfErr } = await admin.storage.from("purchase-dte").download(pPdf);
        if (pdfErr || !pdfBlob) { salida.push({ ...base, pdf: `descarga: ${pdfErr?.message}` }); continue; }
        try {
          const txt = await textoDelPdf(new Uint8Array(await pdfBlob.arrayBuffer()));
          salida.push({ ...base, pdf_caracteres: txt.length,
            pdf_texto: txt.slice(Number(body?.pdf_desde ?? 0), Number(body?.pdf_desde ?? 0) + Number(body?.pdf_largo ?? 2500)) });
        } catch (e: any) {
          // PDF escaneado o sin capa de texto: no hay nada que leer.
          salida.push({ ...base, pdf: `ilegible: ${e?.message ?? e}` });
        }
        continue;
      }

      salida.push(modo === "claves"
        ? base
        : { ...base, items: items.slice(0, Math.min(Number(max_items) || MAX_ITEMS, 25)) });
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
