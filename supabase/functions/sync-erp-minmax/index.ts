import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, getErpInvMap, requireInvokeSecret } from "../_shared/security.ts";

// ERP credentials loaded from ERP_INV_BRANCH_MAP secret — never hardcode.
const LOGIN_URL   = "https://clientesdte3.oss.com.sv/farma_salud/login.php";
const REPOSI_BASE = "https://clientesdte3.oss.com.sv/farma_salud/reporte_reposicion_json.php";
const CHUNK       = 500;

// ERP sucursal_id (erpId in secret) → ERP ubicacion_id for the reposicion report
const ERPSUC_TO_UBICACION: Record<number, number> = {
  1: 3,  // Salud 1
  2: 4,  // Salud 2
  3: 5,  // Salud 3
  4: 6,  // Salud 4
  5: 7,  // La Popular
  6: 1,  // Bodega
  7: 8,  // Salud 5
};

async function getSessionCookie(username: string, password: string): Promise<string> {
  const form = new URLSearchParams();
  form.append("username", username);
  form.append("password", password);
  form.append("m", "1");
  const res = await fetch(LOGIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Login failed: no session cookie");
  return cookie;
}

// Caché de cookie por-invocación, keyed por credenciales (evita re-login por sucursal).
async function getCachedCookie(cache: Map<string, string>, username: string, password: string): Promise<string> {
  const key = `${username}|${password}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const cookie = await getSessionCookie(username, password);
  cache.set(key, cookie);
  return cookie;
}

async function syncBranch(
  supabase: any,
  erpId: number,
  username: string,
  password: string,
  now: string,
  cookieCache: Map<string, string>,
): Promise<{ erp_sucursal_id: number; inserted: number; skipped: number; errors: string[] }> {
  const ubicacionId = ERPSUC_TO_UBICACION[erpId];
  if (!ubicacionId) throw new Error(`No ubicacion mapping for erpId ${erpId}`);

  const cookie = await getCachedCookie(cookieCache, username, password);

  const url = `${REPOSI_BASE}?id_ubicacion=${ubicacionId}`;
  const res = await fetch(url, {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`ERP HTTP ${res.status} for ubicacion ${ubicacionId}`);

  const payload = await res.json();
  const items: any[] = payload?.items ?? [];
  if (items.length === 0) throw new Error(`Empty payload for erpId ${erpId} (ubicacion ${ubicacionId})`);

  const erp_sucursal_id = erpId;
  const errors: string[] = [];
  const rows: any[] = [];

  for (const item of items) {
    const erp_product_id = parseInt(item.id_producto, 10);
    if (!erp_product_id) continue;

    for (const d of (item.detalles ?? [])) {
      const erp_presentacion_id = d.id_presentacion ? parseInt(d.id_presentacion, 10) : null;

      // id_presentacion es obligatorio — si el ERP no lo envía, reportar y omitir la fila.
      if (!erp_presentacion_id) {
        errors.push(
          `[suc=${erp_sucursal_id}] producto ${erp_product_id} ("${item.producto}"): ` +
          `presentación "${d.presentacion ?? "?"}" sin id_presentacion en ERP`
        );
        continue;
      }

      rows.push({
        erp_sucursal_id,
        erp_product_id,
        erp_presentacion_id,    // FK → presentaciones(id), datos disponibles via JOIN
        detalle:   d.detalle ?? null,
        min_qty:   d.min    ?? null,
        max_qty:   d.max    ?? null,
        synced_at: now,
      });
    }
  }

  // UPSERT on natural key — avoid table bloat from DELETE+INSERT cycles
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase.from("erp_minmax")
      .upsert(rows.slice(i, i + CHUNK), {
        onConflict: "erp_sucursal_id,erp_product_id,erp_presentacion_id",
      });
    // FK violation (erp_presentacion_id no existe en presentaciones) se reporta aquí.
    if (error) errors.push(`upsert[suc=${erp_sucursal_id}][offset=${i}]: ${error.message}`);
  }

  // Delete rows removed from ERP since last sync
  const { error: delErr } = await supabase
    .from("erp_minmax")
    .delete()
    .eq("erp_sucursal_id", erp_sucursal_id)
    .lt("synced_at", now);
  if (delErr) errors.push(`delete stale[suc=${erp_sucursal_id}]: ${delErr.message}`);

  const skipped = items.reduce((s: number, item: any) => s + (item.detalles?.length ?? 0), 0) - rows.length;
  return { erp_sucursal_id, inserted: rows.length, skipped, errors };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!requireInvokeSecret(req)) {
    return new Response(JSON.stringify({ ok: false, error: "UNAUTHORIZED" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const body = await req.json().catch(() => ({}));
    const onlyErpId: number | null = body.erp_id ? Number(body.erp_id) : null;

    const INV_MAP = getErpInvMap();
    const now = new Date().toISOString();
    const results: any[] = [];
    const allErrors: string[] = [];
    const cookieCache = new Map<string, string>();

    for (const entry of INV_MAP) {
      if (onlyErpId && entry.erpId !== onlyErpId) continue;
      if (!ERPSUC_TO_UBICACION[entry.erpId]) continue;

      try {
        const r = await syncBranch(supabase, entry.erpId, entry.username, entry.password, now, cookieCache);
        results.push(r);
        if (r.errors.length > 0) allErrors.push(...r.errors);
      } catch (e: any) {
        allErrors.push(`sync[erpId=${entry.erpId}]: ${e.message}`);
      }
    }

    return new Response(
      JSON.stringify({ ok: allErrors.length === 0, synced: results.length, results, errors: allErrors }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
