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
        role:roles!employees_role_id_fkey ( name )
      `)
      .or(`code.eq.${clean},kiosk_pin.eq.${clean}`)
      .limit(1);

    if (dbError) return json({ ok: false, error: "DB_ERROR", details: dbError.message });
    if (!rows?.length) return json({ ok: false, error: "NOT_FOUND", details: "Código o PIN no encontrado en el sistema." });

    const employee = rows[0];

    if (employee.status && employee.status !== "ACTIVO") {
      return json({ ok: false, error: "INACTIVE", details: "El empleado ha sido dado de baja." });
    }

    // Determinar si el match fue por kiosk_pin o por code/username
    const matchedByKioskPin = employee.kiosk_pin != null &&
      employee.kiosk_pin.trim().toUpperCase() === clean;

    let email: string;
    let createPayload: Record<string, unknown>;

    if (matchedByKioskPin) {
      // Usuario kiosk: email propio, password = kiosk_pin
      // No usamos id: employee.id porque el usuario portal ya lo ocupa
      email = `${employee.kiosk_pin.toLowerCase()}@staff.local`;
      createPayload = {
        email,
        password: employee.kiosk_pin,
        email_confirm: true,
        user_metadata: { code: employee.code, kiosk: true },
      };
    } else {
      // Usuario portal: email username@farmalasa.app
      // Usamos id: employee.id para mantener la FK con la tabla employees
      const baseEmail = employee.username || employee.code.toLowerCase();
      email = `${baseEmail}@farmalasa.app`;

      // Generar contraseña inicial aleatoria segura (sin caracteres ambiguos O/0/l/1/I)
      const randomPassword = (): string => {
        const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
        let result = '';
        const array = new Uint8Array(12);
        crypto.getRandomValues(array);
        array.forEach(b => result += chars[b % chars.length]);
        return result;
      };
      const initialPassword = randomPassword();

      createPayload = {
        id: employee.id,
        email,
        password: initialPassword,
        email_confirm: true,
        user_metadata: {
          code: employee.code,
          must_change_password: true,
        },
      };
    }

    // Crear usuario Auth si no existe (si ya existe, el error se ignora silenciosamente)
    const createRes = await admin.auth.admin.createUser(createPayload);
    const isNewUser = !createRes.error;

    if (createRes.error) {
      const msg = (createRes.error.message || "").toLowerCase();
      const isAlready = msg.includes("already") || msg.includes("exists") || msg.includes("registered") || msg.includes("duplicate");
      if (!isAlready) {
        return json({ ok: false, error: "AUTH_CREATE_ERROR", details: createRes.error.message });
      }
    }

    // Respuesta limpia — igual en ambos flujos
    return json({
      ok: true,
      isNewUser,
      user: {
        id: employee.id,
        name: employee.name,
        code: employee.code,
        role: (employee.role as { name?: string } | null)?.name || "Sin Cargo",
        branchId: employee.branch_id,
        photo: employee.photo_url,
        email,
        phone: employee.phone,
        isAdmin: employee.is_admin === true,
        userType: employee.is_admin ? "admin" : "employee",
      },
    });

  } catch (e) {
    return json({ ok: false, error: "UNHANDLED", details: String((e as Error)?.message ?? e) });
  }
});