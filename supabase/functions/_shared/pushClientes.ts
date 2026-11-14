// Mandar avisos a los clientes de Puntos Salud: al TELÉFONO (Expo) y al
// NAVEGADOR (Web Push), con una sola llamada (2026-11-14).
//
// La app en la web (app.farmasalud.lat) guarda en `app_cliente_sesiones.push_token`
// la suscripción del navegador como `web:<JSON de PushSubscription>`; la app
// del teléfono guarda el token de Expo (`ExponentPushToken[…]`). Quien manda
// (avisos-clientes y la prueba de app-clientes) arma los mensajes de Expo
// igual que siempre (`mensajePush` de _shared/avisoPrivado.ts) y esto los
// reparte: los de Expo van en tandas a exp.host, los de la web uno por uno
// con la llave VAPID del proyecto (la misma del portal: VAPID_PUBLIC_KEY /
// VAPID_PRIVATE_KEY / VAPID_SUBJECT).
//
// En la web el texto que se ve es el «público» cuando el aviso nombra algo
// privado (un medicamento, una receta): el banner del navegador se ve con la
// pantalla bloqueada. Eso ya lo resuelve `mensajePush`: una sesión con
// `plataforma = 'web'` recibe el cuerpo público.
import webpush from "npm:web-push@3.6.7";

export const esTokenWeb = (t: string | null | undefined) => typeof t === "string" && t.startsWith("web:");

export interface MensajeExpo {
  to: string; title: string; body: string;
  data?: { url?: string; tipo?: string; cuerpo?: string };
  [k: string]: unknown;
}

let vapidListo: boolean | null = null;
function prepararVapid(): boolean {
  if (vapidListo !== null) return vapidListo;
  const pub = Deno.env.get("VAPID_PUBLIC_KEY");
  const priv = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!pub || !priv) { console.error("[pushClientes] faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY"); vapidListo = false; return false; }
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") || "mailto:admin@farmalasa.com", pub, priv);
  vapidListo = true;
  return true;
}

/**
 * Manda `mensajes` (formato Expo) y devuelve, por posición, cómo le fue a
 * cada uno: `ok`, o `muerta: true` cuando el destino ya no existe (la app se
 * desinstaló, el navegador quitó el permiso) y hay que olvidar el token.
 */
export async function enviarPushClientes(mensajes: MensajeExpo[]) {
  const res: { ok: boolean; muerta?: boolean; error?: string }[] = mensajes.map(() => ({ ok: false }));
  const expo = mensajes.map((m, i) => ({ m, i })).filter((x) => !esTokenWeb(x.m.to));
  const web = mensajes.map((m, i) => ({ m, i })).filter((x) => esTokenWeb(x.m.to));

  for (let k = 0; k < expo.length; k += 100) {
    const tanda = expo.slice(k, k + 100);
    const r = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(tanda.map((x) => x.m)),
      // Con plazo: un Expo colgado no se lleva la corrida entera.
      signal: AbortSignal.timeout(20_000),
    }).catch((e) => ({ ok: false, status: 0, json: async () => null, _e: e }) as unknown as Response);
    const cuerpo = await r.json().catch(() => null);
    if (!r.ok || !Array.isArray(cuerpo?.data)) { for (const x of tanda) res[x.i] = { ok: false, error: `expo ${r.status}` }; continue; }
    cuerpo.data.forEach((t: { status: string; message?: string; details?: { error?: string } }, j: number) => {
      const i = tanda[j].i;
      if (t.status === "ok") res[i] = { ok: true };
      else res[i] = { ok: false, error: t.details?.error ?? t.message ?? "error", muerta: t.details?.error === "DeviceNotRegistered" };
    });
  }

  if (web.length && prepararVapid()) {
    await Promise.all(web.map(async ({ m, i }) => {
      let sub;
      try { sub = JSON.parse(m.to.slice(4)); } catch { res[i] = { ok: false, error: "suscripción ilegible", muerta: true }; return; }
      const payload = JSON.stringify({
        titulo: m.title,
        cuerpo: m.body,
        url: m.data?.url ?? "/",
        tipo: m.data?.tipo ?? null,
      });
      try {
        // `urgency: high` y un día de vida, como los del portal: sin eso iOS
        // y Android en reposo los entregan por tandas, tarde.
        await webpush.sendNotification(sub, payload, { urgency: "high", TTL: 86400 });
        res[i] = { ok: true };
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        res[i] = { ok: false, error: `web ${status ?? "?"}`, muerta: status === 404 || status === 410 };
      }
    }));
  } else {
    for (const { i } of web) res[i] = { ok: false, error: "web sin VAPID" };
  }
  return res;
}
