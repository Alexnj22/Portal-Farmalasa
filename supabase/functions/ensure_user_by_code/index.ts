// supabase/functions/ensure_user_by_code/index.ts

import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireAuthUser } from "../_shared/security.ts";

// ─── Admin client a nivel de módulo para reutilizar conexiones entre invocaciones cálidas ───
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin       = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;

// ── Rate limit anti fuerza-bruta: el password de login es el propio código
// (ver AuthContext.jsx signInWithPassword), así que este endpoint es el único
// oráculo que distingue código válido/activo de inválido. Solo se cuentan
// intentos FALLIDOS (NOT_FOUND/INACTIVE) por IP — un login exitoso nunca suma,
// así que un kiosco con tráfico real de múltiples empleados jamás lo dispara.
const RATE_LIMIT_WINDOW_MIN = 10;
const RATE_LIMIT_MAX_FAILURES = 15;

const SELECT_COLS = `
    id,
    code,
    kiosk_pin,
    name,
    role_id,
    secondary_role_id,
    branch_id,
    photo_url,
    username,
    phone,
    status,
    system_role,
    role:roles!employees_role_id_fkey ( name )
  `;

function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

async function isRateLimited(ip: string): Promise<boolean> {
  if (!admin) return false;
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MIN * 60_000).toISOString();
  const { count, error } = await admin
    .from("login_rate_limit")
    .select("id", { count: "exact", head: true })
    .eq("client_ip", ip)
    .gte("created_at", since);
  if (error) return false; // fail-open: no bloquear login real por un error de la tabla de rate-limit
  return (count ?? 0) >= RATE_LIMIT_MAX_FAILURES;
}

function recordFailure(ip: string): void {
  if (!admin) return;
  admin.from("login_rate_limit").insert({ client_ip: ip }).then(() => {});
}

