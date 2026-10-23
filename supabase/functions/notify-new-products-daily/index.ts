import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireInvokeSecret } from "../_shared/security.ts";

// Notifica al Jefe/a de Compras y Logistica los productos nuevos desde el último
// aviso. Cron: lunes–sábado a las 8am El Salvador (*/1-6 en pg_cron).
// Si el jefe está de vacaciones/incapacidad → fallback a Administrador.
//
// H24 (2026-10-23): avisaba siempre de «ayer», y como el domingo no corre, lo
// dado de alta un SÁBADO no se avisaba nunca (15 productos entre julio y
// octubre). Ahora el rango arranca el día siguiente al último aviso (tope: una
// semana) y termina antes del inicio de hoy, así el lunes cubre sábado y
// domingo. El fin es `lt` contra el inicio del día siguiente: con `lte
// …T23:59:59` se perdía lo creado en el último segundo.

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

  // Rango en días de El Salvador (UTC-6): desde el día siguiente al último
  // aviso (como mucho 7 días atrás) hasta ayer inclusive.
  const diaSV = (offsetDias: number) => {
    const d = new Date(Date.now() - 6 * 3600_000);
    d.setUTCDate(d.getUTCDate() + offsetDias);
    return d.toISOString().split("T")[0];
  };
  const sumarDia = (dia: string, n: number) => {
    const d = new Date(`${dia}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().split("T")[0];
  };
  const hoy  = diaSV(0);
  const ayer = diaSV(-1);
  const { data: ultimo, error: ultErr } = await supabase
    .from("announcements")
    .select("metadata")
    .eq("metadata->>type", "NEW_PRODUCTS_DAILY")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (ultErr) console.error("[notify-new-products] Error al leer el último aviso:", ultErr.message);
  const ultimoCubierto = String(ultimo?.metadata?.hasta ?? ultimo?.metadata?.fecha ?? "");
  let desdeDia = /^\d{4}-\d{2}-\d{2}$/.test(ultimoCubierto) ? sumarDia(ultimoCubierto, 1) : ayer;
  if (desdeDia < diaSV(-7)) desdeDia = diaSV(-7);
  if (desdeDia > ayer) {
    return new Response(
      JSON.stringify({ ok: true, ayer, nuevos: 0, note: "Ya se avisó hasta ayer." }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
  const desde = `${desdeDia}T00:00:00-06:00`;
  const hasta = `${hoy}T00:00:00-06:00`;   // exclusivo
  const rango = desdeDia === ayer ? `ayer (${ayer})` : `del ${desdeDia} al ${ayer}`;

  // 1. Productos nuevos del rango
  const { data: nuevos, error: prodErr } = await supabase
    .from("products")
    .select("id, nombre, activo")
    .gte("created_at", desde)
    .lt("created_at", hasta)
    .eq("activo", true)
    .order("nombre");

  if (prodErr) {
    console.error("[notify-new-products] Error al consultar productos:", prodErr.message);
    return new Response(JSON.stringify({ error: prodErr.message }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const total = nuevos?.length ?? 0;
  console.log(`[notify-new-products] Productos nuevos ${rango}: ${total}`);

  if (total === 0) {
    return new Response(
      JSON.stringify({ ok: true, ayer, desde: desdeDia, nuevos: 0, note: "Sin productos nuevos en el rango." }),
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

  const title   = `${total} producto${total > 1 ? "s" : ""} nuevo${total > 1 ? "s" : ""} ${rango}`;
  const cuando  = desdeDia === ayer ? `el ${ayer}` : `entre el ${desdeDia} y el ${ayer}`;
  const message = `Se agregaron ${total} producto${total > 1 ? "s" : ""} al catálogo ${cuando}. Revisá MinMax para asignarlos a las sucursales que corresponda.\n\n${listaCorta}${resto}`;

  // 4. El push lo manda el trigger `trg_push_on_announcement` al crear el
  // anuncio. Hasta el 2026-10-08 esta función mandaba OTRO push por su cuenta
  // y cada destinatario recibía dos por el mismo aviso.
  let notified = 0;

  // 5. Anuncio persistente
  try {
    const { error: annErr } = await supabase.from("announcements").insert({
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
        // `fecha` es el último día cubierto (lo leían así antes); `desde` y
        // `hasta` dicen el rango entero y `hasta` es la marca del próximo.
        fecha:   ayer,
        desde:   desdeDia,
        hasta:   ayer,
        total,
        ids:     (nuevos ?? []).map((p) => p.id),
        url:     "/minmax",
      },
    });
    // Es el ÚNICO canal (el push sale de su trigger): si falla, que se vea.
    if (annErr) console.error("[notify-new-products] Error al crear anuncio:", annErr.message);
    else notified = ids.length;
  } catch (err) {
    console.error("[notify-new-products] Error al crear anuncio:", err);
  }

  console.log(`[notify-new-products] notified=${notified} ids=${ids.length}`);

  return new Response(
    JSON.stringify({ ok: true, ayer, nuevos: total, notified }),
    { headers: { ...cors, "Content-Type": "application/json" } },
  );
});
