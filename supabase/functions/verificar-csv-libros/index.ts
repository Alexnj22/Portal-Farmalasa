import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireInvokeSecret, getErpBranchMap } from "../_shared/security.ts";

// Compara, línea por línea, el CSV que produce el portal contra el archivo real
// del ERP — por reporte y por sucursal.
//
// El CSV del portal no se pide al frontend: lo genera `generar_csv_libro`, una
// SEGUNDA implementación escrita por separado en SQL. Si dos implementaciones
// independientes coinciden entre sí Y con el archivo del origen, la prueba vale
// mucho más que reusar el mismo código para verificarse a sí mismo.
//
// Lo que NO puede probar: que el navegador escriba el archivo igual (BOM,
// CRLF, escape de comillas). Eso lo cubre `exportCsv`, que es común a todos los
// módulos y no cambió.

const BASE       = "https://clientesdte3.oss.com.sv/farma_salud/";
const LOGIN_URL  = `${BASE}login.php`;
const SESION_URL = `${BASE}cambio_sesion.php`;

// branch_id → id de sucursal en el ERP.
const ERP_SUC: Record<number, number> = { 2: 5, 4: 1, 25: 2, 27: 3, 28: 4, 29: 7, 30: 6 };

interface Reporte { archivo: string; creds: 'ventas' | 'compras'; }
const REPORTES: Record<string, Reporte> = {
  consumidor:    { archivo: 'libro_ventas_consumidor_csv.php',    creds: 'ventas'  },
  contribuyente: { archivo: 'libro_ventas_contribuyente_csv.php', creds: 'ventas'  },
  anulados:      { archivo: 'documentos_anulados_csv.php',        creds: 'ventas'  },
  compras:       { archivo: 'libro_compras_iva_csv.php',          creds: 'compras' },
  percepcion:    { archivo: 'libro_percepcion_iva_csv.php',       creds: 'compras' },
};

function getPurchaseCreds(): { username: string; password: string } {
  const raw = Deno.env.get("ERP_PURCHASES_CREDS");
  if (!raw) throw new Error("ERP_PURCHASES_CREDS no configurado");
  return JSON.parse(raw);
}

async function login(username: string, password: string): Promise<string> {
  const res = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password, m: '1' }).toString(),
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });
  const cookie = res.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('login sin cookie');
  return cookie;
}

