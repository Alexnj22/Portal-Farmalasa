import { createClient } from "npm:@supabase/supabase-js@2";
import {
  getCorsHeaders, getErpBranchMap, permisoDeModulo, requireActiveEmployeeUser,
} from "../_shared/security.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Los tres actos de caja que faltaban en el portal: ABRIR, anotar un INGRESO y
// CERRAR el día. El corte vive aparte, en `hacer-corte-caja`, porque tiene su
// propia regla —el conteo a ciegas— y mezclarlos escondería esa regla adentro
// de un `switch`.
//
// POR QUÉ EXISTEN AHORA
// Hasta el 2026-08-29 el portal MIRABA la caja; operarla se hacía en la otra
// pantalla. Desde el lunes 31 las salas pierden ese acceso, así que lo que no
// esté acá no se puede hacer.
//
// ── ABRIR: dos identidades, y las dos importan ─────────────────────────────
// La caja identifica a quien abre con un número suyo (`emp=38`), y su pantalla
// sólo ofrece el empleado de la sesión — o sea que ese número no se puede pedir
// por nombre. Lo que sí se puede es reusar el que esa sala ya venía usando, que
// la captura guarda en `cortes_caja_aperturas.erp_empleado_id`.
//
// La identidad REAL —quién pasó el carné— la guarda el portal. Hoy tres de las
// seis salas abren con una cuenta compartida («MI CAJA LA POPULAR»), así que
// esto no empeora el papel: usa el mismo número de siempre y agrega el nombre
// verificado que antes no existía en ningún lado.
//
// ── INGRESO: por qué no ofrece «abono a crédito» ───────────────────────────
// El tiquete del corte tiene DOS líneas para lo que entra: INGRESOS y COBROS
// CRÉDITO, y lo que las separa es el `id_tipo` del movimiento. Ese catálogo no
// se pudo leer —la pantalla que lo lista sólo se abre para el usuario que tiene
// la caja vigente, y la cuenta del portal no lo es en ninguna sala—, así que
// acá se escriben SÓLO los ingresos comunes con el único tipo ejercido de
// verdad. Un cobro de crédito mal clasificado movería plata de una línea a la
// otra sin que nada falle, y por eso no se ofrece: se sigue haciendo allá hasta
// conocer su número.
//
// ── CERRAR: el Z sale de cerrar el turno, no del formulario del corte ──────
// Medido el 29-ago: `cierre_turno.php` devuelve `tipo_corte=C` con cualquier
// parámetro. El Z aparece al cerrar el turno (`apertura_caja.php
// process=cerrar_turno`), que es lo que hace la sala hoy — en los datos, el Z
// entra segundos después del último C.
// ═══════════════════════════════════════════════════════════════════════════

const BASE       = "https://clientesdte3.oss.com.sv/farma_salud/";
const LOGIN_URL  = `${BASE}login.php`;
const SESION_URL = `${BASE}cambio_sesion.php`;
const CORTE_URL  = `${BASE}admin_corte.php`;
const APERTURA   = `${BASE}apertura_caja.php`;
const INGRESO    = `${BASE}agregar_ingreso_caja.php`;

/** El único tipo ejercido de verdad (28-ago, movimiento 43260). */
const ID_TIPO = "1";

function getCortesCreds(): { username: string; password: string } {
  const raw = Deno.env.get("ERP_CORTES_CREDS");
  if (!raw) throw new Error("ERP_CORTES_CREDS secret no configurado.");
  return JSON.parse(raw);
}

async function getSessionCookie(u: string, p: string): Promise<string> {
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

async function abrirSala(cookie: string, erpId: number): Promise<void> {
  const r = await fetch(SESION_URL, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ process: "set_sucursal", id_sucursal: String(erpId) }).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  let ok = false;
  try { ok = Boolean(JSON.parse(await r.text())?.success); } catch { ok = false; }
  // Operar la caja de otra sala no se deshace solo. Si no se pudo fijar, se para.
  if (!ok) throw new Error(`no se pudo abrir la sala ${erpId}`);
}

