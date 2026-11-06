// Aplica en la caja los conteos que la corrigen (2026-11-05), de a un producto.
// Lo llama el cron `conteo-caja-cada-minuto` sólo cuando hay cola; la cola la
// arma `aprobar_conteo_inventario` (ver la migración `conteo_caja`). La lógica
// de cada producto vive en `_shared/erp-ajuste-conteo.ts`.
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireInvokeSecret } from "../_shared/security.ts";
import { login } from "../_shared/erp-dte.ts";
import { sesionEn } from "../_shared/erp-traslado.ts";
import { aplicarAjusteDeConteo, type Movimiento } from "../_shared/erp-ajuste-conteo.ts";
import { presupuestoDelWorker } from "../_shared/relojDelWorker.ts";

const PRESUPUESTO_MS = 100_000;

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  // Nadie de afuera: lo llama el cron.
  if (!requireInvokeSecret(req)) return json({ ok: false, error: "No autorizado." }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const arranque = Date.now();
  const PRESUPUESTO = presupuestoDelWorker(arranque, PRESUPUESTO_MS, 100_000).ms;
  const hechos: { producto: string | null; estado: string }[] = [];
  const conteos = new Set<string>();

  try {
    while (Date.now() - arranque < PRESUPUESTO) {
      const { data: m, error } = await admin.rpc("conteo_caja_tomar");
      if (error) throw error;
      if (!m) break;
      const mov = m as Movimiento;
      conteos.add(mov.conteo_id);

      let r;
      try {
        if (!mov.erp_sucursal_id) throw new Error("La sala no tiene inventario ligado.");
        // Una sesión por producto: la sucursal es estado global de la sesión y
        // el descargo abre la suya; compartirla entre escrituras es cómo una
        // termina en otra sala.
        const cookie = await sesionEn(mov.erp_sucursal_id, login);
        r = await aplicarAjusteDeConteo(admin, cookie, mov);
      } catch (e) {
        // Se cortó antes o durante: si alguna línea quedó hecha está anotada en
        // `lineas`; si no se sabe, se marca para revisar y no se reintenta solo.
        r = { estado: "INCIERTO", lineas: mov.lineas, error: (e as Error).message, resultado: { at: new Date().toISOString() } };
      }

      const { error: eU } = await admin.from("conteo_caja_movimiento").update({
        estado: r.estado, lineas: r.lineas, error: r.error, resultado: r.resultado,
        updated_at: new Date().toISOString(),
      }).eq("id", mov.id);
      if (eU) console.error(`[conteo-caja] no se pudo anotar ${mov.id}: ${eU.message}`);
      hechos.push({ producto: mov.producto, estado: r.estado });
    }

    for (const c of conteos) {
      const { error } = await admin.rpc("conteo_caja_recalcular", { p_conteo_id: c });
      if (error) console.error(`[conteo-caja] recalcular ${c}: ${error.message}`);
    }
    return json({ ok: true, aplicados: hechos.length, hechos });
  } catch (e) {
    console.error("[conteo-caja]", (e as Error).message);
    return json({ ok: false, error: (e as Error).message, aplicados: hechos.length }, 500);
  }
});
