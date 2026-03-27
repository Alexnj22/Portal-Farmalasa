// supabase/functions/ensure_user_by_code/index.ts

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno&no-check";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  // ✅ Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ ok: false, error: "METHOD_NOT_ALLOWED" }),
        {
          status: 405,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const body = await req.json().catch(() => ({}));
    const clean = typeof body?.code === "string"
      ? body.code.trim().toUpperCase()
      : "";

    if (!clean) {
      return new Response(JSON.stringify({ ok: false, error: "CODE_REQUIRED" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ ok: false, error: "MISSING_ENV" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ✅ Cliente admin (service role) — bypass RLS
    const admin = createClient(supabaseUrl, serviceKey);

    // 1) Buscar empleado por code
    const { data: rows, error } = await admin
      .from("employees")
      .select("id, code, kiosk_pin, name, role, branch_id, photo_url, email, phone, is_admin, status")
      .or(`code.eq.${clean},kiosk_pin.eq.${clean}`)
      .limit(1);

    if (error) {
      return new Response(JSON.stringify({ ok: false, error: "DB_ERROR", details: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!rows?.length) {
      return new Response(JSON.stringify({ ok: false, error: "NOT_FOUND" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const employee = rows[0];

    if (employee.status && employee.status !== "ACTIVO") {
      return new Response(JSON.stringify({ ok: false, error: "INACTIVE" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) Asegurar usuario Auth (email = code@staff.local, password = code)
    const email = employee.email || `${clean.toLowerCase()}@staff.local`;

    // si no tenía email, lo guardamos (no es obligatorio, pero ayuda a consistencia)
    if (!employee.email) {
      await admin.from("employees").update({ email }).eq("id", employee.id);
    }

    // ✅ Mejor que listUsers(): intentamos create y si ya existe, seguimos sin fallar
    const createRes = await admin.auth.admin.createUser({
      email,
      password: clean,     // regla: password = code
      email_confirm: true,
      user_metadata: { code: clean },
    });

    // Si ya existe, Supabase suele devolver error 422/400 dependiendo del caso.
    // No queremos bloquear login por eso.
    if (createRes.error) {
      const msg = (createRes.error.message || "").toLowerCase();
      const isAlready =
        msg.includes("already") ||
        msg.includes("exists") ||
        msg.includes("registered") ||
        msg.includes("duplicate");

      if (!isAlready) {
        return new Response(
          JSON.stringify({ ok: false, error: "AUTH_CREATE_ERROR", details: createRes.error.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // 3) Respuesta final
    return new Response(
      JSON.stringify({
        ok: true,
        user: {
          id: employee.id,
          name: employee.name,
          code: employee.code,
          role: employee.role,
          branchId: employee.branch_id,
          photo: employee.photo_url,
          email,
          phone: employee.phone,
          isAdmin: employee.is_admin === true,
          userType: employee.is_admin ? "admin" : "employee",
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: "UNHANDLED", details: String((e as Error)?.message ?? e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});