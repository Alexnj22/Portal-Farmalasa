// La conversación con el ERP y, a través de él, con Hacienda.
//
// Vive acá y no dentro de una función porque hay DOS que la necesitan:
// `aplicar-solicitud-facturacion` (anula lo que el supervisor aprobó) y
// `regularizar-dte` (el barrido nocturno de lo que quedó a medias). Tenerla
// dos veces sería garantizar que una de las copias se quede vieja.
//
// ── Los cuatro pasos, y por qué ese orden ─────────────────────────────────
// El navegador NUNCA habla directo con el MH: todo va por `proxydte.php`, que
// es el proxy del propio ERP.
//
//   1. GET  generar_dte.php | anular_dte.php   → token + ambiente
//   2. POST _helper_dte_class.php  creaJsonDTe → arma y firma el documento
//   3. POST generar_dte.php        get_dte     → lo lee
//   4. POST proxydte.php                       → lo envía al MH
//   5. POST generar_dte.php        save_response_mh → registra la respuesta
//
// EL PASO 1 NO ES DECORATIVO. Esa pantalla no solo entrega el token: al
// abrirla, el ERP se autentica contra Hacienda y **lo cachea en la sesión
// PHP**. Sin ese GET previo, `get_dte` responde
// {"detalles":null,"typeinfo":"Error","msg":"Token no pudo ser cargado"}.
// Comprobado el 2026-08-05 salteándolo.
//
// EL PASO 5 NO ES OPCIONAL, y corre incluso cuando Hacienda rechaza: si se
// envía y no se registra la respuesta, el MH tiene el documento y el ERP no lo
// anota. Esa divergencia es justo lo que el módulo de Facturación existe para
// detectar.
//
// ── Una sesión sirve para LEER todas las sucursales. Para escribir, no ───
// Verificado el 2026-08-06: la misma cookie leyó facturas de Salud 1, 3, 4, 5
// y La Popular sin pasar por `cambio_sesion.php`. Los endpoints de DTE
// resuelven por `id_factura`, no por el contexto de sucursal de la sesión.
//
// PERO ESO VALE SÓLO PARA LEER, y la frase anterior —que no lo decía— hizo que
// `aplicar-solicitud-facturacion` se saltara el cambio de sucursal. La cuenta
// del portal aterriza siempre en Salud 1: la única anulación que funcionó era
// justamente de Salud 1, y la primera de otra sala fue rechazada (Salud 4,
// 0000068132_COF, 2026-08-11).
//
// `anular_factura.php` no es un endpoint de DTE aunque viva en la misma
// familia: revierte la venta —existencias y caja de esa sala— y sigue a la
// sucursal de la SESIÓN. Toda escritura abre antes su sucursal con
// `cambio_sesion.php`, como ya hacían las otras nueve funciones.

const BASE        = "https://clientesdte3.oss.com.sv/farma_salud";
const LOGIN_URL   = `${BASE}/login.php`;
const GENERAR_DTE = `${BASE}/generar_dte.php`;
const ANULAR_DTE  = `${BASE}/anular_dte.php`;
const ANULAR      = `${BASE}/anular_factura.php`;
const HELPER_DTE  = `${BASE}/_helper_dte_class.php`;
const PROXY_DTE   = `${BASE}/proxydte.php`;

export { BASE, ANULAR };

/** Estado de los tres campos editables, leído de la pantalla del ERP. */
export type Ficha = { cliente: string | null; clienteNombre: string; credito: string | null; vendedor: string | null };

