// supabase/functions/ensure_user_by_code/index.ts

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
    const body = await req.json().catch(() => ({}));
    const clean = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";

    if (!clean) return json({ ok: false, error: "CODE_REQUIRED", details: "El código no puede estar vacío." });

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "MISSING_ENV", details: "Faltan Secrets en Supabase." });

    const admin = createClient(supabaseUrl, serviceKey);

    // 🚨 FIX 1: Pedimos las columnas EXACTAS que existen en tu esquema.
    // Usamos "roles(name)" para traer el nombre del cargo automáticamente.
    const { data: rows, error: dbError } = await admin
      .from("employees")
      .select(`
        id, 
        code, 
        kiosk_pin, 
        name, 
        role_id, 
        branch_id, 
        photo_url, 
        username, 
        phone, 
        is_admin, 
        status,
        roles ( name )
      `)
      .or(`code.eq.${clean},kiosk_pin.eq.${clean}`)
      .limit(1);

    if (dbError) return json({ ok: false, error: "DB_ERROR", details: dbError.message });
    if (!rows?.length) return json({ ok: false, error: "NOT_FOUND", details: "Código o PIN no encontrado en el sistema." });

    const employee = rows[0];

    if (employee.status && employee.status !== "ACTIVO") {
      return json({ ok: false, error: "INACTIVE", details: "El empleado ha sido dado de baja." });
    }

    // 🚨 FIX 2: Construimos el correo usando tu campo "username"
    const baseEmail = employee.username || employee.code.toLowerCase();
    const email = `${baseEmail}@farmalasa.app`;

    // Intentamos crear el usuario en Auth por si no existía (Sincronización silenciosa)
    const createRes = await admin.auth.admin.createUser({
      id: employee.id, // VITAL para mantener sincronizadas ambas tablas
      email,
      password: clean, 
      email_confirm: true,
      user_metadata: { code: employee.code },
    });

    if (createRes.error) {
      const msg = (createRes.error.message || "").toLowerCase();
      const isAlready = msg.includes("already") || msg.includes("exists") || msg.includes("registered") || msg.includes("duplicate");
      if (!isAlready) {
        return json({ ok: false, error: "AUTH_CREATE_ERROR", details: createRes.error.message });
      }
    }

    // Respuesta limpia
    return json({
        ok: true,
        user: {
          id: employee.id,
          name: employee.name,
          code: employee.code,
          role: employee.roles?.name || "Sin Cargo", // Extraído directo de la tabla de roles
          branchId: employee.branch_id,
          photo: employee.photo_url,
          email: email,
          phone: employee.phone,
          isAdmin: employee.is_admin === true,
          userType: employee.is_admin ? "admin" : "employee",
        }
    });

  } catch (e) {
    return json({ ok: false, error: "UNHANDLED", details: String((e as Error)?.message ?? e) });
  }
});