import { getCorsHeaders, requireInvokeSecret, getErpBranchMap } from "../_shared/security.ts";

// Herramienta de diagnóstico: baja los CSV de los libros del ERP y devuelve su
// ENCABEZADO y unas pocas filas, para poder replicar el formato columna por
// columna en vez de deducirlo.
//
// Existe porque las credenciales del ERP viven en los secrets del servidor y no
// en el entorno local, así que no hay forma de mirar esos archivos desde una
// sesión de desarrollo. `oss-proxy` no sirve para esto: pide un JWT de usuario
// del portal y reenvía la cookie del navegador — no hace login por sí mismo.
//
// Acotada a propósito: sólo compone rutas bajo el host del ERP (no acepta una
// URL entera), sólo hace GET, y devuelve un tope de líneas. Va detrás de
// ADMIN_INVOKE_SECRET como el resto.

const BASE       = "https://clientesdte3.oss.com.sv/farma_salud/";
const LOGIN_URL  = `${BASE}login.php`;
const SESION_URL = `${BASE}cambio_sesion.php`;

const MAX_LINEAS = 500;

function getPurchaseCreds(): { username: string; password: string } {
  const raw = Deno.env.get("ERP_PURCHASES_CREDS");
  if (!raw) throw new Error("ERP_PURCHASES_CREDS secret no configurado.");
  return JSON.parse(raw);
}

async function getSessionCookie(username: string, password: string): Promise<string> {
  const form = new URLSearchParams({ username, password, m: '1' });
  const res = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });
  const cookie = res.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('login sin cookie de sesión');
  return cookie;
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
    const rutas: string[] = Array.isArray(body.rutas) ? body.rutas : [];
    const qs: string      = String(body.qs ?? '');
    const lineas          = Math.min(Number(body.lineas) || 6, MAX_LINEAS);
    const erpId           = body.erpId != null ? Number(body.erpId) : null;
    const usarVentas      = body.credenciales === 'ventas';

    if (rutas.length === 0) throw new Error('faltan `rutas`');

    // Las de ventas están por sucursal en ERP_BRANCH_MAP; las de compras tienen
    // su propio usuario. Cuál sirve depende del reporte que se esté mirando.
    let creds: { username: string; password: string };
    if (usarVentas) {
      const mapa = getErpBranchMap();
      if (!mapa.length) throw new Error('ERP_BRANCH_MAP vacío');
      const entry = erpId != null
        ? (mapa.find(b => b.erpId === erpId) ?? mapa[0])
        : mapa[0];
      creds = { username: (entry as any).username, password: (entry as any).password };
    } else {
      creds = getPurchaseCreds();
    }

    const cookie = await getSessionCookie(creds.username, creds.password);

    // La sucursal es estado de SESIÓN en estos endpoints, no un parámetro.
    if (erpId != null) {
      await fetch(SESION_URL, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ process: 'set_sucursal', id_sucursal: String(erpId) }).toString(),
        signal: AbortSignal.timeout(20_000),
      });
    }

    const out: any[] = [];
    for (const ruta of rutas) {
      // Sólo el nombre del archivo: nada de rutas absolutas ni `..`.
      const limpio = String(ruta).replace(/[^a-zA-Z0-9_.-]/g, '');
      const url = `${BASE}${limpio}${qs ? `?${qs}` : ''}`;
      try {
        const res  = await fetch(url, {
          headers: { Cookie: cookie, 'X-Requested-With': 'XMLHttpRequest' },
          signal: AbortSignal.timeout(60_000),
        });
        const txt  = await res.text();
        const trim = txt.trim();
        // Un 200 con HTML es el login o un 404 maquillado: no es un CSV.
        const esHtml = /^\s*<(!doctype|html)/i.test(trim);
        out.push({
          ruta: limpio,
          status: res.status,
          bytes: txt.length,
          tipo: esHtml ? 'HTML (no es CSV)' : (trim ? 'texto' : 'vacio'),
          primeras: esHtml ? [] : trim.split('\n').slice(0, lineas),
        });
      } catch (e) {
        out.push({ ruta: limpio, error: (e as Error)?.message ?? String(e) });
      }
    }

    return new Response(JSON.stringify({ ok: true, resultados: out }, null, 1), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error('erp-csv-probe:', e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error)?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
