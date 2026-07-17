import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireInvokeSecret } from "../_shared/security.ts";

// Calcula MIN/MAX para las 6 sucursales de venta en secuencia, luego notifica
// a los Supervisores de Ventas (con fallback al jefe inmediato si están
// de vacaciones/incapacidad/permiso hoy).
// Disparado por pg_cron el día 1 de cada mes a las 9am (El Salvador, UTC-6 = 15:00 UTC).
//
// Bodega (erp_sucursal_id=6) NO se incluye a propósito (auditoría 2026-07-17):
// su MIN/MAX real se mantiene solo/en tiempo real vía el trigger
// trg_bodega_draft_sync (SUM de las sucursales) y publish_stock_params —
// calculate_stock_params(6) generaba un borrador independiente basado en
// demanda agregada que NUNCA podía aplicarse (publish_stock_params excluye
// erp_sucursal_id=6 en ambos bloques) y quedaba como ruido acumulado.

const ERP_ORDER = [5, 1, 2, 3, 4, 7];
const ERP_NAMES: Record<number, string> = {
  1: "Salud 1",
  2: "Salud 2",
  3: "Salud 3",
  4: "Salud 4",
  5: "La Popular",
  7: "Salud 5",
};

serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  if (!requireInvokeSecret(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const results: { id: number; name: string; rows?: number; auto_applied?: number; drafted?: number; error?: string }[] = [];
  let totalRows = 0;
  let totalAutoApplied = 0;
  let totalDrafted = 0;

  for (const id of ERP_ORDER) {
    const { data, error } = await supabase.rpc("calculate_stock_params", {
      p_erp_sucursal_id: id,
    });
    if (error) {
      results.push({ id, name: ERP_NAMES[id], error: error.message });
      console.error(`[auto-calculate-minmax] Error en ${ERP_NAMES[id]}:`, error.message);
      await supabase.from("minmax_sync_log").insert({
        source: "auto-calculate-minmax",
        erp_sucursal_id: id,
        success: false,
        error_msg: error.message.slice(0, 2000),
      });
    } else {
      const r = (data as { rows?: number; auto_applied?: number; drafted?: number }) ?? {};
      const rows = r.rows ?? 0;
      const autoApplied = r.auto_applied ?? 0;
      const drafted = r.drafted ?? 0;
      totalRows += rows;
      totalAutoApplied += autoApplied;
      totalDrafted += drafted;
      results.push({ id, name: ERP_NAMES[id], rows, auto_applied: autoApplied, drafted });
      await supabase.from("minmax_sync_log").insert({
        source: "auto-calculate-minmax",
        erp_sucursal_id: id,
        success: true,
        items_count: rows,
      });
    }
  }

  const failed = results.filter((r) => r.error).map((r) => r.name);
  const succeeded = results.filter((r) => !r.error);

  // Obtener IDs de supervisores disponibles (con fallback a jefe inmediato)
  const { data: approverIds, error: approverErr } = await supabase.rpc(
    "get_minmax_approver_ids",
  );
  if (approverErr) {
    console.error("[auto-calculate-minmax] Error al obtener aprobadores:", approverErr.message);
  }
  const empIds: string[] = approverIds ?? [];

  let notified = 0;
  if (empIds.length > 0) {
    const pushUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-push-notification`;
    const invokeSecret = Deno.env.get("ADMIN_INVOKE_SECRET")!;

    const message = failed.length > 0
      ? `Recálculo completado con errores (${succeeded.length}/${ERP_ORDER.length} sucursales). Errores en: ${failed.join(", ")}. Revisá los borradores en MinMax.`
      : totalDrafted > 0
        ? `Recálculo mensual completado. ${totalAutoApplied.toLocaleString()} productos actualizados automáticamente · ${totalDrafted.toLocaleString()} requieren revisión en MinMax.`
        : `Recálculo mensual completado. ${totalAutoApplied.toLocaleString()} productos actualizados automáticamente. No hay borradores pendientes.`;

    const pushTitle = "Recálculo mensual MIN/MAX";
    try {
      const pushRes = await fetch(pushUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${invokeSecret}`,
          "x-cron-secret": Deno.env.get("CRON_INVOKE_SECRET") ?? "",
        },
        body: JSON.stringify({
          title: pushTitle,
          message,
          url: "/minmax",
          urgent: false,
          target_type: "EMPLOYEE",
          target_value: empIds,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (pushRes.ok) {
        const pushData = await pushRes.json();
        notified = pushData.sent ?? 0;
      }
    } catch (err) {
      console.error("[auto-calculate-minmax] Error al enviar push:", err);
    }

    // Anuncio persistente con trazabilidad de lectura (read_by[])
    try {
      await supabase.from("announcements").insert({
        title: pushTitle,
        message,
        target_type: "EMPLOYEE",
        target_value: empIds,
        read_by: [],
        is_archived: false,
        created_by: null,
        priority: failed.length > 0 ? "HIGH" : "NORMAL",
        metadata: {
          type: "MINMAX_AUTO_CALCULATE",
          totalRows,
          totalAutoApplied,
          totalDrafted,
          succeeded: succeeded.length,
          failed,
          url: "/minmax",
        },
      });
    } catch (err) {
      console.error("[auto-calculate-minmax] Error al crear anuncio:", err);
    }
  }

  console.log(
    `[auto-calculate-minmax] totalRows=${totalRows} autoApplied=${totalAutoApplied} drafted=${totalDrafted} failed=${failed.length} notified=${notified}`,
  );

  return new Response(
    JSON.stringify({ results, totalRows, failed, approversNotified: notified }),
    { headers: { ...cors, "Content-Type": "application/json" } },
  );
});
