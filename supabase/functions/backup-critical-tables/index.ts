// supabase/functions/backup-critical-tables/index.ts
// Backup semanal de las tablas de trabajo manual/configuración al bucket
// privado 'backups' (gzip). Los datos del ERP (ventas/inventario/productos)
// NO se exportan: se recuperan por resync. Cron: domingos 08:00 UTC (2am SV).
// Retención: elimina backups de más de 60 días.

import { createClient } from "npm:@supabase/supabase-js@2";

const TABLES = [
  "employees", "roles", "role_permissions", "branches", "shifts", "holidays",
  "employee_branches", "employee_events", "employee_documents", "employee_rosters",
  "product_stock_params", "dispatch_rules", "stock_config", "minmax_ignored",
  "product_categories", "erp_sucursal_map",
  "kiosk_devices", "overtime_bank", "payroll_periods", "payroll_entries",
  "vacation_plan_headers", "vacation_plans", "audit_logs",
  // ── Bitácoras: el registro que la norma manda conservar MÁS tiempo ──────
  // RTS 11.02.04:24 §6.2.16 conserva temperatura y humedad **2 años**, y la
  // Guía de Verificación de BPAD 3.12 la dispensación bajo receta 1 año. No
  // se recuperan por resync: se anotan a mano en la sala y no existen en
  // ningún otro sistema.
  //
  // Y el respaldo es una de las CINCO secciones obligatorias del protocolo de
  // supervisión del sistema electrónico que exige el §6.1.15 para llevar las
  // bitácoras en digital. Hasta el 2026-09-03 ninguna de las 7 tablas estaba
  // acá: el control existía como frase y no alcanzaba lo que iba a declarar.
  // Pesan 1.3 MB en total.
  //
  // ⚠️ Esta lista y el whitelist de `backup_dump_table` (migración
  // 20260903174328) son la MISMA lista dicha dos veces, y se mueven juntas.
  // Una tabla agregada sólo acá vuelve `TABLE_NOT_ALLOWED`, y como el contador
  // de fallos hace que la corrida entera reporte `ok: false`, se cae el
  // respaldo COMPLETO — no sólo la tabla nueva.
  "bitacora_areas", "bitacora_lecturas", "bitacora_limpiezas",
  "bitacora_correcciones", "bitacora_cierres", "bitacora_dispensaciones",
  "bitacora_folios",
  // Anular una limpieza hacía DELETE sin dejar rastro. Desde el 2026-09-03 la
  // foto de lo anulado (y de lo corregido) vive acá, así que esta tabla ES el
  // registro: sin ella, el respaldo guardaría la limpieza que quedó y no la
  // que alguien quitó.
  "bitacora_limpiezas_historial",
];

const RETENTION_DAYS = 60;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function gzip(data: string): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const secret = Deno.env.get("ADMIN_INVOKE_SECRET");
  const auth = req.headers.get("Authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) return json({ ok: false, error: "UNAUTHORIZED" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "MISSING_ENV" });
  const admin = createClient(supabaseUrl, serviceKey);

  const today = new Date(Date.now() - 6 * 3600 * 1000).toISOString().split("T")[0];
  const results: Record<string, unknown> = {};
  let okCount = 0, failCount = 0, totalBytes = 0;

  try {
    // 1. Exportar cada tabla (RPC con whitelist, solo service_role)
    for (const table of TABLES) {
      try {
        const { data, error } = await admin.rpc("backup_dump_table", { p_table: table });
        if (error) throw new Error(error.message);
        const rows = Array.isArray(data) ? data.length : 0;
        const compressed = await gzip(JSON.stringify(data ?? []));
        const path = `${today}/${table}.json.gz`;
        const { error: upErr } = await admin.storage.from("backups")
          .upload(path, compressed, { contentType: "application/gzip", upsert: true });
        if (upErr) throw new Error(upErr.message);
        results[table] = { rows, kb: Math.round(compressed.byteLength / 1024) };
        totalBytes += compressed.byteLength;
        okCount++;
      } catch (e) {
        results[table] = { error: String((e as Error)?.message ?? e) };
        failCount++;
      }
    }

    // 2. Retención: borrar carpetas (YYYY-MM-DD) de más de RETENTION_DAYS
    try {
      const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400 * 1000).toISOString().split("T")[0];
      const { data: folders } = await admin.storage.from("backups").list("", { limit: 200 });
      for (const f of folders ?? []) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(f.name) || f.name >= cutoff) continue;
        const { data: files } = await admin.storage.from("backups").list(f.name, { limit: 100 });
        const paths = (files ?? []).map((x) => `${f.name}/${x.name}`);
        if (paths.length) await admin.storage.from("backups").remove(paths);
      }
    } catch { /* la retención no bloquea el backup */ }

    const backupOk = failCount === 0;
    const failedTables = Object.entries(results)
      .filter(([, v]) => (v as any)?.error)
      .map(([k]) => k);
    await admin.from("backup_sync_log").insert({
      success: backupOk,
      error_msg: backupOk ? null : failedTables.join(", ").slice(0, 2000),
      tables_ok: okCount,
      tables_failed: failCount,
      total_kb: Math.round(totalBytes / 1024),
    });

    return json({
      ok: backupOk,
      date: today,
      tables_ok: okCount,
      tables_failed: failCount,
      total_kb: Math.round(totalBytes / 1024),
      results,
    });
  } catch (e) {
    try {
      await admin.from("backup_sync_log").insert({
        success: false,
        error_msg: String((e as Error)?.message ?? e).slice(0, 2000),
      });
    } catch { /* logging no debe tapar el error original */ }
    return json({ ok: false, error: "UNHANDLED", details: String((e as Error)?.message ?? e) });
  }
});
