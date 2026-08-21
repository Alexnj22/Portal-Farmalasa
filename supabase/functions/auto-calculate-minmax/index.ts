import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireInvokeSecret } from "../_shared/security.ts";
import { ERP_ORDER_MINMAX } from "../_shared/minmax.ts";

// Calcula MIN/MAX para las 6 sucursales de venta en secuencia, luego notifica
// a los Supervisores de Ventas (con fallback al jefe inmediato si están
// de vacaciones/incapacidad/permiso hoy).
// Disparado por pg_cron el día 1 de cada mes a las 9am (El Salvador, UTC-6 = 15:00 UTC).
//
// Quién entra en el recálculo —y por qué Bodega no— vive en _shared/minmax.ts:
// `check-sync-health-alerts` necesita la MISMA lista para saber a quién le toca
// correr, y hasta el 2026-08-21 no la tenía (ver el comentario de ese archivo).

const ERP_ORDER = ERP_ORDER_MINMAX;
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

  // calculate_stock_params puede devolver { ok:false, skipped:true, reason } —
  // p.ej. la sucursal tiene borradores pendientes de revisar. Eso NO es un
  // cálculo: es un cálculo que no ocurrió, y hay que decirlo. Tratarlo como
  // éxito con rows=0 es lo que hizo que el recálculo llevara desde junio sin
  // correr en las 6 sucursales sin que nadie se enterara — el aviso decía
  // "completado, no hay borradores pendientes" mientras no se calculaba nada.
  const MOTIVOS: Record<string, string> = {
    branch_has_pending_drafts: "tiene borradores pendientes de revisar",
    // Candado de mantenimiento (F0): alguien tiene MIN·MAX o Pedidos en
    // mantenimiento. El cron se salta el recálculo a propósito para no
    // reescribir min/max por debajo de quien está trabajando.
    module_locked: "el módulo está en mantenimiento",
  };

  const results: { id: number; name: string; rows?: number; auto_applied?: number; drafted?: number; error?: string; skipped?: string }[] = [];
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
      continue;
    }

    const r = (data as { rows?: number; auto_applied?: number; drafted?: number; skipped?: boolean; reason?: string; locked_by?: string }) ?? {};

    if (r.skipped) {
      const motivo = (MOTIVOS[r.reason ?? ""] ?? (r.reason ?? "motivo desconocido")) +
        (r.locked_by ? ` (${r.locked_by})` : "");
      results.push({ id, name: ERP_NAMES[id], skipped: motivo });
      console.warn(`[auto-calculate-minmax] SALTADA ${ERP_NAMES[id]}: ${motivo}`);
      // success:false a propósito: desde "¿se recalculó esta sucursal?", una
      // saltada es un no. Así cualquier consulta al log la ve.
      await supabase.from("minmax_sync_log").insert({
        source: "auto-calculate-minmax",
        erp_sucursal_id: id,
        success: false,
        error_msg: `SALTADA: ${motivo}`.slice(0, 2000),
        items_count: 0,
      });
      continue;
    }

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

  const failed = results.filter((r) => r.error).map((r) => r.name);
  const skipped = results.filter((r) => r.skipped);
  const succeeded = results.filter((r) => !r.error && !r.skipped);

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

    // El detalle de lo que se saltó va SIEMPRE que haya algo saltado: es la
    // información que faltaba para notar que el recálculo no estaba corriendo.
    const detalleSaltadas = skipped.length > 0
      ? ` No se recalcularon ${skipped.length} de ${ERP_ORDER.length}: ${skipped.map((s) => `${s.name} (${s.skipped})`).join(", ")}.`
      : "";

    const nadaSeCalculo = succeeded.length === 0;

    const message = nadaSeCalculo && skipped.length > 0 && failed.length === 0
      // El caso que antes salía como "completado, no hay borradores pendientes".
      ? `NO se recalculó ninguna sucursal: las ${skipped.length} se saltaron.${detalleSaltadas} El MIN/MAX quedó igual que el mes pasado.`
      : failed.length > 0
        ? `Recálculo con errores (${succeeded.length}/${ERP_ORDER.length} sucursales calculadas). Errores en: ${failed.join(", ")}.${detalleSaltadas} Revisá MinMax.`
        : totalDrafted > 0
          ? `Recálculo mensual completado en ${succeeded.length}/${ERP_ORDER.length} sucursales. ${totalAutoApplied.toLocaleString()} productos actualizados automáticamente · ${totalDrafted.toLocaleString()} requieren revisión en MinMax.${detalleSaltadas}`
          : `Recálculo mensual completado en ${succeeded.length}/${ERP_ORDER.length} sucursales. ${totalAutoApplied.toLocaleString()} productos actualizados automáticamente. No hay borradores pendientes.${detalleSaltadas}`;

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
          // Que no se recalculara nada sí es urgente: el MIN/MAX se quedó viejo
          // y nadie lo sabría hasta el mes siguiente.
          urgent: failed.length > 0 || nadaSeCalculo,
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
        // Que no se recalculara NADA es tan urgente como un error: en los dos
        // casos el MIN/MAX se quedó viejo.
        priority: (failed.length > 0 || nadaSeCalculo) ? "HIGH" : "NORMAL",
        metadata: {
          type: "MINMAX_AUTO_CALCULATE",
          totalRows,
          totalAutoApplied,
          totalDrafted,
          succeeded: succeeded.length,
          failed,
          skipped: skipped.map((s) => ({ name: s.name, reason: s.skipped })),
          url: "/minmax",
        },
      });
    } catch (err) {
      console.error("[auto-calculate-minmax] Error al crear anuncio:", err);
    }
  }

  console.log(
    `[auto-calculate-minmax] calculadas=${succeeded.length}/${ERP_ORDER.length} saltadas=${skipped.length} totalRows=${totalRows} autoApplied=${totalAutoApplied} drafted=${totalDrafted} failed=${failed.length} notified=${notified}`,
  );

  return new Response(
    JSON.stringify({
      results,
      totalRows,
      calculated: succeeded.length,
      skipped: skipped.map((s) => ({ name: s.name, reason: s.skipped })),
      failed,
      approversNotified: notified,
    }),
    { headers: { ...cors, "Content-Type": "application/json" } },
  );
});
