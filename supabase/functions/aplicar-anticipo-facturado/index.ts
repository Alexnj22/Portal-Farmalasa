// El anticipo de una reserva se aplica solo cuando su preventa se factura
// (2026-11-21).
//
// La R-000177 de Salud 3 se envió a caja, se facturó por el total y quedó
// «Lista para retirar» cinco días: el cierre por factura no cierra una reserva
// con anticipo sin aplicar —el vale de «Retirar» es lo que saca de la cuenta
// del cajón el efectivo que entró el día del anticipo— y nadie apretó
// «Retirar». Ahora `preventas_cerrar_facturadas` pide ese vale apenas ve la
// factura, y llega acá.
//
// Esto es sólo un RELEVO: la base no tiene una sesión que presentarle a
// `operar-caja` (pide JWT). Entra con el secreto del circuito fiscal y le pasa
// el pedido a `operar-caja` con la llave de servicio y el mismo secreto en
// `x-cierre-automatico` —igual que `cierre-automatico-caja` → `hacer-corte-caja`—.
// Todo lo que decide (la preventa facturada en esa sala, el monto = anticipo en
// efectivo, una sola vez por reserva, quién firma) lo comprueba `operar-caja`.
import { getCorsHeaders, requireInvokeSecret, secretoDeCircuito } from "../_shared/security.ts";

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
  if (!requireInvokeSecret(req, "fiscal")) return json({ ok: false, error: "UNAUTHORIZED" }, 401);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const reserva = Number(body.reserva_id);
  const preventa = Number(body.preventa_id);
  const sala = Number(body.sala);
  const monto = Number(body.monto);
  const codigo = String(body.codigo ?? "").slice(0, 20);
  if (![reserva, preventa, sala].every(Number.isInteger) || !(monto > 0)) {
    return json({ ok: false, error: "Faltan la reserva, la preventa, la sucursal o el monto." }, 400);
  }

  try {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/operar-caja`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        "x-cierre-automatico": secretoDeCircuito("fiscal") ?? "",
      },
      body: JSON.stringify({
        accion: "salida", sala, tipo: "APLICA_ANTICIPO", automatico: true, preventa_id: preventa,
        aplicar: { reserva_id: reserva }, monto, concepto: `Aplica anticipo ${codigo}`,
      }),
      signal: AbortSignal.timeout(110_000),
    });
    const res = await r.json().catch(() => null) as Record<string, unknown> | null;
    const linea = `[aplicar-anticipo-facturado] reserva=${reserva} preventa=${preventa} sala=${sala}: ${r.status} ${JSON.stringify(res).slice(0, 400)}`;
    if (!r.ok || res?.ok !== true) console.error(linea); else console.log(linea);
    return json(res ?? { ok: false, error: `operar-caja respondió ${r.status}` }, r.ok ? 200 : r.status);
  } catch (e) {
    console.error(`[aplicar-anticipo-facturado] reserva=${reserva}:`, e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 502);
  }
});
