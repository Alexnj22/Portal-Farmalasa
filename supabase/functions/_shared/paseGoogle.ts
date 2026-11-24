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
// lectura para las dos—: saldo en dólares, puntos, nivel y el mismo código
// de barras Code 128 con el código de 7 caracteres, sin el código escrito
// (2026-10-17, igual que Apple desde v2.1303.2).
//
// Secretos de la función (nunca en el repositorio):
//   GOOGLE_WALLET_ISSUER_ID   el número del emisor (consola de Google Pay & Wallet)
//   GOOGLE_WALLET_SA_B64      el JSON de la cuenta de servicio, en base64
// Sin ellos, `googleWalletListo()` da false y la app no ofrece el botón.
//
// Se ACTUALIZA SOLA con el mismo cron de Apple (`wallet-pases` /avisar, cada
// minuto). Desde el 2026-11-24 sólo a quien la tiene: `wallet_google_tarjetas`
// lleva una fila por ficha con tarjeta (entra al pedir el enlace y con el
// barrido diario `reconciliarGoogle`, que lee la lista de objetos que Google
// tiene de este emisor) y su `notificado_at`, como Apple: cada cambio se manda
// UNA vez. Antes era una ventana de 2 minutos sobre todo `puntos_cuenta` con el
// cron cada minuto: cada cambio salía dos veces, y a todas las cuentas aunque
// nunca la hubieran guardado (~770 PATCH al día, casi todos para un 404).
import { claveDeNivel, corto, datosDeCliente, MATERIALES, nivelRotulo, type DatosPase } from "./pase.ts";

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
    // Sin `countryCode` (2026-10-17): la consola de Google Wallet no ofrece El
    // Salvador en esa lista, y un código que Google no acepta haría fallar la clase.
    localizedIssuerName: { defaultValue: { language: "es", value: "Farmacia Salud" } },
  };
}

const idDeObjeto = (d: DatosPase) => `${emisor()}.socio-${d.customerId}${d.prueba ? `-prueba-${claveDeNivel(d.nivel)}${d.equipo ? "-equipo" : ""}` : ""}`;

// El código de barras: el mismo Code 128 que la tarjeta de Apple y la de la
// app, con el código de 7 caracteres que lee la caja. Google admite UN solo
// código (Apple lleva además el QR para el Watch), así que el QR sólo queda
// para la ficha que todavía no tiene código: la caja también acepta la
// dirección de `/mis-puntos`. `alternateText` vacío a propósito: el código
// escrito debajo de las barras deja copiarlo de una foto sin tener la tarjeta.
function codigoDeBarras(d: DatosPase) {
  if (d.codigo) return { type: "CODE_128", value: d.codigo, alternateText: "" };
  return { type: "QR_CODE", value: "https://portal.farmasalud.lat/mis-puntos", alternateText: "" };
}

function objeto(d: DatosPase) {
  return {
    id: idDeObjeto(d),
    classId: clase(d.nivel).id,
    state: "ACTIVE",
    // Sin `accountId`: Google lo pinta en la tarjeta como «ID de miembro», y
    // ahí iba el código — o sea, el código escrito que el barcode ya no lleva.
    accountName: corto(d.nombre),
    hexBackgroundColor: hex(MATERIALES[claveDeNivel(d.nivel)].fondo),
    loyaltyPoints: { label: "Saldo de puntos", balance: { money: { micros: Math.round(d.equivale * 1_000_000), currencyCode: "USD" } } },
    secondaryLoyaltyPoints: { label: "Puntos", balance: { int: Math.round(d.saldo) } },
    barcode: codigoDeBarras(d),
    textModulesData: [
      // Igual que en Apple: el personal lleva su nivel con « · TEAM».
      { id: "nivel", header: `${nivelRotulo(d.nivel)}${d.equipo ? " · TEAM" : ""}`, body: corto(d.nombre) },
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
    headers: { Authorization: `Bearer ${token ?? await tokenVigente()}`, "Content-Type": "application/json" },
    // El barcode va también: así las tarjetas guardadas con el QR viejo (y el
    // código escrito debajo) pasan al Code 128 la próxima vez que cambie su saldo.
    body: JSON.stringify({ loyaltyPoints: o.loyaltyPoints, secondaryLoyaltyPoints: o.secondaryLoyaltyPoints, textModulesData: o.textModulesData, hexBackgroundColor: o.hexBackgroundColor, barcode: o.barcode }),
    // Corre dentro del cron de cada minuto: uno colgado no puede llevarse la vuelta de Apple.
    signal: AbortSignal.timeout(15_000),
  });
  if (r.status === 404) return false;
  if (r.status === 401) tokenEnCache = null; // token vencido antes de tiempo: el próximo intento pide otro
  if (!r.ok) throw new Error(`Google Wallet ${r.status}: ${await r.text()}`);
  return true;
}

// El token dura una hora: se reusa mientras viva la instancia (50 min), en vez
// de pedir uno nuevo en cada vuelta del cron.
let tokenEnCache: { valor: string; vence: number } | null = null;
async function tokenVigente(): Promise<string> {
  if (tokenEnCache && Date.now() < tokenEnCache.vence) return tokenEnCache.valor;
  const valor = await tokenOAuth(cuenta());
  tokenEnCache = { valor, vence: Date.now() + 50 * 60_000 };
  return valor;
}

// Quien pidió el enlace y todavía no aparece en Google: se le da un día para
// guardarla antes de sacarlo de la lista (un 404 antes de eso no lo borra).
const GRACIA_MS = 24 * 60 * 60_000;

