import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireInvokeSecret } from "../_shared/security.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Baja el DTE de una venta —el JSON y el PDF— y lo archiva en `sales-dte`.
//
// Los dos endpoints son PÚBLICOS por `codigoGeneracion` (es el esquema del QR
// de Hacienda): no hay login, no hay cookie, no hay sucursal. Sirven sólo para
// NUESTROS documentos emitidos.
//
//   downloads/dteqr_json.php?codigoGeneracion=<UUID>
//   downloads/dteqr_pdf.php?codigoGeneracion=<UUID>
//
// TRAMPA: con un código que no es nuestro el JSON responde **HTTP 200 con body
// vacío**, así que chequear el status no atrapa nada. Por eso se valida el
// CONTENIDO de los dos: el JSON tiene que parsear y traer `identificacion`, y
// el PDF tiene que empezar con `%PDF`. Es la misma trampa que ya mordió en
// `sync-purchase-emails`.
//
// El endpoint del JSON estuvo caído hasta el 2026-08-01 (faltaba un directorio
// del lado del proveedor). Se archiva en vez de pedirlo al vuelo justamente por
// eso, y porque el Art. 147 CT pide conservar el documento.
// ═══════════════════════════════════════════════════════════════════════════

const BASE   = "https://clientesdte3.oss.com.sv/farma_salud/downloads";
const BUCKET = "sales-dte";
const PARALELO = 4;          // el primero del lote paga caché frío (4-5s); el resto ~1.3s

type Doc = { id: number; codigo_generacion: string; fecha: string };

async function traer(url: string, intentos = 3): Promise<Uint8Array | null> {
  for (let i = 0; i < intentos; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(45_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength === 0) return null;      // 200 + vacío = no es nuestro
      return buf;
    } catch (_e) {
      if (i === intentos - 1) return null;
      await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
  return null;
}

const esPdf = (b: Uint8Array) =>
  b.byteLength > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;

function esDteNuestro(b: Uint8Array): boolean {
  try {
    const j = JSON.parse(new TextDecoder().decode(b));
    return Boolean(j?.identificacion?.numeroControl);
  } catch { return false; }
}

async function unDocumento(supabase: any, proyectoUrl: string, doc: Doc) {
  const cg = String(doc.codigo_generacion).toUpperCase();
  const [anio, mes] = doc.fecha.split("-");
  const carpeta = `${anio}/${mes}`;

  const [json, pdf] = await Promise.all([
    traer(`${BASE}/dteqr_json.php?codigoGeneracion=${cg}`),
    traer(`${BASE}/dteqr_pdf.php?codigoGeneracion=${cg}`),
  ]);

  const jsonOk = json !== null && esDteNuestro(json);
  const pdfOk  = pdf  !== null && esPdf(pdf);
  if (!jsonOk && !pdfOk) return { id: doc.id, cg, error: "el origen no devolvió ni el JSON ni el PDF" };

  // La URL formato-public es el identificador que va a la BD; el bucket es
  // privado y `getSignedFileUrl` la firma al mostrarla. Guardar una firmada
  // sería guardar algo que expira.
  const publica = (ext: string) =>
    `${proyectoUrl}/storage/v1/object/public/${BUCKET}/${carpeta}/${cg}.${ext}`;

  const fila: Record<string, unknown> = {
    invoice_id: doc.id, codigo_generacion: doc.codigo_generacion,
    descargado_at: new Date().toISOString(),
  };

  if (jsonOk) {
    const { error } = await supabase.storage.from(BUCKET)
      .upload(`${carpeta}/${cg}.json`, json, { contentType: "application/json", upsert: true });
    if (error) return { id: doc.id, cg, error: `subida del JSON: ${error.message}` };
    fila.json_path = publica("json");
    fila.json_bytes = json!.byteLength;
  }
  if (pdfOk) {
    const { error } = await supabase.storage.from(BUCKET)
      .upload(`${carpeta}/${cg}.pdf`, pdf, { contentType: "application/pdf", upsert: true });
    if (error) return { id: doc.id, cg, error: `subida del PDF: ${error.message}` };
    fila.pdf_path = publica("pdf");
    fila.pdf_bytes = pdf!.byteLength;
  }

  const { error: upErr } = await supabase
    .from("sales_dte_documents")
    .upsert(fila, { onConflict: "codigo_generacion" });
  if (upErr) return { id: doc.id, cg, error: `upsert: ${upErr.message}` };

  return { id: doc.id, cg, json: jsonOk, pdf: pdfOk };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!requireInvokeSecret(req)) {
    return new Response(JSON.stringify({ ok: false, error: "UNAUTHORIZED" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const {
      fini, ffin, branchId = null,
      soloRetencion = true,     // el caso que motivó la función
      force = false,            // volver a bajar aunque ya esté archivado
      invoiceIds = null,        // o una lista explícita, y lo demás se ignora
    } = body;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );
    const proyectoUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");

    // 1. Qué documentos. Paginado explícito: PostgREST corta en 1000 sin avisar.
    const pendientes: Doc[] = [];
    const PAG = 500;
    for (let desde = 0; ; desde += PAG) {
      let q = supabase.from("sales_invoices")
        .select("id, codigo_generacion, fecha")
        .not("codigo_generacion", "is", null)
        .order("id", { ascending: true })
        .range(desde, desde + PAG - 1);
      if (Array.isArray(invoiceIds) && invoiceIds.length) q = q.in("id", invoiceIds);
      else {
        if (fini) q = q.gte("fecha", fini);
        if (ffin) q = q.lte("fecha", ffin);
        if (branchId != null) q = q.eq("branch_id", Number(branchId));
        if (soloRetencion) q = q.gt("retencion", 0);
      }
      const { data, error } = await q;
      if (error) throw new Error(`select de ventas: ${error.message}`);
      pendientes.push(...(data ?? []));
      if (!data || data.length < PAG) break;
    }

    // 2. Los que ya están archivados, salvo `force`.
    let objetivo = pendientes;
    if (!force && pendientes.length) {
      const ids = pendientes.map(d => d.id);
      const yaHay = new Set<number>();
      for (let i = 0; i < ids.length; i += 500) {
        const { data, error } = await supabase.from("sales_dte_documents")
          .select("invoice_id").in("invoice_id", ids.slice(i, i + 500));
        if (error) throw new Error(`select de archivados: ${error.message}`);
        for (const r of (data ?? [])) yaHay.add(r.invoice_id);
      }
      objetivo = pendientes.filter(d => !yaHay.has(d.id));
    }

    // 3. En tandas cortas: son peticiones a un servidor ajeno, no una carrera.
    const resultados: any[] = [];
    for (let i = 0; i < objetivo.length; i += PARALELO) {
      resultados.push(...await Promise.all(
        objetivo.slice(i, i + PARALELO).map(d => unDocumento(supabase, proyectoUrl, d))
      ));
    }

    const fallidos = resultados.filter(r => r.error);
    return new Response(JSON.stringify({
      ok: fallidos.length === 0,
      candidatos: pendientes.length,
      intentados: objetivo.length,
      archivados: resultados.length - fallidos.length,
      con_json: resultados.filter(r => r.json).length,
      con_pdf:  resultados.filter(r => r.pdf).length,
      fallidos,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