/** La caja y la apertura vigentes de la sala, leídas del panel. */
async function estadoDeLaCaja(cookie: string) {
  const pagina = await (await fetch(CORTE_URL, {
    headers: { Cookie: cookie }, signal: AbortSignal.timeout(30_000),
  })).text();
  const idEmple = pagina.match(/id=["']id_emple["'][^>]*value=["'](\d+)["']/)?.[1] ?? "0";
  const cajas = [...pagina.matchAll(/<option value='(\d+)'>\s*Caja[^<]*<\/option>/gi)].map((m) => m[1]);
  for (const idCaja of cajas) {
    const panel = await (await fetch(CORTE_URL, {
      method: "POST",
      headers: {
        Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: new URLSearchParams({ process: "caja", id_caja: idCaja, id_empleado: idEmple }).toString(),
      signal: AbortSignal.timeout(30_000),
    })).text();
    const aper = panel.match(/id_apertura=(\d+)/)?.[1];
    if (aper) {
      return {
        abierta: true, idCaja,
        aper, emp: panel.match(/emp=(\d+)/)?.[1] ?? idEmple,
        turno: panel.match(/turno=(\d+)/)?.[1] ?? "1",
        idEmple,
      };
    }
  }
  return { abierta: false, idCaja: cajas[0] ?? null, aper: null, emp: null, turno: null, idEmple };
}

const dosDecimales = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const exito = (t: string) => /"typeinfo"\s*:\s*"Success"/i.test(t);

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

  try {
    const body = await req.json().catch(() => ({}));
    const accion = String(body.accion ?? "");
    const sala = Number(body.sala);
    if (!["abrir", "ingreso", "cerrar", "estado"].includes(accion)) {
      return json({ ok: false, error: "Acción desconocida." }, 400);
    }
    if (!Number.isFinite(sala)) return json({ ok: false, error: "Falta la sala." }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const quien = await requireActiveEmployeeUser(req, supabase);
    if (!quien) return json({ ok: false, error: "Sesión inválida o empleado inactivo." }, 401);
    // Leer el estado no es operar: mirar si la caja está abierta lo puede hacer
    // quien ve los cortes; abrir, anotar o cerrar necesita el permiso de operar.
    const permiso = await permisoDeModulo(
      supabase, quien.id, "caja_vales", accion === "estado" ? "can_view" : "can_edit",
    );
    if (permiso.roto) return json({ ok: false, error: permiso.roto }, 503);
    if (!permiso.puede) return json({ ok: false, error: "No tienes permiso para operar la caja desde el portal." }, 403);

    const entrada = getErpBranchMap().find((e) => e.branchId === sala);
    if (!entrada) return json({ ok: false, error: "Esa sala no está configurada." }, 400);

    const { username, password } = getCortesCreds();
    const cookie = await getSessionCookie(username, password);
    await abrirSala(cookie, entrada.erpId);
    const estado = await estadoDeLaCaja(cookie);

    if (accion === "estado") {
      return json({ ok: true, abierta: estado.abierta, caja: estado.idCaja, turno: estado.turno });
    }

    // ── ABRIR ───────────────────────────────────────────────────────────────
    if (accion === "abrir") {
      if (estado.abierta) return json({ ok: false, error: "Esa caja ya está abierta." }, 409);
      if (!estado.idCaja) return json({ ok: false, error: "Esa sala no tiene ninguna caja configurada." }, 409);

      // El empleado con el que la CAJA identifica a quien abre. Se reusa el que
      // esa sala ya venía usando; si nunca se vio, el de la sesión — y en los
      // dos casos la persona de verdad queda en `abierta_por`.
      const { data: ultima } = await supabase.from("cortes_caja_aperturas")
        .select("erp_empleado_id")
        .eq("branch_id", sala).not("erp_empleado_id", "is", null)
        .order("abierta_el", { ascending: false }).limit(1);
      const empErp = ultima?.[0]?.erp_empleado_id ?? estado.idEmple;

      const hoy = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
      const monto = Number(body.monto_apertura ?? 0);
      const resp = await (await fetch(APERTURA, {
        method: "POST",
        headers: {
          Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: new URLSearchParams({
          process: "insert", fecha: hoy, empleado: String(empErp), caja: String(estado.idCaja),
          monto_apertura: dosDecimales(monto), monto_ch: "0",
          turno_x: String(body.turno ?? 1), turno: String(body.turno ?? 1),
          id_sucursal: String(entrada.erpId),
        }).toString(),
        signal: AbortSignal.timeout(45_000),
      })).text();

      if (!exito(resp)) return json({ ok: false, error: `La caja no aceptó la apertura: ${resp.slice(0, 200)}` }, 502);

      // Quién la abrió DE VERDAD. La captura de cada media hora va a traer el
      // resto (hora, monto, id de apertura); esto es lo que ella no puede saber.
      await supabase.from("caja_aperturas_del_portal").insert({
        branch_id: sala, abierta_por: quien.id, erp_empleado_id: empErp,
        caja_erp: Number(estado.idCaja), monto_apertura: monto,
      });
      return json({ ok: true, abierta: true, caja: estado.idCaja });
    }

    // De acá para abajo hace falta una caja abierta.
    if (!estado.abierta) return json({ ok: false, error: "Esa sala no tiene una caja abierta." }, 409);

    // ── INGRESO ─────────────────────────────────────────────────────────────
    if (accion === "ingreso") {
      const monto = Number(body.monto);
      const concepto = String(body.concepto ?? "").trim();
      if (!(Number.isFinite(monto) && monto > 0)) return json({ ok: false, error: "Falta el monto." }, 400);
      if (!concepto) return json({ ok: false, error: "Falta el concepto." }, 400);

      const resp = await (await fetch(INGRESO, {
        method: "POST",
        headers: {
          Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: new URLSearchParams({
          process: "ingreso", id_apertura: estado.aper!, id_empleado: estado.emp!,
          turno: estado.turno!, monto: dosDecimales(monto),
          // El campo trunca a 50: se recorta acá para que el recorte sea
          // deliberado y no una sorpresa del otro lado.
          concepto: concepto.slice(0, 50), id_tipo: ID_TIPO,
        }).toString(),
        signal: AbortSignal.timeout(45_000),
      })).text();

      if (!exito(resp)) return json({ ok: false, error: `La caja no aceptó el ingreso: ${resp.slice(0, 200)}` }, 502);
      let idMov: number | null = null;
      try { idMov = Number(JSON.parse(resp)?.id_mov) || null; } catch { idMov = null; }
      return json({ ok: true, movimiento_en_caja: idMov });
    }

    // ── CERRAR EL DÍA ───────────────────────────────────────────────────────
    const resp = await (await fetch(APERTURA, {
      method: "POST",
      headers: {
        Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: new URLSearchParams({ process: "cerrar_turno", id_apertura: estado.aper! }).toString(),
      signal: AbortSignal.timeout(45_000),
    })).text();

    if (!exito(resp)) return json({ ok: false, error: `La caja no aceptó el cierre: ${resp.slice(0, 200)}` }, 502);
    return json({ ok: true, cerrada: true });
  } catch (e) {
    console.error("operar-caja:", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error)?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
