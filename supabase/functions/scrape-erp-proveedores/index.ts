import { getCorsHeaders, requireInvokeSecret } from "../_shared/security.ts";

// E4 del PLAN-CONTABILIDAD-2026-08-02: el maestro de proveedores del ERP.
//
// POR QUÉ VIVE ACÁ Y NO EN UN SCRIPT LOCAL, como la migración de clientes:
// las credenciales que sirven son las de COMPRAS (`ERP_PURCHASES_CREDS`), y
// esas viven en la bóveda del servidor. Sacarlas a disco para correr un script
// sería el único paso de todo esto que empeora la seguridad, y no hace falta.
//
// H23 — POR QUÉ LA CUENTA IMPORTA. Probado el 2026-08-02 con los dos usuarios
// del ERP contra los mismos ids:
//
//     id_proveedor=112 -> cuenta de clientes: ficha VACIA
//                         cuenta de compras : DROGUERIA COMERCIAL SALVADOREÑA
//     id_proveedor=125 -> cuenta de clientes: "PROVEEDOR NO DEFINIDO"
//                         cuenta de compras : ficha VACIA
//
// O sea que `id_proveedor` NO es global: el mismo número apunta a proveedores
// distintos según con qué cuenta entres. `suppliers.erp_supplier_id` sale de
// `descargar_compras_json.php`, que se baja con la cuenta de compras — así que
// ésa es la única que numera igual que nosotros. Con la otra, el barrido
// importaría datos de otra empresa encima de fichas reales.
//
// Modos, de menos a más invasivo. Los tres primeros NO ESCRIBEN NADA:
//   listar : descubre los id_proveedor del catálogo.
//   leer   : baja fichas y devuelve TODOS sus campos crudos, sin interpretar.
//   plan   : cruza lo leído contra el portal y devuelve qué cambiaría.
//   (la escritura es un paso aparte, después de mirar el plan)

const BASE      = "https://clientesdte3.oss.com.sv/farma_salud/";
const LOGIN_URL = `${BASE}login.php`;
const LISTA_URL = `${BASE}admin_proveedor.php`;
const FICHA_URL = `${BASE}editar_proveedor.php`;

// El ERP es lento y la Edge Function vive 150s. 60 fichas por llamada entran
// con margen; el que llama pagina.
const MAX_FICHAS = 60;

function getPurchaseCreds(): { username: string; password: string } {
  const raw = Deno.env.get("ERP_PURCHASES_CREDS");
  if (!raw) throw new Error("ERP_PURCHASES_CREDS secret no configurado.");
  return JSON.parse(raw);
}

async function getSessionCookie(): Promise<string> {
  const { username, password } = getPurchaseCreds();
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

async function traer(url: string, cookie: string): Promise<string> {
  const res = await fetch(url, {
    headers: { Cookie: cookie, "X-Requested-With": "XMLHttpRequest" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return await res.text();
}

// Una respuesta que es la pantalla de login significa sesión caída, no ficha
// vacía. Sin este chequeo, un login expirado se leería como "el ERP no tiene
// ese proveedor" y el barrido reportaría 140 fichas vacías como si fuera un
// resultado.
function esLogin(html: string): boolean {
  return /name=["'](username|clave)["']/i.test(html) && !/id_proveedor/i.test(html);
}

/** Todos los `<input name=... value=...>`, sin filtrar. */
function inputs(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<input\b[^>]*>/gi;
  for (const m of html.matchAll(re)) {
    const tag = m[0];
    const n = /\bname=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!n) continue;
    const v = /\bvalue=["']([^"']*)["']/i.exec(tag)?.[1] ?? "";
    // Un `name` repetido (radios) se queda con el que está marcado.
    if (out[n] && !/\bchecked\b/i.test(tag)) continue;
    out[n] = v;
  }
  return out;
}

/** Para cada `<select>`, el value y el texto de la opción elegida. */
function selects(html: string): Record<string, { value: string; texto: string }> {
  const out: Record<string, { value: string; texto: string }> = {};
  const re = /<select\b[^>]*\bname=["']([^"']+)["'][^>]*>([\s\S]*?)<\/select>/gi;
  for (const m of html.matchAll(re)) {
    const op = /<option\b[^>]*\bselected\b[^>]*>([\s\S]*?)<\/option>/i.exec(m[2]);
    const value = op ? (/\bvalue=["']([^"']*)["']/i.exec(op[0])?.[1] ?? "") : "";
    out[m[1]] = { value, texto: (op?.[1] ?? "").replace(/\s+/g, " ").trim() };
  }
  return out;
}

function textareas(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<textarea\b[^>]*\bname=["']([^"']+)["'][^>]*>([\s\S]*?)<\/textarea>/gi;
  for (const m of html.matchAll(re)) out[m[1]] = m[2].trim();
  return out;
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
    const modo: string = String(body.modo ?? "listar");
    const cookie = await getSessionCookie();

    // ── listar ──────────────────────────────────────────────────────────────
    if (modo === "listar") {
      const html = await traer(LISTA_URL, cookie);
      if (esLogin(html)) throw new Error("la sesión no quedó abierta (listar)");
      const ids = [...new Set(
        [...html.matchAll(/id_proveedor=(\d+)/g)].map((m) => Number(m[1])),
      )].sort((a, b) => a - b);

      return new Response(JSON.stringify({
        ok: true, modo, bytes: html.length, total: ids.length, ids,
        // Si `ids` viene corto es que la tabla se carga por AJAX. Este recorte
        // sirve para encontrar de dónde, sin tener que adivinar el nombre del
        // endpoint.
        pistas: [...new Set([
          ...[...html.matchAll(/["']([a-z0-9_]+\.php[^"']*)["']/gi)].map((m) => m[1]),
        ])].slice(0, 40),
      }, null, 1), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── leer ────────────────────────────────────────────────────────────────
    if (modo === "leer") {
      const ids: number[] = Array.isArray(body.ids)
        ? body.ids.map(Number).filter(Boolean).slice(0, MAX_FICHAS)
        : [];
      if (ids.length === 0) throw new Error("faltan `ids`");

      const fichas: any[] = [];
      for (const id of ids) {
        try {
          const html = await traer(`${FICHA_URL}?id_proveedor=${id}`, cookie);
          if (esLogin(html)) throw new Error("sesión caída a mitad del barrido");
          const inp = inputs(html);
          const sel = selects(html);
          // Una ficha "vacía" (el id existe pero no es de esta cuenta) trae el
          // formulario en blanco salvo el propio id. Se marca en vez de
          // devolverla como si fuera un proveedor sin nombre.
          const vacia = !(inp["nombre_proveedor"] ?? "").trim();
          fichas.push({ id, vacia, bytes: html.length, inputs: inp, selects: sel, textareas: textareas(html) });
        } catch (e) {
          fichas.push({ id, error: (e as Error)?.message ?? String(e) });
        }
      }
      return new Response(JSON.stringify({ ok: true, modo, fichas }, null, 1), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error(`modo desconocido: ${modo}`);
  } catch (e) {
    console.error("scrape-erp-proveedores:", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error)?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
