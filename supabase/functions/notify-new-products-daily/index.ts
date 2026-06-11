import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireInvokeSecret } from "../_shared/security.ts";

// Notifica al Jefe/a de Compras y Logistica los productos nuevos del día anterior.
// Cron: lunes–sábado a las 8am El Salvador (*/1-6 en pg_cron).
// Si el jefe está de vacaciones/incapacidad → fallback a Administrador.
// Los domingos pg_cron simplemente no dispara.

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  if (!requireInvokeSecret(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Rango: ayer completo en zona El Salvador (UTC-6)
  const now       = new Date(Date.now() - 6 * 3600_000);
  const yesterday = new Date(now);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const ayer      = yesterday.toISOString().split("T")[0];
  const desde     = `${ayer}T00:00:00-06:00`;
  const hasta     = `${ayer}T23:59:59-06:00`;

  // 1. Productos nuevos de ayer
  const { data: nuevos, error: prodErr } = await supabase
    .from("products")
    .select("id, nombre, activo")
    .gte("created_at", desde)
    .lte("created_at", hasta)
    .eq("activo", true)
    .order("nombre");

  if (prodErr) {
    console.error("[notify-new-products] Error al consultar productos:", prodErr.message);
    return new Response(JSON.stringify({ error: prodErr.message }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const total = nuevos?.length ?? 0;
  console.log(`[notify-new-products] Productos nuevos el ${ayer}: ${total}`);

  if (total === 0) {
    return new Response(
      JSON.stringify({ ok: true, ayer, nuevos: 0, note: "Sin productos nuevos ayer." }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  // 2. Destinatarios: Jefe Logística activo (fallback → Administrador)
  const { data: empIds, error: empErr } = await supabase.rpc("get_logistics_chief_ids");
  if (empErr) {
    console.error("[notify-new-products] Error al obtener destinatarios:", empErr.message);
  }
  const ids: string[] = empIds ?? [];

  if (ids.length === 0) {
    console.warn("[notify-new-products] Sin destinatarios disponibles.");
    return new Response(
      JSON.stringify({ ok: true, ayer, nuevos: total, notified: 0, note: "Sin destinatarios activos." }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  // 3. Armar mensaje
  const listaCorta = (nuevos ?? [])
    .slice(0, 8)
    .map((p) => `• ${p.nombre}`)
    .join("\n");
  const resto = total > 8 ? `\n…y ${total - 8} más.` : "";

  const title   = `${total} producto${total > 1 ? "s" : ""} nuevo${total > 1 ? "s" : ""} ayer (${ayer})`;
  const message = `Se agregaron ${total} producto${total > 1 ? "s" : ""} al catálogo el ${ayer}. Revisá MinMax para asignarlos a las sucursales que corresponda.\n\n${listaCorta}${resto}`;

  // 4. Push notification
  let notified = 0;
  const pushUrl      = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-push-notification`;
  const invokeSecret = Deno.env.get("ADMIN_INVOKE_SECRET")!;

  try {
    const pushRes = await fetch(pushUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${invokeSecret}`,
      },
      body: JSON.stringify({
        title,
        message,
        url: "/minmax",
        urgent: false,
        target_type: "EMPLOYEE",
        target_value: ids,
      }),
    });
    if (pushRes.ok) {
      const pushData = await pushRes.json();
      notified = pushData.sent ?? 0;
    }
  } catch (err) {
    console.error("[notify-new-products] Error al enviar push:", err);
  }

  // 5. Anuncio persistente
  try {
    await supabase.from("announcements").insert({
      title,
      message,
      target_type: "EMPLOYEE",
      target_value: ids,
      read_by:      [],
      is_archived:  false,
      created_by:   null,
      priority:     "NORMAL",
      metadata: {
        type:    "NEW_PRODUCTS_DAILY",
        fecha:   ayer,
        total,
        ids:     (nuevos ?? []).map((p) => p.id),
        url:     "/minmax",
      },
    });
  } catch (err) {
    console.error("[notify-new-products] Error al crear anuncio:", err);
  }

  console.log(`[notify-new-products] notified=${notified} ids=${ids.length}`);

  return new Response(
    JSON.stringify({ ok: true, ayer, nuevos: total, notified }),
    { headers: { ...cors, "Content-Type": "application/json" } },
  );
});
