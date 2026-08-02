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
    const body = await req.json().catch(() => ({}));
    const { after_id = 0 } = body;

    // Fase 5 E6 (PLAN-MEJORAS-DTE-PROVEEDORES-2026-07.md): mismo bug que
    // backfill-proveedores-dte — una NC/ND cuyo original todavía no llegó
    // (sinMatch) queda en la cabeza de la cola para siempre, hasMore nunca
    // baja. Cursor explícito (after_id / nextAfterId).
    // El filtro es `doc_relacionado_ref IS NULL` y ya no
    // `documento_relacionado_id IS NULL`: son dos preguntas distintas y confundir
    // una con la otra era el problema de fondo. "¿Ya leí el JSON de esta nota?"
    // la responde la referencia cruda; "¿encontré el documento que corrige?" la
    // responde el id. Con el filtro viejo, una nota cuyo CCF original nunca llegó
    // por correo se releía de Storage en cada corrida, para siempre, y nunca
    // guardaba nada — 85 de 139 notas estaban en ese estado.
    const { data: rows, error: rowsErr } = await admin
      .from("purchase_dte_documents")
      .select("id, tipo_dte, json_path, emisor_nit")
      .in("tipo_dte", ["05", "06"])
      .is("doc_relacionado_ref", null)
      .gt("id", after_id)
      .order("id", { ascending: true })
      .limit(BATCH_SIZE);
    if (rowsErr) throw new Error(`purchase_dte_documents: ${rowsErr.message}`);

    let processed = 0;
    let matched    = 0;
    let ligadasACompra = 0;
    let sinMatch    = 0;
    let lastId      = after_id;
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
        warnings.push(`doc ${row.id}: no se pudo leer/parsear json_path — ${e.message}`);
        sinMatch++;
        continue;
      }

      const ref = extractRelatedDocRef(json);
      if (!ref) { sinMatch++; continue; }

      // La referencia CRUDA se guarda siempre, resuelva o no. Es lo que permite
      // reintentar el vínculo con un UPDATE el día que la compra aparezca, en vez
      // de volver a bajar el JSON de Storage.
      const refCruda = ref.byCodigoGeneracion ?? ref.byNumeroControl;
      const relatedId = await resolveRelatedDocId(admin, ref);

      // Y además se busca la COMPRA que la nota corrige. El CCF original muchas
      // veces no llegó por correo pero sí está en el ERP, que es donde la
      // contadora lo necesita. Se liga solo si hay exactamente una y el NIT del
      // proveedor coincide: el documento del ERP viene truncado a 20 caracteres
      // y su propio sync advierte que "no siempre es único".
      let compraId: number | null = null;
      if (ref.byCodigoGeneracion && row.emisor_nit) {
        const { data: compras, error: cErr } = await admin
          .from("purchase_receipts")
          .select("id, proveedores_maestro!inner(nit)")
          .eq("documento_numero", ref.byCodigoGeneracion.toUpperCase().slice(0, 20))
          .eq("proveedores_maestro.nit", row.emisor_nit)
          .limit(2);
        if (cErr) warnings.push(`doc ${row.id}: buscando la compra — ${cErr.message}`);
        else if ((compras ?? []).length === 1) compraId = compras![0].id;
      }

      if (!refCruda && !relatedId && !compraId) { sinMatch++; continue; }

      const { error: updErr } = await admin
        .from("purchase_dte_documents")
        .update({
          doc_relacionado_ref: refCruda,
          ...(relatedId ? { documento_relacionado_id: relatedId } : {}),
          ...(compraId  ? { corrige_purchase_receipt_id: compraId } : {}),
        })
        .eq("id", row.id);
      if (updErr) {
        warnings.push(`doc ${row.id}: guardando la relación — ${updErr.message}`);
        sinMatch++;
        continue;
      }
      // Se cuentan por separado los dos destinos, porque son dos preguntas
      // distintas: encontrar el DTE original (que puede no haber llegado nunca)
      // y encontrar la compra del ERP (que es lo que la contadora necesita).
      if (relatedId) matched++;
      if (compraId)  ligadasACompra++;
      if (!relatedId && !compraId) sinMatch++;
    }

    const hasMore = cutOff || (rows ?? []).length === BATCH_SIZE;
    return new Response(JSON.stringify({
      success: true, hasMore, processed, matched, ligadasACompra, sinMatch,
      // nextAfterId avanza incluso en sinMatch (original aún no sincronizado)
      // — a diferencia de backfill-proveedores-dte, esos SÍ podrían resolver
      // en el futuro cuando el original llegue. El cursor solo evita
      // re-escanear la MISMA cabeza de cola dentro de una limpieza manual en
      // curso; para recapturar NC/ND que quedaron sinMatch, volver a correr
      // con after_id=0 (o sin after_id) periódicamente — no programar el
      // cursor persistente como si fuera un checkpoint definitivo.
      nextAfterId: lastId,
      warnings: warnings.slice(0, 50),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
