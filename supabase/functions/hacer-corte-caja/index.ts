import { createClient } from "npm:@supabase/supabase-js@2";
import {
  getCorsHeaders, getErpBranchMap, permisoDeModulo, requireActiveEmployeeUser,
} from "../_shared/security.ts";

// ═══════════════════════════════════════════════════════════════════════════
// El corte de caja, hecho desde el portal — con el conteo A CIEGAS.
//
// EL ORDEN ES EL DISEÑO, y no se puede equivocar (pedido del usuario, 29-ago):
//
//   1. Se escribe UN vale con todas las salidas del día abierto. Antes del
//      corte, o el corte cuenta un dinero que ya no está.
//   2. Se pide el efectivo contado. **Sin decir cuánto debería haber.**
//   3. Se manda el corte y se lee lo que contestó.
//   4. Recién ahí aparece la diferencia, para confirmar o rechazar.
//
// POR QUÉ EL CONTEO A CIEGAS ES EL PUNTO
// La pantalla de la caja muestra lo esperado ANTES de teclear, y su total sale
// de tres casillas —efectivo, tarjeta y cheque— que escribe la misma persona:
// inflando la de tarjeta, la diferencia queda en cero y nadie se entera. Acá el
// portal conoce el esperado y NO lo manda al navegador hasta después del
// conteo, y pide UN número: el efectivo. Las otras dos van en cero, que es lo
// que corresponde — ni la tarjeta ni el crédito pasan por la caja.
//
// ⚠️ El control sólo vale si el corte se hace SÓLO desde acá. Mientras la sala
// pueda cortar en la otra pantalla, ahí ve el esperado y esto es una comodidad,
// no un control. Está dicho porque es la condición, no un detalle.
//
// CÓMO SE ARMA EL ENVÍO
// No se inventa: se pide la pantalla del corte —que ya viene calculada por el
// servidor, 50 campos con las listas de documentos— y se reenvía tal cual,
// cambiando sólo lo que teclea una persona. Reconstruir esos 50 números acá
// sería una segunda opinión sobre lo que la caja ya sabe, y la primera regla de
// este módulo es que el esperado lo sigue calculando ella.
// ═══════════════════════════════════════════════════════════════════════════

const BASE       = "https://clientesdte3.oss.com.sv/farma_salud/";
const LOGIN_URL  = `${BASE}login.php`;
const SESION_URL = `${BASE}cambio_sesion.php`;
const CORTE_URL  = `${BASE}admin_corte.php`;
const PANTALLA   = `${BASE}corte_caja_diario.php`;
const CIERRE_URL = `${BASE}cierre_turno.php`;
const CREAR_VALE = `${BASE}agregar_salida_caja.php`;
const MOV_URL    = `${BASE}admin_movimiento_caja_dt.php`;

const ID_TIPO_SALIDA = "1";

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
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
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
  // Cortar la caja de otra sala no se deshace: el corte queda hecho allá y el
  // turno de esta sigue abierto. Si no se pudo fijar, no se sigue.
  if (!ok) throw new Error(`no se pudo abrir la sala ${erpId}`);
}

