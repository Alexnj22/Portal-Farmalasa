// supabase/functions/bulk-create-employee-users/index.ts

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
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !serviceKey)
      return json({ ok: false, error: "MISSING_ENV" });

    const admin = createClient(supabaseUrl, serviceKey);

    // 1. Obtener todos los empleados activos con username
    const { data: employees, error: dbError } = await admin
      .from("employees")
      .select("id, username, kiosk_pin, name, code, status")
      .eq("status", "ACTIVO")
      .not("username", "is", null);

    if (dbError) return json({ ok: false, error: "DB_ERROR", details: dbError.message });
    if (!employees?.length) return json({ ok: true, created: 0, skipped: 0, errors: [] });

    let created = 0;
    let skipped = 0;
    const errors: { username: string; error: string }[] = [];

    // 2. Intentar crear usuario Auth para cada empleado
    for (const emp of employees) {
      const email = `${emp.username.toLowerCase().trim()}@farmalasa.app`;

      const { error } = await admin.auth.admin.createUser({
        id: emp.id,
        email,
        password: "1234",
        email_confirm: true,
        user_metadata: {
          must_change_password: true,
          code: emp.code,
          username: emp.username,
        },
      });

      if (!error) {
        created++;
      } else {
        const msg = error.message.toLowerCase();
        const isDuplicate =
          msg.includes("already") ||
          msg.includes("exists") ||
          msg.includes("registered") ||
          msg.includes("duplicate");

        if (isDuplicate) {
          skipped++;
        } else {
          errors.push({ username: emp.username, error: error.message });
        }
      }
    }

    return json({ ok: true, created, skipped, errors });
  } catch (e) {
    return json({ ok: false, error: "UNHANDLED", details: String((e as Error)?.message ?? e) });
  }
});
