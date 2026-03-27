// supabase/functions/set-employee-password/index.ts

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno&no-check";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req: Request) => {
  // 1. Manejo de CORS
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    // 🚨 2. CERO ADIVINANZAS: Exigimos el Header de Autorización
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ ok: false, error: "MISSING_AUTH_HEADER", details: "Llamada bloqueada. Se requiere token JWT." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    if (!supabaseUrl || !serviceKey || !anonKey) return json({ ok: false, error: "MISSING_ENV" }, 500);

    // 🚨 3. AUDITORÍA DE SEGURIDAD: Identificamos quién hace la petición
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user: caller }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !caller) return json({ ok: false, error: "UNAUTHORIZED_CALLER" }, 401);

    // Cliente Admin (Para saltarse el RLS y crear el usuario en Auth)
    const admin = createClient(supabaseUrl, serviceKey);

    // Verificamos que el caller sea realmente un Administrador
    const { data: callerData } = await admin
      .from("employees")
      .select("is_admin")
      .eq("id", caller.id)
      .single();

    if (!callerData?.is_admin) {
        return json({ ok: false, error: "INSUFFICIENT_PERMISSIONS", details: "Solo un administrador puede forzar/crear contraseñas." }, 403);
    }

    // 4. Procesamiento de Datos
    const body = await req.json().catch(() => ({}));
    const username = typeof body?.username === "string" ? body.username.toLowerCase().trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!username || !password) return json({ ok: false, error: "MISSING_FIELDS" }, 400);
    if (password.length < 6) return json({ ok: false, error: "PASSWORD_TOO_SHORT" }, 400);

    const email = `${username}@farmalasa.app`;

    // Buscar datos del empleado destino
    const { data: rows, error: dbErr } = await admin
      .from("employees")
      .select("id, code, status")
      .eq("username", username)
      .limit(1);

    if (dbErr || !rows?.length) return json({ ok: false, error: "EMPLOYEE_NOT_FOUND" }, 404);

    const employee = rows[0];

    if (employee.status && employee.status !== "ACTIVO") {
        return json({ ok: false, error: "EMPLOYEE_INACTIVE" }, 403);
    }

    // 🚨 5. MODO SOLUCIÓN: Usamos getUserById en vez del costoso listUsers
    // Asumimos Integridad Referencial: Auth.id === employee.id
    const { data: existingAuth, error: checkErr } = await admin.auth.admin.getUserById(employee.id);

    if (existingAuth?.user) {
      // El usuario existe en Auth, actualizamos contraseña
      const { error: updErr } = await admin.auth.admin.updateUserById(employee.id, {
        password,
        user_metadata: { username, code: employee.code },
      });
      if (updErr) return json({ ok: false, error: "AUTH_UPDATE_ERROR", details: updErr.message }, 500);
    } else {
      // El usuario NO existe en Auth, lo creamos forzando el ID para enlazarlo a su perfil
      const { error: createErr } = await admin.auth.admin.createUser({
        id: employee.id, // VITAL: Vincula el auth con la tabla employees
        email,
        password,
        email_confirm: true,
        user_metadata: { username, code: employee.code },
      });
      if (createErr) return json({ ok: false, error: "AUTH_CREATE_ERROR", details: createErr.message }, 500);
    }

    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: "UNHANDLED", details: String((e as Error)?.message ?? e) }, 500);
  }
});