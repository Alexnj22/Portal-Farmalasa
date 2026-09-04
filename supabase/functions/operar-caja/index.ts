import { createClient } from "npm:@supabase/supabase-js@2";
import {
  getCorsHeaders, getErpBranchMap, permisoDeModulo, requireActiveEmployeeUser,
} from "../_shared/security.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Los actos de caja que faltaban en el portal: ABRIR, anotar un INGRESO o una
// SALIDA del cajón, y CERRAR el día. El corte vive aparte, en `hacer-corte-caja`, porque tiene su
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
// ── INGRESO y SALIDA: el CAJÓN, no la bolsa ────────────────────────────────
// Lo que sale de una BOLSA vive en Bolsas, con su bolsa elegida, su foto y su
// vale consolidado. Acá va lo que entra y sale del cajón sin pasar por ninguna
// bolsa —el pago de un recibo, la compra de agua fría—, que hasta hoy se
// tecleaba en la otra pantalla y desde el lunes no se puede.
//
// ── El «catálogo de tipos» no existe, y eso lo cierra (29-ago) ─────────────
// Estuve esperando la lista del desplegable «Tipo» para no clasificar mal un
// ingreso. El usuario mandó las dos pantallas y no hay tal desplegable: el
// ingreso pide monto, concepto y código de vendedor; el vale pide monto,
// concepto y recibe. El `id_tipo` no lo elige una persona — lo fija el
// formulario según qué botón se apretó.
//
// Y en qué línea del tiquete cae, medido en vez de supuesto: se escribió un
// ingreso de $0.01 y `total_entrada` del formulario del corte pasó de 100.92 a
// 100.93 y lo esperado de 387.12 a 387.13, con `total_credito` quieto en 0.
// Después se borró y los tres volvieron. O sea: **un ingreso del portal cuenta
// como INGRESO**, no como cobro de crédito.
//
// Lo único que sigue afuera es registrar un COBRO de una venta al crédito, que
// es otro acto —la línea propia del tiquete— y no se hace desde acá.
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
const SALIDA     = `${BASE}agregar_salida_caja.php`;
const EDITAR     = `${BASE}editar_movimiento_caja.php`;
const BORRAR     = `${BASE}borrar_movimiento_caja.php`;

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
    // Lo que el sistema espera adentro AHORA y a qué hora se abrió. Está en el
    // mismo panel: no cuesta una petición más y es la primera pregunta de quien
    // mira la pantalla — «¿cuánto hay?».
    //
    // El «Nombre» del panel NO se lee: es el de la cuenta con la que la sala
    // abre siempre, no el de quien abrió. Quién abrió sale de
    // `caja_aperturas_del_portal` (ver la acción `estado`).
    const campo = (etiqueta: string) =>
      (panel.match(new RegExp(`${etiqueta}:\\s*([^<]*)<`))?.[1] ?? "")
        .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() || null;
    /* ── EL PANEL DICE LA APERTURA DE DOS FORMAS, Y LA SEGUNDA ES LA QUE
     *    QUEDA DESPUÉS DEL CORTE (2026-09-02) ──────────────────────────────
     *
     * `id_apertura=` sale en el ENLACE de «hacer corte». En cuanto el turno ya
     * tiene su corte ese enlace desaparece, y el número sobrevive sólo en el
     * campo escondido `<input id="id_apertura" value="…">`. Leyendo únicamente
     * el enlace, esta función daba la caja por CERRADA sobre un turno que el
     * origen tiene bien vivo.
     *
     * Medido en Salud 3 el 2-sep: corte 14389 a las 12:38, y a las 13:04 la
     * pantalla ofrecía «Abrir la caja» mientras el origen contestaba cinco
     * veces «Ya existe una apertura de caja vigente en esta caja!». Con la
     * caja leída como cerrada NADA se puede hacer: ni la salida, ni rehacer el
     * corte —`hacer-corte-caja` tenía el mismo lector—, así que la sala queda
     * sin poder cortar justo después de cortar.
     *
     * `sync-aperturas-caja` ya leía las dos formas (`leerPanel`) y por eso el
     * barrido de las 13:00 la seguía viendo abierta. Eran DOS lectores del
     * MISMO panel con distinta regla, y el que decide si se puede operar era
     * el ciego. Al tocar uno hay que tocar los tres.
     *
     * `emp` y `turno` viajan en ese mismo enlace y se caen con él: el turno se
     * recupera del rótulo del panel —que es de donde lo saca el barrido, y el
     * que dio «2» bien ese día— y el empleado cae al de la sesión, que es el
     * respaldo que esta función ya tenía. */
    const aper = panel.match(/id_apertura=(\d+)/)?.[1]
      ?? panel.match(/id=["']id_apertura["'][^>]*value=["'](\d+)["']/)?.[1];
    if (aper) {
      const num = (v: string | null) => {
        const limpio = String(v ?? "").replace(/[^0-9.-]/g, "");
        const n = Number(limpio);
        return limpio && Number.isFinite(n) ? n : null;
      };
      /* ── «APERTURA VIGENTE» NO ES «TURNO CORRIENDO» ────────────────────
       *
       * El enlace del corte sólo está mientras el turno corre. Sin él, el panel
       * muestra «Apertura Vigente» y un botón verde **Iniciar Turno**: la
       * apertura del día sigue viva y no hay turno con el que vender ni cortar.
       *
       * Devolver `abierta: true` a secas —lo que hace este arreglo— es correcto
       * para no volver a perder la apertura, y a la vez esconde ese estado: la
       * pantalla dice «Abierta» y no ofrece nada, así que la sala termina yendo
       * al sistema a apretar el botón. Es el mismo defecto de antes al revés.
       *
       * `turno_corriendo` lo separa, y desde el 3-sep el portal SÍ ofrece
       * «Iniciar turno» (ver la acción `iniciar_turno`), así que ese estado ya
       * no es un callejón. La sonda que se usó para descubrir el botón del
       * origen se quitó: lo que averiguaba es el `idDetalle` de acá abajo. */
      const turnoCorriendo = /id_apertura=\d+/.test(panel);
      return {
        abierta: true, turnoCorriendo, idCaja,
        /* El «detalle de apertura», que es lo que `apertura_turno` pide junto
         * con la apertura. Sale del mismo campo escondido que lee el JS del
         * origen (`$("#id_d_ap1").val()`), y sólo está cuando el turno NO
         * corre — que es justo cuando hace falta. La sonda que lo descubrió se
         * quita: ya no hay nada que averiguar. */
        idDetalle: panel.match(/id=['"]id_d_ap1['"][^>]*value=['"](\d+)['"]/)?.[1]
          ?? panel.match(/class=['"]id_d_ap1['"][^>]*value=['"](\d+)['"]/)?.[1] ?? null,
        aper, emp: panel.match(/emp=(\d+)/)?.[1] ?? idEmple,
        turno: panel.match(/turno=(\d+)/)?.[1]
          ?? campo("Turno")?.match(/\d+/)?.[0] ?? "1",
        idEmple,
        registrado: num(campo("Monto Registrado")),
        apertura: num(campo("Monto Apertura")),
        desde: campo("Hora Apertura"),
      };
    }
  }
  return { abierta: false, turnoCorriendo: false, idCaja: cajas[0] ?? null, aper: null, emp: null, turno: null, idEmple, idDetalle: null };
}

const dosDecimales = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const exito = (t: string) => /"typeinfo"\s*:\s*"Success"/i.test(t);

/**
 * **Cuántos BILLETES hay en el cajón ahora.** Otra pregunta que «Monto
 * Registrado», y la que decide de dónde sale una salida de efectivo.
 *
 * ── Por qué `registrado` no sirve tal cual, medido ─────────────────────────
 * El «Monto Registrado» del panel es el `total_corte` del origen:
 *
 *     total_tike + total_factura + total_credito + monto_apertura
 *     + total_entrada − total_salida
 *
 * o sea que le sobran dos cosas y le falta una:
 *
 * 1. **Le sobran las ventas que no fueron en efectivo.** Una venta con tarjeta
 *    entra ahí y no deja un billete en el cajón. Se restan de
 *    `sales_invoices.tipo_pago`, que es el mismo dato con el que la pantalla
 *    ya arma el panel del día.
 * 2. **Le sobra lo que ya se embolsó hoy.** Meter el dinero en una bolsa no le
 *    avisa nada al origen: la plata de las bolsas DE HOY le sigue figurando
 *    adentro hasta el Z de la noche (es exactamente el motivo por el que
 *    existe `caja_vales_portal`). Medido en Salud 3 el 30-ago: corte C de las
 *    12:14 con $438.69 contados → bolsa de $438.69, y el corte de las 18:04
 *    esperaba $969.30, o sea que el origen seguía contando los $438.69 que ya
 *    estaban dentro de una bolsa sellada.
 *
 *    ⚠️ Y de eso hay que devolver lo que YA se anotó como vale: cuando una
 *    salida tomó de una bolsa de hoy, el portal le anotó el vale a la caja
 *    —`registrado` ya lo restó— y esa misma plata está adentro de
 *    `embolsado`. Restar las dos la contaría dos veces.
 * 3. **Le falta el cobro de créditos**, que es el defecto conocido del origen
 *    (docs/AUDITORIA-CORTE-DESDE-EL-PORTAL-2026-09-02.md §2). Ese dinero SÍ
 *    entra en billetes, así que no sumarlo deja el número **por debajo** de lo
 *    que hay — y esa es la dirección segura: de menos manda la salida a las
 *    bolsas, que es lo que se hacía siempre. De más mandaría a alguien a
 *    buscar en un cajón billetes que no están.
 *
 * Nada de esto escribe una diferencia en ningún lado: es para decidir de dónde
 * sale la plata, no para corregirle el corte al origen —eso se decidió dejarlo
 * como está—.
 *
 * Vive en el servidor y no en la pantalla por dos motivos: `sales_invoices` con
 * llave de servicio no depende del permiso de quien mira (el alcance de
 * `cortes_caja` lo tienen 9 de 24 cargos, y sin él la consulta devuelve cero
 * filas **sin error**, o sea un cajón que parece lleno), y así las tres
 * pantallas que ofrecen la salida contestan lo mismo.
 *
 * Devuelve las piezas además del total: un número que decide dónde está el
 * dinero tiene que poder auditarse sin volver a correr la cuenta.
 */
async function efectivoEnElCajon(
  // deno-lint-ignore no-explicit-any
  supabase: any, sala: number, dia: string, registrado: number | null,
) {
  if (registrado == null) return { efectivo: null };

  /* Las tres piezas se suman EN LA BASE (`caja_efectivo_piezas`) y no bajando
   * las filas para sumarlas acá. Lo levantó `gate:data` como `sin-paginar` y
   * tenía razón: PostgREST trunca en 1000 filas sin avisar, así que el día que
   * una sala cruce las mil facturas el descuento saldría de menos y el cajón
   * parecería tener MÁS de lo que tiene — la dirección peligrosa. Medido: el
   * máximo por sala y día son 273, o sea que el defecto habría vivido callado
   * hasta el día que sí. De paso, tres viajes se vuelven uno. */
  const { data, error } = await supabase
    .rpc("caja_efectivo_piezas", { p_branch_id: sala, p_dia: dia });

  /* Un error NO se lee como cero. Sin el descuento, el cajón parecería tener
   * todo lo del día: es la regla de las edge functions —nunca ignorar el
   * `error`— y acá el precio sería mandar a alguien a sacar billetes que no
   * están. Sin poder medirlo, `efectivo: null`, y `null` no es cero: la salida
   * cae a las bolsas, que es lo que se hacía siempre. */
  if (error || !data) {
    console.error(`[operar-caja] efectivo sala=${sala} dia=${dia}: ${error?.message ?? "sin datos"}`);
    return { efectivo: null };
  }

  const noEfectivo = Number(data.ventas_no_efectivo ?? 0);
  const embolsado = Number(data.embolsado_hoy ?? 0);
  const yaAnotado = Number(data.vales_ya_anotados ?? 0);
  const efectivo = registrado - noEfectivo - embolsado + yaAnotado;
  return {
    efectivo: Number(dosDecimales(Math.max(0, efectivo))),
    efectivo_piezas: {
      registrado,
      ventas_no_efectivo: noEfectivo,
      embolsado_hoy: embolsado,
      vales_ya_anotados: yaAnotado,
    },
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
    const accion = String(body.accion ?? "");
    const sala = Number(body.sala);
    // ⚠️ Esta lista es una PUERTA, no una etiqueta. `aplicar_correccion` estuvo
    // acá antes de existir, y el bloque de CERRAR no era una rama sino la COLA
    // de la función: una acción aceptada y sin implementar caía en él y
    // **cerraba el día**, el único acto irreversible del módulo. Hoy la cola ya
    // no es cola (ver el `if (accion === "cerrar")` de abajo), pero la regla
    // queda: no se agrega un nombre acá hasta que su rama esté escrita.
    // `abono` faltaba desde que se escribió su rama (v2.924.0, 1-sep): el botón
    // salió a producción y esta puerta le contestaba «Acción desconocida» — la
    // rama existía y nunca se alcanzó. Es lo que esta lista tiene de traicionero
    // en el otro sentido: no sólo deja pasar de más, también deja afuera.
    if (!["abrir", "iniciar_turno", "ingreso", "salida", "abono", "cerrar", "estado", "corregir",
          "aplicar_correccion"].includes(accion)) {
      return json({ ok: false, error: "Acción desconocida." }, 400);
    }
    if (!Number.isFinite(sala)) return json({ ok: false, error: "Falta la sala." }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const quien = await requireActiveEmployeeUser(req, supabase);
    if (!quien) return json({ ok: false, error: "Sesión inválida o empleado inactivo." }, 401);
    /* Tres permisos distintos y no uno, porque son tres actos distintos:
     *
     *  · MIRAR el estado lo puede hacer quien ve los cortes (`can_view`).
     *  · ABRIR, anotar o cerrar es operar la caja (`caja_vales` `can_edit`), y
     *    pedir una corrección también: la pide quien anotó.
     *  · APLICAR una corrección es DECIDIRLA, y ésa es la otra persona
     *    (`requests_caja` `can_approve`). Cobrarla con `caja_vales` dejaría que
     *    quien se equivocó se aprobara a sí mismo, que es exactamente lo que la
     *    solicitud existe para impedir. */
    const [modulo, accionDelPermiso] = accion === "aplicar_correccion"
      ? ["requests_caja", "can_approve"]
      : ["caja_vales", accion === "estado" ? "can_view" : "can_edit"];   // `abono` incluido: es un ingreso
    const permiso = await permisoDeModulo(supabase, quien.id, modulo, accionDelPermiso);
    if (permiso.roto) return json({ ok: false, error: permiso.roto }, 503);
    if (!permiso.puede) {
      return json({ ok: false, error: accion === "aplicar_correccion"
        ? "No tienes permiso para decidir las correcciones de caja."
        : "No tienes permiso para operar la caja desde el portal." }, 403);
    }
    /* El ALCANCE, que hasta el 31-ago no se miraba en ninguna de las dos
     * functions de caja. `sala` viene del navegador y era lo único que decidía
     * qué caja se abría, se anotaba o se cerraba: quien tuviera el permiso
     * operaba las siete. Y no había cómo acotarlo, porque `caja_vales` estaba
     * declarado `hasScope: false` y la pantalla de permisos ni siquiera ofrecía
     * el selector.
     *
     * `aplicar_correccion` y `corregir` no pasan por acá —van contra un
     * movimiento que se relee de la base, con su propia sala— así que el freno
     * se aplica a lo que sí toca una caja por número de sala. */
    if (!["aplicar_correccion", "corregir"].includes(accion)
        && !permiso.alcanceTodo && Number(permiso.emp?.branch_id) !== sala) {
      return json({ ok: false, error: "Solo puedes operar la caja de tu propia sala." }, 403);
    }

    // ── PEDIR UNA CORRECCIÓN ────────────────────────────────────────────────
    //
    // No toca la caja: crea la solicitud y se acabó. Corregir un movimiento ya
    // escrito es una decisión de otra persona —pedido del usuario— y por eso va
    // por la misma bandeja donde el portal ya resuelve las anulaciones de
    // factura, con su aprobador, sus avisos y su bitácora.
    if (accion === "corregir") {
      const movId = Number(body.movimiento);
      const que = String(body.que ?? "");          // 'ANULAR' | 'MONTO'
      const motivo = String(body.motivo ?? "").trim();
      if (!Number.isFinite(movId)) return json({ ok: false, error: "Falta el movimiento." }, 400);
      if (!["ANULAR", "MONTO"].includes(que)) return json({ ok: false, error: "Falta qué corregir." }, 400);
      if (motivo.length < 5) return json({ ok: false, error: "Escribe el motivo." }, 400);

      // El movimiento se RELEE de la base, no se recibe: el navegador manda un
      // id y nada más, así que no puede pedir una corrección sobre un monto que
      // él mismo inventó.
      const { data: mov, error: errMov } = await supabase
        .from("caja_movimientos_portal")
        .select("id, branch_id, tipo, monto, concepto, erp_movimiento_id, anulado_at")
        .eq("id", movId).maybeSingle();
      if (errMov) throw new Error(`leyendo el movimiento: ${errMov.message}`);
      if (!mov) return json({ ok: false, error: "Ese movimiento no existe." }, 404);
      if (mov.anulado_at) return json({ ok: false, error: "Ese movimiento ya está anulado." }, 409);

      /* Una sola solicitud viva por movimiento. Faltaba (auditado el 2-sep a
       * pedido del usuario): dos personas podían pedir lo mismo, un supervisor
       * aprobar las dos, y la segunda corrección aplicarse sobre un movimiento
       * que la primera ya cambió. La garantía es el índice
       * `approval_requests_un_movimiento_pendiente`; esto da el mensaje. */
      const { data: yaHay, error: errYaHay } = await supabase.from("approval_requests")
        .select("id").eq("type", "CAJA_MOVIMIENTO_CHANGE").eq("status", "PENDING")
        .eq("metadata->>movimiento_portal", String(movId)).maybeSingle();
      if (errYaHay) throw new Error(`buscando solicitudes vivas: ${errYaHay.message}`);
      if (yaHay) {
        return json({ ok: false, error: "Ya hay una solicitud pendiente sobre ese movimiento." }, 409);
      }

      const { data: sol, error: errSol } = await supabase.from("approval_requests").insert({
        type: "CAJA_MOVIMIENTO_CHANGE",
        employee_id: quien.id,
        status: "PENDING",
        note: motivo,
        metadata: {
          movimiento_portal: mov.id, branch_id: mov.branch_id,
          que, monto_actual: mov.monto, monto_nuevo: que === "MONTO" ? Number(body.monto_nuevo) : null,
          concepto: mov.concepto, erp_movimiento_id: mov.erp_movimiento_id,
        },
      }).select("id").single();
      if (errSol) {
        // 23505: el índice único. Otra persona pidió lo mismo en el medio.
        if (String((errSol as { code?: string }).code) === "23505") {
          return json({ ok: false, error: "Ya hay una solicitud pendiente sobre ese movimiento." }, 409);
        }
        throw new Error(`creando la solicitud: ${errSol.message}`);
      }
      return json({ ok: true, solicitud: sol.id });
    }

    const entrada = getErpBranchMap().find((e) => e.branchId === sala);
    if (!entrada) return json({ ok: false, error: "Esa sala no está configurada." }, 400);

    const { username, password } = getCortesCreds();
    const cookie = await getSessionCookie(username, password);
    await abrirSala(cookie, entrada.erpId);
    const estado = await estadoDeLaCaja(cookie);

    // El día que la caja tiene abierto. Sale de la captura y no del reloj: a las
    // once de la noche, con la caja sin cerrar, sigue siendo el de ayer.
    const { data: aperturaViva } = await supabase
      .from("cortes_caja_aperturas")
      .select("abierta_el")
      .eq("branch_id", sala).is("cerrada_at", null)
      .order("abierta_el", { ascending: false }).limit(1);
    const diaAbierto = aperturaViva?.[0]?.abierta_el
      ?? new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);

    // Los cortes del día que la caja tiene abierto. La pantalla los necesita
    // para no ofrecer el cierre cuando no hay ninguno: el candado de verdad está
    // abajo, en la acción de cerrar, pero enterarse recién ahí —después de leer
    // el aviso y escribir la palabra— es hacer perder el tiempo por una
    // condición que ya se conocía al pintar.
    const { data: cortesDelDia, error: errCortes } = await supabase
      .from("cortes_caja")
      .select("id, tipo, hora, total_declarado, esperado, diferencia_erp, estado")
      .eq("branch_id", sala).eq("fecha", diaAbierto)
      .order("hora", { ascending: true });
    // Un error acá NO se puede leer como «no hay cortes»: sería ofrecer el
    // cierre justo cuando no se pudo comprobar que hubiera alguno.
    if (errCortes) throw new Error(`revisando los cortes del día: ${errCortes.message}`);

    if (accion === "estado") {
      const registrado = (estado as { registrado?: number | null }).registrado ?? null;
      /* ── QUIÉN ABRIÓ LA CAJA ────────────────────────────────────────────
       *
       * NO sale del panel del origen. El panel da el nombre de la CUENTA con
       * la que esa sala abre siempre, que no es quien abrió: en tres salas es
       * literalmente «MI CAJA LA POPULAR» —la tarjeta mostraba «Mi La», que es
       * lo que queda al recortarlo a dos palabras— y en las otras tres es el
       * nombre de una persona que tampoco es la que apretó el botón, porque
       * `abrir` reusa a propósito el mismo empleado que la sala ya venía
       * usando (ver el bloque ABRIR).
       *
       * La respuesta está en `caja_aperturas_del_portal`, que se escribía desde
       * el primer día y no la leía NADIE. Se amarra por `erp_apertura_id` —la
       * apertura concreta— y nunca por «la última de la sala»: eso le
       * atribuiría el segundo turno, abierto desde la caja por otra persona, a
       * quien abrió el primero desde el portal.
       *
       * Si no hay fila, `quien` va en `null` y la pantalla lo dice. Devolver el
       * nombre de la cuenta sería firmar un acto con el nombre de alguien que
       * no lo hizo. */
      const aperturaId = Number((estado as { aper?: string | null }).aper);
      let quienAbrio: string | null = null;
      if (estado.abierta && Number.isFinite(aperturaId)) {
        const { data: fila, error: errQuien } = await supabase
          .from("caja_aperturas_del_portal")
          .select("employees!caja_aperturas_del_portal_abierta_por_fkey(name)")
          .eq("branch_id", sala).eq("erp_apertura_id", aperturaId).maybeSingle();
        // Un error acá NO se puede leer como «no se abrió desde el portal»:
        // sería decir que nadie del portal la abrió porque no se pudo mirar.
        if (errQuien) throw new Error(`leyendo quién abrió la caja: ${errQuien.message}`);
        quienAbrio = (fila as { employees?: { name?: string | null } } | null)?.employees?.name ?? null;
      }
      return json({
        ok: true, abierta: estado.abierta, caja: estado.idCaja, turno: estado.turno,
        // «Vigente» y «corriendo» son dos estados y la pantalla necesita los dos:
        // con la apertura viva y el turno sin iniciar no se puede vender ni cortar.
        turno_corriendo: (estado as { turnoCorriendo?: boolean }).turnoCorriendo ?? true,
        registrado,
        apertura: (estado as { apertura?: number | null }).apertura ?? null,
        quien: quienAbrio,
        desde: (estado as { desde?: string | null }).desde ?? null,
        dia: diaAbierto,
        cortes: cortesDelDia ?? [],
        // Cuánto de eso son BILLETES, que es otra pregunta. Ver `efectivoEnElCajon`.
        ...(await efectivoEnElCajon(supabase, sala, diaAbierto, registrado)),
      });
    }

    // ── APLICAR UNA CORRECCIÓN APROBADA ─────────────────────────────────────
    //
    // La otra mitad de `corregir`. Hasta que existió, el botón «Corregir» era un
    // callejón: creaba la solicitud, alguien la aprobaba y la caja no cambiaba.
    //
    // Lo que se corrige **NO viene del navegador**: el id de la solicitud es lo
    // único que se recibe, y de ahí se relee qué se pidió, sobre qué movimiento
    // y con qué monto. Mandar el monto desde afuera dejaría que quien aprueba
    // escribiera un número distinto del que se pidió, y la bitácora guardaría el
    // pedido y no lo hecho.
    //
    // El orden importa y es el mismo que usa facturación: primero la caja,
    // después el portal, y la solicitud queda APPROVED **al final**. Si el
    // sistema no acepta, la solicitud sigue PENDING con el motivo a la vista —
    // nunca una corrección «aprobada» sobre una caja que no cambió.
    if (accion === "aplicar_correccion") {
      const solId = String(body.solicitud ?? "");
      if (!solId) return json({ ok: false, error: "Falta la solicitud." }, 400);

      const { data: sol, error: errSol } = await supabase.from("approval_requests")
        .select("id, type, status, metadata, employee_id, note, approvals")
        .eq("id", solId).maybeSingle();
      if (errSol) throw new Error(`leyendo la solicitud: ${errSol.message}`);
      if (!sol) return json({ ok: false, error: "Esa solicitud no existe." }, 404);
      if (sol.type !== "CAJA_MOVIMIENTO_CHANGE") {
        return json({ ok: false, error: "Esa solicitud no es de una corrección de caja." }, 400);
      }
      if (sol.status !== "PENDING") {
        return json({ ok: false, error: `Esa solicitud ya está en ${sol.status}.` }, 409);
      }
      // Quien la pidió no la aprueba. El permiso ya se cobró arriba; esto es lo
      // otro que hace falta, y no es lo mismo: tener el permiso de decidir no
      // habilita a decidir lo propio.
      if (sol.employee_id === quien.id) {
        return json({ ok: false, error: "No puedes aprobar tu propia corrección." }, 403);
      }

      const meta = (sol.metadata ?? {}) as Record<string, unknown>;
      if (Number(meta.branch_id) !== sala) {
        return json({ ok: false, error: "Esa corrección es de otra sala." }, 400);
      }

      const { data: mov, error: errMov } = await supabase
        .from("caja_movimientos_portal")
        .select("id, tipo, monto, concepto, erp_movimiento_id, anulado_at")
        .eq("id", Number(meta.movimiento_portal)).maybeSingle();
      if (errMov) throw new Error(`leyendo el movimiento: ${errMov.message}`);
      if (!mov) return json({ ok: false, error: "Ese movimiento ya no existe." }, 404);
      if (mov.anulado_at) return json({ ok: false, error: "Ese movimiento ya está anulado." }, 409);
      // Sin el número del sistema no hay qué corregir del otro lado: la fila del
      // portal es un intento que nunca llegó a la caja. Decirlo es mejor que
      // marcar la solicitud como aplicada sobre algo que no está.
      if (!mov.erp_movimiento_id) {
        return json({ ok: false, error: "Ese movimiento nunca llegó a la caja, así que no hay nada que corregir ahí." }, 409);
      }

      /* ── El monto tiene que ser TODAVÍA el que la solicitud dice ────────
       *
       * `monto_actual` se guarda al PEDIR y hasta acá nadie lo volvía a mirar,
       * así que quien aprobaba decidía sobre una foto vieja: si entre el pedido
       * y la firma alguien editó el movimiento —en el sistema de la caja, por
       * fuera del portal— la pantalla del supervisor seguía diciendo «$50 →
       * $30» sobre un movimiento que ya valía $70, y al aplicar quedaba en $30
       * sin que nadie hubiera decidido eso.
       *
       * Es la misma regla que ya rige los abonos a crédito: el saldo se relee
       * antes de escribir. Acá se compara y se FRENA — corregir sobre una cifra
       * que cambió no es corregir, es pisar. Quien decida lo vuelve a pedir con
       * el número de hoy, que es una molestia y no un error de dinero. */
      const montoAlPedir = Number(meta.monto_actual);
      if (Number.isFinite(montoAlPedir)
          && Math.abs(Number(mov.monto) - montoAlPedir) > 0.004) {
        return json({
          ok: false,
          error: `Ese movimiento cambió: la solicitud se pidió cuando valía `
               + `${montoAlPedir.toFixed(2)} y hoy vale ${Number(mov.monto).toFixed(2)}. `
               + `Recházala y vuelve a pedirla con el monto de ahora.`,
        }, 409);
      }

      const anular = meta.que === "ANULAR";
      const montoNuevo = Number(meta.monto_nuevo);
      if (!anular && !(Number.isFinite(montoNuevo) && montoNuevo > 0)) {
        return json({ ok: false, error: "La solicitud no trae un monto válido." }, 400);
      }

      const resp = anular
        ? await (await fetch(BORRAR, {
            method: "POST",
            headers: {
              Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded",
              "X-Requested-With": "XMLHttpRequest",
            },
            body: new URLSearchParams({
              process: "eliminar", id_movimiento: String(mov.erp_movimiento_id),
            }).toString(),
            signal: AbortSignal.timeout(45_000),
          })).text()
        : await (await fetch(EDITAR, {
            method: "POST",
            headers: {
              Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded",
              "X-Requested-With": "XMLHttpRequest",
            },
            body: new URLSearchParams({
              process: "editar", id_movimiento: String(mov.erp_movimiento_id),
              id_apertura: estado.aper ?? "", id_empleado: estado.emp ?? "",
              turno: estado.turno ?? "1",
              monto: dosDecimales(montoNuevo),
              // El concepto NO se toca: es lo que ata las dos filas cuando
              // alguien mira del otro lado.
              concepto: `P${mov.id} ${mov.concepto}`.slice(0, 50),
            }).toString(),
            signal: AbortSignal.timeout(45_000),
          })).text();

      if (!exito(resp)) {
        console.error(`[operar-caja] corrección mov=${meta.erp_movimiento_id}: ${resp.slice(0, 1000)}`);
        return json({ ok: false, error: "La caja no aceptó la corrección. Vuelve a intentarlo; si sigue igual, avisa a Sistemas." }, 502);
      }

      // Ya cambió del otro lado. De acá en adelante un fallo deja el portal
      // desfasado, no la caja: se contesta que se aplicó y se dice qué no quedó
      // anotado, en vez de callarlo o de fingir que no pasó nada.
      const parche = anular
        ? { anulado_at: new Date().toISOString(), anulado_por: quien.id,
            anulado_motivo: (sol as { note?: string }).note ?? null }
        : { monto: Number(dosDecimales(montoNuevo)) };
      const { error: errPortal } = await supabase.from("caja_movimientos_portal")
        .update({ ...parche, updated_at: new Date().toISOString() })
        .eq("id", mov.id);

      // Quién decidió va en la fila, no sólo en el estado: una decisión sin
      // firma no se puede auditar, y ésta mueve dinero de una caja.
      const { error: errCerrar } = await supabase.from("approval_requests")
        .update({
          status: "APPROVED", approver_id: quien.id,
          approver_note: String(body.approver_note ?? "").slice(0, 500) || null,
          approvals: [...(Array.isArray(sol.approvals) ? sol.approvals : []), {
            level: 1, approverId: quien.id, approvedAt: new Date().toISOString(),
            approverNote: String(body.approver_note ?? "") || null,
          }],
          updated_at: new Date().toISOString(),
        })
        // `eq("status","PENDING")` es el freno contra dos aprobaciones a la vez:
        // la segunda no encuentra la fila y no vuelve a escribir en la caja.
        .eq("id", sol.id).eq("status", "PENDING");

      if (errPortal || errCerrar) {
        return json({ ok: true, aplicado: { que: meta.que, movimiento: mov.id },
          aviso: "La caja se corrigió, pero el portal no lo pudo anotar entero. Avísale a Sistemas." });
      }
      return json({ ok: true, aplicado: { que: meta.que, movimiento: mov.id,
        monto: anular ? null : Number(dosDecimales(montoNuevo)) } });
    }

    // ── ABRIR ───────────────────────────────────────────────────────────────
    if (accion === "abrir") {
      if (estado.abierta) return json({ ok: false, error: "Esa caja ya está abierta." }, 409);
      if (!estado.idCaja) return json({ ok: false, error: "Esa sala no tiene ninguna caja configurada." }, 409);

      // El empleado con el que la CAJA identifica a quien abre. Se reusa el que
      // esa sala ya venía usando; si nunca se vio, el de la sesión — y en los
      // dos casos la persona de verdad queda en `abierta_por`.
      const { data: ultima, error: errUltima } = await supabase.from("cortes_caja_aperturas")
        .select("erp_empleado_id")
        .eq("branch_id", sala).not("erp_empleado_id", "is", null)
        .order("abierta_el", { ascending: false }).limit(1);
      // Descartar este error hacía que una consulta FALLADA se leyera como «esta
      // sala nunca abrió», y la caja quedaba abierta a nombre del empleado de la
      // sesión en vez del que esa sala usa siempre. Un dato equivocado en la
      // caja, sin error a la vista.
      if (errUltima) {
        return json({ ok: false, error: "No se pudo averiguar con qué empleado abre esta sala." }, 503);
      }
      const empErp = ultima?.[0]?.erp_empleado_id ?? estado.idEmple;

      const hoy = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
      const monto = Number(body.monto_apertura ?? 0);

      /* QUÉ TURNO SIGUE LO DICE LA CAJA, no el portal.
       *
       * `apertura_caja.php` trae un campo escondido `turno` con el número que
       * corresponde —lo calcula su servidor mirando los turnos que ya se
       * abrieron ese día en esa sala— y su propio formulario lo manda tal cual.
       * El portal escribía **1 fijo**, y 1 sólo es correcto en el PRIMER turno
       * del día: en cuanto hay un corte, el turno siguiente es el 2, y pedir
       * otra vez el 1 es pedir un turno que ya existe.
       *
       * Medido el 2026-09-01 en Salud 3: dos turnos ya abiertos, el campo
       * escondido decía **3**, el portal mandó **1**, y la sala se quedó sin
       * poder empezar el turno hasta que alguien lo abrió desde la caja. El
       * defecto nació con la pantalla y era invisible: el primer turno del día
       * —el único que se había probado— es justo el caso en que 1 acierta.
       *
       * Se mandan los DOS campos con el mismo número, igual que el formulario:
       * `turno` es el escondido y `turno_x` el que se elige en pantalla. Y NO
       * se lee de `body`: quien llama no sabe la respuesta, y el cliente
       * mandaba precisamente el 1 que rompe. */
      const formulario = await (await fetch(APERTURA, {
        headers: { Cookie: cookie }, signal: AbortSignal.timeout(30_000),
      })).text();
      // `name='turno'` con la comilla pegada: `turno_x` no coincide.
      const turno = formulario.match(/name=['"]turno['"][^>]*value=['"](\d+)['"]/i)?.[1];
      // Sin el número NO se inventa uno. Caer a 1 es volver al defecto, y
      // adivinar acá escribe un turno equivocado en la caja de una sala.
      if (!turno) {
        console.error(`[operar-caja] abrir sala=${sala}: el formulario de apertura no trajo el turno`);
        return json({ ok: false, error: "No se pudo saber qué turno sigue. Vuelve a intentarlo en un momento." }, 503);
      }

      const resp = await (await fetch(APERTURA, {
        method: "POST",
        headers: {
          Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: new URLSearchParams({
          process: "insert", fecha: hoy, empleado: String(empErp), caja: String(estado.idCaja),
          monto_apertura: dosDecimales(monto), monto_ch: "0",
          turno_x: turno, turno,
          id_sucursal: String(entrada.erpId),
        }).toString(),
        signal: AbortSignal.timeout(45_000),
      })).text();

      /* El motivo COMPLETO va al registro, no a la pantalla.
       *
       * Devolvía los primeros 200 caracteres de la respuesta cruda de la caja:
       * ni la sala entiende eso, ni alcanza para diagnosticarlo después —el
       * 502 del 01-sep quedó sin motivo en ninguna parte, porque el texto sólo
       * existió en la pantalla de quien lo apretó—. Hoy el detalle queda en el
       * registro de la función y la pantalla dice lo que hay que hacer. */
      if (!exito(resp)) {
        console.error(`[operar-caja] abrir sala=${sala} caja=${estado.idCaja} turno=${turno}: ${resp.slice(0, 1000)}`);
        /* ── «Ya está abierta» NO es «volvé a intentar» ─────────────────────
         *
         * Medido el 2026-09-02 en Salud 3: SEIS intentos en cuatro minutos
         * (13:04–13:08), los seis con la misma respuesta del origen —«Ya existe
         * una apertura de caja vigente en esta caja»— y el portal contestando
         * «vuelve a intentarlo». O sea que el aviso invitaba a repetir
         * exactamente lo único que no podía funcionar, y la persona lo hizo
         * seis veces.
         *
         * El motivo lo dice el origen y el portal lo sabía: sólo que lo mandaba
         * al registro y a la pantalla le daba la frase genérica. Este caso se
         * distingue y se dice, porque cambia lo que hay que hacer: no es
         * reintentar ni avisar a Sistemas — la caja ya está abierta y hay que
         * recargar para verla. */
        if (/apertura de caja vigente|ya existe una apertura/i.test(resp)) {
          return json({
            ok: false, ya_estaba: true,
            error: "Esta caja ya está abierta. Recarga la pantalla para verla; "
                 + "si vas a empezar otro turno, primero hay que cerrar el que está.",
          }, 409);
        }
        return json({ ok: false, error: "La caja no aceptó la apertura. Vuelve a intentarlo; si sigue igual, avisa a Sistemas." }, 502);
      }

      /* Quién la abrió DE VERDAD, y a CUÁL apertura corresponde.
       *
       * El número de apertura lo acaba de crear el origen, así que se relee el
       * panel: es la única forma de saberlo, y sin él esta fila dice «alguien
       * del portal abrió una caja de esta sala hoy» y no cuál. Con dos turnos
       * en el día —uno desde el portal y otro desde la caja— eso alcanza para
       * firmar el segundo con el nombre de quien abrió el primero.
       *
       * Cuesta una relectura del panel por apertura (seis al día). Si falla,
       * la fila se escribe igual con el número en NULL: perder quién abrió por
       * no poder amarrarlo sería el peor de los dos errores — pero sin amarre
       * la pantalla NO se lo atribuye a nadie, que es lo correcto. */
      const recien = await estadoDeLaCaja(cookie).catch((e) => {
        console.error(`[operar-caja] abrir sala=${sala}: no se pudo releer la apertura: ${e}`);
        return null;
      });
      const aperturaNueva = Number((recien as { aper?: string | null } | null)?.aper);
      if (!Number.isFinite(aperturaNueva)) {
        console.error(`[operar-caja] abrir sala=${sala}: la caja abrió y el panel no dio el número de apertura`);
      }

      const { error: errApertura } = await supabase.from("caja_aperturas_del_portal").insert({
        branch_id: sala, abierta_por: quien.id, erp_empleado_id: empErp,
        caja_erp: Number(estado.idCaja), monto_apertura: monto,
        erp_apertura_id: Number.isFinite(aperturaNueva) ? aperturaNueva : null,
      });
      // La caja YA está abierta cuando llegamos acá. Si la anotación falla, la
      // apertura existe y el portal no sabe quién la hizo — que es justo el dato
      // que esta función existe para guardar. Se contesta que abrió (es verdad)
      // y se dice que no quedó anotada, en vez de callarlo.
      if (errApertura) {
        return json({ ok: true, abierta: true, caja: estado.idCaja,
          aviso: "La caja abrió, pero no se pudo anotar quién la abrió. Avísale a Sistemas." });
      }
      return json({ ok: true, abierta: true, caja: estado.idCaja });
    }

    // ── INICIAR EL TURNO ────────────────────────────────────────────────────
    //
    // «Apertura vigente» y «turno corriendo» son dos estados: abrir la caja crea
    // la apertura del día CON su primer turno, pero el segundo, el tercero y el
    // cuarto se arrancan con otro botón —el verde «Iniciar Turno» del panel— que
    // el portal no tenía. Sin él, en cuanto un turno se cerraba la sala quedaba
    // obligada a ir al sistema de la caja, y el portal decía «Abierta» igual.
    //
    // Reproduce `agregar_turno()` de `js/funciones/funciones_corte_caja.js`:
    //
    //     POST apertura_caja.php
    //     process=apertura_turno&id_detalle=<#id_d_ap1>&id_apertura=<#id_apertura>
    //
    // ── LA SESIÓN ES LA FIRMA, y por eso ésta es la ÚNICA acción que no usa la
    //    cuenta compartida ───────────────────────────────────────────────────
    //
    // Esa petición **no lleva empleado**: el ERP le atribuye el turno a quien
    // tenga la sesión. Y `cambio_sesion.php` cambia la SUCURSAL, no la persona.
    // Es lo contrario del corte y de la apertura, que mandan `id_empleado` /
    // `empleado` en el formulario — de ahí sale la generalización equivocada.
    //
    // Costó los seis turnos del 3-sep: se reabrieron a mano desde una sesión
    // ajena y los seis quedaron firmados por esa persona («inicio turno pero con
    // edwin no con el usuario de caja»). Hubo que cerrarlos.
    //
    // Por eso acá se entra con las credenciales de ESA sala (`ERP_BRANCH_MAP` ya
    // las trae por sucursal) y, antes de escribir, se COMPRUEBA que el empleado
    // de esa sesión sea el mismo con el que la caja está abierta. Si no lo es,
    // no se escribe: un turno bien hecho a nombre de quien no era no da error y
    // no se deshace.
    //
    // `simular: true` hace todo menos escribir, y contesta a nombre de quién
    // quedaría. Es como se mide antes de soltarlo, sin tocar la caja.
    if (accion === "iniciar_turno") {
      if (!estado.abierta) {
        return json({ ok: false, error: "Esa sala no tiene una caja abierta. Primero hay que abrir la caja." }, 409);
      }
      if ((estado as { turnoCorriendo?: boolean }).turnoCorriendo) {
        return json({ ok: false, ya_estaba: true, error: "El turno ya está corriendo." }, 409);
      }

      // La sesión de la SALA, no la compartida. Si esa sala no tiene cuenta
      // propia no se cae a la compartida: sería firmar con el nombre de otro,
      // que es exactamente lo que esta acción viene a evitar.
      if (!entrada.username || !entrada.password) {
        return json({ ok: false, error: "Esta sala no tiene cuenta propia en el sistema de la caja. Avísale a Sistemas." }, 503);
      }
      const cookieSala = await getSessionCookie(entrada.username, entrada.password);
      await abrirSala(cookieSala, entrada.erpId);
      const suyo = await estadoDeLaCaja(cookieSala);

      // Las dos sesiones tienen que estar mirando la MISMA apertura. Si no,
      // algo se movió en el medio y el `id_detalle` sería de otra.
      if (String(suyo.aper ?? "") !== String(estado.aper ?? "")) {
        console.error(`[operar-caja] iniciar_turno sala=${sala}: aperturas distintas `
          + `(compartida ${estado.aper}, sala ${suyo.aper})`);
        return json({ ok: false, error: "La caja cambió mientras se preparaba el turno. Recarga y volvé a intentarlo." }, 409);
      }
      if (suyo.turnoCorriendo) {
        return json({ ok: false, ya_estaba: true, error: "El turno ya está corriendo." }, 409);
      }

      // Con QUÉ empleado está abierta la caja: es el que el portal usó al abrir
      // y el que sale en el panel. La comparación es contra el empleado de la
      // sesión de la sala, que es quien va a firmar el turno.
      const { data: filaAp, error: errAp } = await supabase.from("cortes_caja_aperturas")
        .select("erp_empleado_id, empleado_texto")
        .eq("branch_id", sala).eq("erp_apertura_id", Number(estado.aper)).maybeSingle();
      // Un error acá NO se lee como «no hay con qué comparar»: sería escribir
      // justo cuando no se pudo comprobar quién firma.
      if (errAp) return json({ ok: false, error: "No se pudo comprobar con qué usuario quedaría el turno." }, 503);

      const deLaSesion = Number(suyo.idEmple);
      const deLaCaja = Number(filaAp?.erp_empleado_id);
      const coinciden = Number.isFinite(deLaSesion) && Number.isFinite(deLaCaja) && deLaSesion === deLaCaja;

      if (body.simular === true) {
        return json({
          ok: true, simulado: true, coinciden,
          apertura: estado.aper, caja: suyo.idCaja, turno: suyo.turno,
          empleado_de_la_sesion: Number.isFinite(deLaSesion) ? deLaSesion : null,
          empleado_de_la_caja: Number.isFinite(deLaCaja) ? deLaCaja : null,
          empleado_texto: filaAp?.empleado_texto ?? null,
          id_detalle: suyo.idDetalle ?? null,
        });
      }

      if (!coinciden) {
        console.error(`[operar-caja] iniciar_turno sala=${sala}: la sesión de la sala es el empleado `
          + `${deLaSesion} y la caja está abierta con ${deLaCaja} (${filaAp?.empleado_texto ?? "?"})`);
        return json({
          ok: false,
          error: "El turno quedaría a nombre de otro usuario del sistema, no del de esta caja. "
               + "Inícialo desde el sistema de la caja y avísale a Sistemas.",
        }, 409);
      }
      if (!suyo.idDetalle) {
        console.error(`[operar-caja] iniciar_turno sala=${sala}: el panel no trajo id_d_ap1`);
        return json({ ok: false, error: "No se pudo saber qué turno sigue. Volvé a intentarlo en un momento." }, 503);
      }

      const resp = await (await fetch(APERTURA, {
        method: "POST",
        headers: {
          Cookie: cookieSala, "Content-Type": "application/x-www-form-urlencoded",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: new URLSearchParams({
          process: "apertura_turno", id_detalle: suyo.idDetalle, id_apertura: String(estado.aper),
        }).toString(),
        signal: AbortSignal.timeout(45_000),
      })).text();
      if (!exito(resp)) {
        console.error(`[operar-caja] iniciar_turno sala=${sala}: ${resp.slice(0, 1000)}`);
        return json({ ok: false, error: "La caja no aceptó el inicio del turno. Volvé a intentarlo; si sigue igual, avisa a Sistemas." }, 502);
      }

      /* El «success» NO es la prueba: se relee el panel. Es la misma lección del
       * corte que salió X con la respuesta diciendo «Success». */
      const despues = await estadoDeLaCaja(cookieSala).catch(() => null);
      const corriendo = Boolean((despues as { turnoCorriendo?: boolean } | null)?.turnoCorriendo);

      // El espejo, para que la pantalla no diga «turno cerrado» hasta el próximo
      // barrido —media hora— justo después de haberlo abierto.
      const { error: errEspejo } = await supabase.from("cortes_caja_aperturas")
        .update({ turno_corriendo: corriendo, updated_at: new Date().toISOString() })
        .eq("branch_id", sala).eq("erp_apertura_id", Number(estado.aper));
      if (errEspejo) console.error(`[operar-caja] iniciar_turno espejo sala=${sala}: ${errEspejo.message}`);

      return corriendo
        ? json({ ok: true, turno: (despues as { turno?: string | null } | null)?.turno ?? null })
        : json({
          ok: true, turno_corriendo: false,
          aviso: "La caja aceptó el inicio del turno pero sigue apareciendo sin iniciar. "
               + "Comprobalo en el sistema de la caja antes de seguir vendiendo.",
        });
    }

    // De acá para abajo hace falta una caja abierta.
    if (!estado.abierta) return json({ ok: false, error: "Esa sala no tiene una caja abierta." }, 409);

    // ── INGRESO y SALIDA del cajón ──────────────────────────────────────────
    //
    // Los dos por el mismo camino porque son el mismo acto con el signo dado
    // vuelta, y separarlos duplicaría el freno de no escribir dos veces.
    //
    // NO es la salida de una bolsa: eso vive en Bolsas, con su bolsa elegida y
    // su vale consolidado. Esto es lo que entra y sale del CAJÓN —el pago de un
    // recibo, la compra de agua fría— que hasta hoy se tecleaba en la otra
    // pantalla.
    if (accion === "ingreso" || accion === "salida" || accion === "abono") {
      const esEntrada = accion !== "salida";
      const esAbono = accion === "abono";
      const monto = Number(body.monto);
      let concepto = String(body.concepto ?? "").trim();
      if (!(Number.isFinite(monto) && monto > 0)) return json({ ok: false, error: "Falta el monto." }, 400);
      if (!esAbono && !concepto) return json({ ok: false, error: "Falta el concepto." }, 400);

      /* ── EL ABONO DE CLIENTE ────────────────────────────────────────────
       *
       * Es un ingreso con un contrato encima: el dinero entra al cajón igual
       * que cualquier otro, y además queda una fila que dice a quién, por qué
       * producto y hasta cuándo. Va por ESTE camino y no por uno propio porque
       * el movimiento de caja es exactamente el mismo — separarlo daría dos
       * maneras de meter dinero al cajón, y la segunda se olvidaría de algo.
       *
       * El ORDEN importa y no es libre:
       *   1. el folio, que es lo que va impreso y en el concepto;
       *   2. el movimiento del portal, ANTES de tocar la caja (patrón de acá);
       *   3. la fila del abono, ligada al movimiento;
       *   4. recién entonces la caja.
       *
       * Si (4) falla, queda un abono con su movimiento sin `erp_movimiento_id`:
       * un intento VISIBLE que se puede reintentar. Al revés —tocar la caja
       * primero— dejaría dinero adentro sin nada que dijera de quién es. */
      let folio: string | null = null;
      let cliente = "";
      let telefono: string | null = null;
      let renglones: unknown[] = [];
      let total: number | null = null;
      let venceEl = "";
      if (esAbono) {
        cliente = String(body.cliente_nombre ?? "").trim();
        telefono = String(body.cliente_telefono ?? "").trim() || null;
        renglones = Array.isArray(body.renglones) ? body.renglones : [];
        total = body.total == null || body.total === "" ? null : Number(body.total);
        venceEl = String(body.vence_el ?? "").trim();
        if (cliente.length < 3) return json({ ok: false, error: "Falta el nombre del cliente." }, 400);
        if (!renglones.length) return json({ ok: false, error: "Falta qué se está apartando." }, 400);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(venceEl)) return json({ ok: false, error: "Falta hasta cuándo vale la reserva." }, 400);
        // El total NO puede ser menor que lo que ya pagó: sería un saldo
        // negativo impreso en un comprobante que el cliente se lleva.
        if (total != null && Number.isFinite(total) && total < monto) {
          return json({ ok: false, error: "El abono no puede ser mayor que el total del producto." }, 400);
        }

        const { data: f, error: errFolio } = await supabase
          .rpc("siguiente_folio_de_abono", { p_branch_id: sala });
        // Sin folio no se sigue: el comprobante SE IDENTIFICA por él, y uno
        // inventado acá no coincidiría con la serie que la función lleva.
        if (errFolio || !f) {
          console.error(`[operar-caja] abono sala=${sala}: folio: ${errFolio?.message}`);
          return json({ ok: false, error: "No se pudo generar el numero del comprobante." }, 503);
        }
        folio = String(f);
        // El concepto que ve la caja lleva el folio: es lo único que ata el
        // movimiento con el papel cuando alguien mira del otro lado.
        concepto = `Abono ${folio} ${cliente}`;
      }

      // La fila del portal se escribe ANTES: si la caja lo acepta y el portal no
      // llega a anotarlo, queda un movimiento sin respaldo y sin forma de
      // corregirlo. Al revés, una fila sin `erp_movimiento_id` es un intento
      // visible que se puede reintentar.
      /* ── QUIEN SE LLEVA EL EFECTIVO ─────────────────────────────────────
       *
       * El vale es el de un solo uso de `identidad_vales` —cinco minutos, un
       * consumo, verificado contra la persona— y lo consume el SERVIDOR, que es
       * el unico que lo puede comprobar. El navegador solo lo transporta y
       * nunca ve el secreto con el que se emitio.
       *
       * Se consume ANTES de escribir nada: si la identidad no se puede probar,
       * no hay movimiento y no se mueve un centavo. Al reves —escribir y
       * comprobar despues— dejaria plata salida a nombre de nadie.
       *
       * `metodo` sale del vale y no del cuerpo del pedido: es el vale el que
       * sabe si fue carne o contrasena, y dejar que lo diga el navegador
       * permitiria escribir «carne» sobre una comprobacion que fue de otra
       * clase. */
      let recibidoPor: string | null = null;
      let recibidoMetodo: string | null = null;
      if (!esEntrada && body.recibido_por) {
        const { data: metodo, error: errVale } = await supabase
          .rpc("consumir_vale_de_identidad", {
            p_vale: body.vale ?? null, p_persona: String(body.recibido_por),
          });
        if (errVale) {
          console.error(`[operar-caja] salida sala=${sala}: identidad: ${errVale.message}`);
          return json({ ok: false, error: errVale.message }, 403);
        }
        recibidoPor = String(body.recibido_por);
        recibidoMetodo = metodo ? String(metodo) : null;
      }

      const { data: fila, error: errFila } = await supabase
        .from("caja_movimientos_portal")
        .insert({
          branch_id: sala, tipo: esEntrada ? "ENTRADA" : "SALIDA",
          monto: Number(dosDecimales(monto)), concepto,
          /* El concepto COMPLETO, sin el recorte a 50 que exige el campo del
           * sistema de la caja. `concepto` es lo que se pudo MANDAR allá;
           * esto es lo que se ESCRIBIÓ. Son dos verdades distintas, y hasta el
           * 2026-09-02 se guardaba sólo la primera: la remesa de $50 de Salud 4
           * quedó como «… · MONEYGRAM · PAGO D», cortada a la mitad de la nota.
           *
           * Se guarda sólo si dice MÁS que el recortado: si son iguales, dos
           * copias del mismo texto no agregan nada y `null` deja claro que no
           * hubo nada que recortar. */
          detalle: body.detalle && String(body.detalle).trim() !== concepto
            ? String(body.detalle).trim().slice(0, 500)
            : null,
          /* QUÉ fue, además de cuánto. El concepto sigue siendo texto libre —es
           * el detalle: «Neurobion 25000»— y el tipo es lo que se puede sumar.
           * Sin él, la aplicación de inyección estaba escrita de quince maneras
           * y nadie podía decir cuánto entró por aplicaciones en un mes.
           *
           * La FK lo valida: un código inventado hace fallar el INSERT antes de
           * que el dinero se mueva, que es el orden correcto. `null` sigue
           * siendo válido y es lo que tienen las filas viejas. */
          tipo_codigo: body.tipo ? String(body.tipo).slice(0, 40) : null,
          numero_boleta: body.boleta ? String(body.boleta).slice(0, 40) : null,
          foto_url: body.foto_url ? String(body.foto_url) : null,
          // Las dos mitades de «quien recibio», y nunca las dos a la vez: o se
          // comprobo con carne, o se escribio un nombre porque el receptor no
          // es de la casa.
          recibido_por: recibidoPor,
          recibido_metodo: recibidoMetodo,
          recibido_texto: !esEntrada && !recibidoPor && body.recibe
            ? String(body.recibe).slice(0, 60) : null,
          fecha: diaAbierto, erp_apertura_id: Number(estado.aper),
          registrado_por: quien.id,
        })
        .select("*").single();
      if (errFila) throw new Error(`guardando el movimiento: ${errFila.message}`);

      let abono: Record<string, unknown> | null = null;
      if (esAbono) {
        const { data: fa, error: errAbono } = await supabase
          .from("abonos_de_cliente")
          .insert({
            folio, branch_id: sala, fecha: diaAbierto,
            cliente_erp_id: body.cliente_erp_id ? Number(body.cliente_erp_id) : null,
            cliente_nombre: cliente, cliente_telefono: telefono,
            total: total != null && Number.isFinite(total) ? Number(dosDecimales(total)) : null,
            abonado: Number(dosDecimales(monto)),
            renglones, vence_el: venceEl,
            anotado_por: quien.id, movimiento_ingreso_id: fila.id,
          })
          .select("*").single();
        // Si el abono no se puede escribir, el dinero TODAVÍA no entró a la
        // caja: se para acá y queda sólo el intento del movimiento, que es
        // visible y sin plata movida. Seguir daría un ingreso sin contrato —el
        // caso que este circuito existe para que no pase.
        if (errAbono) {
          console.error(`[operar-caja] abono sala=${sala} folio=${folio}: ${errAbono.message}`);
          return json({ ok: false, error: "No se pudo guardar el abono. No se movio dinero." }, 500);
        }
        abono = fa;
      }

      // El concepto lleva el número del portal adelante: es lo único que ata
      // las dos filas cuando alguien mira del otro lado, y el campo trunca a 50.
      const conceptoCaja = `P${fila.id} ${concepto}`.slice(0, 50);
      const resp = await (await fetch(esEntrada ? INGRESO : SALIDA, {
        method: "POST",
        headers: {
          Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: new URLSearchParams(esEntrada
          ? {
            process: "ingreso", id_apertura: estado.aper!, id_empleado: estado.emp!,
            turno: estado.turno!, monto: dosDecimales(monto),
            concepto: conceptoCaja, id_tipo: ID_TIPO,
            /* El código de vendedor sale de QUIEN ESTÁ ADENTRO, no de un campo
             * (pedido del usuario, 31-ago). Era el único dato del formulario que
             * pedía teclear algo que el portal ya sabe, y un campo así se
             * escribe mal o se deja vacío: en los dos casos el ingreso queda a
             * nombre de nadie.
             *
             * Sale de la sesión y no del cuerpo del pedido a propósito — si
             * viajara desde el navegador, cualquiera podría anotar un ingreso a
             * nombre de otra persona.
             *
             * Va vacío cuando la ficha no tiene código: el sistema lo acepta así
             * (probado el 28-ago con el campo en blanco), y es preferible a
             * inventar un número que podría ser el de otra persona. */
            codigo_vendedor: String(quien.code ?? ""),
          }
          : {
            process: "salida", id_apertura: estado.aper!, id_empleado: estado.emp!,
            turno: estado.turno!, monto: dosDecimales(monto), concepto: conceptoCaja,
            proveedor: "", tipo_doc: "", n_doc: String(body.boleta ?? ""),
            // «Recibe» es un campo de SU formulario y lo escribe una persona: es
            // quien se llevó el efectivo. Antes iba «PORTAL», que dice quién lo
            // tecleó y no quién lo recibió — justo el dato que el papel existe
            // para conservar.
            recibe: String(body.recibe ?? "").slice(0, 60), id_tipo: ID_TIPO,
          }).toString(),
        signal: AbortSignal.timeout(45_000),
      })).text();

      if (!exito(resp)) {
        console.error(`[operar-caja] ${accion} sala=${sala} fila=${fila.id}: ${resp.slice(0, 1000)}`);
        return json({
          ok: false, movimiento_del_portal: fila.id,
          error: "La caja no aceptó el movimiento. Vuelve a intentarlo; si sigue igual, avisa a Sistemas.",
        }, 502);
      }
      let idMov: number | null = null;
      try { idMov = Number(JSON.parse(resp)?.id_mov) || null; } catch { idMov = null; }
      const { error: errLigar } = await supabase.from("caja_movimientos_portal")
        .update({ erp_movimiento_id: idMov, updated_at: new Date().toISOString() })
        .eq("id", fila.id);
      // El movimiento ya ocurrió en la caja. Si no se pudo ligar, el portal
      // tiene la fila sin el número del sistema: se puede reintentar, pero
      // alguien tiene que enterarse.
      if (errLigar) {
        return json({ ok: true, movimiento_del_portal: fila.id, movimiento_en_caja: idMov, abono,
          aviso: "El movimiento se hizo, pero no se pudo enlazar con el del sistema." });
      }

      // El abono viaja de vuelta ENTERO: el comprobante se arma con la fila que
      // quedó escrita —con su folio y su vencimiento—, no con lo que el
      // navegador creía que estaba mandando. Si los dos difieren, el papel
      // tiene que decir lo que dice la base.
      // `fila` entera: el comprobante se arma con lo que QUEDÓ ESCRITO —su
      // número, su fecha, su boleta—, no con lo que el formulario creía estar
      // mandando. Mismo criterio que el papel del abono.
      return json({ ok: true, movimiento_del_portal: fila.id, movimiento_en_caja: idMov, abono,
        movimiento: fila });
    }

    // ── CERRAR EL DÍA ───────────────────────────────────────────────────────
    //
    // La rama va con su `if` EXPLÍCITO y no de cola: cerrar no se deshace, y
    // ser el final del `try` la convertía en lo que pasa cuando ninguna otra
    // coincide. Ver el comentario de la lista de acciones.
    //
    // NO se cierra sin al menos un corte del día (regla del usuario, 30-ago).
    // El cierre emite el Z, y un día que cierra sin haber cortado deja el
    // efectivo de toda la jornada sin haberse contado ni una vez: la diferencia
    // ya no se puede atribuir a ningún turno, y el Z no se deshace.
    //
    // El corte se cuenta del DÍA QUE LA CAJA TIENE ABIERTO —no de hoy—: una
    // caja que quedó abierta pasada la medianoche sigue en su día, y pedirle un
    // corte «de hoy» le exigiría cortar dos veces.
    if (accion !== "cerrar") return json({ ok: false, error: "Acción desconocida." }, 400);

    {
      // La lista ya se leyó arriba, con su error tratado como error.
      /* CONFIRMADO, no sólo hecho (regla del usuario, 1-sep): «que se cierre
       * caja si se confirma el corte, no al hacer el corte, ya que si fue
       * prueba el corte no es final».
       *
       * Pedía sólo que existiera un corte de tipo C, y un corte se puede
       * DESCARTAR —es la salida para un conteo mal hecho—. Pasó el 1-sep en
       * Salud 3: se hizo un corte de prueba, se descartó, y el cierre quedaba
       * habilitado igual. Cerrar sobre un conteo que nadie firmó deja el
       * efectivo del día sin contar ni una vez, y el cierre no se deshace. */
      const confirmados = (cortesDelDia ?? []).filter((c) => c.tipo === "C" && c.estado === "CONFIRMADO");
      if (!confirmados.length) {
        const hechos = (cortesDelDia ?? []).filter((c) => c.tipo === "C").length;
        return json({
          ok: false,
          error: hechos
            ? "El corte de esta caja todavía no está confirmado. Confírmalo antes de cerrar: "
              + "un corte descartado o sin revisar no cuenta, y el cierre no se deshace."
            : "Esta caja no tiene ningún corte del día. Haz el corte antes de cerrar: "
              + "si cierras ahora, el efectivo de toda la jornada queda sin contar y el cierre no se deshace.",
        }, 409);
      }
    }

    const resp = await (await fetch(APERTURA, {
      method: "POST",
      headers: {
        Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: new URLSearchParams({ process: "cerrar_turno", id_apertura: estado.aper! }).toString(),
      signal: AbortSignal.timeout(45_000),
    })).text();

    if (!exito(resp)) {
      console.error(`[operar-caja] cerrar sala=${sala}: ${resp.slice(0, 1000)}`);
      return json({ ok: false, error: "La caja no aceptó el cierre. Vuelve a intentarlo; si sigue igual, avisa a Sistemas." }, 502);
    }

    /* ── ¿Salió el Z? Se COMPRUEBA, no se supone ──────────────────────────
     *
     * El cierre del turno es lo que emite el Z, y hasta el 31-ago el portal
     * daba por hecho que había salido: contestaba `cerrada: true` con sólo
     * mirar que la caja aceptara la petición.
     *
     * Se agrega por lo que enseñó el primer corte hecho desde el portal ese
     * mismo día: el formulario del corte trae `tipo_corte` con **X** marcado
     * por defecto, el portal lo reenviaba tal cual, y salió una LECTURA en vez
     * de un corte de efectivo. Nadie se enteró en el momento —la respuesta
     * decía «success»— y encima el X quedó invisible, porque `sync-cortes-caja`
     * sólo guarda C y Z. O sea: el tipo de documento que sale del otro lado no
     * es algo que se pueda dar por sabido, y el cierre es el acto donde menos
     * se puede, porque no se deshace.
     *
     * Se lee el listado del origen y no `cortes_caja`: la tabla del portal se
     * llena con el sync, que corre después, así que preguntarle recién cerrado
     * diría «no hay Z» siempre. Y si la comprobación falla, el cierre YA ocurrió
     * — se contesta `ok: true` con el aviso, nunca un error que invite a
     * cerrar de nuevo. */
    /* ── EL ESPEJO SE CIERRA ACÁ MISMO ───────────────────────────────────
     *
     * `cortes_caja_aperturas` es lo que ahora contesta «¿está abierta?» —la
     * pantalla dejó de raspar el panel para pintarse (`caja_estado`)— y quien
     * lo mantiene es un barrido cada 30 minutos. Sin esta línea, la sala que
     * acaba de cerrar el día vería «Abierta» hasta media hora después, y el
     * cierre es justo el momento en que se mira la pantalla para comprobar que
     * pasó.
     *
     * Abrir no necesita su gemela: con la caja figurando cerrada, el portal le
     * pregunta al origen igual (ver `hayQuePreguntarleAlOrigen`). Cerrar sí,
     * porque ahí el espejo dice «abierta» y esa respuesta no se revalida.
     *
     * El error se registra y NO corta: la caja YA cerró, y devolver un fallo
     * acá invitaría a cerrar de nuevo sobre un día que ya emitió su Z. */
    {
      const { error: errEspejo } = await supabase.from("cortes_caja_aperturas")
        .update({ cerrada_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("branch_id", sala).eq("erp_apertura_id", Number(estado.aper))
        .is("cerrada_at", null);
      if (errEspejo) console.error(`[operar-caja] cerrando el espejo sala=${sala}: ${errEspejo.message}`);
    }

    let zEmitido: boolean | null = null;
    try {
      const listado = await (await fetch(CORTE_URL, {
        method: "POST",
        headers: {
          Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: new URLSearchParams({ process: "ok", fecha1: diaAbierto, fecha2: diaAbierto }).toString(),
        signal: AbortSignal.timeout(45_000),
      })).text();
      zEmitido = [...listado.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].some(([, tr]) => {
        const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
          .map((m) => m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
        return tds.length >= 8 && tds[5].toUpperCase() === "Z";
      });
    } catch (e) {
      console.error("operar-caja: no se pudo comprobar el Z:", e);
    }

    return json({
      ok: true, cerrada: true, z: zEmitido,
      aviso: zEmitido === false
        ? "La caja cerró, pero no aparece el corte Z del día. Hay que revisarlo antes de que se cierre el mes."
        : zEmitido === null
          ? "La caja cerró, pero no se pudo comprobar que saliera el corte Z."
          : undefined,
    });
  } catch (e) {
    console.error("operar-caja:", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error)?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
