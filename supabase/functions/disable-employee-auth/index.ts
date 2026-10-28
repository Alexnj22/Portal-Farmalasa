// supabase/functions/disable-employee-auth/index.ts
// Desactiva (ban) o reactiva las cuentas Auth de un empleado:
// 1) la cuenta principal username@farmalasa.app (id = employees.id)
// 2) las cuentas de carné/kiosco {code}@staff.local y {kiosk_pin}@staff.local
// Se invoca en la baja (TERMINATION), la recontratación (REHIRE), la cancelación
// de una baja, y desde el cron apply-scheduled-employee-events (vía ADMIN_INVOKE_SECRET).

import { createClient } from "npm:@supabase/supabase-js@2";
import { anotarAccionDeCuenta, permisoDeModulo, puedeTocarCuentaDe, requireActiveEmployeeUser } from "../_shared/security.ts";

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
    // usuario con permisos (staff_list -> can_edit, igual que
    // set-employee-password).
    //
    // Hasta el 2026-08-24 la segunda vía leía el permiso de
    // `caller.user_metadata`, que lo escribe el propio navegador. Cualquier
    // cuenta activa podía declararse `SUPERADMIN` y desactivarle la cuenta a
    // quien quisiera. El JWT dice QUIÉN sos —eso lo firma Supabase—; el permiso
    // lo resuelve la base. Fase 0 de
    // docs/planes-cerrados/PLAN-BLINDAJE-ANTE-TERCEROS-2026-08-13.md.
    const adminSecret = Deno.env.get("ADMIN_INVOKE_SECRET");
    let allowed = !!adminSecret && token === adminSecret;
    // La FICHA de quien llama (`employees.id`), no su cuenta de `auth.users`.
    // Ver abajo, en CANNOT_DISABLE_SELF, por qué la diferencia importa acá.
    let caller: { id: string; name: string; code: string } | null = null;

    if (!allowed) {
      caller = await requireActiveEmployeeUser(req, admin);
      if (!caller) return json({ ok: false, error: "INVALID_TOKEN" });

      const permiso = await permisoDeModulo(admin, caller.id, "staff_list", "can_edit");
      // «No se pudo averiguar» no es «no podés»: lo primero se reintenta, lo
      // segundo es una decisión. Contestar lo segundo cuando pasó lo primero
      // manda a la persona por el camino equivocado y esconde la falla real.
      if (permiso.roto) return json({ ok: false, error: "PERMISSION_CHECK_FAILED", details: permiso.roto });
      if (!permiso.puede) return json({ ok: false, error: "INSUFFICIENT_PERMISSIONS" });
    }

    const body = await req.json().catch(() => ({}));
    const employeeId = body?.employeeId ? String(body.employeeId) : "";
    const action = body?.action === "enable" ? "enable" : "disable";
    if (!employeeId) return json({ ok: false, error: "MISSING_FIELDS" });

    // Y este freno recién ahora funciona de verdad. Antes `caller` era el
    // usuario de `auth.users` y `employeeId` es la FICHA, y para 33 de las 42
    // personas que usan el portal esos dos ids NO son el mismo valor: entran por
    // una cuenta `*@staff.local` ligada en `employee_auth_accounts`. O sea que
    // la comparación daba `false` casi siempre y el candado contra
    // desactivarse a uno mismo no cerraba para casi nadie. `caller.id` ahora ES
    // la ficha, resuelta igual que `auth_employee_id()` en la base.
    if (action === "disable" && caller && caller.id === employeeId)
      return json({ ok: false, error: "CANNOT_DISABLE_SELF" });

    // No se bloquea —ni se desbloquea— la cuenta de un cargo de rango mayor
    // (2026-10-14). El cron entra con el secreto y no tiene `caller`: aplica
    // una baja que alguien con permiso ya decidió.
    if (caller) {
      const alcance = await puedeTocarCuentaDe(admin, caller.id, employeeId);
      if (alcance.roto) return json({ ok: false, error: "PERMISSION_CHECK_FAILED", details: alcance.roto });
      if (!alcance.puede) return json({ ok: false, error: "INSUFFICIENT_PERMISSIONS", details: "No puedes cambiar el acceso de un cargo superior al tuyo." });
    }

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

    // 2. Cuentas de carné/kiosco @staff.local. Cada fallo se ANOTA (2026-10-14):
    // antes el `catch {}` se tragaba el bloque entero y un bloqueo que no entró
    // se contaba igual en `touched`, o sea que la respuesta decía «bloqueada»
    // sobre una cuenta que seguía abierta.
    const fallidas: string[] = [];
    const { data: empRows, error: empErr } = await admin.from("employees").select("code, kiosk_pin").eq("id", employeeId).limit(1);
    if (empErr) fallidas.push(`ficha: ${empErr.message}`);
    const code = empRows?.[0]?.code?.trim();
    const pin = empRows?.[0]?.kiosk_pin?.trim() || (code ? await kioskPinFromCode(code) : null);
    // La cuenta `<número>@staff.local` se CIERRA con la baja pero no se
    // vuelve a abrir al recontratar: desde el 2026-10-14 nadie entra con el
    // número a secas (ver `ensure_user_by_code`), y reabrirla devolvería una
    // cuenta cuya contraseña es el número de vendedor.
    const emails = [...new Set([
      code && action === "disable" ? `${code.toLowerCase()}@staff.local` : null,
      pin ? `${pin.toLowerCase()}@staff.local` : null,
    ].filter(Boolean))] as string[];

    for (const email of emails) {
      try {
        const res = await fetch(`${supabaseUrl}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`, { headers: adminHeaders });
        if (!res.ok) { fallidas.push(`${email}: búsqueda ${res.status}`); continue; }
        const list = await res.json().catch(() => null);
        const match = (list?.users || []).find((u: { email?: string }) => u.email === email);
        if (!match?.id) continue;
        const { error: banErr } = await admin.auth.admin.updateUserById(match.id, { ban_duration: banDuration });
        if (banErr) { fallidas.push(`${email}: ${banErr.message}`); continue; }
        if (action === "disable") await revokeSessions(match.id);
        touched++;
      } catch (e) {
        fallidas.push(`${email}: ${String((e as Error)?.message ?? e)}`);
      }
    }

    // 3. El carné de PAPEL del día (2026-10-14). Vale hasta medianoche y su
    // cuenta (`carne-<id>@staff.local`) no la tocaba la baja: quien se iba con
    // el papel en el bolsillo seguía entrando el resto del día.
    if (action === "disable") {
      const { data: papeles, error: papErr } = await admin.from("carnes_temporales")
        .update({ anulado_el: new Date().toISOString() })
        .eq("employee_id", employeeId).is("anulado_el", null)
        .select("auth_user_id");
      if (papErr) fallidas.push(`carné de papel: ${papErr.message}`);
      for (const p of (papeles ?? []) as { auth_user_id: string | null }[]) {
        if (!p.auth_user_id) continue;
        const { error: apErr } = await admin.rpc("apagar_cuenta_de_carne_temporal", { p_auth_user_id: p.auth_user_id });
        if (apErr) fallidas.push(`carné de papel: ${apErr.message}`);
        else touched++;
      }
    }

    if (caller) {
      await anotarAccionDeCuenta(admin, caller, action === "disable" ? "ACCESO_CERRADO" : "ACCESO_REABIERTO", employeeId,
        { cuentas: touched, fallidas }, fallidas.length ? "CRITICAL" : "WARNING");
    }
    if (fallidas.length) return json({ ok: false, error: "PARCIAL", details: fallidas.join(" · "), accounts: touched });
    if (touched === 0) return json({ ok: true, skipped: "NO_AUTH_USER" });
    return json({ ok: true, action, accounts: touched });
  } catch (e) {
    return json({ ok: false, error: "UNHANDLED", details: String((e as Error)?.message ?? e) });
  }
});
