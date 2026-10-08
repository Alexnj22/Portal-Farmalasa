// ─── Wompi (Banco Agrícola): el cobro en línea de las reservas ─────────────
//
// Lo usan `app-clientes` (crea el enlace de pago) y `wompi-pagos` (recibe el
// aviso y la vuelta del navegador). Escrito una vez: el día que Wompi cambie
// un campo, una copia se quedaría vieja.
//
// Docs: https://docs.wompi.sv — swagger en https://api.wompi.sv/index.html.
// Credenciales: `WOMPI_CLIENT_ID` (App ID) y `WOMPI_CLIENT_SECRET` (API
// Secret) del negocio «Farmacias La Popular y La Salud».
//
// ── El pago se cree SÓLO a la API ───────────────────────────────────────────
// Ni el aviso (webhook) ni los parámetros de la vuelta del navegador marcan
// nada por sí solos: los dos sirven para saber QUÉ transacción mirar, y el
// veredicto sale de `GET /TransaccionCompra/{id}` (`esAprobada`, `monto`,
// `esReal`). El aviso además se valida con su HMAC antes de gastar una
// consulta.
//
// ── Modo de pruebas ─────────────────────────────────────────────────────────
// Mientras el negocio está «en desarrollo» en el panel de Wompi, todo cobro es
// de mentira (`esReal: false`). Esos pagos se aceptan SÓLO si el secreto
// `WOMPI_ACEPTA_PRUEBAS` vale "1". Al pasar el negocio a producción hay que
// borrar ese secreto: si no, un pago de prueba marcaría una reserva pagada.

const ID = "https://id.wompi.sv/connect/token";
const API = "https://api.wompi.sv";

let token: { valor: string; vence: number } | null = null;

async function tokenWompi(): Promise<string> {
  if (token && token.vence > Date.now() + 60_000) return token.valor;
  const r = await fetch(ID, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(15_000),
    body: new URLSearchParams({
      grant_type: "client_credentials",
      audience: "wompi_api",
      client_id: Deno.env.get("WOMPI_CLIENT_ID") ?? "",
      client_secret: Deno.env.get("WOMPI_CLIENT_SECRET") ?? "",
    }),
  });
  if (!r.ok) throw new Error(`wompi token ${r.status}`);
  const j = await r.json();
  token = { valor: j.access_token, vence: Date.now() + Number(j.expires_in ?? 3600) * 1000 };
  return token.valor;
}

/** Deja el token listo antes de que el cliente toque «Pagar» (2026-10-08): el
 *  primer cobro de una instancia nueva gastaba ~1 s sólo en pedirlo. */
export const calentarWompi = () => tokenWompi().then(() => true).catch(() => false);

async function api(metodo: string, ruta: string, cuerpo?: unknown) {
  const r = await fetch(`${API}${ruta}`, {
    method: metodo,
    headers: { authorization: `Bearer ${await tokenWompi()}`, "content-type": "application/json" },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    // Wompi lento no puede colgar al cliente ni agotar el aviso: 20 s y se corta.
    signal: AbortSignal.timeout(20_000),
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`wompi ${metodo} ${ruta} ${r.status}: ${texto.slice(0, 300)}`);
  return texto ? JSON.parse(texto) : null;
}

export type EnlaceNuevo = { idEnlace: number; urlEnlace: string; urlEnlaceLargo: string; estaProductivo: boolean };

/** Un enlace de pago de UN cobro, con monto fijo. */
export function crearEnlace(p: {
  identificador: string; monto: number; producto: string; descripcion: string;
  urlRedirect: string; urlWebhook: string; minutos: number;
}): Promise<EnlaceNuevo> {
  return api("POST", "/EnlacePago", {
    identificadorEnlaceComercio: p.identificador,
    monto: p.monto,
    nombreProducto: p.producto.slice(0, 100),
    infoProducto: { descripcionProducto: p.descripcion.slice(0, 250) },
    // Decisión del usuario (2026-10-07): tarjeta y QuickPay. Sin puntos ni
    // cuotas del banco, ni bitcoin.
    formaPago: {
      permitirTarjetaCreditoDebido: true,
      permitePagoQuickPay: true,
      permitirPagoConPuntoAgricola: false,
      permitirPagoEnCuotasAgricola: false,
      permitirPagoEnBitcoin: false,
      permitePagoNequi: false,
    },
    configuracion: {
      urlRedirect: p.urlRedirect,
      urlWebhook: p.urlWebhook,
      esMontoEditable: false,
      esCantidadEditable: false,
      cantidadPorDefecto: 1,
      duracionInterfazIntentoMinutos: p.minutos,
      notificarTransaccionCliente: true,
    },
    // Un enlace, un cobro: después del primer pago exitoso se desactiva.
    limitesDeUso: { cantidadMaximaPagosExitosos: 1 },
    // Viaja con la transacción: `wompi-pagos` lo compara para que nadie pegue
    // una transacción ajena a esta reserva.
    datosAdicionales: { reserva: p.identificador },
  });
}

export type Transaccion = {
  idTransaccion: string; esAprobada: boolean; esReal: boolean; monto: number;
  codigoAutorizacion?: string | null; formaPago?: string | null; mensaje?: string | null;
};

export const consultarTransaccion = (id: string): Promise<Transaccion> =>
  api("GET", `/TransaccionCompra/${encodeURIComponent(id)}`);

/** ¿El aviso viene de Wompi? HMAC-SHA256 del cuerpo TAL CUAL llegó, con el API Secret. */
export async function avisoAutentico(cuerpo: string, firma: string | null): Promise<boolean> {
  if (!firma) return false;
  const llave = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(Deno.env.get("WOMPI_CLIENT_SECRET") ?? ""),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const firmado = new Uint8Array(await crypto.subtle.sign("HMAC", llave, new TextEncoder().encode(cuerpo)));
  const esperado = [...firmado].map((b) => b.toString(16).padStart(2, "0")).join("");
  const recibido = firma.trim().toLowerCase();
  if (recibido.length !== esperado.length) return false;
  let dif = 0;
  for (let i = 0; i < esperado.length; i++) dif |= esperado.charCodeAt(i) ^ recibido.charCodeAt(i);
  return dif === 0;
}

export const aceptaPruebas = () => Deno.env.get("WOMPI_ACEPTA_PRUEBAS") === "1";
