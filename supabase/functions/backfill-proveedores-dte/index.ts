import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, checkCronSecret, requireActiveEmployeeUser } from "../_shared/security.ts";
import { extractProveedorFromDte, TIPOS_DTE_CON_PROVEEDOR } from "../_shared/proveedorFromDte.ts";

// Backfill del Maestro de Proveedores (PLAN-PROVEEDORES-2026-07.md Fase 2):
// recorre los JSON ya guardados en purchase-dte (sync-purchase-emails) que
// todavía no tienen proveedor_id, llama upsert_proveedor_from_dte y setea el
// FK. Se puede correr varias veces — cada corrida toma un batch nuevo hasta
// hasMore:false. Idempotente: reintentar un doc ya procesado (proveedor_id no
// NULL) no vuelve a ocurrir porque el filtro de la query ya lo excluye.

const BUCKET         = "purchase-dte";
const BATCH_SIZE      = 200; // filas leídas por corrida
const TIME_BUDGET_MS  = 100_000;

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
        .eq("role_id", empRole?.role_id ?? -1).eq("module_key", "proveedores").single();
      authorized = perm?.can_edit === true;
    }
  }
  if (!authorized) {
    return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { dry_run = false, after_id = 0 } = body;

    // Fase 5 E6 (PLAN-MEJORAS-DTE-PROVEEDORES-2026-07.md): el batch era
    // siempre "las primeras 200 por id sin proveedor_id" — una fila que
    // falla para siempre (JSON roto, sin nit/dui extraíble) queda en la
    // cabeza de la cola y hasMore nunca baja, sin importar cuántas veces se
    // corra. Cursor explícito (after_id, devuelto como nextAfterId) en vez
    // de re-consultar siempre desde el principio.
    const { data: rows, error: rowsErr } = await admin
      .from("purchase_dte_documents")
      .select("id, tipo_dte, json_path")
      .is("proveedor_id", null)
      .in("tipo_dte", TIPOS_DTE_CON_PROVEEDOR)
      .gt("id", after_id)
      .order("id", { ascending: true })
      .limit(BATCH_SIZE);
    if (rowsErr) throw new Error(`purchase_dte_documents: ${rowsErr.message}`);

    let processed = 0;
    let upserted   = 0;
    let skipped    = 0;
    let lastId     = after_id; // avanza el cursor incluso en filas que se skippean para siempre
    const warnings: string[] = [];
    const startTime = Date.now();
    let cutOff = false;

    for (const row of (rows ?? [])) {
      if (Date.now() - startTime > TIME_BUDGET_MS) { cutOff = true; break; }
      processed++;
      lastId = row.id;

      let json: any;
      try {
        const path = pathFromPublicUrl(row.json_path);
        const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(path);
        if (dlErr) throw new Error(dlErr.message);
        json = JSON.parse(await blob.text());
      } catch (e: any) {
        warnings.push(`doc ${row.id} (${row.tipo_dte}): no se pudo leer/parsear json_path — ${e.message}`);
        skipped++;
        continue;
      }

      const dte = extractProveedorFromDte(json);
      if (!dte) {
        warnings.push(`doc ${row.id} (${row.tipo_dte}): sin nit/dui/nombre extraíble`);
        skipped++;
        continue;
      }

      if (dry_run) { upserted++; continue; }

      // E3 (PLAN-MEJORAS-DTE-PROVEEDORES-2026-07.md Fase 5): el RPC devuelve
      // {id, supplier_id} — se aprovecha para setear también supplier_id acá
      // (antes este backfill dejaba ese campo sin tocar). Solo se incluye en
      // el UPDATE si el maestro sí tiene un match — no pisar con NULL un
      // supplier_id que ya viniera seteado por otra vía (ej. match ERP
      // manual anterior a la Fase 2.1).
      const { data: proveedorResult, error: rpcErr } = await admin.rpc("upsert_proveedor_from_dte", { p_data: dte });
      if (rpcErr) {
        warnings.push(`doc ${row.id}: upsert_proveedor_from_dte — ${rpcErr.message}`);
        skipped++;
        continue;
      }

      const updatePayload: Record<string, unknown> = { proveedor_id: proveedorResult?.id ?? null };
      if (proveedorResult?.supplier_id) updatePayload.supplier_id = proveedorResult.supplier_id;

      const { error: updErr } = await admin
        .from("purchase_dte_documents")
        .update(updatePayload)
        .eq("id", row.id);
      if (updErr) {
        warnings.push(`doc ${row.id}: set proveedor_id — ${updErr.message}`);
        continue;
      }
      upserted++;
    }

    const hasMore = cutOff || (rows ?? []).length === BATCH_SIZE;
    return new Response(JSON.stringify({
      success: true, dry_run, hasMore, processed, upserted, skipped,
      nextAfterId: lastId, // pasar como after_id en la siguiente corrida
      warnings: warnings.slice(0, 50),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
