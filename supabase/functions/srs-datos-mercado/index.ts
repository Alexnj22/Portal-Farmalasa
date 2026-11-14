import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, permisoDeModulo, requireActiveEmployeeUser } from "../_shared/security.ts";

// ═══════════════════════════════════════════════════════════════════════════
// DATOS DE MERCADO DE LA SRS (2026-11-14).
//
// Cada año la Superintendencia de Regulación Sanitaria pide existencias y
// precio real de venta de todo medicamento, por establecimiento, en su
// sistema de captura (datosmercado.srs.gob.sv). Ese sistema no recibe
// archivos: se busca cada producto en su catálogo y se llena a mano. Esta
// función es el puente:
//
//   accion "buscar"  (navegador, JWT) — busca en el catálogo de la SRS con la
//                    cuenta de la empresa, para elegir la pareja de un
//                    producto en Cumplimiento → Datos de mercado. Permiso:
//                    `cumplimiento_tab_datos_mercado` can_view.
//   accion "cargar"  (herramienta manual, secreto propio) — deja en la base
//                    las parejas que propuso el emparejador
//                    (`srs_mercado_cargar_propuestas`, que nunca pisa lo que ya
//                    confirmó una persona). Se llama con el anon key en
//                    Authorization (pasa el JWT del gateway) y el secreto
//                    `SRS_CARGA_SECRETO` en `x-carga-secreto`.
//
// La cuenta de la SRS vive en los secretos SRS_DM_USUARIO / SRS_DM_CLAVE. El
// sitio de la SRS bloquea navegadores automáticos (un firewall devuelve
// «Web Page Blocked») pero acepta el formulario simple: por eso se entra con
// el mismo POST que hace su página de inicio de sesión.
//
// Es de toda la red (los establecimientos son de la empresa, no de una sala):
// guarda `sin-sala` en scripts/alcance-manifest.json.
// ═══════════════════════════════════════════════════════════════════════════

const BASE = "https://datosmercado.srs.gob.sv/";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const PLAZO_MS = 30_000;

const json = (b: unknown, s = 200, h: HeadersInit = {}) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", ...h } });

// La sesión de la SRS, reutilizada mientras la instancia siga viva.
let galletas: Record<string, string> = {};

function guardarGalletas(res: Response) {
  for (const c of res.headers.getSetCookie()) {
    const [par] = c.split(";");
    const i = par.indexOf("=");
    if (i > 0) galletas[par.slice(0, i).trim()] = par.slice(i + 1).trim();
  }
}
const cabeceraGalletas = () => Object.entries(galletas).map(([k, v]) => `${k}=${v}`).join("; ");

async function pedir(ruta: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(BASE + ruta, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(PLAZO_MS),
    headers: { "User-Agent": UA, Cookie: cabeceraGalletas(), ...(init.headers ?? {}) },
  });
  guardarGalletas(res);
  return res;
}

async function entrar(): Promise<void> {
  const usuario = Deno.env.get("SRS_DM_USUARIO");
  const clave = Deno.env.get("SRS_DM_CLAVE");
  if (!usuario || !clave) throw new Error("Falta la cuenta de la SRS en la configuración del servidor.");
  galletas = {};
  await (await pedir("login.php")).text();
  const res = await pedir("login.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: BASE + "login.php" },
    body: new URLSearchParams({ username: usuario, password: clave, "login-ingresar": "Login" }),
  });
  await res.text();
  const destino = res.headers.get("location") ?? "";
  if (!(res.status >= 300 && res.status < 400 && destino.includes("index.php"))) {
    throw new Error("La SRS no aceptó la cuenta de la empresa.");
  }
}

type ProductoSrs = {
  crp: string; n_registro: string; nombre_comercial: string;
  presentacion: string; laboratorio: string; ingresado: string | null;
};

async function buscarEnCatalogo(q: string): Promise<ProductoSrs[]> {
  for (let intento = 0; intento < 2; intento++) {
    if (!Object.keys(galletas).length) await entrar();
    const res = await pedir("data_listaproductosfiltro.php?query=" + encodeURIComponent(q), {
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    const cuerpo = await res.text();
    // Sesión vencida: la SRS contesta con su página (o redirige al inicio).
    if (res.status >= 300 || cuerpo.trimStart().startsWith("<")) { galletas = {}; continue; }
    if (!res.ok) throw new Error(`La SRS respondió ${res.status}.`);
    return cuerpo.trim() ? JSON.parse(cuerpo) : [];
  }
  throw new Error("No se pudo entrar a la SRS.");
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const responder = (b: unknown, s = 200) => json(b, s, cors);

  try {
    const body = await req.json().catch(() => ({}));
    const accion = String(body.accion ?? "");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (accion === "cargar") {
      const secreto = Deno.env.get("SRS_CARGA_SECRETO");
      if (!secreto || req.headers.get("x-carga-secreto") !== secreto) {
        return responder({ ok: false, error: "No autorizado." }, 401);
      }
      const filas = Array.isArray(body.filas) ? body.filas : [];
      if (!filas.length || filas.length > 5000) return responder({ ok: false, error: "Sin filas." }, 400);
      let escritas = 0;
      for (let i = 0; i < filas.length; i += 500) {
        const { data, error } = await admin.rpc("srs_mercado_cargar_propuestas", { p_filas: filas.slice(i, i + 500) });
        if (error) return responder({ ok: false, error: error.message, escritas }, 500);
        escritas += Number(data?.escritas ?? 0);
      }
      return responder({ ok: true, recibidas: filas.length, escritas });
    }

    if (accion === "buscar") {
      const q = String(body.q ?? "").trim();
      if (q.length < 3) return responder({ ok: true, productos: [] });
      if (q.length > 80) return responder({ ok: false, error: "La búsqueda es muy larga." }, 400);

      const quien = await requireActiveEmployeeUser(req, admin);
      if (!quien) return responder({ ok: false, error: "Sesión inválida o empleado inactivo." }, 401);
      const permiso = await permisoDeModulo(admin, quien.id, "cumplimiento_tab_datos_mercado", "can_view");
      if (permiso.roto) return responder({ ok: false, error: permiso.roto }, 503);
      if (!permiso.puede) return responder({ ok: false, error: "No tienes permiso para ver los datos de mercado." }, 403);

      const productos = await buscarEnCatalogo(q);
      return responder({ ok: true, productos });
    }

    return responder({ ok: false, error: "Acción desconocida." }, 400);
  } catch (e) {
    console.error("[srs-datos-mercado]", (e as Error).message);
    return responder({ ok: false, error: (e as Error).message }, 502);
  }
});
