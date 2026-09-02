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
/** El PANEL de un crédito: su deuda, sus abonos con fecha y hora, y el id de
 *  cada uno. Es la misma URL que el abono, con `id_credito` por GET. */
const PANEL_URL = `${BASE}abono_credito.php`;

/** Las ocho que el ORIGEN acepta, tal cual las ofrece su desplegable. Se deja
 *  escrita para saber qué se le puede mandar, pero NO es la lista que valida el
 *  portal — ver `FORMAS_DEL_PORTAL`. */
export const FORMAS_DEL_ORIGEN = [
  "Efectivo", "Recibo", "Voucher", "Transferencia", "Cheque", "Tarjeta", "Bitcoin", "Otro",
];

/**
 * Las CUATRO que el portal acepta, decidido por el usuario (2-sep): «voucher y
 * recibo quítalo, otro y bitcoin también».
 *
 * Las que salieron no eran formas de pago sino papeles —«recibo», «voucher»— o
 * un cajón de sastre —«otro»— que vuelve incontable lo que entró: con «otro»
 * disponible, el corte de la caja no se puede cuadrar por método.
 *
 * ⚠️ Esta lista y la del desplegable de `CuentasPorCobrarView` son la MISMA
 * dicha dos veces y se mueven juntas. Sólo acá, la pantalla ofrecería algo que
 * el servidor rechaza; sólo allá, alguien podría mandar `Bitcoin` en la
 * petición y el origen lo aceptaría.
 */
export const FORMAS_DEL_PORTAL = ["Efectivo", "Transferencia", "Tarjeta", "Cheque"];

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


export interface AbonoDelOrigen {
  erp_id: string | null;
  fecha: string | null;     // YYYY-MM-DD
  hora: string | null;
  forma: string;
  documento: string | null;
  monto: number;
}

/**
 * Los abonos que el ORIGEN tiene registrados para un crédito.
 *
 * ── Esto corrige una afirmación equivocada ────────────────────────────────
 * Hasta el 2-sep el portal decía —y así estaba escrito en el código— que «el
 * sistema de la caja no expone la fecha de sus abonos, sólo el acumulado». Es
 * falso: el panel `abono_credito.php?id_credito=<n>` trae la tabla completa con
 * **fecha, hora, tipo de documento, número y monto**, y además el id de cada
 * abono. La conclusión vieja salió de mirar el listado de créditos, que sólo da
 * el total abonado, y de no abrir el panel.
 *
 * Con esto la ficha puede mostrar TODO el historial y no sólo lo cobrado desde
 * el portal — que era la mitad de la historia, y la mitad que menos importa
 * cuando alguien discute un saldo.
 *
 * Se lee bajo demanda, al abrir la ficha: es una petición de ~250 ms. Traerlo
 * en el cron serían 124 peticiones por corrida para algo que casi nadie mira.
 */
export async function abonosDelCredito(
  cookie: string, erpId: number, credito: string,
): Promise<AbonoDelOrigen[]> {
  await abrirSala(cookie, erpId);
  const html = await (await fetch(`${PANEL_URL}?id_credito=${encodeURIComponent(credito)}`, {
    headers: { Cookie: cookie, "X-Requested-With": "XMLHttpRequest" },
    signal: AbortSignal.timeout(30_000),
  })).text();

  /* El cuerpo de la tabla se llama `appas` en el HTML del origen. Se acota a
   * ese bloque a propósito: el panel trae además el formulario de abonar, y una
   * expresión suelta sobre la página entera levantaría sus filas. */
  const cuerpo = /<tbody[^>]*id=['"]appas['"][^>]*>([\s\S]*?)<\/tbody>/i.exec(html)?.[1] ?? "";
  const filas = [...cuerpo.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);

  return filas.map((fila) => {
    const celdas = [...fila.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((c) => c[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
    // El id del abono viaja en el `id` del botón de borrar de la última celda.
    const erp_id = /id=['"](\d+)['"]/.exec(fila)?.[1] ?? null;
    // dd-mm-aaaa → aaaa-mm-dd, sin pasar por Date: leída como medianoche, una
    // fecha retrocede un día en cualquier huso al oeste.
    const cruda = celdas[0] ?? "";
    const p = /^(\d{2})-(\d{2})-(\d{4})$/.exec(cruda);
    return {
      erp_id,
      fecha: p ? `${p[3]}-${p[2]}-${p[1]}` : null,
      hora: celdas[1] || null,
      forma: celdas[2] || "",
      documento: celdas[3] || null,
      monto: Number(String(celdas[4] ?? "").replace(/[^0-9.]/g, "")) || 0,
    };
  }).filter((a) => a.monto > 0);
}
