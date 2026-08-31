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
const TICKET_URL = `${BASE}corte_caja_diario.php`;

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

/**
 * El tiquete que acaba de salir, y lo que ÉL dice que se esperaba.
 *
 * Existe porque `total_corte` del formulario NO es el efectivo esperado, y eso
 * se midió el 31-ago sobre el primer corte real hecho desde el portal (Salud 3,
 * corte 14319). El portal leyó 893.50, mandó una diferencia de -411.55, y el
 * tiquete que imprimió el mismo documento dice:
 *
 *     (+) VENTA $: 541.75 · (-)VALES $: 150.50 · (+) COBROS CREDITO $: 100.45
 *     TOTAL CAJA $: 491.70 · EFECTIVO $: 481.95
 *
 * O sea que lo esperado eran 491.70 y la diferencia real -9.75. La cuenta del
 * tiquete cierra sola; la del formulario no, porque `total_corte` sale de
 * `ventas - vales` y **no incluye los cobros de crédito** (comprobado: el X de
 * las 12:41 leyó 391.25 = 541.75 - 150.50). El sistema imprime la diferencia
 * que se le manda, sin recalcularla, así que un esperado equivocado se vuelve
 * una afirmación falsa sobre dinero en el papel.
 *
 * Por eso lo que se le muestra a quien contó sale del TIQUETE y no de la cuenta
 * del portal. Es la misma regla que ya rige el módulo —el esperado lo calcula la
 * caja, no nosotros—, aplicada al lugar donde la caja de verdad lo dice.
 */
interface Tiquete {
  texto: string;
  tipo: string | null;
  /** `null` cuando el tiquete vino pero no se le pudo leer la cuenta. */
  esperado: number | null;
  contado: number | null;
  diferencia: number | null;
  /**
   * Las líneas con las que la caja llegó a lo esperado, en su orden.
   *
   * Van al papel que imprime el portal: sin ellas el comprobante diría una
   * diferencia y no de dónde sale, y quien lo lea no tendría cómo comprobarla.
   * Es lo mismo que ya hace el vale de bolsa, que lista de qué bolsa salió cada
   * parte en vez de sólo el total.
   */
  lineas: { rotulo: string; monto: number }[];
  /** Lo que el tiquete dice de sí mismo: identifica el papel sobre la mesa. */
  empleado: string | null;
  caja: string | null;
  turno: string | null;
}

