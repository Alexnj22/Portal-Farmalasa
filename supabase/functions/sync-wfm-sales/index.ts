import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireAuthUser, getErpCredsByBranch } from "../_shared/security.ts";

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const user = await requireAuthUser(req);
  if (!user) {
    return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { branchId, fechaI, fechaF } = await req.json();

    if (!branchId) throw new Error("branchId es obligatorio.");

    // Credentials come from Supabase Secrets (ERP_BRANCH_MAP), never from the client
    const creds = getErpCredsByBranch(Number(branchId));
    if (!creds) throw new Error(`No hay credenciales ERP configuradas para branchId ${branchId}.`);

    const { username, password } = creds;

    // Usar offset de El Salvador (UTC-6)
    const tzOffset = -6 * 60 * 60 * 1000;
    const hoyCST = new Date(Date.now() + tzOffset).toISOString().split("T")[0];
    const startDate = fechaI || hoyCST;
    const endDate = fechaF || hoyCST;

    // 1. LOGIN
    const loginForm = new URLSearchParams();
    loginForm.append("username", username);
    loginForm.append("password", password);
    loginForm.append("m", "1");

    const loginRes = await fetch("https://clientesdte3.oss.com.sv/farma_salud/login.php", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: loginForm.toString(),
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });

    const sessionCookie = loginRes.headers.get("set-cookie")?.split(";")[0];
    if (!sessionCookie) throw new Error("Fallo de autenticación en el ERP.");

    // 2. PETICIÓN JSON (Usando startDate y endDate calculados)
    const jsonUrl = `https://clientesdte3.oss.com.sv/farma_salud/ventas_vendedor_hora_json.php?fini=${startDate}&ffin=${endDate}`;
    const dataRes = await fetch(jsonUrl, {
      method: "GET",
      headers: { "Cookie": sessionCookie },
      signal: AbortSignal.timeout(30_000),
    });

    const payload = await dataRes.json();
    if (!payload.datos || !Array.isArray(payload.datos)) {
      // Si no hay datos hoy, simplemente respondemos éxito con 0 procesados
      return new Response(JSON.stringify({ success: true, processed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. PROCESAMIENTO
    const hourlyBuckets = {};
    payload.datos.forEach(item => {
      const [day, month, year] = item.fecha.split('-');
      const sale_date = `${year}-${month}-${day}`;

      const timeMatch = item.hora.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
      if (!timeMatch) return;

      let hour = parseInt(timeMatch[1], 10);
      const ampm = timeMatch[3].toUpperCase();
      if (ampm === "PM" && hour < 12) hour += 12;
      if (ampm === "AM" && hour === 12) hour = 0;

      const key = `${sale_date}_${hour}`;
      if (!hourlyBuckets[key]) {
        hourlyBuckets[key] = {
          branch_id: branchId,
          sale_date,
          sale_hour: hour,
          total_sales: 0,
          transaction_count: 0
        };
      }
      hourlyBuckets[key].total_sales += parseFloat(item.total) || 0;
      hourlyBuckets[key].transaction_count += parseInt(item.cantidad) || 0;
    });

    // 4. UPSERT
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const inserts = Object.values(hourlyBuckets);
    if (inserts.length > 0) {
      const { error } = await supabase
        .from('branch_hourly_sales')
        .upsert(inserts, { onConflict: 'branch_id,sale_date,sale_hour' });
      
      if (error) throw error;
    }

    return new Response(JSON.stringify({ 
      success: true, 
      processed: inserts.length,
      range: { startDate, endDate } 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});