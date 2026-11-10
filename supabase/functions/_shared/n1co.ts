// ─── n1co: el cobro en línea (links de pago) ───────────────────────────────
//
// Reemplaza a Wompi (2026-11-10, decisión del dueño: Wompi se quita entero).
// Lo usan `app-clientes` y `operar-caja` (crean el link) y `n1co-pagos`
// (recibe el aviso de n1co y la vuelta del navegador). Escrito una vez: el día
// que n1co cambie un campo, una copia se quedaría vieja.
//
// Docs: https://n1-docs.pages.dev/docs/checkoutlink-api/intro (CheckoutLink) y
// https://n1-docs.pages.dev/docs/developer-tool/webhook (avisos).
//
// Secretos de la función:
//   N1CO_SECRET_KEY      llave del «Link de Checkout» (portal de n1co →
//                        Configuración → Opciones para desarrolladores).
//   N1CO_WEBHOOK_SECRET  la «llave secreta» que n1co genera al registrar la
//                        URL del aviso (Configuración → Webhook).
//   N1CO_AMBIENTE        "produccion" para cobrar de verdad. Cualquier otro
//                        valor —o ninguno— es el ambiente de PRUEBAS: falla
//                        segura, un olvido nunca cobra dinero real.
//   N1CO_ACEPTA_PRUEBAS  "1" para que un pago de pruebas marque el cobro como
//                        pagado (con `prueba: true`). Se borra al pasar a
//                        producción.
//
// ── El pago se cree SÓLO a la API ───────────────────────────────────────────
// Ni el aviso ni la vuelta del navegador marcan nada por sí solos: sirven para
// saber QUÉ orden mirar, y el veredicto sale de
// `GET /paymentlink/order/{orderCode}` sobre una orden que creamos NOSOTROS
// (el código se guarda al crear el link, nunca se toma de la petición).

const AMBIENTE = () => (Deno.env.get("N1CO_AMBIENTE") === "produccion" ? "produccion" : "pruebas");
const API = () => AMBIENTE() === "produccion" ? "https://api-pay.n1co.shop/api" : "https://api-pay-sandbox.n1co.shop/api";
export const esProduccion = () => AMBIENTE() === "produccion";
export const aceptaPruebas = () => Deno.env.get("N1CO_ACEPTA_PRUEBAS") === "1";

async function api(metodo: string, ruta: string, cuerpo?: unknown) {
  const llave = Deno.env.get("N1CO_SECRET_KEY");
  if (!llave) throw new Error("n1co: falta el secreto N1CO_SECRET_KEY");
  const r = await fetch(`${API()}${ruta}`, {
    method: metodo,
    headers: { authorization: `Bearer ${llave}`, "content-type": "application/json" },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    // n1co lento no puede colgar al cliente ni agotar el aviso: 20 s y se corta.
    signal: AbortSignal.timeout(20_000),
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`n1co ${metodo} ${ruta} ${r.status}: ${texto.slice(0, 300)}`);
  return texto ? JSON.parse(texto) : null;
}

/** ¿Hay con qué cobrar? Sin llave no se intenta crear nada ni se aparta nada:
 *  el pago en línea está «en preparación» (2026-11-10: Wompi se quitó antes de
 *  tener las credenciales de n1co). */
export const pasarelaLista = () => !!Deno.env.get("N1CO_SECRET_KEY");
export const EN_PREPARACION = "El pago en línea estará disponible muy pronto. Por ahora se paga en la sucursal.";

export type EnlaceNuevo = { idEnlace: number; codigo: string; url: string; prueba: boolean };

/** Un link de pago de UN cobro, con monto fijo. */
export async function crearEnlace(p: {
  identificador: string; monto: number; producto: string; descripcion: string;
  urlVuelta: string; minutos: number;
}): Promise<EnlaceNuevo> {
  const monto = Math.round(Number(p.monto) * 100) / 100;
  if (!(monto > 0)) throw new Error("n1co: monto inválido");
  const r = await api("POST", "/paymentlink/checkout", {
    // `orderReference` es NUESTRO identificador: viaja en el aviso y en la
    // orden, y `n1co-pagos` lo compara con la fila antes de confirmar.
    orderReference: p.identificador.slice(0, 255),
    orderName: p.producto.slice(0, 255),
    orderDescription: p.descripcion.slice(0, 2048),
    amount: monto,
    successUrl: p.urlVuelta,
    // Cancelar también vuelve por el mismo camino: la función mira la orden y
    // dice «pendiente», y la app vuelve a leer el estado.
    cancelUrl: `${p.urlVuelta}${p.urlVuelta.includes("?") ? "&" : "?"}cancelado=1`,
    expirationMinutes: Math.max(5, Math.round(p.minutos)),
    metadata: [{ name: "referencia", value: p.identificador }],
  });
  const idEnlace = Number(r?.orderId);
  const codigo = String(r?.orderCode ?? "");
  const url = String(r?.paymentLinkUrl ?? "");
  if (!Number.isFinite(idEnlace) || !codigo || !/^https:\/\//.test(url)) {
    throw new Error(`n1co: respuesta sin link (${JSON.stringify(r).slice(0, 200)})`);
  }
  return { idEnlace, codigo, url, prueba: !esProduccion() };
}

export type Orden = {
  orderId: number; orderCode: string; orderReference: string | null;
  estado: string; pagada: boolean; total: number; esReal: boolean;
  codigoAutorizacion: string | null; fecha: string | null;
};

/** La orden según n1co. `pagada` = PAID o FINALIZED (finalizada viene de pagada). */
export async function consultarOrden(codigo: string): Promise<Orden> {
  const o = await api("GET", `/paymentlink/order/${encodeURIComponent(codigo)}`);
  const estado = String(o?.orderStatus ?? "").toUpperCase();
  return {
    orderId: Number(o?.orderId),
    orderCode: String(o?.orderCode ?? codigo),
    orderReference: o?.orderReference == null ? null : String(o.orderReference),
    estado,
    pagada: estado === "PAID" || estado === "FINALIZED",
    total: Number(o?.total),
    esReal: esProduccion(),
    codigoAutorizacion: o?.payment?.authorizationCode ?? null,
    fecha: o?.created ?? null,
  };
}

/** ¿El aviso viene de n1co? HMAC-SHA256 del cuerpo TAL CUAL llegó, en Base64,
 *  con la llave secreta del webhook (cabecera `X-H4B-Hmac-Sha256`). */
export async function avisoAutentico(cuerpo: string, firma: string | null): Promise<boolean> {
  const secreto = Deno.env.get("N1CO_WEBHOOK_SECRET");
  if (!firma || !secreto) return false;
  const llave = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const firmado = new Uint8Array(await crypto.subtle.sign("HMAC", llave, new TextEncoder().encode(cuerpo)));
  const esperado = btoa(String.fromCharCode(...firmado));
  const recibido = firma.trim();
  if (recibido.length !== esperado.length) return false;
  let dif = 0;
  for (let i = 0; i < esperado.length; i++) dif |= esperado.charCodeAt(i) ^ recibido.charCodeAt(i);
  return dif === 0;
}