async function leerTiquete(
  cookie: string, idCorte: string, erpId: number,
): Promise<Tiquete | null> {
  const r = await fetch(TICKET_URL, {
    method: "POST",
    headers: {
      Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: new URLSearchParams({
      process: "imprimir", id_corte: idCorte, id_sucursal_dom: String(erpId),
    }).toString(),
    signal: AbortSignal.timeout(45_000),
  });
  const mov = JSON.parse(await r.text())?.movimiento ?? null;
  // Tiene que ser el corte PEDIDO: el origen contesta 200 con un tiquete de
  // otro corte cuando el id no es de esta sala. Mismo freno que el sync.
  if (!mov || !new RegExp(`:\\s*${idCorte}\\b`).test(mov)) return null;

  const linea = (rx: RegExp) => {
    const m = String(mov).match(rx);
    if (!m) return null;
    const n = Number(m[1].replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  const totalCaja = linea(/TOTAL CAJA \$:\s*([\d.,-]+)/i);
  const efectivo  = linea(/EFECTIVO \$:\s*([\d.,-]+)/i);
  const retencion = linea(/RETENCION \$:\s*([\d.,-]+)/i) ?? 0;
  const devol     = linea(/DEVOLUCIONES\s*\$:\s*([\d.,-]+)/i) ?? 0;
  const texto = String(mov);
  const cabecera = {
    tipo:     texto.match(/CORTE TIPO:\s*([^\n]+)/i)?.[1]?.trim() ?? null,
    empleado: texto.match(/EMPLEADO:\s*([^\n]+)/i)?.[1]?.trim() ?? null,
    caja:     texto.match(/CAJA\s*:\s*(\d+)/i)?.[1] ?? null,
    turno:    texto.match(/TURNO:\s*(\d+)/i)?.[1] ?? null,
  };

  // Sólo las líneas que TRAJO el tiquete: una sala sin caja chica no imprime esa
  // línea, y un cero inventado en el papel se lee como un dato medido.
  const lineas: { rotulo: string; monto: number }[] = [];
  const agregar = (rotulo: string, rx: RegExp, siCero = false) => {
    const v = linea(rx);
    if (v === null || (v === 0 && !siCero)) return;
    lineas.push({ rotulo, monto: v });
  };
  agregar("Saldo inicial",  /SALDO INICIAL \$:\s*([\d.,-]+)/i);
  agregar("Caja chica",     /SALDO CAJA CHICA \$:\s*([\d.,-]+)/i);
  agregar("Ingresos",       /\(\+\)\s*INGRESOS \$:\s*([\d.,-]+)/i);
  agregar("Venta",          /\(\+\)\s*VENTA \$:\s*([\d.,-]+)/i, true);
  agregar("Vales",          /\(-\)\s*VALES \$:\s*([\d.,-]+)/i);
  agregar("Cobros credito", /\(\+\)\s*COBROS CREDITO \$:\s*([\d.,-]+)/i);
  agregar("Retencion",      /\(-\)\s*RETENCION \$:\s*([\d.,-]+)/i);
  agregar("Devoluciones",   /\(-\)\s*DEVOLUCIONES\s*\$:\s*([\d.,-]+)/i);

  // Un tiquete sin las dos líneas de la cuenta se devuelve igual, con la cuenta
  // en `null`. Inventar un cero acá sería decir «cuadró» sobre algo que no se
  // leyó, que es peor que no saber.
  if (totalCaja === null || efectivo === null) {
    return { texto, ...cabecera, esperado: null, contado: null, diferencia: null, lineas };
  }
  const esperado = Number((totalCaja - retencion - devol).toFixed(2));
  return {
    texto, ...cabecera, esperado, contado: efectivo,
    diferencia: Number((efectivo - esperado).toFixed(2)), lineas,
  };
}

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
    // El ALCANCE, que hasta el 31-ago no se miraba: `sala` viene del navegador y
    // era lo único que decidía a qué caja se le hacía el corte. Quien tuviera el
    // permiso podía cortar la caja de cualquiera de las siete salas, y un corte
    // no se deshace. El módulo `caja_vales` no ofrecía alcance en la pantalla de
    // permisos, así que tampoco había forma de acotarlo.
    if (!permiso.alcanceTodo && Number(permiso.emp?.branch_id) !== sala) {
      return json({ ok: false, error: "Solo puedes hacer el corte de tu propia sala." }, 403);
    }

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
      const marca = `VALE DE CAJA ${valeId} `;
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
            concepto: `VALE DE CAJA ${valeId} (${mias.length} salida${mias.length === 1 ? "" : "s"})`,
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
    //
    // Y el TIPO se fija en C, que es lo único que «reenviar el formulario tal
    // cual» no podía acertar. Medido el 31-ago en el formulario vivo de Salud 3:
    //
    //     <option  value="C">
    //     <option selected value="X">   ← el que viene marcado
    //     <option value="Z">
    //
    // O sea que el default del formulario es **X**, que es una LECTURA de
    // ventas y no un corte de efectivo. El portal reproducía fielmente ese
    // default y el primer corte hecho desde acá salió X: tiquete
    // «CORTE TIPO: X», sin línea de efectivo, y encima invisible en el portal
    // porque `sync-cortes-caja` sólo guarda C y Z. La persona lo repitió y el
    // segundo salió C, así que quedaron dos cortes de la misma caja con dos
    // minutos de diferencia.
    //
    // Los de caja son C. No es una preferencia: el X no cuenta el dinero.
    campos.set("tipo_corte", "C");
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
    const idCorte = datos?.id_corte ?? null;

    // El tiquete manda sobre la cuenta del portal. Si no se pudo leer, se avisa
    // en vez de caer en silencio a un número que ya sabemos que puede estar mal.
    let tiquete: Tiquete | null = null;
    if (ok && idCorte) {
      try { tiquete = await leerTiquete(cookie, String(idCorte), entrada.erpId); }
      catch (e) { console.error("hacer-corte-caja: tiquete:", e); }
    }
    const delTiquete = tiquete?.esperado !== null && tiquete?.esperado !== undefined;

    return json({
      ok,
      // Recién ACÁ viaja el esperado: después del conteo, nunca antes. Y sale
      // del tiquete cuando se pudo leer — ver `leerTiquete`.
      esperado: delTiquete ? tiquete!.esperado : esperado,
      contado: delTiquete ? tiquete!.contado : Number(efectivo),
      diferencia: delTiquete ? tiquete!.diferencia : Number(dosDecimales(diferencia)),
      // Lo que el portal había calculado, para poder compararlo. Mientras las
      // dos cuentas no coincidan siempre, esto es lo que permite verlo.
      segun_el_portal: { esperado, diferencia: Number(dosDecimales(diferencia)) },
      del_tiquete: delTiquete,
      tipo: tiquete?.tipo ?? null,
      id_corte: idCorte,
      // Lo que necesita el comprobante que imprime el portal. El sistema de la
      // caja arma su propio tiquete pero sólo lo imprime desde SU pantalla, así
      // que desde el portal el corte salía sin ningún papel.
      tiquete: tiquete
        ? {
          lineas: tiquete.lineas, empleado: tiquete.empleado,
          caja: tiquete.caja, turno: tiquete.turno,
        }
        : null,
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