// ── Identidad de quien ya tiene sesión ───────────────────────────────────────
// Espejo exacto de auth_employee_id() en la BD: el uid del JWT es el id del
// empleado (las cuentas del portal se crean con `id: employee.id`), y si no,
// el vínculo explícito de employee_auth_accounts cubre las del kiosco/carné.
// El `code` que venga en el cuerpo del pedido NO participa: hasta el 2026-08-04
// esta función tomaba ese código y devolvía el perfil de CUALQUIER empleado a
// cualquier sesión válida — y además copiaba su roleId/systemRole/branchId al
// metadata de quien preguntaba, que era una escalada directa a SUPERADMIN.
async function resolveEmployeeFromSession(uid: string) {
  if (!admin) return null;

  const direct = await admin.from("employees").select(SELECT_COLS).eq("id", uid).limit(1);
  if (direct.error) throw new Error(`employees por uid: ${direct.error.message}`);
  if (direct.data?.length) return direct.data[0];

  const link = await admin
    .from("employee_auth_accounts")
    .select("employee_id")
    .eq("auth_user_id", uid)
    .limit(1);
  if (link.error) throw new Error(`employee_auth_accounts: ${link.error.message}`);
  if (!link.data?.length) return null;

  const byLink = await admin
    .from("employees").select(SELECT_COLS).eq("id", link.data[0].employee_id).limit(1);
  if (byLink.error) throw new Error(`employees por vínculo: ${byLink.error.message}`);
  return byLink.data?.[0] ?? null;
}

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
  const clientIp = getClientIp(req);

  try {
    // ═══ Con sesión: devuelve el perfil de QUIEN PREGUNTA, y de nadie más ═══
    if (authenticatedUser) {
      const employee = await resolveEmployeeFromSession(authenticatedUser.id);
      if (!employee) return json({ ok: false, error: "NOT_FOUND" });
      if (employee.status && employee.status !== "ACTIVO") {
        return json({ ok: false, error: "INACTIVE" });
      }

      // El metadata del JWT ya no decide permisos (lo hacen las funciones auth_*
      // contra la tabla), pero el frontend lo lee para pintar la UI: se mantiene
      // al día con el empleado real, no con lo que pidió el cliente.
      const newRoleId     = employee.role_id ?? null;
      const newSystemRole = (employee.system_role as string | null) || "EMPLEADO";
      const newBranchId   = employee.branch_id ?? null;
      const curMeta       = authenticatedUser.user_metadata || {};

      const metaChanged =
        curMeta.roleId               !== newRoleId     ||
        curMeta.systemRole           !== newSystemRole ||
        curMeta.branchId             !== newBranchId   ||
        curMeta.code                 !== employee.code ||
        curMeta.must_change_password !== false;

      if (metaChanged) {
        await admin.auth.admin.updateUserById(authenticatedUser.id, {
          user_metadata: {
            ...curMeta,
            code:                 employee.code,
            roleId:               newRoleId,
            systemRole:           newSystemRole,
            branchId:             newBranchId,
            must_change_password: false,
          },
        });
      }

      return json({
        ok: true,
        isNewUser: false,
        user: {
          id:              employee.id,
          name:            employee.name,
          code:            employee.code,
          username:        employee.username ?? null,
          role:            (employee.role as { name?: string } | null)?.name || "Sin Cargo",
          roleId:          newRoleId,
          secondaryRoleId: employee.secondary_role_id ?? null,
          branchId:        newBranchId,
          photo:           employee.photo_url,
          email:           authenticatedUser.email,
          phone:           employee.phone,
          systemRole:      newSystemRole,
        },
      });
    }

    // ═══ Pre-login: sin sesión, el código es lo único que hay. Solo devuelve
    // el correo con el que completar el signIn — nunca datos del empleado. ═══
    const body = await req.json().catch(() => ({}));
    const raw  = typeof body?.code === "string" ? body.code.trim() : "";

    // ── Validación de input: solo caracteres seguros (excluye % _ para evitar inyección ILIKE) ──
    if (!raw || !/^[a-zA-Z0-9.\-]+$/.test(raw)) {
      return json({ ok: false, error: "CODE_INVALID" });
    }

    if (await isRateLimited(clientIp)) {
      return json({ ok: false, error: "RATE_LIMITED" }, 429);
    }

    const clean = raw.toUpperCase();

    // ── Búsqueda parametrizada (sin interpolar input en .or()): primero por code
    // (case-insensitive), luego por kiosk_pin exacto. Los métodos .ilike/.eq
    // escapan el valor correctamente, evitando inyección en el filtro PostgREST.
    let { data: rows, error: dbError } = await admin
      .from("employees")
      .select(SELECT_COLS)
      .ilike("code", raw)
      .limit(1);

    if (!dbError && !rows?.length) {
      ({ data: rows, error: dbError } = await admin
        .from("employees")
        .select(SELECT_COLS)
        .eq("kiosk_pin", clean)
        .limit(1));
    }

    if (dbError) return json({ ok: false, error: "DB_ERROR", details: dbError.message });
    if (!rows?.length) {
      recordFailure(clientIp);
      return json({ ok: false, error: "NOT_FOUND" });
    }

    const employee = rows[0];

    if (employee.status && employee.status !== "ACTIVO") {
      recordFailure(clientIp);
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
      // Carné escaneado / código de empleado: cuenta scan-style cuyo password es el
      // propio código normalizado (mismo modelo de seguridad que kiosk_pin). El cliente
      // siempre envía el código en mayúsculas, por eso se normaliza aquí también.
      const codeKey = employee.code.trim().toUpperCase();
      email = `${codeKey.toLowerCase()}@staff.local`;
      createPayload = {
        email,
        password: codeKey,
        email_confirm: true,
        user_metadata: { code: employee.code, kiosk: true },
      };
    }

    // ── Crear usuario Auth solo si no existe ──
    const createRes = await admin.auth.admin.createUser(createPayload);
    const isNewUser = !createRes.error;
    if (createRes.error) {
      const msg        = (createRes.error.message || "").toLowerCase();
      const isExisting = msg.includes("already") || msg.includes("exists") ||
                         msg.includes("registered") || msg.includes("duplicate");
      if (!isExisting) return json({ ok: false, error: "AUTH_CREATE_ERROR", details: createRes.error.message });
    }

    // El uid de estas cuentas lo genera Auth, así que no coincide con employees.id:
    // sin esta fila, las funciones auth_* no pueden resolver al empleado y la cuenta
    // queda sin permisos. Falla cerrada, nunca abierta.
    if (isNewUser && createRes.data?.user?.id) {
      const { error: linkErr } = await admin
        .from("employee_auth_accounts")
        .upsert({ auth_user_id: createRes.data.user.id, employee_id: employee.id },
                { onConflict: "auth_user_id" });
      if (linkErr) return json({ ok: false, error: "LINK_ERROR", details: linkErr.message });
    }

    return json({ ok: true, isNewUser, user: { email, isKiosk: matchedByKioskPin } });

  } catch (e) {
    return json({ ok: false, error: "UNHANDLED", details: String((e as Error)?.message ?? e) });
  }
});
