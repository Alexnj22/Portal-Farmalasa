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

    // 🚨 FIX MAESTRO: Búsqueda Inteligente (Ignorando mayúsculas)
    let { data: callerData } = await admin.from("employees").select("is_admin").eq("id", caller.id).single();
    
    if (!callerData) {
        // Obligamos a que el correo se lea en minúsculas para que haga match con la DB
        const callerUsername = caller.email ? caller.email.split('@')[0].toLowerCase() : '';
        const { data: fallbackData } = await admin.from("employees").select("is_admin").eq("username", callerUsername).single();
        callerData = fallbackData;
    }

    if (!callerData?.is_admin) {
        return json({ ok: false, error: "INSUFFICIENT_PERMISSIONS", details: `La base de datos rechazó al usuario: ${caller.email}` });
    }

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
        password, user_metadata: { username, code: employee.code },
      });
      if (updErr) return json({ ok: false, error: "AUTH_UPDATE_ERROR", details: updErr.message });
    } else {
      const { error: createErr } = await admin.auth.admin.createUser({
        id: employee.id, email, password, email_confirm: true, user_metadata: { username, code: employee.code },
      });
      if (createErr) return json({ ok: false, error: "AUTH_CREATE_ERROR", details: createErr.message });
    }

    return json({ ok: true });
    
  } catch (e) {
    return json({ ok: false, error: "UNHANDLED_EXCEPTION", details: String((e as Error)?.message ?? e) });
  }
});