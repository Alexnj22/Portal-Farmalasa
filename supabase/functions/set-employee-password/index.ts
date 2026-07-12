// supabase/functions/set-employee-password/index.ts

import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/security.ts";

// Contraseña temporal aleatoria (sin caracteres ambiguos) para resets.
// Reemplaza los valores triviales '1234'/'123456' que permitían tomar cuentas
// no usadas antes del primer login.
function randomTempPassword(len = 10): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  let out = "";
  arr.forEach(b => (out += chars[b % chars.length]));
  return out;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = { ...getCorsHeaders(req), "Access-Control-Allow-Methods": "POST, OPTIONS" };
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ ok: false, error: "MISSING_AUTH_HEADER", details: "El frontend no envió el JWT." });

    const token = authHeader.replace('Bearer ', '').trim();
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "MISSING_ENV", details: "Faltan los Secrets en la nube." });

    const admin = createClient(supabaseUrl, serviceKey);

    // 1. Validar token y extraer quién está haciendo la petición
    const { data: { user: caller }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !caller) return json({ ok: false, error: "INVALID_TOKEN", details: "El token expiró o es inválido." });

    // Verificar permiso: SUPERADMIN tiene acceso total; los demás necesitan staff_list → can_edit
    const meta = caller.user_metadata || {};
    const isSuperAdmin = meta.systemRole === 'SUPERADMIN';
    let canSetPassword = isSuperAdmin;

    if (!canSetPassword && meta.roleId) {
      const { data: perm } = await admin.from('role_permissions')
        .select('can_edit')
        .eq('role_id', meta.roleId)
        .eq('module_key', 'staff_list')
        .single();
      canSetPassword = perm?.can_edit === true;
    }

    if (!canSetPassword)
      return json({ ok: false, error: "INSUFFICIENT_PERMISSIONS", details: `Acceso denegado para: ${caller.email}` });

    // 2. Procesar datos
    const body = await req.json().catch(() => ({}));
    const username = typeof body?.username === "string" ? body.username.toLowerCase().trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    // password === '1234' es el sentinel de "resetear a temporal".
    const isResetRequest = password === '1234';
    if (!username || !password) return json({ ok: false, error: "MISSING_FIELDS" });
    if (!isResetRequest && password.length < 8) {
        return json({ ok: false, error: "PASSWORD_TOO_SHORT", details: "Mínimo 8 caracteres." });
    }

    const email = `${username}@farmalasa.app`;

    const { data: rows, error: dbErr } = await admin.from("employees").select("id, code, status").eq("username", username).limit(1);
    if (dbErr || !rows?.length) return json({ ok: false, error: "EMPLOYEE_NOT_FOUND", details: "El username no existe en la base de datos." });

    const employee = rows[0];
    if (employee.status && employee.status !== "ACTIVO") return json({ ok: false, error: "EMPLOYEE_INACTIVE", details: "Empleado dado de baja." });

    // En un reset (o creación) generamos una contraseña temporal aleatoria que
    // se devuelve SOLO al admin autorizado para que se la comunique al empleado.
    const tempPassword = randomTempPassword();

    // 3. Actualizar o Crear en Auth
    const { data: existingAuth } = await admin.auth.admin.getUserById(employee.id);

    if (existingAuth?.user) {
      const effectivePassword = isResetRequest ? tempPassword : password;
      const { error: updErr } = await admin.auth.admin.updateUserById(employee.id, {
        password: effectivePassword, user_metadata: { username, code: employee.code, must_change_password: isResetRequest },
      });
      if (updErr) return json({ ok: false, error: "AUTH_UPDATE_ERROR", details: updErr.message });
    } else {
      const { error: createErr } = await admin.auth.admin.createUser({
        id: employee.id, email, password: tempPassword, email_confirm: true,
        user_metadata: { username, code: employee.code, must_change_password: true },
      });
      if (createErr) return json({ ok: false, error: "AUTH_CREATE_ERROR", details: createErr.message });
    }

    // Devolver la temporal sólo cuando la generamos nosotros (reset o creación).
    const generated = isResetRequest || !existingAuth?.user;
    return json({ ok: true, ...(generated ? { tempPassword } : {}) });
    
  } catch (e) {
    return json({ ok: false, error: "UNHANDLED_EXCEPTION", details: String((e as Error)?.message ?? e) });
  }
});