/** Normaliza para comparar: el origen mezcla `1166` y `1166.00` en la misma columna. */
function normalizar(linea: string): string {
  return linea.split(';').map(c => {
    const t = c.trim();
    // Sólo toca lo que es un número decimal puro; deja intactos códigos y textos.
    if (/^-?\d+(\.\d+)?$/.test(t) && t !== '') {
      const n = Number(t);
      if (Number.isFinite(n)) return n.toFixed(4);
    }
    return t;
  }).join(';');
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!requireInvokeSecret(req)) {
    return new Response(JSON.stringify({ ok: false, error: "UNAUTHORIZED" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body     = await req.json().catch(() => ({}));
    const desde    = String(body.desde ?? '2026-06-01');
    const hasta    = String(body.hasta ?? '2026-06-30');
    const reportes: string[] = Array.isArray(body.reportes) && body.reportes.length
      ? body.reportes : Object.keys(REPORTES);
    const branches: number[] = Array.isArray(body.branches) && body.branches.length
      ? body.branches.map(Number) : Object.keys(ERP_SUC).map(Number);
    const maxDif = Math.min(Number(body.maxDif) || 3, 10);

    // Columnas que se excluyen de la comparación, por reporte, CADA UNA CON SU
    // MOTIVO. No es para tapar diferencias: es para poder responder "¿el resto
    // hace match?" sin que el ruido conocido lo oculte. Si una columna no está
    // acá, tiene que coincidir.
    const ignorar: Record<string, number[]> = body.ignorar ?? {};

    const mapa = getErpBranchMap();
    const cookies = new Map<string, string>();

    const out: any[] = [];

    for (const branchId of branches) {
      const erpId = ERP_SUC[branchId];
      if (!erpId) { out.push({ branchId, error: 'sin erpId conocido' }); continue; }

      for (const rep of reportes) {
        const def = REPORTES[rep];
        if (!def) { out.push({ branchId, reporte: rep, error: 'reporte desconocido' }); continue; }

        try {
          // — cookie por (credenciales, sucursal): la sucursal es estado de sesión
          const key = `${def.creds}|${erpId}`;
          let cookie = cookies.get(key);
          if (!cookie) {
            let creds: { username: string; password: string };
            if (def.creds === 'ventas') {
              const e = mapa.find((b: any) => b.erpId === erpId);
              if (!e) throw new Error(`sin credenciales de ventas para erpId ${erpId}`);
              creds = { username: (e as any).username, password: (e as any).password };
            } else {
              creds = getPurchaseCreds();
            }
            cookie = await login(creds.username, creds.password);
            await fetch(SESION_URL, {
              method: 'POST',
              headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({ process: 'set_sucursal', id_sucursal: String(erpId) }).toString(),
              signal: AbortSignal.timeout(20_000),
            });
            cookies.set(key, cookie);
          }

          const url = `${BASE}${def.archivo}?fechaInicio=${desde}&fechaFin=${hasta}`;
          const res = await fetch(url, {
            headers: { Cookie: cookie, 'X-Requested-With': 'XMLHttpRequest' },
            signal: AbortSignal.timeout(90_000),
          });
          const texto = (await res.text()).trim();
          if (/^\s*<(!doctype|html)/i.test(texto)) throw new Error(`HTTP ${res.status}: vino HTML`);

          const lineasErp = texto ? texto.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim()) : [];

          const { data: filas, error: errGen } = await supabase.rpc('generar_csv_libro', {
            p_reporte: rep, p_desde: desde, p_hasta: hasta, p_branch_id: branchId,
          });
          if (errGen) throw new Error(`generar_csv_libro: ${errGen.message}`);
          const lineasPortal: string[] = (filas ?? []).map((f: any) =>
            typeof f === 'string' ? f : (f.generar_csv_libro ?? String(f)));

          const omitidas = new Set(ignorar[rep] ?? []);
          // Compara una línea columna a columna, salteando las omitidas.
          const igualSalvoOmitidas = (a: string, b: string) => {
            const ca = a.split(';'), cb = b.split(';');
            const n = Math.max(ca.length, cb.length);
            for (let c = 0; c < n; c++) {
              if (omitidas.has(c)) continue;
              if (normalizar(ca[c] ?? '') !== normalizar(cb[c] ?? '')) return false;
            }
            return true;
          };

          // — comparación línea por línea, en orden
          const n = Math.max(lineasErp.length, lineasPortal.length);
          let iguales = 0;
          const difs: any[] = [];
          for (let i = 0; i < n; i++) {
            const a = lineasErp[i] ?? null;
            const b = lineasPortal[i] ?? null;
            if (a !== null && b !== null && igualSalvoOmitidas(a, b)) { iguales++; continue; }
            if (difs.length < maxDif) {
              // Qué columnas difieren, para no leer dos líneas enteras a ojo.
              const ca = (a ?? '').split(';'), cb = (b ?? '').split(';');
              const cols: number[] = [];
              for (let c = 0; c < Math.max(ca.length, cb.length); c++) {
                if (omitidas.has(c)) continue;
                if (normalizar(ca[c] ?? '') !== normalizar(cb[c] ?? '')) cols.push(c);
              }
              difs.push({ linea: i + 1, columnas: cols, erp: a, portal: b });
            }
          }

          out.push({
            branchId, reporte: rep,
            lineas_erp: lineasErp.length,
            lineas_portal: lineasPortal.length,
            iguales,
            distintas: n - iguales,
            veredicto: (n > 0 && iguales === n) ? 'IDENTICO' : (n === 0 ? 'AMBOS VACIOS' : 'DIFIERE'),
            diferencias: difs,
          });
        } catch (e) {
          out.push({ branchId, reporte: rep, error: (e as Error)?.message ?? String(e) });
        }
      }
    }

    const total = out.filter(r => !r.error);
    return new Response(JSON.stringify({
      ok: true, desde, hasta,
      resumen: {
        comparaciones: total.length,
        identicos: total.filter(r => r.veredicto === 'IDENTICO' || r.veredicto === 'AMBOS VACIOS').length,
        difieren:  total.filter(r => r.veredicto === 'DIFIERE').length,
        errores:   out.filter(r => r.error).length,
      },
      detalle: out,
    }, null, 1), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error('verificar-csv-libros:', e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error)?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
