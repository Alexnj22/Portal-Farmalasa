// supabase/functions/ensure_user_by_code/index.ts

import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireAuthUser } from "../_shared/security.ts";

// ─── Admin client a nivel de módulo para reutilizar conexiones entre invocaciones cálidas ───
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin       = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")   return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  if (!admin)                  return json({ ok: false, error: "MISSING_ENV" }, 500);

  const authenticatedUser = await requireAuthUser(req);

  try {
    const body = await req.json().catch(() => ({}));
    const raw  = typeof body?.code === "string" ? body.code.trim() : "";

    // ── Validación de input: solo caracteres seguros (excluye % _ para evitar inyección ILIKE) ──
    if (!raw || !/^[a-zA-Z0-9.\-]+$/.test(raw)) {
      return json({ ok: false, error: "CODE_INVALID" });
    }

    const clean = raw.toUpperCase();

    // ── Búsqueda parametrizada (sin interpolar input en .or()): primero por code
    // (case-insensitive), luego por kiosk_pin exacto. Los métodos .ilike/.eq
    // escapan el valor correctamente, evitando inyección en el filtro PostgREST.
    const SELECT_COLS = `
        id,
        code,
        kiosk_pin,
        name,
        role_id,
        branch_id,
        photo_url,
        username,
        phone,
        status,
        system_role,
        role:roles!employees_role_id_fkey ( name )
      `;

    let { data: rows, error: dbError } = await admin!
      .from("employees")
      .select(SELECT_COLS)
      .ilike("code", raw)
      .limit(1);

    if (!dbError && !rows?.length) {
      ({ data: rows, error: dbError } = await admin!
        .from("employees")
        .select(SELECT_COLS)
        .eq("kiosk_pin", clean)
        .limit(1));
    }

    if (dbError) return json({ ok: false, error: "DB_ERROR", details: dbError.message });
    if (!rows?.length) return json({ ok: false, error: "NOT_FOUND" });

    const employee = rows[0];

    if (employee.status && employee.status !== "ACTIVO") {
      return json({ ok: false, error: "INACTIVE" });
    }

    const matchedByKioskPin =
      employee.kiosk_pin != null &&
      employee.kiosk_pin.trim().toUpperCase() === clean;

    // ── Email e info de creación según tipo de usuario ──
    let email: string;
    let createPayload: Record<string, unknown>;

    if (matchedByKioskPin) {
      email = `${employee.kiosk_pin.toLowerCase()}@staff.local`;
      createPayload = {
        email,
        password: employee.kiosk_pin,
        email_confirm: true,
        user_metadata: { code: employee.code, kiosk: true },
      };
    } else {
      const baseEmail = employee.username || employee.code.toLowerCase();
      email = `${baseEmail}@farmalasa.app`;

      const randomPassword = (): string => {
        const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
        let result = "";
        const array = new Uint8Array(12);
        crypto.getRandomValues(array);
        array.forEach(b => (result += chars[b % chars.length]));
        return result;
      };

      createPayload = {
        id: employee.id,
        email,
        password: randomPassword(),
        email_confirm: true,
        user_metadata: { code: employee.code, must_change_password: true },
      };
    }

    // ── Crear usuario Auth solo si no existe ──
    const createRes = await admin!.auth.admin.createUser(createPayload);
    const isNewUser = !createRes.error;
    if (createRes.error) {
      const msg      = (createRes.error.message || "").toLowerCase();
      const isExisting = msg.includes("already") || msg.includes("exists") ||
                         msg.includes("registered") || msg.includes("duplicate");
      if (!isExisting) return json({ ok: false, error: "AUTH_CREATE_ERROR", details: createRes.error.message });
    }

    // ── Pre-login (no autenticado): solo devuelve email para completar signIn ──
    if (!authenticatedUser) {
      return json({ ok: true, isNewUser, user: { email, isKiosk: matchedByKioskPin } });
    }

    // ── Post-login (autenticado): actualiza JWT metadata solo si cambió algo ──
    const newRoleId     = employee.role_id     ?? null;
    const newSystemRole = (employee.system_role as string | null) || "EMPLEADO";
    const newBranchId   = employee.branch_id   ?? null;
    const curMeta       = authenticatedUser.user_metadata || {};

    const metaChanged =
      curMeta.roleId            !== newRoleId     ||
      curMeta.systemRole        !== newSystemRole  ||
      curMeta.branchId          !== newBranchId    ||
      curMeta.must_change_password !== false;

    if (metaChanged) {
      await admin!.auth.admin.updateUserById(authenticatedUser.id, {
        user_metadata: {
          ...curMeta,
          roleId:               newRoleId,
          systemRole:           newSystemRole,
          branchId:             newBranchId,
          must_change_password: false,
        },
      });
    }

    return json({
      ok: true,
      isNewUser,
      user: {
        id:         employee.id,
        name:       employee.name,
        code:       employee.code,
        username:   employee.username ?? null,
        role:       (employee.role as { name?: string } | null)?.name || "Sin Cargo",
        roleId:     newRoleId,
        branchId:   newBranchId,
        photo:      employee.photo_url,
        email,
        phone:      employee.phone,
        systemRole: newSystemRole,
      },
    });

  } catch (e) {
    return json({ ok: false, error: "UNHANDLED", details: String((e as Error)?.message ?? e) });
  }
});
