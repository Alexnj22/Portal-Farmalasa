// supabase/functions/set-employee-password/index.ts

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno&no-check";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const username =
      typeof body?.username === "string" ? body.username.toLowerCase().trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!username || !password)
      return json({ ok: false, error: "MISSING_FIELDS" }, 400);

    if (password.length < 6)
      return json({ ok: false, error: "PASSWORD_TOO_SHORT" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    // Intentar custom secret primero, luego la variable built-in de Supabase
    const serviceKey =
      Deno.env.get("SERVICE_ROLE_KEY") ??
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
      "";

    if (!supabaseUrl || !serviceKey)
      return json({ ok: false, error: "MISSING_ENV" }, 500);

    const admin = createClient(supabaseUrl, serviceKey);
    const email = `${username}@farmalasa.app`;

    // 1) Buscar empleado por username para obtener el code
    const { data: rows, error: dbErr } = await admin
      .from("employees")
      .select("id, code, username, status")
      .eq("username", username)
      .limit(1);

    if (dbErr || !rows?.length)
      return json({ ok: false, error: "EMPLOYEE_NOT_FOUND" }, 404);

    const employee = rows[0];

    if (employee.status && employee.status !== "ACTIVO")
      return json({ ok: false, error: "EMPLOYEE_INACTIVE" }, 403);

    // 2) Buscar si ya existe el usuario en Auth con ese email
    const { data: listData } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const existingUser = listData?.users?.find((u) => u.email === email);

    if (existingUser) {
      // Actualizar contraseña y user_metadata
      const { error: updErr } = await admin.auth.admin.updateUserById(existingUser.id, {
        password,
        user_metadata: { username, code: employee.code },
      });
      if (updErr) return json({ ok: false, error: "AUTH_UPDATE_ERROR", details: updErr.message }, 500);
    } else {
      // Crear nuevo usuario Auth
      const { error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { username, code: employee.code },
      });
      if (createErr)
        return json({ ok: false, error: "AUTH_CREATE_ERROR", details: createErr.message }, 500);
    }

    return json({ ok: true });
  } catch (e) {
    return json(
      { ok: false, error: "UNHANDLED", details: String((e as Error)?.message ?? e) },
      500
    );
  }
});
