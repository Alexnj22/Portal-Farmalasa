import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireInvokeSecret } from "../_shared/security.ts";

// Calcula MIN/MAX para las 7 sucursales en secuencia, luego notifica
// a los Supervisores de Ventas (con fallback al jefe inmediato si están
// de vacaciones/incapacidad/permiso hoy).
// Disparado por pg_cron el día 1 de cada mes a las 3am (El Salvador).

const ERP_ORDER = [5, 1, 2, 3, 4, 7, 6];
const ERP_NAMES: Record<number, string> = {
  1: "Salud 1",
  2: "Salud 2",
  3: "Salud 3",
  4: "Salud 4",
  5: "La Popular",
  6: "Bodega",
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

  const results: { id: number; name: string; rows?: number; error?: string }[] = [];
  let totalRows = 0;

  for (const id of ERP_ORDER) {
    const { data, error } = await supabase.rpc("calculate_stock_params", {
      p_erp_sucursal_id: id,
    });
    if (error) {
      results.push({ id, name: ERP_NAMES[id], error: error.message });
      console.error(`[auto-calculate-minmax] Error en ${ERP_NAMES[id]}:`, error.message);
    } else {
      const rows = (data as { rows?: number })?.rows ?? 0;
      totalRows += rows;
      results.push({ id, name: ERP_NAMES[id], rows });
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
      ? `Cálculo completado (${succeeded.length}/${ERP_ORDER.length} sucursales). Errores en: ${failed.join(", ")}. Revisá los borradores en MinMax.`
      : `${totalRows.toLocaleString()} borradores generados para las ${ERP_ORDER.length} sucursales. Revisá los cambios y publicá lo que corresponda.`;

    try {
      const pushRes = await fetch(pushUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${invokeSecret}`,
        },
        body: JSON.stringify({
          title: "Recálculo mensual MIN/MAX",
          message,
          url: "/minmax",
          urgent: false,
          target_type: "EMPLOYEE",
          target_value: empIds,
        }),
      });
      if (pushRes.ok) {
        const pushData = await pushRes.json();
        notified = pushData.sent ?? 0;
      }
    } catch (err) {
      console.error("[auto-calculate-minmax] Error al enviar push:", err);
    }
  }

  console.log(
    `[auto-calculate-minmax] totalRows=${totalRows} failed=${failed.length} notified=${notified}`,
  );

  return new Response(
    JSON.stringify({ results, totalRows, failed, approversNotified: notified }),
    { headers: { ...cors, "Content-Type": "application/json" } },
  );
});
