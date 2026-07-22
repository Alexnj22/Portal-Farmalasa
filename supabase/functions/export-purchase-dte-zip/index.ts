import { createClient } from "npm:@supabase/supabase-js@2";
import JSZip from "npm:jszip@3.10.1";
import { getCorsHeaders, requireActiveEmployeeUser } from "../_shared/security.ts";

// Descarga masiva de facturas de compra (JSON+PDF) — arma el ZIP en memoria y
// lo devuelve directo en la respuesta, sin persistir un archivo temporal en
// Storage (decisión de diseño, ver PLAN-FACTURAS-COMPRA-2026-07.md).
const BUCKET = "purchase-dte";
const MAX_ITEMS = 300; // tope de seguridad — evita timeouts en selecciones enormes

// Catálogo oficial DTE (Ministerio de Hacienda El Salvador) — duplicado del
// mapping de src/utils/dteTypes.js porque las edge functions (Deno) no
// pueden importar módulos de src/ (resolución de módulos distinta). Mismo
// texto, mantener sincronizados si el catálogo cambia.
const DTE_TYPE_FOLDERS: Record<string, string> = {
  "01": "Factura",
  "03": "Credito Fiscal (CCF)",
  "04": "Nota de Remision",
  "05": "Nota de Credito",
  "06": "Nota de Debito",
  "07": "Comprobante de Retencion",
  "08": "Comprobante de Liquidacion",
  "09": "Doc. Contable de Liquidacion",
  "11": "Factura de Exportacion",
  "14": "Factura Sujeto Excluido",
};
function folderForTipo(tipoDte: string | null): string {
  if (!tipoDte) return "Sin clasificar";
  return DTE_TYPE_FOLDERS[tipoDte] || `Tipo ${tipoDte}`;
}

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
    // Pedido del usuario 2026-07-22: la descarga masiva también debe traer
    // lo que sigue pendiente en Revisión (PDFs huérfanos, JSON inválido,
    // etc.), en su propia carpeta "Revisar" — el cliente lo pide solo en la
    // primera tanda (downloadPurchaseDteZipBulk) para no duplicarlo cuando
    // el rango de fechas necesita varias llamadas.
    const includePendingReview = body.include_pending_review === true;
    if (ids.length === 0 && !includePendingReview) {
      return new Response(JSON.stringify({ error: "ids vacío" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (ids.length > MAX_ITEMS) {
      return new Response(JSON.stringify({ error: `Máximo ${MAX_ITEMS} documentos por descarga — acotá el rango de fechas.` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const zip = new JSZip();
    let included = 0;
    const warnings: string[] = [];

    // Fase 5 E4 (PLAN-MEJORAS-DTE-PROVEEDORES-2026-07.md): antes cada
    // .download() esperaba al anterior (serie) — una descarga de 300 docs
    // (hasta 600 archivos) tardaba minutos. Tandas en paralelo bajan eso a
    // segundos, sin saturar la conexión a Storage. Carpetas por tipo_dte
    // (pedido del usuario 2026-07-22) — más fácil de auditar/contar por
    // tipo de documento sin abrir cada archivo.
    type DownloadTask = { entryName: string; rel: string };
    const tasks: DownloadTask[] = [];

    if (ids.length > 0) {
      const { data: rows, error: selErr } = await admin
        .from("purchase_dte_documents")
        .select("id, codigo_generacion, tipo_dte, json_path, pdf_path")
        .in("id", ids);
      if (selErr) throw new Error(selErr.message);

      for (const row of rows ?? []) {
        // codigo_generacion es NULL en docs "confirmados sin JSON" (ver
        // TabRevision) — sin este fallback, 2+ documentos así en la misma
        // descarga masiva generaban null.json/null.pdf y JSZip los pisaba
        // entre sí, perdiendo archivos sin ningún aviso.
        const baseName = row.codigo_generacion || `doc-${row.id}`;
        const folder = folderForTipo(row.tipo_dte);
        const jsonRel = relativePath(row.json_path);
        if (jsonRel) tasks.push({ entryName: `${folder}/${baseName}.json`, rel: jsonRel });
        const pdfRel = relativePath(row.pdf_path);
        if (pdfRel) tasks.push({ entryName: `${folder}/${baseName}.pdf`, rel: pdfRel });
      }
    }

    if (includePendingReview) {
      const { data: pending, error: pendErr } = await admin
        .from("purchase_dte_review_queue")
        .select("id, file_path, filename")
        .eq("status", "pendiente");
      if (pendErr) throw new Error(pendErr.message);
      for (const row of pending ?? []) {
        const rel = relativePath(row.file_path);
        if (!rel) continue;
        // Prefijo con el id de la fila — dos correos distintos pueden
        // llegar con el mismo nombre de archivo (ej. "Comprobante.pdf" de
        // proveedores distintos) y JSZip pisaría uno con otro sin avisar.
        tasks.push({ entryName: `Revisar/${row.id}_${row.filename || `archivo-${row.id}`}`, rel });
      }
    }

    const CONCURRENCY = 16;
    for (let i = 0; i < tasks.length; i += CONCURRENCY) {
      const batch = tasks.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(async (t) => {
        const { data, error } = await admin.storage.from(BUCKET).download(t.rel);
        return { t, data, error };
      }));
      for (const { t, data, error } of results) {
        if (data) { zip.file(t.entryName, await data.arrayBuffer()); included++; }
        else warnings.push(`${t.entryName}: ${error?.message ?? 'no se pudo descargar'}`);
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

    // STORE (sin compresión): PDFs ya vienen comprimidos internamente y el
    // cliente vuelve a empaquetar este ZIP en un ZIP maestro cuando hay más
    // de una tanda (downloadPurchaseDteZipBulk) — deflate acá sería CPU
    // gastado dos veces por poco beneficio de tamaño. Empaquetado más rápido
    // era pedido explícito del usuario (2026-07-22).
    const zipBytes = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
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
