import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireInvokeSecret, getErpBranchMap } from "../_shared/security.ts";
// La comparación por conjunto vive aparte porque es la pieza que falló (H10) y
// necesitaba una prueba que no dependa del ERP ni de producción:
// tests/unit/compararLibros.test.js arma el caso de 503 líneas contra 389 —el
// que ya no se puede reproducir en prod, porque el índice único de A1 lo
// impide— y exige que el veredicto sea DIFIERE.
import { compararPorConjunto, normalizar, crudo } from "../_shared/compararLibros.ts";

// Compara, línea por línea, el CSV que produce el portal contra el archivo real
// del ERP — por reporte y por sucursal.
//
// QUÉ PRUEBA Y QUÉ NO. El encabezado anterior decía que `generar_csv_libro` era
// «una SEGUNDA implementación escrita por separado» y que por eso la prueba
// valía el doble. **Es falso, y la auditoría del 2026-08-02 (H11) lo verificó
// leyendo las dos**: `generar_csv_libro` transcribe las mismas reglas que los
// RPC — el mismo `length(recibido_mh)=40`, el mismo `subtotal − percepcion`, el
// mismo `LEFT JOIN proveedores_maestro ON supplier_id`. Hereda sus defectos
// enteros. Dos copias de la misma regla no son dos testigos.
//
// Lo que esta función SÍ prueba, y es mucho, es lo único que importaba: **que
// las líneas coincidan con el archivo del ERP**, que es una fuente
// verdaderamente independiente. Esa es toda su fuerza; la "segunda
// implementación" no aportaba nada.
//
// Lo que NO puede probar: que el navegador escriba el archivo igual (BOM, CRLF,
// escape de comillas). Eso ahora tiene su propio verificador —
// `npm run verificar:libros`, que baja el archivo apretando el botón real con
// Playwright— y ése sí es un testigo distinto.

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

// `normalizar` y `crudo` viven en ../_shared/compararLibros.ts, junto con la
// comparación que los usa. B5 (H21): normalizar sigue siendo lo correcto para el
// VEREDICTO —como número, `1166` y `1166.00` son el mismo valor— pero antes
// además las hacía invisibles. Ahora se cuentan en `formato_decimal`.

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

          // Modo CONJUNTO: las líneas tienen que coincidir sin importar en qué
          // posición. Aísla las diferencias de CONTENIDO de las de orden.
          //
          // B1 (H10) — ESTE MODO ERA CIEGO DE UN LADO. Comprobaba que cada línea
          // del ERP existiera en el portal y nunca lo inverso, así que **al
          // portal le podía sobrar y el veredicto salía IDENTICO igual**. Con
          // 503 líneas del portal contra 389 del ERP —que es exactamente lo que
          // produce un `supplier_id` duplicado (H1)— las 389 se encontraban y la
          // verificación daba el visto bueno a $92 mil de compras inventadas.
          //
          // La red de seguridad tenía el mismo punto ciego que el bug que debía
          // atrapar. Ahora el veredicto exige que **la bolsa quede vacía**: lo
          // que sobra se cuenta, se muestra y hace DIFERIR.
          if (body.porConjunto) {
            out.push({
              branchId, reporte: rep, modo: 'conjunto',
              ...compararPorConjunto(lineasErp, lineasPortal, omitidas, maxDif),
            });
            continue;
          }

          // — comparación línea por línea, en orden
          const n = Math.max(lineasErp.length, lineasPortal.length);
          let iguales = 0;
          // B5 (H21): líneas que coinciden como número pero no como texto —
          // el ERP escribe `1166` en unas filas y `1166.00` en otras, en la
          // misma columna del mismo archivo. No son una diferencia fiscal, pero
          // tampoco son "iguales": se cuentan aparte para que se vean.
          let formatoDecimal = 0;
          const difs: any[] = [];
          for (let i = 0; i < n; i++) {
            const a = lineasErp[i] ?? null;
            const b = lineasPortal[i] ?? null;
            if (a !== null && b !== null && igualSalvoOmitidas(a, b)) {
              iguales++;
              const ca = a.split(';'), cb = b.split(';');
              for (let c = 0; c < Math.max(ca.length, cb.length); c++) {
                if (omitidas.has(c)) continue;
                if (crudo(ca[c] ?? '') !== crudo(cb[c] ?? '')) { formatoDecimal++; break; }
              }
              continue;
            }
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
            // Iguales como número, distintas como texto. No cambian el veredicto
            // —son el mismo valor— pero dejan de ser invisibles.
            formato_decimal: formatoDecimal,
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
