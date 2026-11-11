// ─── WhatsApp: el código para entrar desde un teléfono nuevo ────────────────
//
// 2026-11-11. Lo usa `app-clientes` (acción `entrar`). Se manda con la API
// oficial de WhatsApp Business (Cloud API de Meta) y una plantilla de
// AUTENTICACIÓN, que es la única categoría que Meta deja usar para códigos:
// lleva el código en el cuerpo y en el botón «Copiar código».
//
// Docs: https://developers.facebook.com/docs/whatsapp/business-management-api/authentication-templates
//
// Secretos de la función (sin los tres, `whatsappListo()` es falso y la app
// entra como siempre, sin código):
//   WHATSAPP_TOKEN      token permanente de un usuario del sistema con
//                       `whatsapp_business_messaging`.
//   WHATSAPP_PHONE_ID   el «Phone number ID» del número que envía.
//   WHATSAPP_PLANTILLA  el nombre de la plantilla de autenticación aprobada
//                       (idioma `es`, con botón de copiar código).

const VERSION_API = "v21.0";

export const whatsappListo = () =>
  !!(Deno.env.get("WHATSAPP_TOKEN") && Deno.env.get("WHATSAPP_PHONE_ID") && Deno.env.get("WHATSAPP_PLANTILLA"));

/** ¿Ese número puede recibir WhatsApp? Los fijos de El Salvador (empiezan con
 *  2) no: no se intenta mandar a un número que nunca lo va a recibir. */
export const recibeWhatsapp = (tel8: string) => /^[67]\d{7}$/.test(tel8);

/** Manda el código. Lanza si Meta no lo acepta: quien llama decide qué decirle
 *  al cliente, y un envío fallido nunca se da por hecho. */
export async function enviarCodigoWhatsapp(tel8: string, codigo: string): Promise<void> {
  const token = Deno.env.get("WHATSAPP_TOKEN");
  const phoneId = Deno.env.get("WHATSAPP_PHONE_ID");
  const plantilla = Deno.env.get("WHATSAPP_PLANTILLA");
  if (!token || !phoneId || !plantilla) throw new Error("whatsapp: faltan secretos");
  const r = await fetch(`https://graph.facebook.com/${VERSION_API}/${phoneId}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: `503${tel8}`,
      type: "template",
      template: {
        name: plantilla,
        language: { code: "es" },
        components: [
          { type: "body", parameters: [{ type: "text", text: codigo }] },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: codigo }] },
        ],
      },
    }),
    // Meta lento no puede dejar al cliente esperando en la pantalla de entrar.
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) {
    const texto = await r.text().catch(() => "");
    throw new Error(`whatsapp ${r.status}: ${texto.slice(0, 300)}`);
  }
}

/** Seis dígitos al azar, con el generador criptográfico (nunca Math.random). */
export function codigoNuevo(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}
