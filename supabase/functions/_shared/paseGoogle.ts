// La tarjeta de Puntos Salud en GOOGLE WALLET (2026-10-08): el gemelo Android
// de `pase.ts` (Apple Wallet).
//
// Google no recibe un archivo firmado como el .pkpass: recibe un ENLACE
// «Agregar a Google Wallet» (`https://pay.google.com/gp/v/save/<JWT>`) cuyo JWT
// lleva la tarjeta (un `loyaltyObject`) y su plantilla (un `loyaltyClass`),
// firmado con la llave de una CUENTA DE SERVICIO autorizada en la consola del
// emisor (pay.google.com/business/console). El teléfono abre el enlace, Google
// Wallet muestra la tarjeta y la persona toca «Guardar».
//
// Lo que dice es lo mismo que la de Apple —sale de `datosDeCliente`, una sola
// lectura para las dos—: saldo en dólares, puntos, nivel, «cliente desde» y el
// QR con la MISMA dirección que el ticket (`/mis-puntos?codigo=`).
//
// Secretos de la función (nunca en el repositorio):
//   GOOGLE_WALLET_ISSUER_ID   el número del emisor (consola de Google Pay & Wallet)
//   GOOGLE_WALLET_SA_B64      el JSON de la cuenta de servicio, en base64
// Sin ellos, `googleWalletListo()` da false y la app no ofrece el botón.
//
// Se ACTUALIZA SOLA con el mismo cron de Apple (`wallet-pases` /avisar, cada
// minuto): `avisarGoogle` toma las cuentas cuyo saldo cambió en los últimos
// minutos y le hace PATCH a su objeto. Sin tabla de «quién la guardó»: Google
// contesta 404 si esa persona nunca la guardó, y eso no es un error. La
// ventana es más larga que la cadencia para que un minuto perdido no deje una
// tarjeta vieja; repetir el PATCH no cambia nada.
import { claveDeNivel, corto, datosDeCliente, desde, MATERIALES, nivelRotulo, type DatosPase } from "./pase.ts";

interface CuentaDeServicio { client_email: string; private_key: string }

// Cuadrado: Google pide el logo del programa cuadrado (el de las facturas es
// apaisado, 435×123). 512 px es lo más grande que publica el portal hoy.
const LOGO = "https://portal.farmasalud.lat/Logo512.png";
const REGLAMENTO = "https://portal.farmasalud.lat/reglamento-puntos";

export const googleWalletListo = () => !!(Deno.env.get("GOOGLE_WALLET_ISSUER_ID") && Deno.env.get("GOOGLE_WALLET_SA_B64"));

function cuenta(): CuentaDeServicio {
  const b64 = Deno.env.get("GOOGLE_WALLET_SA_B64");
  if (!b64) throw new Error("falta GOOGLE_WALLET_SA_B64");
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
}
const emisor = () => {
  const id = Deno.env.get("GOOGLE_WALLET_ISSUER_ID");
  if (!id) throw new Error("falta GOOGLE_WALLET_ISSUER_ID");
  return id;
};

const b64url = (b: Uint8Array | string) => {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : b;
  let t = "";
  for (let i = 0; i < bytes.length; i += 0x8000) t += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(t).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function firmarRS256(cuerpo: Record<string, unknown>, sa: CuentaDeServicio): Promise<string> {
  const der = Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  const llave = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const datos = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify(cuerpo))}`;
  const firma = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", llave, new TextEncoder().encode(datos)));
  return `${datos}.${b64url(firma)}`;
}

// «rgb(40, 10, 52)» → «#280a34»: Google pide el color en hex.
const hex = (rgb: string) => "#" + (rgb.match(/\d+/g) ?? ["0", "0", "0"]).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("");

/** Una plantilla por material (vip, oro, zafiro…): el color de fondo es el del material, como en Apple. */
function clase(nivel: string | undefined) {
  const clave = claveDeNivel(nivel);
  return {
    id: `${emisor()}.puntos-salud-${clave}`,
    issuerName: "Farmacia Salud",
    programName: "Puntos Salud",
    programLogo: { sourceUri: { uri: LOGO }, contentDescription: { defaultValue: { language: "es", value: "Farmacia Salud" } } },
    hexBackgroundColor: hex(MATERIALES[clave].fondo),
    reviewStatus: "UNDER_REVIEW",
    countryCode: "SV",
    localizedIssuerName: { defaultValue: { language: "es", value: "Farmacia Salud" } },
  };
}

const idDeObjeto = (d: DatosPase) => `${emisor()}.socio-${d.customerId}${d.prueba ? `-prueba-${claveDeNivel(d.nivel)}${d.equipo ? "-equipo" : ""}` : ""}`;

function objeto(d: DatosPase) {
  const qr = d.codigo ? `https://portal.farmasalud.lat/mis-puntos?codigo=${d.codigo}` : "https://portal.farmasalud.lat/mis-puntos";
  return {
    id: idDeObjeto(d),
    classId: clase(d.nivel).id,
    state: "ACTIVE",
    accountId: d.codigo ?? String(d.customerId),
    accountName: corto(d.nombre),
    hexBackgroundColor: hex(MATERIALES[claveDeNivel(d.nivel)].fondo),
    loyaltyPoints: { label: "Saldo de puntos", balance: { money: { micros: Math.round(d.equivale * 1_000_000), currencyCode: "USD" } } },
    secondaryLoyaltyPoints: { label: "Puntos", balance: { int: Math.round(d.saldo) } },
    barcode: { type: "QR_CODE", value: qr, alternateText: d.codigo ?? "" },
    textModulesData: [
      // Igual que en Apple: el personal lleva su nivel con « · TEAM».
      { id: "nivel", header: `${nivelRotulo(d.nivel)}${d.equipo ? " · TEAM" : ""}`, body: corto(d.nombre) },
      { id: "desde", header: "Cliente desde", body: desde(d.socioDesde) },
      { id: "como", header: "Cómo se usa", body: "Muestra el código en caja: acumulas en cada compra y canjeas desde 100 puntos ($1)." },
    ],
    linksModuleData: { uris: [{ id: "reglamento", uri: REGLAMENTO, description: "Reglamento" }] },
  };
}

