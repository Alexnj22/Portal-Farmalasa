import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, checkCronSecret, requireActiveEmployeeUser } from "../_shared/security.ts";
import { extractRelatedDocRef, resolveRelatedDocId } from "../_shared/dteRelatedDoc.ts";

// Backfill de emparejamiento CCF↔Nota de Crédito/Débito (a pedido del
// usuario 2026-07-18): recorre las NC/ND (tipo_dte 05/06) que todavía no
// tienen documento_relacionado_id, lee su JSON, y matchea contra el
// documento original ya guardado. Mismo patrón hasMore que
// backfill-proveedores-dte — se puede correr varias veces.

const BUCKET        = "purchase-dte";
const BATCH_SIZE     = 200;
const TIME_BUDGET_MS = 100_000;

function pathFromPublicUrl(url: string): string {
  const marker = `/${BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) throw new Error(`json_path inesperado (sin /${BUCKET}/): ${url}`);
  return url.slice(idx + marker.length);
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  let authorized = checkCronSecret(req);
  if (!authorized) {
    const employee = await requireActiveEmployeeUser(req, admin);
    if (employee) {
      const { data: empRole } = await admin.from("employees").select("role_id").eq("id", employee.id).single();
      const { data: perm } = await admin.from("role_permissions").select("can_edit")
        .eq("role_id", empRole?.role_id ?? -1).eq("module_key", "facturas_compra").single();
      authorized = perm?.can_edit === true;
    }
  }
  if (!authorized) {
    return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { data: rows, error: rowsErr } = await admin
      .from("purchase_dte_documents")
      .select("id, tipo_dte, json_path")
      .in("tipo_dte", ["05", "06"])
      .is("documento_relacionado_id", null)
      .order("id", { ascending: true })
      .limit(BATCH_SIZE);
    if (rowsErr) throw new Error(`purchase_dte_documents: ${rowsErr.message}`);

    let processed = 0;
    let matched    = 0;
    let sinMatch    = 0;
    const warnings: string[] = [];
    const startTime = Date.now();
    let cutOff = false;

    for (const row of (rows ?? [])) {
      if (Date.now() - startTime > TIME_BUDGET_MS) { cutOff = true; break; }
      processed++;

      let json: any;
      try {
        const path = pathFromPublicUrl(row.json_path);
        const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(path);
        if (dlErr) throw new Error(dlErr.message);
        json = JSON.parse(await blob.text());
      } catch (e: any) {
        warnings.push(`doc ${row.id}: no se pudo leer/parsear json_path — ${e.message}`);
        sinMatch++;
        continue;
      }

      const ref = extractRelatedDocRef(json);
      if (!ref) { sinMatch++; continue; }

      const relatedId = await resolveRelatedDocId(admin, ref);
      if (!relatedId) { sinMatch++; continue; }

      const { error: updErr } = await admin
        .from("purchase_dte_documents")
        .update({ documento_relacionado_id: relatedId })
        .eq("id", row.id);
      if (updErr) {
        warnings.push(`doc ${row.id}: set documento_relacionado_id — ${updErr.message}`);
        sinMatch++;
        continue;
      }
      matched++;
    }

    const hasMore = cutOff || (rows ?? []).length === BATCH_SIZE;
    return new Response(JSON.stringify({
      success: true, hasMore, processed, matched, sinMatch,
      warnings: warnings.slice(0, 50),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