export function parsearFicha(html: string): Ficha {
  /* `-?` porque **CLIENTES VARIOS es `value='-1'`**, y el `\d+` de antes no lo
   * leía: la ficha volvía con `cliente: null` para toda venta a consumidor sin
   * nombre. Eso no era cosmético — ver la guarda del cambio de pago. */
  const cli = html.match(/id="id_cliente"[\s\S]*?<option value='(-?\d+)'\s+selected>\s*([^<]*?)\s*<\/option>/);
  const selCred = html.match(/id="credito"([\s\S]*?)<\/select>/);
  const cred = selCred?.[1].match(/<option value="(\d)"\s+selected>/);
  const vend = html.match(/Cod\. Vendedor<\/label>[\s\S]*?<input[^>]*value="([^"]*)"/);
  return {
    cliente: cli?.[1] ?? null,
    clienteNombre: cli?.[2] ?? "",
    credito: cred?.[1] ?? null,
    // El input vacío da `""`, no `null`. Con `?? null` un campo en blanco
    // pasaba por "leído", que es la mitad de por qué la guarda de abajo nunca
    // se disparó.
    vendedor: vend?.[1]?.trim() || null,
  };
}

export async function leerFicha(cookie: string, erpId: string): Promise<Ficha> {
  const html = await pedir(cookie, `${BASE}/reimprimir_factura.php?id_factura=${encodeURIComponent(erpId)}`);
  const ficha = parsearFicha(html);
  /* La pantalla se dibuja IGUAL cuando la venta no carga: el combo de forma de
   * pago no queda vacío, queda en su valor por defecto —«Efectivo»—. Así que
   * «pude leer la forma de pago» NO prueba que haya una venta detrás; lo
   * prueban el cliente y el vendedor.
   *
   * La guarda vieja pedía los TRES en null y por eso nunca se disparó. Con
   * 0000065840_COF (Salud 2, 26-ago) la pantalla llegó sin cliente, sin
   * vendedor y sin total, el combo dijo «Efectivo» por defecto, y como el
   * cambio pedido era JUSTAMENTE a efectivo la comprobación posterior dio
   * por bueno un cambio que nunca ocurrió. */
  if (ficha.cliente === null && ficha.vendedor === null)
    throw new Error(`La pantalla de la venta ${erpId} no trae sus datos, así que no se toca.`);
  return ficha;
}

// Una factura anulada no es un documento vivo. Son DOS estados, no uno: medido
// el 2026-08-06, 975 facturas en 'DTE INVALIDADO EN MH' contra 14 en 'NULA'.
// 'NULA' es el paso intermedio —anulada en el ERP, todavía sin invalidar ante
// Hacienda—; el final es el otro. Mismo criterio que `factura_esta_anulada()`.
const ESTADOS_ANULADA = new Set(["NULA", "DTE INVALIDADO EN MH"]);
export const estaAnulada = (estado: string | null | undefined) =>
  ESTADOS_ANULADA.has(String(estado ?? "").toUpperCase());

export function getCreds(): { username: string; password: string } {
  const raw = Deno.env.get("ERP_FACTURACION_CREDS") ?? Deno.env.get("ERP_PURCHASES_CREDS");
  if (!raw) throw new Error("Falta el secreto ERP_FACTURACION_CREDS.");
  return JSON.parse(raw);
}

export async function login(): Promise<string> {
  const { username, password } = getCreds();
  const res = await fetch(LOGIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, m: "1" }).toString(),
    redirect: "manual",                       // la cookie viaja en el 302
    signal: AbortSignal.timeout(20_000),
  });
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("El ERP no devolvió cookie de sesión.");
  return cookie;
}

// El ERP se cae solo a veces: en 365 escrituras contestó una vez "Proceso no
// encontrado" en texto plano, y el mismo payload entró al reintentarlo.
export async function conReintento<T>(fn: () => Promise<T>, veces = 3, pausaMs = 1500): Promise<T> {
  let ultimo: unknown;
  for (let i = 0; i < veces; i++) {
    try { return await fn(); } catch (e) {
      ultimo = e;
      if (i < veces - 1) await new Promise(r => setTimeout(r, pausaMs * (i + 1)));
    }
  }
  throw ultimo;
}

interface OpcionesPedido {
  cuerpoJson?: unknown;
  extra?: Record<string, string>;
  timeoutMs?: number;
}

