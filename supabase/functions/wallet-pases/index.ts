// El servicio web de PassKit: lo que hace que la tarjeta de Puntos Salud en
// Apple Wallet se actualice sola (2026-10-06, pedido del usuario).
//
// Lo llama el iPhone, no la app, con las rutas que fija Apple (el pase lleva
// `webServiceURL` = esta función y un `authenticationToken` por tarjeta):
//
//   POST   /v1/devices/:disp/registrations/:tipo/:serial   se registró (body: pushToken)
//   DELETE /v1/devices/:disp/registrations/:tipo/:serial   la quitaron de Wallet
//   GET    /v1/devices/:disp/registrations/:tipo?passesUpdatedSince=…   ¿cuáles cambiaron?
//   GET    /v1/passes/:tipo/:serial                         la tarjeta nueva
//   POST   /v1/log                                          errores del iPhone
//
// Y una ruta propia, `/avisar`, que llama el cron cada minuto: busca las
// tarjetas cuyo saldo cambió (`puntos_cuenta.updated_at` > `notificado_at`) y le
// manda a Apple un aviso vacío por cada teléfono. El iPhone entonces pregunta
// qué cambió y baja la tarjeta. El aviso va firmado con el MISMO certificado
// del pase (Apple no acepta otro para Wallet), por HTTP/2 a APNs.
//
// El token de cada tarjeta se DERIVA del serial con HMAC (`tokenDePase`): no se
// guarda en ninguna tabla y no se puede adivinar el de otra persona.
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkCronSecret } from "../_shared/security.ts";
import { clienteDelSerial, paseDeCliente, TIPO_PASE, tokenDePase } from "../_shared/pase.ts";
import { avisarGoogle } from "../_shared/paseGoogle.ts";

const vacio = (status: number) => new Response(null, { status });
const pem = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const url = new URL(req.url);
  const ruta = url.pathname.replace(/^.*\/wallet-pases/, "");
  const p = ruta.split("/").filter(Boolean);

  try {
    // ── El cron: avisar a Apple de las tarjetas que cambiaron ─────────────
    if (ruta === "/avisar" && req.method === "POST") {
      if (!checkCronSecret(req)) return vacio(401);
      // Apple y Google en la misma vuelta; uno que falla no frena al otro.
      const [apple, google] = await Promise.allSettled([avisar(admin), avisarGoogle(admin)]);
      const motivo = (r: PromiseSettledResult<unknown>) => r.status === "fulfilled" ? r.value : { ok: false, error: String((r as PromiseRejectedResult).reason?.message ?? r) };
      if (google.status === "rejected") console.error("[wallet-pases] Google:", motivo(google));
      if (apple.status === "rejected") throw apple.reason;
      return Response.json({ ...(apple.value as object), google: motivo(google) });
    }

    if (p[0] === "v1" && p[1] === "log" && req.method === "POST") {
      const cuerpo = await req.json().catch(() => null);
      console.error("[wallet-pases] el iPhone reporta:", JSON.stringify(cuerpo?.logs ?? cuerpo).slice(0, 1000));
      return vacio(200);
    }

    // El iPhone se presenta con «ApplePass <token>» en lo que toca una tarjeta.
    const autorizado = async (serial: string) => {
      const h = req.headers.get("authorization") ?? "";
      return h === `ApplePass ${await tokenDePase(serial)}`;
    };

    // POST/DELETE /v1/devices/:disp/registrations/:tipo/:serial
    if (p[0] === "v1" && p[1] === "devices" && p[3] === "registrations" && p.length === 6) {
      const [, , disp, , tipo, serial] = p;
      if (tipo !== TIPO_PASE) return vacio(404);
      if (!(await autorizado(serial))) return vacio(401);
      const customerId = clienteDelSerial(serial);
      if (!customerId) return vacio(404);
      if (req.method === "POST") {
        const { pushToken } = await req.json().catch(() => ({}));
        if (!pushToken) return vacio(400);
        const { data: ya, error: eY } = await admin.from("wallet_registros").select("id").eq("dispositivo", disp).eq("serial", serial).maybeSingle();
        if (eY) throw eY;
        const { error } = await admin.from("wallet_registros").upsert(
          { dispositivo: disp, push_token: String(pushToken), serial, customer_id: customerId, notificado_at: new Date().toISOString() },
          { onConflict: "dispositivo,serial" });
        if (error) throw error;
        return vacio(ya ? 200 : 201);
      }
      if (req.method === "DELETE") {
        const { error } = await admin.from("wallet_registros").delete().eq("dispositivo", disp).eq("serial", serial);
        if (error) throw error;
        return vacio(200);
      }
    }

    // GET /v1/devices/:disp/registrations/:tipo?passesUpdatedSince=…
    if (p[0] === "v1" && p[1] === "devices" && p[3] === "registrations" && p.length === 5 && req.method === "GET") {
      const [, , disp, , tipo] = p;
      if (tipo !== TIPO_PASE) return vacio(404);
      const { data: regs, error } = await admin.from("wallet_registros").select("serial, customer_id").eq("dispositivo", disp);
      if (error) throw error;
      if (!regs?.length) return vacio(204);
      const { data: ctas, error: eC } = await admin.from("puntos_cuenta").select("customer_id, updated_at")
        .in("customer_id", regs.map((r) => r.customer_id));
      if (eC) throw eC;
      const desde = Number(url.searchParams.get("passesUpdatedSince") ?? 0);
      const cambios = (ctas ?? []).map((c) => ({ id: c.customer_id, t: Date.parse(c.updated_at) }));
      const nuevos = regs.filter((r) => (cambios.find((c) => c.id === r.customer_id)?.t ?? 0) > desde);
      if (!nuevos.length) return vacio(204);
      const ultimo = Math.max(...cambios.map((c) => c.t));
      return Response.json({ serialNumbers: nuevos.map((r) => r.serial), lastUpdated: String(ultimo) });
    }

    // GET /v1/passes/:tipo/:serial
    if (p[0] === "v1" && p[1] === "passes" && p.length === 4 && req.method === "GET") {
      const [, , tipo, serial] = p;
      if (tipo !== TIPO_PASE) return vacio(404);
      if (!(await autorizado(serial))) return vacio(401);
      const id = clienteDelSerial(serial);
      if (!id) return vacio(404);
      const { pase, cambio } = await paseDeCliente(admin, id);
      return new Response(pase, { headers: {
        "Content-Type": "application/vnd.apple.pkpass",
        "Last-Modified": new Date(cambio ?? Date.now()).toUTCString(),
        "Cache-Control": "no-store",
      } });
    }

    return vacio(404);
  } catch (e) {
    console.error("[wallet-pases]", (e as Error)?.message ?? e);
    return vacio(500);
  }
});