/**
 * Lo que corre el cron: las tarjetas de Google cuyo saldo cambió después del
 * último aviso (`wallet_google_por_avisar`). Una sola vez por cambio.
 */
// deno-lint-ignore no-explicit-any
export async function avisarGoogle(admin: any) {
  if (!googleWalletListo()) return { ok: true, google: "sin_configurar" };
  const { data, error } = await admin.rpc("wallet_google_por_avisar");
  if (error) throw error;
  if (!data?.length) return { ok: true, google: 0 };
  const token = await tokenVigente();
  let actualizadas = 0;
  const errores: string[] = [];
  const sinTarjeta: number[] = [];
  const anotar = async (customer_id: number, cambio_at: string) => {
    const { error: eU } = await admin.from("wallet_google_tarjetas").update({ notificado_at: cambio_at }).eq("customer_id", customer_id);
    if (eU) console.error("[wallet-pases] Google: no se anotó el aviso:", eU.message);
  };
  for (const f of data as { customer_id: number; cambio_at: string; created_at: string }[]) {
    try {
      if (await actualizarObjetoGoogle(admin, f.customer_id, token)) {
        actualizadas++;
        await anotar(f.customer_id, f.cambio_at);
      } else if (Date.now() - Date.parse(f.created_at) > GRACIA_MS) {
        sinTarjeta.push(f.customer_id); // 404: pidió el enlace hace más de un día y no la guardó
      } else {
        await anotar(f.customer_id, f.cambio_at); // 404 reciente: puede guardarla todavía; al guardarla nace al día
      }
    } catch (e) {
      // Sin anotar: el próximo minuto lo reintenta.
      errores.push((e as Error)?.message ?? String(e));
    }
  }
  if (sinTarjeta.length) {
    const { error: eD } = await admin.from("wallet_google_tarjetas").delete().in("customer_id", sinTarjeta);
    if (eD) console.error("[wallet-pases] Google: no se borraron las que no están guardadas:", eD.message);
  }
  if (errores.length) console.error("[wallet-pases] errores Google Wallet:", [...new Set(errores)].slice(0, 5).join(" | "));
  return { ok: true, google: data.length, actualizadas, sinTarjeta: sinTarjeta.length, errores: errores.length };
}

/**
 * El barrido diario: quién tiene la tarjeta según GOOGLE. Lista los objetos de
 * cada plantilla (una por material) y siembra `wallet_google_tarjetas` con las
 * fichas que aparecen. Es lo que garantiza que nadie con la tarjeta guardada se
 * quede sin avisos: también las guardadas antes de que existiera la tabla, o
 * con un enlace viejo. Si la lista sale completa, saca a quien pidió el enlace
 * hace más de un día y no está.
 */
// deno-lint-ignore no-explicit-any
export async function reconciliarGoogle(admin: any) {
  if (!googleWalletListo()) return { ok: true, google: "sin_configurar" };
  const token = await tokenVigente();
  const prefijo = `${emisor()}.socio-`;
  const ids = new Set<number>();
  let objetos = 0, sinUsuarios = 0, conUsuarios = 0;
  for (const clave of Object.keys(MATERIALES)) {
    let pagina: string | undefined;
    do {
      const u = new URL("https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject");
      u.searchParams.set("classId", `${emisor()}.puntos-salud-${clave}`);
      u.searchParams.set("maxResults", "1000");
      if (pagina) u.searchParams.set("token", pagina);
      const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
      if (r.status === 404) break; // esa plantilla nunca se creó: nadie guardó ese material
      if (!r.ok) throw new Error(`Google Wallet lista ${clave} ${r.status}: ${await r.text()}`);
      const j = await r.json();
      for (const o of (j.resources ?? []) as { id?: string; hasUsers?: boolean }[]) {
        objetos++;
        const resto = String(o.id ?? "").startsWith(prefijo) ? String(o.id).slice(prefijo.length) : "";
        if (!/^\d+$/.test(resto)) continue; // las de prueba (`-prueba-…`) no se avisan
        // `hasUsers: false` = la quitaron de su teléfono. Sin el campo se cuenta
        // como guardada: sobra un PATCH, pero no se pierde a nadie.
        if (o.hasUsers === false) { sinUsuarios++; continue; }
        if (o.hasUsers === true) conUsuarios++;
        ids.add(Number(resto));
      }
      pagina = j.pagination?.nextPageToken || undefined;
    } while (pagina);
  }
  const { data, error } = await admin.rpc("wallet_google_sembrar", { p_ids: [...ids], p_completo: true });
  if (error) throw error;
  return { ok: true, objetos, conUsuarios, sinUsuarios, ...(data as object) };
}

/**
 * «Borrar mi cuenta» de la app (2026-10-19): la tarjeta guardada en Google
 * Wallet pasa a VENCIDA (Google la mueve a «Pases vencidos» y deja de
 * mostrarla como vigente). 404 = esa persona nunca la guardó: no es un error.
 * Sólo cambia el estado: el PATCH del saldo (`actualizarObjetoGoogle`) no
 * manda `state`, así que no la vuelve a activar.
 */
export async function expirarObjetoGoogle(customerId: number): Promise<boolean> {
  const id = `${emisor()}.socio-${customerId}`;
  const r = await fetch(`https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${await tokenVigente()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ state: "EXPIRED" }),
    signal: AbortSignal.timeout(15_000),
  });
  if (r.status === 404) return false;
  if (!r.ok) throw new Error(`Google Wallet ${r.status}: ${await r.text()}`);
  return true;
}