export async function pedir(
  cookie: string, url: string, datos?: URLSearchParams, opts: OpcionesPedido = {},
): Promise<string> {
  const { cuerpoJson, extra, timeoutMs = 45_000 } = opts;
  const hayCuerpo = datos !== undefined || cuerpoJson !== undefined;
  return await conReintento(async () => {
    const res = await fetch(url, {
      method: hayCuerpo ? "POST" : "GET",
      headers: {
        Cookie: cookie,
        "User-Agent": "Mozilla/5.0",
        "X-Requested-With": "XMLHttpRequest",
        Referer: `${BASE}/admin_factura_rangos.php`,
        ...(cuerpoJson !== undefined ? { "Content-Type": "application/json" }
            : datos !== undefined ? { "Content-Type": "application/x-www-form-urlencoded" }
            : {}),
        ...(extra ?? {}),
      },
      body: cuerpoJson !== undefined ? JSON.stringify(cuerpoJson) : datos?.toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const texto = await res.text();
    if (/name\s*=\s*["']password/i.test(texto.slice(0, 4000)))
      throw new Error("La sesión del ERP caducó (devolvió el login).");
    return texto;
  });
}

/** Lee el `{typeinfo,msg}` del ERP. Un rechazo llega con HTTP 200. */
export function leerRespuesta(cuerpo: string): { ok: boolean; msg: string } {
  try {
    const j = JSON.parse(cuerpo);
    return { ok: String(j.typeinfo).toLowerCase() === "success", msg: String(j.msg ?? "") };
  } catch {
    return { ok: false, msg: `Respuesta ilegible del ERP: ${cuerpo.slice(0, 200)}` };
  }
}

/** El DUI viaja con el formato que valida el ERP (`isDUI`): 00000000-0. */
export function formatearDui(bruto: string): string | null {
  const d = String(bruto ?? "").replace(/\D/g, "");
  if (d.length !== 9) return null;
  return `${d.slice(0, 8)}-${d.slice(8)}`;
}

export interface ResultadoMH {
  sello: string;
  descripcion: string;
  codigo: string;
  fh: string;
  observaciones: string[];
  codigoGeneracion: string;
}

/**
 * Un rechazo de Hacienda, con las observaciones ENTERAS.
 *
 * Antes esto era un `Error` pelado y las observaciones viajaban concatenadas
 * dentro del `message`. Justo el caso accionable —el que se arregla corrigiendo
 * la ficha del cliente, `[receptor.direccion.distrito]`— era el que perdía la
 * estructura, mientras que las que sí llegaban como array eran casi todas
 * `[identificacion.fecEmi]`, que NO se arregla. Medido sobre el histórico: las
 * 3 apariciones del distrito estaban las 3 en rechazos.
 *
 * Sigue siendo un Error y `message` no cambió, así que quien solo lo registra
 * —`aplicar-solicitud-facturacion`— no se entera. Quien quiere actuar lee los
 * campos.
 */
export class RechazoMH extends Error {
  readonly esRechazoMH = true;
  constructor(
    message: string,
    readonly observaciones: string[],
    readonly descripcion: string,
    readonly codigo: string,
    readonly fh: string,
  ) {
    super(message);
    this.name = "RechazoMH";
  }
}

/**
 * Manda a Hacienda el documento de una factura y registra la respuesta.
 *
 * `anula: false` → emisión (la factura no tiene sello de recepción).
 * `anula: true`  → invalidación (la factura ya está anulada en el ERP).
 *
 * Es la MISMA cadena para los dos: cambia el `anula` que viaja en cada paso y,
 * en la invalidación, los datos de quien responde por ella.
 *
 * Lanza si Hacienda rechaza. El criterio de éxito es **el sello**, no el HTTP
 * 200: el proxy contesta 200 igual cuando el MH rechaza, y ahí `selloRecibido`
 * viene nulo con las razones en `observaciones`.
 */
export async function enviarDteAlMH(
  cookie: string,
  erpId: string,
  tipodoc: string,
  opts: { anula: boolean; nombreResp?: string; duiResp?: string },
): Promise<ResultadoMH> {
  const anula = opts.anula ? "1" : "0";

  // 1 · La pantalla: entrega el token y deja la sesión autenticada ante el MH.
  const pantalla = opts.anula
    ? `${ANULAR_DTE}?id_factura=${erpId}&tipodoc=${tipodoc}&anula=1`
    : `${GENERAR_DTE}?id_factura=${erpId}&tipodoc=${tipodoc}`;
  const modal = await pedir(cookie, pantalla);
  const token    = modal.match(/id=\s*"tok"[^>]*>([^<]+)<\/textarea>/)?.[1]?.trim();
  const ambiente = modal.match(/id="ambiente"\s+value="([^"]+)"/)?.[1] ?? "01";
  if (!token) throw new Error("El ERP no entregó el token de Hacienda.");

  // 2 · Armar y firmar el documento.
  const campos: Record<string, string> = {
    process: "creaJsonDTe", id_factura: erpId, tipodoc, anula,
  };
  if (opts.anula) {
    campos.nombreResp = opts.nombreResp ?? "";
    campos.duiResp    = opts.duiResp ?? "";
  }
  const creado = leerRespuesta(await pedir(cookie, HELPER_DTE, new URLSearchParams(campos)));
  if (!creado.ok) throw new Error(`No se pudo generar el documento: ${creado.msg}`);

  // 3 · Leerlo.
  const doc = JSON.parse(await pedir(cookie, GENERAR_DTE, new URLSearchParams({
    process: "get_dte", id_factura: erpId, tipodoc, anula,
  })))?.detalles;
  if (!doc?.encodeDte) throw new Error("El ERP no devolvió el documento firmado.");

  // 4 · Al MH, por el proxy del ERP. La emisión manda tipoDte y
  // codigoGeneracion; la invalidación no los lleva.
  const payload: Record<string, unknown> = {
    ambiente, idEnvio: doc.id_envio, version: doc.version, documento: doc.encodeDte,
  };
  if (!opts.anula) {
    payload.tipoDte = doc.tipoDTE;
    payload.codigoGeneracion = doc.codigoGeneracion;
  }
  const bruto = await pedir(cookie, PROXY_DTE, undefined, {
    cuerpoJson: payload,
    extra: { Authorization: token },
    timeoutMs: 60_000,
  });
  let mh: Record<string, unknown>;
  try { mh = JSON.parse(bruto); }
  catch { throw new Error(`Hacienda devolvió algo ilegible: ${bruto.slice(0, 200)}`); }

  const sello = String(mh.selloRecibido ?? "");
  const observaciones = Array.isArray(mh.observaciones) ? mh.observaciones.map(String) : [];

  // 5 · Registrar la respuesta en el ERP — pase lo que pase.
  await pedir(cookie, GENERAR_DTE, new URLSearchParams({
    process: "save_response_mh", id_factura: erpId, tipodoc, anula,
    clasificaMsg:    String(mh.clasificaMsg ?? ""),
    codigoMsg:       String(mh.codigoMsg ?? ""),
    descripcionMsg:  String(mh.descripcionMsg ?? ""),
    selloRecibido:   sello,
    observaciones:   JSON.stringify(observaciones),
    fhProcesamiento: String(mh.fhProcesamiento ?? ""),
  }));

  if (!sello || sello === "null")
    throw new RechazoMH(
      `Hacienda rechazó el documento: ${mh.descripcionMsg ?? "sin descripción"}` +
        (observaciones.length ? ` — ${observaciones.join("; ")}` : ""),
      observaciones,
      String(mh.descripcionMsg ?? ""),
      String(mh.codigoMsg ?? ""),
      String(mh.fhProcesamiento ?? ""),
    );

  return {
    sello,
    descripcion: String(mh.descripcionMsg ?? ""),
    codigo: String(mh.codigoMsg ?? ""),
    fh: String(mh.fhProcesamiento ?? ""),
    observaciones,
    codigoGeneracion: String(doc.codigoGeneracion ?? ""),
  };
}