// deno-lint-ignore no-explicit-any
async function avisar(admin: any) {
  const { data: filas, error } = await admin.rpc("wallet_registros_por_avisar");
  if (error) throw error;
  if (!filas?.length) return { ok: true, avisos: 0 };

  // APNs con el certificado del pase, por HTTP/2.
  // deno-lint-ignore no-explicit-any
  const cliente = (Deno as any).createHttpClient({
    cert: pem(Deno.env.get("WALLET_CERT_B64")!), key: pem(Deno.env.get("WALLET_KEY_B64")!), http2: true,
  });
  let enviados = 0;
  const errores: string[] = [];
  const muertos: number[] = [];
  for (const f of filas as { id: number; push_token: string; cambio_at: string }[]) {
    try {
      const r = await fetch(`https://api.push.apple.com/3/device/${f.push_token}`, {
        method: "POST", body: "{}",
        headers: { "apns-topic": TIPO_PASE, "apns-priority": "5", "content-type": "application/json" },
        // deno-lint-ignore no-explicit-any
        client: cliente, signal: AbortSignal.timeout(15_000),
      } as any);
      if (r.ok) {
        enviados++;
        const { error: eU } = await admin.from("wallet_registros").update({ notificado_at: f.cambio_at }).eq("id", f.id);
        if (eU) console.error("[wallet-pases] no se pudo anotar el aviso:", eU.message);
      } else {
        const motivo = (await r.json().catch(() => ({})))?.reason ?? r.status;
        errores.push(String(motivo));
        // El teléfono ya no tiene la tarjeta o el token murió: se olvida.
        if (r.status === 410 || motivo === "BadDeviceToken" || motivo === "Unregistered") muertos.push(f.id);
      }
    } catch (e) {
      errores.push((e as Error)?.message ?? String(e));
    }
  }
  if (muertos.length) {
    const { error: eD } = await admin.from("wallet_registros").delete().in("id", muertos);
    if (eD) console.error("[wallet-pases] no se pudieron borrar los registros muertos:", eD.message);
  }
  if (errores.length) console.error("[wallet-pases] errores APNs:", [...new Set(errores)].join(", "));
  return { ok: true, avisos: filas.length, enviados, errores: [...new Set(errores)] };
}
