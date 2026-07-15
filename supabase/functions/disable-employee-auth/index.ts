// supabase/functions/disable-employee-auth/index.ts
// Desactiva (ban) o reactiva las cuentas Auth de un empleado:
// 1) la cuenta principal username@farmalasa.app (id = employees.id)
// 2) las cuentas de carné/kiosco {code}@staff.local y {kiosk_pin}@staff.local
// Se invoca en la baja (TERMINATION), la recontratación (REHIRE), la cancelación
// de una baja, y desde el cron apply-scheduled-employee-events (vía ADMIN_INVOKE_SECRET).

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Mismo algoritmo que generateHashCorto en el frontend: el kiosk_pin se deriva
// del código, así podemos localizar la cuenta @staff.local aunque el update de
// la baja ya haya puesto kiosk_pin = null.
async function kioskPinFromCode(code: string): Promise<string | null> {
  try {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
    const b64 = btoa(String.fromCharCode(...new Uint8Array(hash)));
    return b64.replace(/[^A-Za-z0-9]/g, "").toUpperCase().substring(0, 8);
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ ok: false, error: "MISSING_AUTH_HEADER" });
    const token = authHeader.replace("Bearer ", "").trim();

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "MISSING_ENV" });

    const admin = createClient(supabaseUrl, serviceKey);

    // Dos vías de autorización: ADMIN_INVOKE_SECRET (cron / interno) o JWT de
    // usuario con permisos (SUPERADMIN o staff_list -> can_edit, igual que
    // set-employee-password).
    const adminSecret = Deno.env.get("ADMIN_INVOKE_SECRET");
    let allowed = !!adminSecret && token === adminSecret;
    let caller: { id: string } | null = null;

    if (!allowed) {
      const { data, error: authErr } = await admin.auth.getUser(token);
      caller = data?.user ?? null;
      if (authErr || !caller) return json({ ok: false, error: "INVALID_TOKEN" });

      const meta = (data.user.user_metadata || {}) as Record<string, unknown>;
      allowed = meta.systemRole === "SUPERADMIN";
      if (!allowed && meta.roleId) {
        const { data: perm } = await admin.from("role_permissions")
          .select("can_edit")
          .eq("role_id", meta.roleId)
          .eq("module_key", "staff_list")
          .single();
        allowed = perm?.can_edit === true;
      }
      if (!allowed) return json({ ok: false, error: "INSUFFICIENT_PERMISSIONS" });
    }

    const body = await req.json().catch(() => ({}));
    const employeeId = body?.employeeId ? String(body.employeeId) : "";
    const action = body?.action === "enable" ? "enable" : "disable";
    if (!employeeId) return json({ ok: false, error: "MISSING_FIELDS" });

    if (action === "disable" && caller && caller.id === employeeId)
      return json({ ok: false, error: "CANNOT_DISABLE_SELF" });

    const banDuration = action === "disable" ? "876000h" : "none";
    const adminHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

    const revokeSessions = async (userId: string) => {
      // Best-effort: revocar los refresh tokens activos (GoTrue admin logout)
      try {
        await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}/logout`, {
          method: "POST",
          headers: adminHeaders,
        });
      } catch { /* no bloquea la baja */ }
    };

    // 1. Cuenta principal (username@farmalasa.app, id = employees.id)
    let touched = 0;
    const { data: existing } = await admin.auth.admin.getUserById(employeeId);
    if (existing?.user) {
      const { error: updErr } = await admin.auth.admin.updateUserById(employeeId, { ban_duration: banDuration });
      if (updErr) return json({ ok: false, error: "AUTH_UPDATE_ERROR", details: updErr.message });
      if (action === "disable") await revokeSessions(employeeId);
      touched++;
    }

    // 2. Cuentas de carné/kiosco @staff.local (best-effort; ensure_user_by_code
    // ya rechaza INACTIVE, esto solo cierra sesiones/refresh tokens residuales)
    try {
      const { data: empRows } = await admin.from("employees").select("code, kiosk_pin").eq("id", employeeId).limit(1);
      const code = empRows?.[0]?.code?.trim();
      const pin = empRows?.[0]?.kiosk_pin?.trim() || (code ? await kioskPinFromCode(code) : null);
      const emails = [...new Set([
        code ? `${code.toLowerCase()}@staff.local` : null,
        pin ? `${pin.toLowerCase()}@staff.local` : null,
      ].filter(Boolean))] as string[];

      for (const email of emails) {
        const res = await fetch(`${supabaseUrl}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`, { headers: adminHeaders });
        if (!res.ok) continue;
        const list = await res.json().catch(() => null);
        const match = (list?.users || []).find((u: { email?: string }) => u.email === email);
        if (match?.id) {
          await admin.auth.admin.updateUserById(match.id, { ban_duration: banDuration });
          if (action === "disable") await revokeSessions(match.id);
          touched++;
        }
      }
    } catch { /* best-effort */ }

    if (touched === 0) return json({ ok: true, skipped: "NO_AUTH_USER" });
    return json({ ok: true, action, accounts: touched });
  } catch (e) {
    return json({ ok: false, error: "UNHANDLED", details: String((e as Error)?.message ?? e) });
  }
});