/** El enlace «Agregar a Google Wallet» de una ficha. La app lo abre y Google hace el resto. */
// deno-lint-ignore no-explicit-any
export async function enlaceGoogleWallet(admin: any, customerId: number, nivelDePrueba?: string, equipoPrueba = false): Promise<string> {
  const sa = cuenta();
  const { datos } = await datosDeCliente(admin, customerId, nivelDePrueba, equipoPrueba);
  const jwt = await firmarRS256({
    iss: sa.client_email,
    aud: "google",
    typ: "savetowallet",
    iat: Math.floor(Date.now() / 1000),
    origins: [],
    payload: { loyaltyClasses: [clase(datos.nivel)], loyaltyObjects: [objeto(datos)] },
  }, sa);
  return `https://pay.google.com/gp/v/save/${jwt}`;
}

async function tokenOAuth(sa: CuentaDeServicio): Promise<string> {
  const ahora = Math.floor(Date.now() / 1000);
  const asercion = await firmarRS256({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/wallet_object.issuer",
    aud: "https://oauth2.googleapis.com/token", iat: ahora, exp: ahora + 3600,
  }, sa);
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: asercion }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`Google OAuth ${r.status}: ${await r.text()}`);
  return (await r.json()).access_token;
}

/**
 * Le dice a Google el saldo nuevo de una tarjeta ya guardada. 404 = esa
 * persona nunca la guardó (no es un error: devuelve false).
 */
// deno-lint-ignore no-explicit-any
export async function actualizarObjetoGoogle(admin: any, customerId: number, token?: string): Promise<boolean> {
  const { datos } = await datosDeCliente(admin, customerId);
  const o = objeto(datos);
  const r = await fetch(`https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${encodeURIComponent(o.id)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token ?? await tokenOAuth(cuenta())}`, "Content-Type": "application/json" },
    body: JSON.stringify({ loyaltyPoints: o.loyaltyPoints, secondaryLoyaltyPoints: o.secondaryLoyaltyPoints, textModulesData: o.textModulesData, hexBackgroundColor: o.hexBackgroundColor }),
    // Corre dentro del cron de cada minuto: uno colgado no puede llevarse la vuelta de Apple.
    signal: AbortSignal.timeout(15_000),
  });
  if (r.status === 404) return false;
  if (!r.ok) throw new Error(`Google Wallet ${r.status}: ${await r.text()}`);
  return true;
}

// Medido 2026-10-08: ~2 cuentas cambian cada 5 min, pico 41. Cron cada minuto + ventana de 2.
const VENTANA_MIN = 2;

/** Lo que corre el cron: las tarjetas de Google cuyo saldo cambió en los últimos minutos. */
// deno-lint-ignore no-explicit-any
export async function avisarGoogle(admin: any) {
  if (!googleWalletListo()) return { ok: true, google: "sin_configurar" };
  const desdeISO = new Date(Date.now() - VENTANA_MIN * 60_000).toISOString();
  const { data, error } = await admin.from("puntos_cuenta").select("customer_id").gte("updated_at", desdeISO).limit(500);
  if (error) throw error;
  if (!data?.length) return { ok: true, google: 0 };
  const token = await tokenOAuth(cuenta());
  let actualizadas = 0;
  const errores: string[] = [];
  for (const { customer_id } of data as { customer_id: number }[]) {
    try { if (await actualizarObjetoGoogle(admin, customer_id, token)) actualizadas++; } catch (e) { errores.push((e as Error)?.message ?? String(e)); }
  }
  if (errores.length) console.error("[wallet-pases] errores Google Wallet:", [...new Set(errores)].slice(0, 5).join(" | "));
  return { ok: true, google: data.length, actualizadas, errores: errores.length };
}
