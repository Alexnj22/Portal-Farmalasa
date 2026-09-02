// ─── Leer los créditos del sistema de la caja ───────────────────────────────
//
// Vive acá y no dentro de una función porque lo usan DOS: `creditos-erp` (la
// pantalla, y el abono) y `sync-creditos` (el cron que trae la cartera al
// portal). Escrito dos veces, el día que el origen cambie una columna una de
// las dos copias se queda vieja y nadie se entera — es lo que ya costó
// `turno_del_dia` con cuatro respuestas distintas a la misma pregunta.

const BASE       = "https://clientesdte3.oss.com.sv/farma_salud/";
const LOGIN_URL  = `${BASE}login.php`;
const SESION_URL = `${BASE}cambio_sesion.php`;
const LISTA_URL  = `${BASE}admin_credito_dt.php`;
export const ABONO_URL = `${BASE}abono_credito.php`;

/** Las formas de pago que el origen acepta, tal cual las ofrece su desplegable. */
export const FORMAS_DE_PAGO = [
  "Efectivo", "Recibo", "Voucher", "Transferencia", "Cheque", "Tarjeta", "Bitcoin", "Otro",
];

export interface CreditoDelOrigen {
  credito: string;
  fecha: string;
  cliente: string;
  tipo_doc: string;
  documento: string;
  total: number;
  abonado: number;
  saldo: number;
  estado: string;
  factura_erp: string | null;
}

export function getCortesCreds(): { username: string; password: string } {
  const raw = Deno.env.get("ERP_CORTES_CREDS");
  if (!raw) throw new Error("ERP_CORTES_CREDS secret no configurado.");
  return JSON.parse(raw);
}

export async function getSessionCookie(u: string, p: string): Promise<string> {
  const res = await fetch(LOGIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: u, password: p, m: "1" }).toString(),
    redirect: "manual", signal: AbortSignal.timeout(20_000),
  });
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("login sin cookie de sesión");
  return cookie;
}

export async function abrirSala(cookie: string, erpId: number): Promise<void> {
  const r = await fetch(SESION_URL, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ process: "set_sucursal", id_sucursal: String(erpId) }).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  let ok = false;
  try { ok = Boolean(JSON.parse(await r.text())?.success); } catch { ok = false; }
  // La lista y el abono son POR SUCURSAL: sin fijarla, se leería —o se
  // abonaría— en la sala equivocada, y eso no se deshace.
  if (!ok) throw new Error(`no se pudo abrir la sala ${erpId}`);
}

/** El HTML de una celda, en texto. El listado del origen viene con marcas. */
const soloTexto = (s: string) => String(s ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

/**
 * Los créditos de UNA sala.
 *
 * `length` alto y una sola pasada: son ~800 por sala en año y medio, y el
 * listado del origen pagina del lado del servidor. Pedir de a poco costaría una
 * vuelta de red por página para armar la misma lista.
 *
 * ⚠️ **En serie, nunca en paralelo.** La sucursal vive en la SESIÓN del origen,
 * así que dos lecturas a la vez se pisan la sala y devuelven la cartera
 * equivocada sin dar ningún error.
 */
export async function creditosDeLaSala(
  cookie: string, erpId: number, desde: string, hasta: string,
): Promise<CreditoDelOrigen[]> {
  await abrirSala(cookie, erpId);
  const url = `${LISTA_URL}?fechai=${desde}&fechaf=${hasta}&draw=1&start=0&length=5000`;
  const txt = await (await fetch(url, {
    headers: { Cookie: cookie, "X-Requested-With": "XMLHttpRequest" },
    signal: AbortSignal.timeout(60_000),
  })).text();
  let datos: { data?: unknown[][] };
  try { datos = JSON.parse(txt); } catch { throw new Error("el listado de créditos no vino en JSON"); }

  return (datos.data ?? []).map((f) => {
    // El id de la FACTURA sale del enlace «Ver Detalles»; el de la fila es el
    // del CRÉDITO. Los dos hacen falta y no son el mismo número: medido, el
    // crédito 1912 tiene la factura 299063.
    const factura = /id_factura=(\d+)/.exec(String(f[10] ?? ""))?.[1] ?? null;
    return {
      credito: String(f[0]),
      fecha: String(f[1]),
      cliente: soloTexto(String(f[2])),
      tipo_doc: String(f[3] ?? ""),
      documento: String(f[4] ?? ""),
      total: Number(f[6]) || 0,
      abonado: Number(f[7]) || 0,
      saldo: Number(f[8]) || 0,
      estado: soloTexto(String(f[9] ?? "")),
      factura_erp: factura,
    };
  });
}
