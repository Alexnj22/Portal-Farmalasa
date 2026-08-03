import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders, requireInvokeSecret, getErpBranchMap } from "../_shared/security.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Trae el GRAN Z mensual del origen, por sucursal, y lo guarda tal cual.
//
// El endpoint NO es un archivo aparte: es un POST a la misma pantalla del
// reporte. Buscarlo como `reportez_gz.php`, `granz.php`, `print_gz.php` y cinco
// nombres más da 404 — está anotado porque cuesta media hora volver a
// descubrirlo:
//
//   POST reportez.php
//   process=imprimir_gz&fini=YYYY-MM-DD&ffin=YYYY-MM-DD&selectSucursal=N&id_sucursal_dom=N
//
// Devuelve JSON y el ticket entero viene en la clave `movimiento`.
//
// **Pide las credenciales de COMPRAS.** Con las de ventas la pantalla contesta
// "No tiene permiso para este modulo" y devuelve HTTP 200 con el menú vacío —
// o sea que un chequeo de status no lo atrapa.
//
// La sucursal es estado de SESIÓN además de parámetro: sin `cambio_sesion.php`
// se traería la del usuario y se guardaría como si fuera la pedida.
// ═══════════════════════════════════════════════════════════════════════════

const BASE       = "https://clientesdte3.oss.com.sv/farma_salud/";
const LOGIN_URL  = `${BASE}login.php`;
const SESION_URL = `${BASE}cambio_sesion.php`;
const Z_URL      = `${BASE}reportez.php`;

function getPurchaseCreds(): { username: string; password: string } {
  const raw = Deno.env.get("ERP_PURCHASES_CREDS");
  if (!raw) throw new Error("ERP_PURCHASES_CREDS secret no configurado.");
  return JSON.parse(raw);
}

async function getSessionCookie(username: string, password: string): Promise<string> {
  const res = await fetch(LOGIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, m: "1" }).toString(),
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("login sin cookie de sesión");
  return cookie;
}

// "$ 42,957.84" → 42957.84 · "$ 0.00" → 0
const money = (s: unknown) => Number(String(s ?? "").replace(/[^0-9.-]/g, "")) || 0;

const CLAVES: Record<string, string> = {
  "VENTAS EXENTAS": "exentas",
  "VENTAS GRAVADAS": "gravadas",
  "VENTAS NO SUJETAS": "no_sujetas",
  "RETENCION": "retencion",
  "TOTAL": "total",
  "No. INICIAL": "del",
  "No. FINAL": "al",
};

/**
 * El ticket son secciones con encabezado y pares "RÓTULO: $ monto".
 *
 * CUIDADO con `gravadas`: el origen rotula "VENTAS GRAVADAS" pero imprime el
 * TOTAL CON IVA. En un CCF de $170.10 el libro de contribuyentes reporta 150.54
 * de base y 19.56 de débito. Por eso lo que se guarda como `*_total` es la línea
 * TOTAL y el contraste contra el portal va contra `sum(total)`.
 */
