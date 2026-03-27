// supabase/functions/set-employee-password/index.ts

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

Deno.serve(async (req: Request) => {
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

    // Buscar por id primero
    let { data: callerData } = await admin.from("employees")
      .select("is_admin, id, username, code")
      .eq("id", caller.id).single();

    // Fallback 1: buscar por username (para login con username@farmalasa.app)
    if (!callerData) {
      const callerUsername = caller.email?.split('@')[0].toLowerCase();
      const { data: f1 } = await admin.from("employees")
        .select("is_admin")
        .eq("username", callerUsername).single();
      callerData = f1;
    }

    // Fallback 2: buscar por code (para login con carné: EMP001@staff.local)
    if (!callerData) {
      const callerCode = caller.email?.split('@')[0].toUpperCase();
      const { data: f2 } = await admin.from("employees")
        .select("is_admin")
        .eq("code", callerCode).single();
      callerData = f2;
    }

    if (!callerData?.is_admin)
      return json({ ok: false, error: "INSUFFICIENT_PERMISSIONS", details: `Acceso denegado para: ${caller.email}` });

    // 2. Procesar datos
    const body = await req.json().catch(() => ({}));
    const username = typeof body?.username === "string" ? body.username.toLowerCase().trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!username || !password) return json({ ok: false, error: "MISSING_FIELDS" });
    if (password.length < 6) return json({ ok: false, error: "PASSWORD_TOO_SHORT" });

    const email = `${username}@farmalasa.app`;

    const { data: rows, error: dbErr } = await admin.from("employees").select("id, code, status").eq("username", username).limit(1);
    if (dbErr || !rows?.length) return json({ ok: false, error: "EMPLOYEE_NOT_FOUND", details: "El username no existe en la base de datos." });

    const employee = rows[0];
    if (employee.status && employee.status !== "ACTIVO") return json({ ok: false, error: "EMPLOYEE_INACTIVE", details: "Empleado dado de baja." });

    // 3. Actualizar o Crear en Auth
    const { data: existingAuth } = await admin.auth.admin.getUserById(employee.id);

    if (existingAuth?.user) {
      const { error: updErr } = await admin.auth.admin.updateUserById(employee.id, {
        password, user_metadata: { username, code: employee.code, must_change_password: false },
      });
      if (updErr) return json({ ok: false, error: "AUTH_UPDATE_ERROR", details: updErr.message });
    } else {
      const { error: createErr } = await admin.auth.admin.createUser({
        id: employee.id, email, password: "1234", email_confirm: true,
        user_metadata: { username, code: employee.code, must_change_password: true },
      });
      if (createErr) return json({ ok: false, error: "AUTH_CREATE_ERROR", details: createErr.message });
    }

    return json({ ok: true });
    
  } catch (e) {
    return json({ ok: false, error: "UNHANDLED_EXCEPTION", details: String((e as Error)?.message ?? e) });
  }
});