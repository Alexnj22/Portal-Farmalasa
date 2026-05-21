import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireAuthUser } from "../_shared/security.ts";

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const user = await requireAuthUser(req);
  if (!user) {
    return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { year } = await req.json();
    if (!year || typeof year !== "number") {
      throw new Error("Se requiere el campo 'year' (número entero).");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // 1. Fetch active employees with hire_date
    const { data: employees, error: empErr } = await supabase
      .from("employees")
      .select("id, first_names, last_names, name, hire_date, branch_id")
      .in("status", ["ACTIVO", "ACTIVE"])
      .not("hire_date", "is", null);

    if (empErr) throw empErr;

    // 2. Fetch branches for names
    const { data: branches } = await supabase
      .from("branches")
      .select("id, name");

    const branchMap: Record<string, string> = {};
    (branches || []).forEach((b: { id: number; name: string }) => {
      branchMap[String(b.id)] = b.name;
    });

    // 3. Filter eligible employees (hired at least 1 year before Jan 1 of target year)
    const cutoff = new Date(`${year - 1}-01-01`);
    const eligible = (employees || []).filter((e: { hire_date: string }) => {
      return new Date(e.hire_date + "T12:00:00") <= cutoff;
    });

    if (eligible.length === 0) {
      throw new Error("No hay empleados elegibles para el año indicado (requieren al menos 1 año de antigüedad).");
    }

    // 4. Fetch holidays for target year
    const { data: holidays } = await supabase
      .from("holidays")
      .select("holiday_date, name")
      .gte("holiday_date", `${year}-01-01`)
      .lte("holiday_date", `${year}-12-31`);

    // 5. Build prompt
    const empList = eligible.map((e: { id: string; name?: string; first_names?: string; last_names?: string; hire_date: string; branch_id: number }) => ({
      employee_id: e.id,
      nombre: e.name || `${e.first_names || ""} ${e.last_names || ""}`.trim(),
      fecha_ingreso: e.hire_date,
      sucursal: branchMap[String(e.branch_id)] || "Sin sucursal",
      sucursal_id: e.branch_id,
    }));

    const holidayList = (holidays || []).map((h: { holiday_date: string; name: string }) => `${h.holiday_date} - ${h.name}`).join("\n");

    const prompt = `Eres un experto en planificación de vacaciones para empresas en El Salvador.

TAREA: Genera el plan anual de vacaciones para el año ${year} cumpliendo el Código de Trabajo de El Salvador.

REGULACIONES DEL CÓDIGO DE TRABAJO DE EL SALVADOR:
- Cada empleado elegible recibe exactamente 15 días de vacaciones (días calendario)
- Los días de vacaciones empiezan a contar desde la fecha asignada
- Trata de distribuir las vacaciones a lo largo del año para no dejar sucursales con poco personal
- Idealmente no más de 1 empleado de la misma sucursal en vacaciones al mismo tiempo
- Evita Semana Santa (usualmente última semana de marzo o primera de abril)
- Evita la última semana de diciembre y primera semana de enero (temporada navideña de alta venta)
- Considera los feriados nacionales al asignar (empezar la semana después de un feriado largo es ideal)

FERIADOS NACIONALES ${year}:
${holidayList || "No hay feriados registrados"}

EMPLEADOS ELEGIBLES (${eligible.length} empleados):
${JSON.stringify(empList, null, 2)}

REGLAS DE FORMATO:
- Devuelve ÚNICAMENTE un array JSON válido, sin texto adicional, sin markdown
- end_date debe ser start_date + 14 días (para cubrir los 15 días calendario incluyendo el día de inicio)
- Los días de inicio deben ser lunes preferiblemente
- days siempre debe ser 15

FORMATO DE RESPUESTA:
[
  {
    "employee_id": "uuid-del-empleado",
    "start_date": "YYYY-MM-DD",
    "end_date": "YYYY-MM-DD",
    "days": 15
  }
]`;

    // 6. Call Gemini
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${Deno.env.get("GEMINI_API_KEY")}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            response_mime_type: "application/json",
          },
        }),
      }
    );

    const geminiData = await geminiRes.json();
    if (geminiData.error) throw new Error(`Gemini: ${geminiData.error.message}`);
    if (!geminiData.candidates?.[0]?.content?.parts?.[0]?.text) {
      throw new Error("Gemini no devolvió un plan válido.");
    }

    const aiPlan: Array<{ employee_id: string; start_date: string; end_date: string; days: number }> =
      JSON.parse(geminiData.candidates[0].content.parts[0].text);

    if (!Array.isArray(aiPlan) || aiPlan.length === 0) {
      throw new Error("El plan generado está vacío.");
    }

    // 7. Upsert header (one per year)
    const { data: header, error: headerErr } = await supabase
      .from("vacation_plan_headers")
      .upsert(
        {
          year,
          status: "DRAFT",
          ai_generated: true,
          generated_by: user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "year" }
      )
      .select()
      .single();

    if (headerErr) throw headerErr;

    // 8. Soft-cancel any existing DRAFT plans for this year (regeneration)
    await supabase
      .from("vacation_plans")
      .update({ status: "CANCELLED", updated_at: new Date().toISOString() })
      .eq("plan_header_id", header.id)
      .eq("status", "DRAFT");

    // 9. Insert new plans
    const rows = aiPlan.map((item) => {
      const emp = empList.find((e) => e.employee_id === item.employee_id);
      return {
        plan_header_id: header.id,
        year,
        employee_id: item.employee_id,
        branch_id: emp?.sucursal_id ?? null,
        start_date: item.start_date,
        end_date: item.end_date,
        days: item.days ?? 15,
        status: "DRAFT",
        created_by: user.id,
      };
    });

    const { error: insertErr } = await supabase.from("vacation_plans").insert(rows);
    if (insertErr) throw insertErr;

    return new Response(
      JSON.stringify({ success: true, header_id: header.id, count: rows.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("ERROR generate-vacation-plan:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
