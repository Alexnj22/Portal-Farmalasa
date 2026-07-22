import { createClient } from "npm:@supabase/supabase-js@2";
import JSZip from "npm:jszip@3.10.1";
import { getCorsHeaders, requireActiveEmployeeUser } from "../_shared/security.ts";

// Descarga masiva de facturas de compra (JSON+PDF) — arma el ZIP en memoria y
// lo devuelve directo en la respuesta, sin persistir un archivo temporal en
// Storage (decisión de diseño, ver PLAN-FACTURAS-COMPRA-2026-07.md).
const BUCKET = "purchase-dte";
const MAX_ITEMS = 300; // tope de seguridad — evita timeouts en selecciones enormes

function relativePath(publicUrl: string | null): string | null {
  if (!publicUrl) return null;
  const marker = `/object/public/${BUCKET}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return null;
  return publicUrl.slice(idx + marker.length);
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  // Descarga = acción de lectura: basta con can_view (no can_edit como
  // "Sincronizar ahora", que sí escribe).
  const employee = await requireActiveEmployeeUser(req, admin);
  if (!employee) {
    return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const { data: empRole } = await admin.from("employees").select("role_id").eq("id", employee.id).single();
  const { data: perm } = await admin.from("role_permissions").select("can_view")
    .eq("role_id", empRole?.role_id ?? -1).eq("module_key", "facturas_compra").single();
  if (perm?.can_view !== true) {
    return new Response(JSON.stringify({ error: "FORBIDDEN" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const ids: number[] = Array.isArray(body.ids) ? body.ids.map(Number).filter(Boolean) : [];
    if (ids.length === 0) {
      return new Response(JSON.stringify({ error: "ids vacío" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (ids.length > MAX_ITEMS) {
      return new Response(JSON.stringify({ error: `Máximo ${MAX_ITEMS} documentos por descarga — acotá el rango de fechas.` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: rows, error: selErr } = await admin
      .from("purchase_dte_documents")
      .select("id, codigo_generacion, json_path, pdf_path")
      .in("id", ids);
    if (selErr) throw new Error(selErr.message);

    const zip = new JSZip();
    let included = 0;
    const warnings: string[] = [];

    // Fase 5 E4 (PLAN-MEJORAS-DTE-PROVEEDORES-2026-07.md): antes cada
    // .download() esperaba al anterior (serie) — una descarga de 300 docs
    // (hasta 600 archivos) tardaba minutos. Tandas de 8 en paralelo bajan
    // eso a segundos, sin saturar la conexión a Storage.
    type DownloadTask = { baseName: string; rel: string; ext: 'json' | 'pdf' };
    const tasks: DownloadTask[] = [];
    for (const row of rows ?? []) {
      // codigo_generacion es NULL en docs "confirmados sin JSON" (ver
      // TabRevision) — sin este fallback, 2+ documentos así en la misma
      // descarga masiva generaban null.json/null.pdf y JSZip los pisaba
      // entre sí, perdiendo archivos sin ningún aviso.
      const baseName = row.codigo_generacion || `doc-${row.id}`;
      const jsonRel = relativePath(row.json_path);
      if (jsonRel) tasks.push({ baseName, rel: jsonRel, ext: 'json' });
      const pdfRel = relativePath(row.pdf_path);
      if (pdfRel) tasks.push({ baseName, rel: pdfRel, ext: 'pdf' });
    }

    const CONCURRENCY = 8;
    for (let i = 0; i < tasks.length; i += CONCURRENCY) {
      const batch = tasks.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(async (t) => {
        const { data, error } = await admin.storage.from(BUCKET).download(t.rel);
        return { t, data, error };
      }));
      for (const { t, data, error } of results) {
        if (data) { zip.file(`${t.baseName}.${t.ext}`, await data.arrayBuffer()); included++; }
        else warnings.push(`${t.baseName}.${t.ext}: ${error?.message ?? 'no se pudo descargar'}`);
      }
    }

    if (included === 0) {
      return new Response(JSON.stringify({ error: "Ningún archivo pudo incluirse" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (warnings.length > 0) {
      zip.file("manifest-errores.txt", `Archivos que no se pudieron incluir en este ZIP:\n\n${warnings.join('\n')}\n`);
    }

    const zipBytes = await zip.generateAsync({ type: "uint8array" });
    const filename = `facturas-compra-${new Date().toISOString().slice(0, 10)}.zip`;

    // Content-Type application/octet-stream (no application/zip): el cliente
    // supabase-js solo devuelve Blob para octet-stream/pdf/json — cualquier
    // otro tipo cae a response.text() y corrompe el binario. El nombre del
    // archivo en Content-Disposition ya le dice al navegador que es un .zip.
    return new Response(zipBytes, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