/** La apertura vigente: `id_apertura`, empleado y turno. */
async function aperturaViva(cookie: string) {
  const pagina = await (await fetch(CORTE_URL, {
    headers: { Cookie: cookie }, signal: AbortSignal.timeout(30_000),
  })).text();
  const idEmple = pagina.match(/id=["']id_emple["'][^>]*value=["'](\d+)["']/)?.[1] ?? "0";
  for (const m of pagina.matchAll(/<option value='(\d+)'>\s*Caja[^<]*<\/option>/gi)) {
    const panel = await (await fetch(CORTE_URL, {
      method: "POST",
      headers: {
        Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: new URLSearchParams({ process: "caja", id_caja: m[1], id_empleado: idEmple }).toString(),
      signal: AbortSignal.timeout(30_000),
    })).text();
    const aper = panel.match(/id_apertura=(\d+)/)?.[1];
    const emp = panel.match(/emp=(\d+)/)?.[1];
    const turno = panel.match(/turno=(\d+)/)?.[1];
    if (aper && emp && turno) return { aper, emp, turno };
  }
  return null;
}

/**
 * Los campos del formulario del corte, tal como los serializaría el navegador.
 *
 * Se leen TODOS —50 medidos el 29-ago— y se reenvían: las listas de documentos
 * («lista_factura», «t_factuta», los rangos de correlativos) son parte del
 * corte y reconstruirlas acá sería inventar el número que la caja ya calculó.
 */
function camposDelFormulario(html: string): Map<string, string> {
  const campos = new Map<string, string>();
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const t = m[0];
    const name = t.match(/name=["']([^"']+)["']/)?.[1];
    if (!name) continue;
    const tipo = (t.match(/type=["']([^"']+)["']/)?.[1] || "text").toLowerCase();
    if (tipo === "button" || tipo === "submit") continue;
    campos.set(name, t.match(/value=["']([^"']*)["']/)?.[1] ?? "");
  }
  for (const m of html.matchAll(/<select\b[^>]*name=["']([^"']+)["'][\s\S]{0,900}?<\/select>/gi)) {
    const sel = m[0].match(/<option[^>]*selected[^>]*value=["']([^"']*)["']/i)
      ?? m[0].match(/<option[^>]*value=["']([^"']*)["']/i);
    campos.set(m[1], sel?.[1] ?? "");
  }
  return campos;
}

const dosDecimales = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

  try {
    const body = await req.json().catch(() => ({}));
    const simular = body.simular === true;
    const sala = Number(body.sala);
    const efectivo = Number(body.efectivo);
    if (!Number.isFinite(sala)) return json({ ok: false, error: "Falta la sala." }, 400);
    if (!simular && !(Number.isFinite(efectivo) && efectivo >= 0)) {
      return json({ ok: false, error: "Falta el efectivo contado." }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const quien = await requireActiveEmployeeUser(req, supabase);
    if (!quien) return json({ ok: false, error: "Sesión inválida o empleado inactivo." }, 401);
    const permiso = await permisoDeModulo(supabase, quien.id, "caja_vales", "can_edit");
    if (permiso.roto) return json({ ok: false, error: permiso.roto }, 503);
    if (!permiso.puede) return json({ ok: false, error: "No tienes permiso para hacer el corte desde el portal." }, 403);

    const entrada = getErpBranchMap().find((e) => e.branchId === sala);
    if (!entrada) return json({ ok: false, error: "Esa sala no está configurada." }, 400);

    const { username, password } = getCortesCreds();
    const cookie = await getSessionCookie(username, password);
    await abrirSala(cookie, entrada.erpId);

    const viva = await aperturaViva(cookie);
    if (!viva) return json({ ok: false, error: "Esa sala no tiene una caja abierta ahora." }, 409);

    // ── 1. El vale de las salidas del día, ANTES del corte ──────────────────
    const { data: pend, error: errPend } = await supabase.rpc("caja_vales_pendientes");
    if (errPend) throw new Error(`leyendo pendientes: ${errPend.message}`);
    const mias = (pend ?? []).filter((p: { branch_id: number }) => Number(p.branch_id) === sala);
    const montoVale = mias.reduce((s: number, p: { monto: number }) => s + Number(p.monto), 0);

    if (simular) {
      // Devuelve lo que va a hacer SIN el esperado: decirlo antes del conteo
      // sería devolver justo lo que el conteo a ciegas viene a esconder.
      return json({
        ok: true, simulado: true, sala,
        apertura: viva.aper, turno: viva.turno,
        vale_a_escribir: mias.length ? { salidas: mias.length, monto: Number(montoVale.toFixed(2)) } : null,
      });
    }

    let valeId: number | null = null;
    let movVale: number | null = null;
    if (mias.length) {
      const { data: creado, error } = await supabase.from("caja_vales_portal")
        .insert({
          branch_id: sala, fecha: mias[0].dia_abierto, monto: 0,
          anotado_por: quien.id,
        })
        .select("id").single();
      if (error) throw new Error(`abriendo el vale: ${error.message}`);
      valeId = creado.id;

      // Freno: ¿ya está escrito? Un reintento no puede duplicar un vale.
      const marca = `VALES DEL PORTAL ${valeId} `;
      const dt = await (await fetch(
        `${MOV_URL}?fechai=${mias[0].dia_abierto}&fechaf=${mias[0].dia_abierto}&draw=1&start=0&length=1000`,
        { headers: { Cookie: cookie, "X-Requested-With": "XMLHttpRequest" }, signal: AbortSignal.timeout(60_000) },
      )).json().catch(() => null);
      if (!Array.isArray(dt?.data)) throw new Error("no se pudo revisar si el vale ya estaba escrito");
      const yaEsta = (dt.data as string[][]).find((f) => String(f[1] ?? "").startsWith(marca));

      if (yaEsta) {
        movVale = Number(yaEsta[0]);
      } else {
        const resp = await (await fetch(CREAR_VALE, {
          method: "POST",
          headers: {
            Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: new URLSearchParams({
            process: "salida", id_apertura: viva.aper, id_empleado: viva.emp, turno: viva.turno,
            monto: dosDecimales(montoVale),
            concepto: `VALES DEL PORTAL ${valeId} (${mias.length} salida${mias.length === 1 ? "" : "s"})`,
            proveedor: "", tipo_doc: "", n_doc: "", recibe: "PORTAL", id_tipo: ID_TIPO_SALIDA,
          }).toString(),
          signal: AbortSignal.timeout(45_000),
        })).text();
        if (!/"typeinfo"\s*:\s*"Success"/i.test(resp)) {
          throw new Error(`el sistema no aceptó el vale: ${resp.slice(0, 160)}`);
        }
        movVale = Number(JSON.parse(resp)?.id_mov) || null;
      }

      /* ── Estas DOS escrituras pasan DESPUÉS de mover dinero ─────────────
       *
       * El vale ya está escrito en el sistema de origen. Si el `update` falla y
       * su error se descarta, el vale queda en PENDIENTE con la plata ya
       * movida: la próxima corrida lo vuelve a intentar y sólo el freno de
       * «¿ya está escrito?» evita el duplicado. Y el segundo deja salidas de
       * bolsa sin vale que las cubra, que es justo lo que el corte tiene que
       * poder demostrar.
       *
       * Lanzar acá es lo correcto y no una molestia: quien llama recibe el
       * error, el vale queda pendiente A PROPÓSITO y alguien lo mira — en vez
       * de un corte que se declara completo sobre una anotación que no ocurrió.
       */
      const ahora = new Date().toISOString();
      const { error: errVale } = await supabase.from("caja_vales_portal").update({
        erp_movimiento_id: movVale, monto: Number(montoVale.toFixed(2)),
        estado: "ANOTADO", anotado_at: ahora, updated_at: ahora,
      }).eq("id", valeId);
      if (errVale) {
        throw new Error(`el vale se escribió en el sistema (${movVale}) pero no se pudo`
          + ` anotar en el portal: ${errVale.message}`);
      }
      const { error: errLigar } = await supabase.from("bolsas_movimientos")
        .update({ caja_vale_id: valeId })
        .in("id", mias.map((p: { movimiento_id: number }) => p.movimiento_id));
      if (errLigar) {
        throw new Error(`el vale quedó anotado pero no se pudo ligar a sus salidas:`
          + ` ${errLigar.message}`);
      }
    }

    // ── 2. La pantalla del corte, YA con el vale adentro ────────────────────
    const html = await (await fetch(`${PANTALLA}?aper_id=${viva.aper}`, {
      headers: { Cookie: cookie }, signal: AbortSignal.timeout(45_000),
    })).text();
    const campos = camposDelFormulario(html);
    const esperado = Number(campos.get("total_corte"));
    if (!campos.size || !Number.isFinite(esperado)) {
      throw new Error("no se pudo leer el formulario del corte");
    }

    // ── 3. El envío: sólo se cambia lo que teclea una persona ──────────────
    // Tarjeta y cheque van en CERO y no en lo que traiga la pantalla: no pasan
    // por la caja, y son las dos casillas por las que se tapa un faltante.
    const diferencia = Number(efectivo) - esperado;
    campos.set("total_efectivo", dosDecimales(efectivo));
    campos.set("total_efectivo1", dosDecimales(efectivo));
    campos.set("total_tarjeta", "0");
    campos.set("monto_ch", "0");
    campos.set("diferencia", dosDecimales(diferencia));
    if (body.observaciones) campos.set("observaciones", String(body.observaciones).slice(0, 200));

    const cuerpo = new URLSearchParams();
    for (const [k, v] of campos) cuerpo.set(k, v);

    const respCorte = await (await fetch(CIERRE_URL, {
      method: "POST",
      headers: {
        Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: cuerpo.toString(),
      signal: AbortSignal.timeout(60_000),
    })).text();

    let datos: Record<string, unknown> | null = null;
    try { datos = JSON.parse(respCorte); } catch { datos = null; }
    const ok = String(datos?.typeinfo ?? "").toLowerCase() === "success";

    return json({
      ok,
      // Recién ACÁ viaja el esperado: después del conteo, nunca antes.
      esperado, contado: Number(efectivo), diferencia: Number(dosDecimales(diferencia)),
      id_corte: datos?.id_corte ?? null,
      vale: valeId ? { id: valeId, movimiento_en_caja: movVale, monto: Number(montoVale.toFixed(2)) } : null,
      respuesta: ok ? undefined : respCorte.slice(0, 300),
    });
  } catch (e) {
    console.error("hacer-corte-caja:", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error)?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
