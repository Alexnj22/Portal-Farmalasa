import { getCorsHeaders, getErpBranchMap, requireInvokeSecret } from "../_shared/security.ts";
import { creditosDeLaSala, getCortesCreds, getSessionCookie } from "../_shared/creditos.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ═══════════════════════════════════════════════════════════════════════════
// LAS CUENTAS POR COBRAR, TRAÍDAS AL PORTAL
//
// Pedido del usuario (2-sep): «haz un cron que traiga las cuentas por cobrar,
// así amarramos a los clientes con los usuarios y empleados, y podemos avisar
// cuando una venta ya pasó el plazo».
//
// ── Qué hace, y qué NO ────────────────────────────────────────────────────
// Trae la lista y la deja en `creditos_de_clientes`, amarrada a la ficha del
// cliente y al vendedor. **No reemplaza la lectura del origen al abonar**: ésa
// se queda, porque el saldo cambia cada vez que alguien cobra en la caja y
// abonar contra una copia de hace una hora es cobrarle de más a un cliente.
// La regla es: *la lista se mira en el portal, el cobro se decide allá.*
//
// ── DOS MODOS, y la diferencia es de diez veces ───────────────────────────
// Idea del usuario (2-sep): «no necesitás toda la fecha; si ya guardaste la
// primera vez las anteriores, después sólo necesitás pasar y obtener las del
// día». Medido, y tenía razón:
//
//   `completo`  2024-01-01 → hoy     **17.3 s · 1.4 MB · 2,387 filas**
//   `hoy`       sólo el día de hoy   **1.8 s · 2 kB · 1 fila**
//
// Así que la pasada frecuente mira SÓLO hoy, y la tanda entera corre una vez
// al día de madrugada. Ese barrido diario no es opcional y es la parte que se
// olvida: un abono hecho EN EL ORIGEN sobre un crédito de hace ocho meses no
// aparece en la ventana de hoy —lo que cambió es su saldo, no su fecha—, así
// que sin el completo el espejo se quedaría con una deuda ya pagada para
// siempre. Corre a las 2am SV, con el origen quieto y sin nadie cobrando.
//
// Y la tercera pieza vive en `creditos-erp`: después de un abono se relee esa
// sala en esa fecha para CONFIRMAR que entró. Es la que hace que el espejo no
// tenga que esperar diez minutos justo cuando alguien acaba de pagar.
//
// ── El costo ──────────────────────────────────────────────────────────────
// 6 peticiones por corrida (una por sala, EN SERIE porque la sucursal vive en
// la sesión del origen), pero en modo `hoy` son 6 peticiones de 250 ms sobre
// cero filas. 90 corridas + 1 completa al día.
// ═══════════════════════════════════════════════════════════════════════════

/** Desde cuándo mira la tanda COMPLETA. Un crédito no caduca: el más antiguo
 *  con saldo tiene 463 días, y una ventana corta lo dejaría fuera del espejo
 *  y de todo aviso — que es justamente el que hay que cobrar. */
const DESDE = "2024-01-01";

/** Cuántos créditos por llamada al RPC. El payload va como UN `jsonb`, así que
 *  el techo de las 1000 filas de PostgREST no aplica —devuelve dos números—;
 *  el corte es para que el `INSERT` no arme un plan enorme de una sola vez. */
const TANDA = 800;

const json = (b: unknown, s = 200, h: HeadersInit = {}) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", ...h } });

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const responder = (b: unknown, s = 200) => json(b, s, cors);

  // La llama un cron, no un navegador: se autentica con el secreto de invocación.
  if (!requireInvokeSecret(req)) return responder({ ok: false, error: "No autorizado." }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const anotarCorrida = async (filas: number, cambios: number, ok: boolean, error: string | null) => {
    // Una fila, siempre la misma. Sin esto, «¿esto está fresco?» no se puede
    // contestar: `updated_at` sólo se mueve cuando algo cambió, así que una
    // corrida sin novedades es indistinguible de una que no corrió.
    const { error: e } = await supabase.from("creditos_sync")
      .upsert({ id: true, corrio_el: new Date().toISOString(), filas, cambios, ok, error });
    if (e) console.error("[sync-creditos] creditos_sync:", e.message);
  };

  try {
    const hasta = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
    const body = await req.json().catch(() => ({}));
    /* `hoy` es el default: la corrida frecuente es la de cada diez minutos, y
     * un modo que hay que pedir es un modo que alguien olvida pedir. La tanda
     * completa se nombra a propósito, que es la que cuesta. */
    const modo = body?.modo === "completo" ? "completo" : "hoy";
    const desde = String(body?.desde ?? (modo === "completo" ? DESDE : hasta));

    const mapa = getErpBranchMap().filter((e) => e.erpId !== 6);   // Bodega no vende al crédito
    const { username, password } = getCortesCreds();
    const cookie = await getSessionCookie(username, password);

    const filas: Record<string, unknown>[] = [];
    const porSala: Record<string, number> = {};
    const fallidas: string[] = [];

    for (const { branchId, erpId } of mapa) {
      try {
        const leidos = await creditosDeLaSala(cookie, erpId, desde, hasta);
        for (const c of leidos) filas.push({ ...c, branch_id: branchId });
        porSala[String(branchId)] = leidos.length;
      } catch (e) {
        /* Una sala que no responde NO tumba la corrida: las otras cinco entran
         * igual. Pero se anota y la respuesta sale en rojo — un 200 sobre
         * trabajo a medias es cómo un fallo vive meses sin que nadie lo mire. */
        fallidas.push(`sala ${branchId}: ${(e as Error).message}`);
      }
    }

    if (!filas.length) {
      /* En modo `hoy`, cero filas es lo NORMAL: hoy hubo un solo crédito en
       * las seis salas. Sólo la tanda completa puede afirmar que cero es un
       * fallo — ahí sí, 2,387 créditos no desaparecen de un día para otro. */
      if (modo === "hoy" && !fallidas.length) {
        await anotarCorrida(0, 0, true, null);
        return responder({ ok: true, modo, procesadas: 0, cambiadas: 0, porSala });
      }
      const msg = fallidas.length ? fallidas.join(" · ") : "el origen no devolvió ningún crédito";
      await anotarCorrida(0, 0, false, msg);
      return responder({ ok: false, error: msg }, 502);
    }

    let procesadas = 0;
    let cambiadas = 0;
    for (let i = 0; i < filas.length; i += TANDA) {
      const { data, error } = await supabase.rpc("sync_creditos_batch",
        { p_filas: filas.slice(i, i + TANDA) });
      // NUNCA ignorar el error de un query: sin esto la corrida diría que
      // escribió y la tabla se quedaría vieja en silencio.
      if (error) throw new Error(`sync_creditos_batch: ${error.message}`);
      const r = Array.isArray(data) ? data[0] : data;
      procesadas += Number(r?.procesadas ?? 0);
      cambiadas  += Number(r?.cambiadas  ?? 0);
    }

    await anotarCorrida(procesadas, cambiadas, fallidas.length === 0,
                        fallidas.length ? fallidas.join(" · ") : null);

    return responder({
      ok: fallidas.length === 0,
      modo, desde, hasta,
      procesadas, cambiadas, porSala,
      fallidas: fallidas.length ? fallidas : undefined,
    }, fallidas.length ? 500 : 200);
  } catch (e) {
    const msg = (e as Error).message ?? "Error";
    console.error("sync-creditos:", e);
    await anotarCorrida(0, 0, false, msg);
    return responder({ ok: false, error: msg }, 500);
  }
});