function parsearTicket(mov: string) {
  const secciones: Record<string, Record<string, number>> = {
    tiquete: {}, factura: {}, ccf: {},
  };
  const encabezado: string[] = [];
  let total_general = 0;
  let sec: string | null = null;

  for (const raw of String(mov).split("\n")) {
    const l = raw.trim();
    if (/^VENTAS CON TIQUETE/.test(l))        { sec = "tiquete"; continue; }
    if (/^VENTAS CON FACTURA/.test(l))        { sec = "factura"; continue; }
    if (/^VENTAS CON CREDITO FISCAL/.test(l)) { sec = "ccf";     continue; }
    if (/^TOTAL GENERAL/.test(l)) { total_general = money(l.split(":")[1]); sec = null; continue; }
    if (!sec) { if (l) encabezado.push(l); continue; }
    const m = l.match(/^(VENTAS EXENTAS|VENTAS GRAVADAS|VENTAS NO SUJETAS|RETENCION|TOTAL|No\. INICIAL|No\. FINAL)\s*:\s*(.+)$/);
    if (m) secciones[sec][CLAVES[m[1]]] = money(m[2]);
  }
  return { secciones, encabezado, total_general };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!requireInvokeSecret(req)) {
    return new Response(JSON.stringify({ ok: false, error: "UNAUTHORIZED" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));

    // Sin `periodo`, el mes ANTERIOR: es lo que pide el cron del día 1, y es el
    // único mes que ya está cerrado y no va a cambiar.
    let periodo: string = String(body.periodo ?? "");
    if (!/^\d{4}-\d{2}$/.test(periodo)) {
      const hoy = new Date(Date.now() - 6 * 3600_000);      // hora SV
      const ant = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 1));
      periodo = `${ant.getUTCFullYear()}-${String(ant.getUTCMonth() + 1).padStart(2, "0")}`;
    }
    const [anio, mes] = periodo.split("-").map(Number);
    const fini = `${periodo}-01`;
    const ffin = `${periodo}-${String(new Date(Date.UTC(anio, mes, 0)).getUTCDate()).padStart(2, "0")}`;
    const onlyBranch = body.branchId != null ? Number(body.branchId) : null;

    const { username, password } = getPurchaseCreds();
    const cookie = await getSessionCookie(username, password);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Solo las sucursales que VENDEN. Bodega no emite Z.
    const objetivo = getErpBranchMap()
      .map((b: any) => ({ branchId: b.branchId, erpId: b.erpId }))
      .filter((b) => !onlyBranch || b.branchId === onlyBranch);

    const resultados: any[] = [];
    // Secuencial a propósito: el origen sirve estos reportes desde archivos
    // temporales de ruta fija y dos peticiones a la vez chocan (medido el
    // 2026-08-03: de 21 sondas en paralelo, 1 volvió con warnings de PHP y
    // HTTP 200, o sea indetectable por status).
    for (const { branchId, erpId } of objetivo) {
      try {
        await fetch(SESION_URL, {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ process: "set_sucursal", id_sucursal: String(erpId) }).toString(),
          signal: AbortSignal.timeout(20_000),
        });

        const res = await fetch(Z_URL, {
          method: "POST",
          headers: {
            Cookie: cookie,
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: new URLSearchParams({
            process: "imprimir_gz", fini, ffin,
            selectSucursal: String(erpId), id_sucursal_dom: String(erpId),
          }).toString(),
          signal: AbortSignal.timeout(60_000),
        });
        const txt = await res.text();

        let mov: string | null = null;
        try { mov = JSON.parse(txt)?.movimiento ?? null; } catch { /* no era JSON */ }
        // Un HTTP 200 con HTML es la pantalla de "No tiene permiso" o la sesión
        // caída. Guardar eso como un Corte Z sería guardar una mentira.
        if (!mov || !/TOTAL GENERAL/.test(mov)) {
          resultados.push({ branchId, error: `respuesta sin ticket (${res.status}, ${txt.length}b)` });
          continue;
        }

        const { secciones, encabezado, total_general } = parsearTicket(mov);
        const fila = {
          branch_id: branchId,
          periodo: fini,
          fecha_inicio: fini,
          fecha_fin: ffin,
          tiquete_total: secciones.tiquete.total ?? 0,
          factura_total: secciones.factura.total ?? 0,
          ccf_total: secciones.ccf.total ?? 0,
          total_general,
          detalle: { secciones, encabezado, erp_id: erpId },
          ticket: mov,
          obtenido_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        const { error } = await supabase.from("corte_z")
          .upsert(fila, { onConflict: "branch_id,periodo" });
        if (error) throw new Error(error.message);

        resultados.push({ branchId, total_general, factura: fila.factura_total, ccf: fila.ccf_total });
      } catch (e: any) {
        resultados.push({ branchId, error: e?.message ?? String(e) });
      }
    }

    return new Response(JSON.stringify({ ok: true, periodo, fini, ffin, resultados }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("sync-corte-z:", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error)?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
