import { createClient } from "npm:@supabase/supabase-js@2";
import {
  getCorsHeaders, getErpBranchMap, permisoDeModulo, requireActiveEmployeeUser,
} from "../_shared/security.ts";
import { hora12 } from "../_shared/hora.ts";

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

/** Para no confundir nunca el entorno de pruebas con producción. */
const REF_PRODUCCION = "sacecdkdmsdvgqnrsett";

/** El único tipo ejercido de verdad (28-ago, movimiento 43260). */
const ID_TIPO = "1";

function getCortesCreds(): { username: string; password: string } {
  const raw = Deno.env.get("ERP_CORTES_CREDS");
  if (!raw) throw new Error("ERP_CORTES_CREDS secret no configurado.");
  return JSON.parse(raw);
}

/**
 * La lectura del comprobante, acotada antes de guardarla.
 *
 * Viene de afuera —es la respuesta de un modelo— así que el tamaño no está bajo
 * control de nadie. Si no cabe se guarda el VEREDICTO y se dice que se recortó,
 * en vez de dejar `null`: «no hubo lectura» y «la lectura no cupo» son cosas
 * distintas y sólo una de las dos es un defecto de esta función. Y nunca hace
 * fallar el movimiento: es auditoría, y el dinero ya se movió.
 */
const TOPE_LECTURA = 20_000
function lecturaParaGuardar(cruda: unknown): Record<string, unknown> | null {
  if (!cruda || typeof cruda !== "object") return null
  const l = cruda as Record<string, unknown>
  try {
    if (JSON.stringify(l).length <= TOPE_LECTURA) return l
  } catch { /* referencias cíclicas: cae al resumen */ }
  return {
    recortada: true,
    veredicto: l.veredicto ?? null,
    montoConfianza: l.montoConfianza ?? null,
    monto: (l.leido as Record<string, unknown> | undefined)?.monto ?? null,
  }
}

/**
 * De dónde salió el monto que se está guardando.
 *
 * Lo DERIVA el servidor y no lo declara el navegador: una marca de auditoría
 * que el cliente puede elegir no es una marca, es una opinión. Acá ya están las
 * dos piezas —lo que el lector contestó y lo que finalmente se guarda—, así que
 * la respuesta sale de compararlas.
 *
 * Regla del usuario (2026-09-05): «si no está seguro el resultado, debe decirlo
 * y permitir poner el monto manualmente y marcarlo». Esto es el marcarlo.
 *
 * `FOTO_SIN_CONFIRMAR` existe porque no alcanza con separar «lo leyó la
 * máquina» de «lo escribió alguien»: un total que el papel imprime UNA sola vez
 * lo leyó la máquina y no lo respalda nadie más, y ése es justo el caso donde un
 * dígito mal leído pasa sin que nada lo note.
 *
 * `FOTO_COTEJADA` (2026-10-20): el formulario ya no deja anotar un monto sin
 * comprobar sin que la persona marque «lo comparé con el papel». Es la única
 * parte que SÍ declara el navegador, porque es una declaración de una persona y
 * no un cálculo: queda firmada por `registrado_por`. Sólo se acepta donde tiene
 * sentido —monto igual al leído y sin confirmar—; en cualquier otro caso se
 * ignora y manda la comparación.
 */
function origenDelMonto(lectura: unknown, montoGuardado: number, cotejado = false): string | null {
  if (!lectura || typeof lectura !== "object") return null
  const l = lectura as Record<string, unknown>
  const leido = Number((l.leido as Record<string, unknown> | undefined)?.monto)
  if (!Number.isFinite(leido)) return "A_MANO"
  // Medio centavo: por debajo de eso es ruido de coma flotante, no una
  // diferencia que alguien haya tecleado.
  if (Math.abs(leido - montoGuardado) >= 0.005) return "A_MANO"
  if (l.montoConfianza === "CONFIRMADO") return "FOTO_CONFIRMADA"
  return cotejado ? "FOTO_COTEJADA" : "FOTO_SIN_CONFIRMAR"
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

/**
 * ¿Ya salió el corte Z de ese día en esta sala?
 *
 * Se le pregunta al ORIGEN y no a `cortes_caja`: la tabla del portal se llena
 * con la captura, que corre después, así que recién cerrado diría «no hay Z»
 * siempre. Medido: La Popular cerró su día a las 19:03:40 del 3-sep y la caja se
 * volvió a abrir a las **19:04:13** — treinta y tres segundos, con el Z ya
 * emitido y todavía sin llegar al portal.
 *
 * `null` = no se pudo comprobar, que NO es «no hay». Quien llama decide: el
 * cierre lo dice como aviso; la apertura, que es lo que hay que frenar, no
 * abre a ciegas.
 */
async function hayZdelDia(cookie: string, dia: string): Promise<boolean | null> {
  try {
    const listado = await (await fetch(CORTE_URL, {
      method: "POST",
      headers: {
        Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: new URLSearchParams({ process: "ok", fecha1: dia, fecha2: dia }).toString(),
      signal: AbortSignal.timeout(45_000),
    })).text();
    return [...listado.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].some(([, tr]) => {
      const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
        .map((m) => m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
      return tds.length >= 8 && tds[5].toUpperCase() === "Z";
    });
  } catch (e) {
    console.error("operar-caja: no se pudo comprobar el Z:", e);
    return null;
  }
}

const dosDecimales = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const exito = (t: string) => /"typeinfo"\s*:\s*"Success"/i.test(t);

/**
 * **Cuántos BILLETES hay en el cajón ahora.** Otra pregunta que «Monto
 * Registrado», y la que decide de dónde sale una salida de efectivo.
 *
 * La cuenta NO vive acá: la hace `caja_efectivo_piezas` en la base, y esta
 * función sólo la pide. Es a propósito — `caja_estado` contesta lo mismo por su
 * cuenta cuando la pantalla entra sin raspar el origen, y dos copias de esta
 * aritmética son dos respuestas distintas sobre el mismo cajón.
 *
 * ── Qué le pasa a esa función, y por qué la apertura y no `registrado` ─────
 * El «Monto Registrado» del panel es apertura más las ventas FINALIZADAS del
 * día —medido el 3-sep contra las seis salas, exacto al centavo— y **no cuenta
 * las entradas ni las salidas del cajón**: el residuo de esa medición dio
 * exactamente `entradas − salidas`.
 *
 * O sea que restarle las ventas que no fueron en efectivo dejaba fuera todo lo
 * que el cajón recibe o entrega sin vender: una aplicación de inyección, una
 * prueba de glucosa, el pago de un recibo, un abono a un crédito, una compra
 * urgente. Reportado desde la sala el 4-sep sobre un ingreso de $1.00 que el
 * portal no sumaba. Por eso ahora se manda la APERTURA y la función arma la
 * cuenta con sus piezas:
 *
 *     apertura + ventas en efectivo + ingresos − vales − lo que quedó en bolsas
 *
 * Nada de esto escribe una diferencia en ningún lado: es para decidir de dónde
 * sale la plata, no para corregirle el corte al origen —eso se decidió dejarlo
 * como está—.
 *
 * Vive en el servidor y no en la pantalla porque con llave de servicio no
 * depende del permiso de quien mira: el alcance de `cortes_caja` lo tienen 9 de
 * 24 cargos, y sin él las consultas devuelven cero filas **sin error**, o sea
 * un cajón que parece lleno.
 *
 * Devuelve las piezas además del total: un número que decide dónde está el
 * dinero tiene que poder auditarse sin volver a correr la cuenta — y desde el
 * 4-sep además se MUESTRAN, renglón por renglón, en el panel del día.
 */
async function efectivoEnElCajon(
  // deno-lint-ignore no-explicit-any
  supabase: any, sala: number, dia: string, apertura: number | null,
) {
  /* Las piezas se suman EN LA BASE y no bajando las filas para sumarlas acá.
   * Lo levantó `gate:data` como `sin-paginar` y tenía razón: PostgREST trunca
   * en 1000 filas sin avisar, así que el día que una sala cruce las mil
   * facturas el descuento saldría de menos y el cajón parecería tener MÁS de lo
   * que tiene — la dirección peligrosa. Medido: el máximo por sala y día son
   * 273, o sea que el defecto habría vivido callado hasta el día que sí. */
  const { data, error } = await supabase
    .rpc("caja_efectivo_piezas", {
      p_branch_id: sala, p_dia: dia, p_apertura: apertura ?? 0,
    });

  /* Un error NO se lee como cero. Sin la cuenta, el cajón parecería tener todo
   * lo del día: es la regla de las edge functions —nunca ignorar el `error`— y
   * acá el precio sería mandar a alguien a sacar billetes que no están. Sin
   * poder medirlo, `efectivo: null`, y `null` no es cero: la salida cae a las
   * bolsas, que es lo que se hacía siempre. */
  if (error || !data) {
    console.error(`[operar-caja] efectivo sala=${sala} dia=${dia}: ${error?.message ?? "sin datos"}`);
    return { efectivo: null };
  }

  return {
    efectivo: Number(dosDecimales(Number(data.efectivo ?? 0))),
    efectivo_piezas: data,
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
      const que = String(body.que ?? "");          // 'ANULAR' | 'MONTO' | 'FORMA'
      const motivo = String(body.motivo ?? "").trim();
      if (!Number.isFinite(movId)) return json({ ok: false, error: "Falta el movimiento." }, 400);
      if (!["ANULAR", "MONTO", "FORMA"].includes(que)) return json({ ok: false, error: "Falta qué corregir." }, 400);
      if (motivo.length < 5) return json({ ok: false, error: "Escribe el motivo." }, 400);

      // El movimiento se RELEE de la base, no se recibe: el navegador manda un
      // id y nada más, así que no puede pedir una corrección sobre un monto que
      // él mismo inventó.
      const { data: mov, error: errMov } = await supabase
        .from("caja_movimientos_portal")
        .select("id, branch_id, tipo, monto, concepto, erp_movimiento_id, anulado_at, bolsa_operacion_id, forma_pago, comprobante_total")
        .eq("id", movId).maybeSingle();
      if (errMov) throw new Error(`leyendo el movimiento: ${errMov.message}`);
      if (!mov) return json({ ok: false, error: "Ese movimiento no existe." }, 404);
      if (mov.anulado_at) return json({ ok: false, error: "Ese movimiento ya está anulado." }, 409);
      // Con permiso de UNA sala, sólo los movimientos de la propia (2026-10-02).
      // El movimiento se relee de la base, pero nadie comparaba SU sala con la
      // de quien pide: se podía pedir la corrección de un movimiento de otra
      // sucursal. Mismo hueco que `pedir_correccion` en creditos-erp.
      if (!permiso.alcanceTodo && Number(permiso.emp?.branch_id) !== Number(mov.branch_id)) {
        return json({ ok: false, error: "Ese movimiento es de otra sala." }, 403);
      }
      /* La parte del cajón de una salida que salió primero de una bolsa no se
       * corrige de monto: el vale dice «$130 de la bolsa + $20 de la caja», y
       * cambiar una mitad deja un vale que no suma. Se anula ENTERA (y al
       * aprobarse se anulan las dos partes) y se vuelve a registrar. */
      if (mov.bolsa_operacion_id && que === "MONTO") {
        return json({ ok: false, error: "Ese movimiento es la parte de la caja de una salida que también sacó de una bolsa: no se le cambia el monto, se anula entera y se vuelve a registrar." }, 409);
      }

      /* ── Cambiar CÓMO se pagó (2026-10-17) ──────────────────────────────
       *
       * No es un rótulo: decide si el dinero está en el cajón. De efectivo a
       * tarjeta el ingreso SALE de la caja; de tarjeta a efectivo ENTRA. Por
       * eso va por la misma aprobación que anular, y lo que la sala no puede
       * hacer sola es exactamente eso: mover dinero del esperado.
       *
       * Pasarlo a tarjeta o transferencia exige la foto del comprobante: es
       * lo que quien decide mira, y sin ella se estaría sacando del cajón
       * dinero que nadie prueba que llegó por otra vía. */
      /* El monto nuevo se valida AL PEDIR y no recién al aplicar: una solicitud
       * imposible llegaba a la bandeja, alguien la aprobaba, y fallaba ahí. Y
       * un cobro con tarjeta no puede pasar de su voucher (2026-10-17). */
      if (que === "MONTO") {
        const n = Number(body.monto_nuevo);
        if (!(Number.isFinite(n) && n > 0)) return json({ ok: false, error: "Falta el monto correcto." }, 400);
        if (mov.comprobante_total != null && n > Number(mov.comprobante_total) + 0.004) {
          return json({ ok: false, error: `El comprobante es por $${Number(mov.comprobante_total).toFixed(2)}: el ingreso no puede pasar de eso.` }, 400);
        }
      }

      let formaNueva: string | null = null;
      if (que === "FORMA") {
        formaNueva = String(body.forma_nueva ?? "").toUpperCase();
        if (!["EFECTIVO", "TARJETA", "TRANSFERENCIA"].includes(formaNueva)) {
          return json({ ok: false, error: "Falta la forma de pago correcta." }, 400);
        }
        if (mov.tipo !== "ENTRADA") {
          return json({ ok: false, error: "Una salida siempre es efectivo: lo que se puede cambiar es el monto, o anularla." }, 409);
        }
        if (formaNueva === String(mov.forma_pago ?? "EFECTIVO")) {
          return json({ ok: false, error: "Ese ingreso ya está con esa forma de pago." }, 409);
        }
        if (formaNueva !== "EFECTIVO" && !String(body.foto_url ?? "").trim()) {
          return json({ ok: false, error: "Para pasarlo a tarjeta o transferencia sube la foto del comprobante." }, 400);
        }
      }

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
          // Cómo se pagó, antes y después. Sólo con `FORMA`, pero `forma_actual`
          // siempre: anular un cobro con tarjeta no le quita nada al cajón, y
          // quien decide tiene que saberlo.
          forma_actual: mov.forma_pago ?? "EFECTIVO",
          ...(formaNueva ? {
            forma_nueva: formaNueva,
            foto_nueva: formaNueva !== "EFECTIVO" ? String(body.foto_url).trim() : null,
            comprobante_total_nuevo: formaNueva !== "EFECTIVO" && Number(body.comprobante_total) > 0
              ? Number(body.comprobante_total) : null,
            numero_nuevo: formaNueva !== "EFECTIVO" ? (String(body.boleta ?? "").trim().slice(0, 40) || null) : null,
          } : {}),
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

    /* ── LA CAJA SIMULADA DEL ENTORNO DE PRUEBAS ───────────────────────────
     *
     * El branch de pruebas NO tiene las credenciales de la caja real, a
     * propósito: un ingreso anotado ahí no puede caer en el cajón de una sala
     * de verdad. Sin ellas, esta función moría al primer `getCortesCreds` y la
     * pantalla de caja no se podía ni abrir — o sea que nada de lo que pasa al
     * anotar un ingreso se podía probar antes de producción.
     *
     * Dos condiciones, y las dos hacen falta: que falte la credencial Y que la
     * base no sea la de producción. Si un día producción pierde el secreto, la
     * segunda condición hace que falle como siempre en vez de «anotar» en una
     * caja de mentira — que sería plata que el portal cree en el cajón y la
     * caja nunca vio.
     *
     * Simula sólo MIRAR y anotar un INGRESO. Abrir, cortar, cerrar o sacar
     * plata se rechazan: no hay nada que probar ahí sin la caja de verdad. */
    const cajaSimulada = !Deno.env.get("ERP_CORTES_CREDS")
      && !String(Deno.env.get("SUPABASE_URL") ?? "").includes(REF_PRODUCCION);
    // Corregir también (2026-10-17): pedir y aplicar una corrección sobre un
    // ingreso de prueba no toca nada real, y es justo lo que hay que poder
    // probar del cobro con tarjeta.
    // Y el vale del retiro de lo apartado (2026-10-20): es la salida que hay
    // que poder probar del retiro al contado.
    const valeDeRetiro = accion === "salida" && String(body.tipo ?? "") === "APLICA_ANTICIPO";
    if (cajaSimulada && !valeDeRetiro && !["estado", "ingreso", "corregir", "aplicar_correccion"].includes(accion)) {
      return json({ ok: false, error: "En el entorno de pruebas la caja es simulada: sólo se puede mirar, anotar ingresos y corregirlos." }, 409);
    }

    let cookie = "";
    let estado: Awaited<ReturnType<typeof estadoDeLaCaja>>;
    let entrada = { branchId: sala, erpId: 0, username: "", password: "" } as ReturnType<typeof getErpBranchMap>[number];
    if (cajaSimulada) {
      estado = {
        abierta: true, turnoCorriendo: true, idCaja: "PRUEBAS", idDetalle: null,
        aper: "0", emp: "0", turno: "1", idEmple: "0",
        registrado: null, apertura: 0, desde: null,
      };
    } else {
      const deLaSala = getErpBranchMap().find((e) => e.branchId === sala);
      if (!deLaSala) return json({ ok: false, error: "Esa sala no está configurada." }, 400);
      entrada = deLaSala;
      const { username, password } = getCortesCreds();
      cookie = await getSessionCookie(username, password);
      await abrirSala(cookie, entrada.erpId);
      estado = await estadoDeLaCaja(cookie);
    }

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
      const apertura = (estado as { apertura?: number | null }).apertura ?? null;
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
        apertura,
        quien: quienAbrio,
        desde: (estado as { desde?: string | null }).desde ?? null,
        dia: diaAbierto,
        cortes: cortesDelDia ?? [],
        // Cuántos BILLETES hay, que es otra pregunta. Ver `efectivoEnElCajon`.
        // Va la APERTURA y no `registrado`: la cuenta del cajón se arma pieza
        // por pieza —apertura, ventas en efectivo, ingresos, vales, bolsas— y
        // `registrado` ya trae las dos primeras mezcladas con la tarjeta.
        ...(await efectivoEnElCajon(supabase, sala, diaAbierto, apertura)),
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
      // Y quien decide, sólo sobre su sala si su permiso es de una (2026-10-02).
      // Lo de arriba sólo comparaba contra la `sala` que manda el navegador.
      // Hoy deciden sólo cargos de red: está para el día que no.
      if (!permiso.alcanceTodo && Number(permiso.emp?.branch_id) !== Number(meta.branch_id)) {
        return json({ ok: false, error: "Esa corrección es de otra sala." }, 403);
      }

      const { data: mov, error: errMov } = await supabase
        .from("caja_movimientos_portal")
        .select("id, tipo, monto, concepto, erp_movimiento_id, anulado_at, bolsa_operacion_id, forma_pago, erp_apertura_id, registrado_por, autorizacion, reserva_id, encargo_id")
        .eq("id", Number(meta.movimiento_portal)).maybeSingle();
      if (errMov) throw new Error(`leyendo el movimiento: ${errMov.message}`);
      if (!mov) return json({ ok: false, error: "Ese movimiento ya no existe." }, 404);
      if (mov.anulado_at) return json({ ok: false, error: "Ese movimiento ya está anulado." }, 409);
      // Sin el número del sistema no hay qué corregir del otro lado: la fila del
      // portal es un intento que nunca llegó a la caja. Decirlo es mejor que
      // marcar la solicitud como aplicada sobre algo que no está.
      /* Un ingreso con tarjeta o transferencia NUNCA fue a la caja, a propósito
       * (2026-10-17): se corrige sólo en el portal. Sin esto, anular un cobro
       * con tarjeta anotado de más era imposible. */
      const formaAntes = String(mov.forma_pago ?? "EFECTIVO");
      const soloPortal = formaAntes !== "EFECTIVO";
      if (!soloPortal && !cajaSimulada && !mov.erp_movimiento_id) {
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

      /* Si quedaba una autorización viva sobre este ingreso, deja de tener
       * objeto: anulado, o pasado a efectivo, ya no hay comprobante que
       * esperar. Se CANCELA —no se rechaza: nadie dijo que no— y el ingreso
       * queda sin autorización pendiente. */
      const cancelarAutorizacion = async (porque: string) => {
        if (mov.autorizacion !== "PENDIENTE") return;
        const { error: errCanc } = await supabase.from("approval_requests")
          .update({ status: "CANCELLED", approver_note: porque, updated_at: new Date().toISOString() })
          .eq("type", "CAJA_INGRESO_AUTORIZACION").eq("status", "PENDING")
          .eq("metadata->>movimiento_portal", String(mov.id));
        if (errCanc) console.error(`[operar-caja] cancelar autorizacion mov=${mov.id}: ${errCanc.message}`);
        const { error: errMovAut } = await supabase.from("caja_movimientos_portal")
          .update({ autorizacion: null, autorizacion_solicitud: null, updated_at: new Date().toISOString() })
          .eq("id", mov.id);
        if (errMovAut) console.error(`[operar-caja] limpiar autorizacion mov=${mov.id}: ${errMovAut.message}`);
      };

      // Cierra la solicitud de corrección como APROBADA, firmada.
      const cerrarSolicitud = () => supabase.from("approval_requests")
        .update({
          status: "APPROVED", approver_id: quien.id,
          approver_note: String(body.approver_note ?? "").slice(0, 500) || null,
          approvals: [...(Array.isArray(sol.approvals) ? sol.approvals : []), {
            level: 1, approverId: quien.id, approvedAt: new Date().toISOString(),
            approverNote: String(body.approver_note ?? "") || null,
          }],
          updated_at: new Date().toISOString(),
        })
        .eq("id", sol.id).eq("status", "PENDING");

      /* ── CAMBIAR LA FORMA DE PAGO ───────────────────────────────────────
       *
       * Tres casos, y sólo dos tocan la caja:
       *   efectivo → tarjeta/transferencia: el ingreso SALE de la caja (se borra allá);
       *   tarjeta/transferencia → efectivo: ENTRA a la caja ahora;
       *   tarjeta ↔ transferencia: sólo el portal.
       *
       * Entrar a la caja sólo mientras el DÍA de ese ingreso sigue abierto:
       * meter hoy el efectivo de un día ya cerrado inflaría el esperado de un
       * día que no lo recibió. */
      if (meta.que === "FORMA") {
        const formaNueva = String(meta.forma_nueva ?? "");
        if (!["EFECTIVO", "TARJETA", "TRANSFERENCIA"].includes(formaNueva)) {
          return json({ ok: false, error: "La solicitud no trae una forma de pago válida." }, 400);
        }
        if (String(meta.forma_actual ?? formaAntes) !== formaAntes) {
          return json({ ok: false, error: "Ese ingreso ya cambió de forma de pago desde que se pidió. Recházala y vuelve a pedirla." }, 409);
        }
        if (formaNueva === formaAntes) {
          return json({ ok: false, error: "Ese ingreso ya está con esa forma de pago." }, 409);
        }
        let erpNuevo: number | null | undefined = undefined;
        if (formaAntes === "EFECTIVO") {
          // Sale de la caja.
          if (mov.erp_movimiento_id && !cajaSimulada) {
            const r = await (await fetch(BORRAR, {
              method: "POST",
              headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" },
              body: new URLSearchParams({ process: "eliminar", id_movimiento: String(mov.erp_movimiento_id) }).toString(),
              signal: AbortSignal.timeout(45_000),
            })).text();
            if (!exito(r)) {
              console.error(`[operar-caja] forma mov=${mov.id}: borrar en caja: ${r.slice(0, 1000)}`);
              return json({ ok: false, error: "La caja no aceptó sacar el ingreso. Vuelve a intentarlo; si sigue igual, avisa a Sistemas." }, 502);
            }
          }
          erpNuevo = null;
        } else if (formaNueva === "EFECTIVO") {
          // Entra a la caja, si el día sigue abierto.
          if (!cajaSimulada && String(mov.erp_apertura_id ?? "") !== String(estado.aper ?? "")) {
            return json({ ok: false, error: "El día de ese ingreso ya se cerró: no se puede meter ese efectivo en la caja de hoy. Anúlalo y anótalo de nuevo en el día que corresponde." }, 409);
          }
          if (!cajaSimulada) {
            const { data: autor, error: errAutor } = await supabase.from("employees").select("code").eq("id", mov.registrado_por).maybeSingle();
            // Sin el código el ingreso entraría a nombre de nadie: se frena
            // antes de tocar la caja, que es cuando todavía no se movió nada.
            if (errAutor) {
              console.error(`[operar-caja] forma mov=${mov.id}: autor: ${errAutor.message}`);
              return json({ ok: false, error: "No se pudo leer quién anotó el ingreso. Vuelve a intentarlo." }, 503);
            }
            const r = await (await fetch(INGRESO, {
              method: "POST",
              headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" },
              body: new URLSearchParams({
                process: "ingreso", id_apertura: estado.aper!, id_empleado: estado.emp!,
                turno: estado.turno!, monto: dosDecimales(Number(mov.monto)),
                concepto: `P${mov.id} ${mov.concepto}`.slice(0, 50), id_tipo: ID_TIPO,
                // A nombre de quien lo ANOTÓ, no de quien aprueba: el ingreso es suyo.
                codigo_vendedor: String(autor?.code ?? ""),
              }).toString(),
              signal: AbortSignal.timeout(45_000),
            })).text();
            if (!exito(r)) {
              console.error(`[operar-caja] forma mov=${mov.id}: ingreso en caja: ${r.slice(0, 1000)}`);
              return json({ ok: false, error: "La caja no aceptó el ingreso. Vuelve a intentarlo; si sigue igual, avisa a Sistemas." }, 502);
            }
            try { erpNuevo = Number(JSON.parse(r)?.id_mov) || null; } catch { erpNuevo = null; }
          } else {
            erpNuevo = null;
          }
        }

        const paraEfectivo = formaNueva === "EFECTIVO";
        const { error: errForma } = await supabase.from("caja_movimientos_portal").update({
          forma_pago: formaNueva,
          ...(erpNuevo !== undefined ? { erp_movimiento_id: erpNuevo } : {}),
          ...(paraEfectivo
            ? { comprobante_total: null }
            : {
              ...(meta.foto_nueva ? { foto_url: String(meta.foto_nueva) } : {}),
              ...(meta.comprobante_total_nuevo ? { comprobante_total: Number(meta.comprobante_total_nuevo) } : {}),
              ...(meta.numero_nuevo ? { numero_boleta: String(meta.numero_nuevo) } : {}),
            }),
          updated_at: new Date().toISOString(),
        }).eq("id", mov.id);
        if (errForma) console.error(`[operar-caja] forma mov=${mov.id}: portal: ${errForma.message}`);
        // Con la foto del comprobante —que este pedido exige para salir del
        // efectivo— o pasado a efectivo, ya no hay autorización que esperar.
        await cancelarAutorizacion("Se cambió la forma de pago con una corrección aprobada.");
        const { error: errCerrarForma } = await cerrarSolicitud();
        const avisoForma = errForma
          ? "La caja ya cambió, pero el portal no quedó anotado. Avisa a Sistemas."
          : errCerrarForma ? "Se aplicó, pero la solicitud no quedó marcada como aprobada." : null;
        return json({ ok: true, aplicado: { que: "FORMA", forma: formaNueva, de: formaAntes },
          ...(avisoForma ? { aviso: avisoForma } : {}) });
      }

      const montoNuevo = Number(meta.monto_nuevo);
      if (!anular && !(Number.isFinite(montoNuevo) && montoNuevo > 0)) {
        return json({ ok: false, error: "La solicitud no trae un monto válido." }, 400);
      }

      /* ── La parte del cajón de una salida mixta se anula CON su bolsa ──────
       *
       * «si se anula se anula de ambas» (usuario, 2026-10-02). La pregunta va
       * ANTES de borrar en la caja: si la bolsa ya se entregó, borrar allá y
       * fallar acá dejaría la salida a medio anular — $20 de vuelta en el
       * cajón y $130 todavía descontados de una bolsa. */
      const operacionBolsa = mov.bolsa_operacion_id ? Number(mov.bolsa_operacion_id) : null;
      if (operacionBolsa && !anular) {
        return json({ ok: false, error: "Ese movimiento es la parte de la caja de una salida que también sacó de una bolsa: no se le cambia el monto, se anula entera." }, 409);
      }
      if (operacionBolsa) {
        const { data: motivoNo, error: errNo } = await supabase
          .rpc("bolsa_operacion_no_anulable", { p_operacion_id: operacionBolsa });
        if (errNo) throw new Error(`revisando la parte de la bolsa: ${errNo.message}`);
        if (motivoNo) return json({ ok: false, error: String(motivoNo) }, 409);
      }

      const resp = soloPortal || cajaSimulada ? null : anular
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

      if (resp !== null && !exito(resp)) {
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
      // Anulado, ya no hay comprobante que esperar.
      if (anular && !errPortal) await cancelarAutorizacion("Se anuló el ingreso con una corrección aprobada.");
      /* Un anticipo (2026-10-20): su reserva o su encargo se corrigen con él.
       * Anulado, vuelve a como estaba (una reserva nacida de ese cobro se
       * borra); con otro monto, el anticipo de la reserva se mueve por la
       * diferencia. Falla visible en el registro: el dinero ya se corrigió. */
      if (!errPortal && ((mov as { reserva_id?: number }).reserva_id || (mov as { encargo_id?: number }).encargo_id)) {
        const { error: errAp } = anular
          ? await supabase.rpc("apartado_deshacer", { p_movimiento: mov.id, p_anular: false })
          : await supabase.rpc("apartado_cambiar_monto", { p_movimiento: mov.id, p_antes: Number(mov.monto), p_nuevo: Number(dosDecimales(montoNuevo)) });
        if (errAp) console.error(`[operar-caja] corrección anticipo mov=${mov.id}: ${errAp.message}`);
      }

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

      // La otra mitad. Sólo si la bolsa sigue viva: ya anulada, no hay nada que
      // hacer y no es un error.
      let errBolsa: { message: string } | null = null;
      if (operacionBolsa) {
        const { data: op, error: errOp } = await supabase.from("bolsas_operaciones")
          .select("anulada_at").eq("id", operacionBolsa).maybeSingle();
        errBolsa = errOp;
        if (!errOp && op && !op.anulada_at) {
          const { error } = await supabase.rpc("anular_salida_de_bolsa_desde_caja", {
            p_operacion_id: operacionBolsa,
            p_motivo: (sol as { note?: string }).note || "Anulada junto con su parte de la caja",
            p_por: quien.id,
          });
          errBolsa = error;
        }
        if (errBolsa) {
          console.error(`[operar-caja] corrección mov=${mov.id}: anulando la bolsa ${operacionBolsa}: ${errBolsa.message}`);
        }
      }

      if (errBolsa) {
        return json({ ok: true, aplicado: { que: meta.que, movimiento: mov.id },
          aviso: "La caja se corrigió, pero la parte de la bolsa no se pudo anular. Anúlala desde el detalle de la bolsa o avísale a Sistemas." });
      }
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

      /* ── CON EL Z DEL DÍA HECHO, LA CAJA NO SE VUELVE A ABRIR ───────────
       *
       * Regla del usuario (3-sep): «si ya está el corte Z del día, el abrir
       * caja debe estar deshabilitado hasta mañana». El Z es el cierre FISCAL
       * de la jornada: lo que se venda después queda de un día que ya declaró
       * su total, y eso no se arregla desde el portal.
       *
       * No es hipotético. Esa misma noche La Popular emitió su Z a las 19:03:40
       * y la caja se volvió a abrir a las **19:04:13** — treinta y tres
       * segundos—, con la pantalla ofreciendo el botón porque nada lo impedía.
       *
       * Se le pregunta al ORIGEN: recién cerrado, `cortes_caja` todavía no
       * tiene el Z, así que preguntarle a la base habría dejado pasar
       * exactamente ese caso. Y si NO se pudo comprobar, tampoco se abre:
       * abrir a ciegas después de un cierre es el error que no se deshace, y
       * el que espera cinco minutos y reintenta no pierde nada. */
      const hoySV = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
      const yaCerroElDia = await hayZdelDia(cookie, hoySV);
      if (yaCerroElDia !== false) {
        return json({
          ok: false, dia_cerrado: yaCerroElDia === true,
          error: yaCerroElDia === true
            ? "Esta sala ya cerró el día. La caja se vuelve a abrir mañana."
            : "No se pudo comprobar si el día ya cerró, y no se abre la caja sin saberlo. "
              + "Volvé a intentarlo en un momento.",
        }, 409);
      }

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
      /* ── CON EL Z DEL DÍA HECHO NO SE INICIA UN TURNO ──────────────────────
       *
       * La gemela de la guarda de `abrir`, y hace falta por separado: aquélla
       * cubre la caja cerrada y ésta la apertura que quedó viva después del Z.
       * Un turno iniciado sobre un día ya cerrado no vende ni cuenta nada —lo
       * único que produce son cortes en cero, como el 14451 de La Popular a las
       * 19:39 del 3-sep, turno 6 y todo en $0.00— y encima corre el contador de
       * turnos de un día que ya terminó.
       *
       * `simular` NO se frena: contesta a nombre de quién quedaría, que es una
       * lectura y sigue siendo cierta con el día cerrado. */
      if (body.simular !== true) {
        const hoySV = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
        const yaCerro = await hayZdelDia(cookie, hoySV);
        if (yaCerro === true) {
          return json({
            ok: false, dia_cerrado: true,
            error: "Esta sala ya cerró el día. El turno se inicia mañana, con la caja del día nuevo.",
          }, 409);
        }
      }
      /* `simular` NO se frena con el turno corriendo: lo que contesta es a
       * nombre de quién quedaría, y esa respuesta es la misma esté el turno
       * parado o no. Frenarla acá dejaba la comprobación disponible sólo en el
       * único momento en que ya no hay tiempo de hacerla — medido la noche del
       * 3-sep: las seis salas con el turno corriendo y nada que se pudiera
       * medir hasta el día siguiente. */
      if (!body.simular && (estado as { turnoCorriendo?: boolean }).turnoCorriendo) {
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
      if (!body.simular && suyo.turnoCorriendo) {
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
          turno_corriendo: suyo.turnoCorriendo,
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

    /* ── CERRAR UNA CAJA QUE EL Z YA CERRÓ ES EL FINAL FELIZ, NO UN FALLO ───
     *
     * `cerrarElDia` es Z primero y cierre después, y **el Z ya cierra la
     * apertura en el origen**: cuando llega el tercer paso no queda nada que
     * cerrar. Con el 409 de acá abajo, el día quedaba perfectamente cerrado y
     * la pantalla lo anunciaba en rojo — y quien lo ve vuelve a apretar, que es
     * de donde salieron los reintentos.
     *
     * Medido la noche del 3-sep: las CINCO salas que cerraron terminaron así,
     * con 15 cortes y 18 operaciones rechazadas entre las 19:03 y las 21:22.
     * La Popular apretó ocho veces en cuatro minutos y en el medio se le volvió
     * a abrir la caja (apertura 2903, turno 7, 33 s después de su Z).
     *
     * Se le pregunta al ORIGEN y no a `cortes_caja`: recién emitido el Z, la
     * tabla del portal todavía no lo tiene —la captura corre después—, así que
     * preguntarle a la base contestaría «no hay Z» justo en el único momento en
     * que esta pregunta se hace. Y si no se pudo comprobar, NO se da por
     * cerrado: se cae al 409 de siempre, que es el que pide reintentar. */
    if (accion === "cerrar" && !estado.abierta) {
      const hoySV = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
      if (await hayZdelDia(cookie, hoySV) === true) {
        /* El espejo se marca ACÁ TAMBIÉN, y no sólo en el camino de siempre.
         * Sin esto la fila queda abierta hasta que pase el barrido de media
         * hora, y la tarjeta de la sala dice «Abierta» sobre una caja que
         * acaba de cerrar el día — que es la misma clase de mentira que este
         * arreglo vino a quitar de la otra punta.
         *
         * Se busca por sala y no por `erp_apertura_id`: con la caja ya cerrada
         * el panel no da la apertura, así que `estado.aper` es null. Una sala
         * tiene una sola apertura viva, y si tuviera dos —como La Popular
         * después del reingreso del 3-sep— cerrar las dos es lo que hay que
         * hacer.
         *
         * El error se registra y NO corta: el día ya cerró de verdad, y
         * devolver un fallo acá invitaría a cerrar otra vez. */
        const ahora = new Date().toISOString();
        const { error: errEspejo } = await supabase.from("cortes_caja_aperturas")
          .update({ cerrada_at: ahora, turno_corriendo: false, updated_at: ahora })
          .eq("branch_id", sala).is("cerrada_at", null);
        if (errEspejo) console.error(`[operar-caja] espejo del cierre ya hecho sala=${sala}: ${errEspejo.message}`);
        return json({ ok: true, cerrada: true, ya_estaba: true, z: true });
      }
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
      // `let`: la aplicación de inyección lo recalcula con el precio vigente.
      let monto = Number(body.monto);
      let concepto = String(body.concepto ?? "").trim();
      if (!(Number.isFinite(monto) && monto > 0)) return json({ ok: false, error: "Falta el monto." }, 400);
      if (!esAbono && !concepto) return json({ ok: false, error: "Falta el concepto." }, 400);

      /* ── CÓMO SE PAGÓ (2026-10-17) ───────────────────────────────────────
       *
       * La caja trata todo ingreso como EFECTIVO: lo suma al esperado del
       * corte. Una inyección cobrada con tarjeta y mandada allá nacía como un
       * faltante que no existe. Así que lo que no es efectivo se anota en el
       * portal y NO viaja a la caja — `caja_efectivo_piezas` tampoco lo suma.
       *
       * Una salida siempre es efectivo: sale del cajón. Sin el campo (la app,
       * el abono a un faltante, las pantallas viejas) es efectivo, que es lo
       * que era todo hasta hoy.
       *
       * El comprobante es la prueba. Sin foto el ingreso igual existe, pero
       * queda esperando autorización de quien tenga `requests_caja`: el
       * dinero no está en ningún cajón que alguien pueda contar. */
      const formaPago = esEntrada ? String(body.forma_pago ?? "EFECTIVO").toUpperCase() : "EFECTIVO";
      if (!["EFECTIVO", "TARJETA", "TRANSFERENCIA"].includes(formaPago)) {
        return json({ ok: false, error: "La forma de pago no es válida." }, 400);
      }
      const noEfectivo = formaPago !== "EFECTIVO";
      const sinComprobante = noEfectivo && !String(body.foto_url ?? "").trim();
      const motivoSinComprobante = String(body.motivo_sin_comprobante ?? "").trim();
      if (sinComprobante && motivoSinComprobante.length < 5) {
        return json({ ok: false, error: "Sin foto del comprobante, explica por qué para pedir la autorización." }, 400);
      }
      /* El total del voucher puede ser MAYOR que el ingreso: un voucher de $16
       * cubre $15 de una venta con tarjeta y $1 de una inyección. Lo que sobra
       * lo cuadra `caja_vouchers_del_dia` contra las ventas con tarjeta. */
      let comprobanteTotal: number | null = null;
      if (noEfectivo && body.comprobante_total != null && body.comprobante_total !== "") {
        comprobanteTotal = Number(body.comprobante_total);
        if (!Number.isFinite(comprobanteTotal) || comprobanteTotal <= 0) {
          return json({ ok: false, error: "El total del comprobante no es válido." }, 400);
        }
        if (comprobanteTotal < monto - 0.004) {
          return json({ ok: false, error: "El ingreso no puede ser mayor que el total del comprobante." }, 400);
        }
      }

      /* ── El MISMO envío no escribe dos movimientos ─────────────────────────
       *
       * `clave_envio` la genera el formulario una sola vez y viaja igual en
       * cada reintento de ESE envío. Si ya hay una fila con esa clave, se
       * contesta con ella y no se toca nada más — sobre todo, no se toca la
       * caja, que es lo que deja el dinero contado dos veces.
       *
       * Va ACÁ arriba, antes de cualquier trabajo, por eso mismo.
       *
       * Medido el 2026-09-17: 13 movimientos de más y $377.61 entre el 4 y el
       * 16 de septiembre, con los pares a 34–73 ms y un caso de TRES filas en
       * un segundo. El navegador ya tiene su cerrojo (`utils/unaSolaVez`), pero
       * ése no cubre dos pestañas ni un reintento de red: esto sí. */
      const claveEnvio = String(body.clave_envio ?? "").trim().slice(0, 100) || null;
      if (claveEnvio) {
        const { data: ya, error: errYa } = await supabase
          .from("caja_movimientos_portal")
          .select("*").eq("clave_envio", claveEnvio).maybeSingle();
        // Un fallo de LECTURA no puede frenar el movimiento: se sigue, y el
        // índice único de abajo es el que no deja pasar el duplicado.
        if (errYa) console.error(`[operar-caja] ${accion} clave=${claveEnvio}: ${errYa.message}`);
        if (ya) {
          let abonoYa: Record<string, unknown> | null = null;
          if (esAbono) {
            const { data: fa, error: errFa } = await supabase.from("abonos_de_cliente")
              .select("*").eq("movimiento_ingreso_id", ya.id).maybeSingle();
            // El abono es para el PAPEL; el movimiento ya está y no se repite.
            // Si no se pudo leer, se dice y se sigue: quedarse sin comprobante
            // es molesto, escribir el ingreso dos veces es plata.
            if (errFa) console.error(`[operar-caja] abono repetido clave=${claveEnvio}: ${errFa.message}`);
            abonoYa = fa ?? null;
          }
          /* Un anticipo o un vale de retiro que NO entró (la caja lo rechazó
           * y se anuló) no es «ya estaba»: contestar ok haría creer que se
           * cobró. Se dice que no entró; la pantalla reintenta con otra clave. */
          const delApartado = ya.tipo_codigo === "APARTADO" || ya.tipo_codigo === "APLICA_ANTICIPO";
          if (delApartado && ya.anulado_at) {
            return json({ ok: false, error: "Ese intento no entró a la caja. Vuelve a intentarlo." }, 409);
          }
          // Y el anticipo que sí entró vuelve con su reserva o encargo, que es
          // lo que la pantalla necesita para la constancia.
          let apartadoYa: Record<string, unknown> | null = null;
          if (ya.tipo_codigo === "APARTADO" && (ya.reserva_id || ya.encargo_id)) {
            const ref = ya.reserva_id ? { reserva_id: ya.reserva_id } : { encargo_id: ya.encargo_id };
            const { data: v, error: errV } = await supabase.rpc("apartado_para_retirar", { p_branch_id: sala, p_apartado: ref });
            if (errV) console.error(`[operar-caja] anticipo repetido clave=${claveEnvio}: ${errV.message}`);
            if (v) {
              let venceAt: string | null = null;
              if (ya.reserva_id) {
                const { data: r, error: errR } = await supabase.from("app_reservas").select("vence_at").eq("id", ya.reserva_id).maybeSingle();
                if (errR) console.error(`[operar-caja] anticipo repetido clave=${claveEnvio}: vence: ${errR.message}`);
                venceAt = r?.vence_at ?? null;
              }
              apartadoYa = { tipo: v.tipo, id: v.id, codigo: v.codigo, total: v.total, anticipo: v.pagado, saldo: v.saldo, vence_at: venceAt };
            }
          }
          console.log(`[operar-caja] ${accion} repetido: clave=${claveEnvio} ya era la fila ${ya.id}`);
          return json({
            ok: true, movimiento_del_portal: ya.id, movimiento_en_caja: ya.erp_movimiento_id,
            abono: abonoYa, movimiento: ya, apartado: apartadoYa,
            // Para que quien llame pueda distinguir «se anotó» de «ya estaba»
            // sin tener que adivinarlo comparando ids.
            repetido: true,
          });
        }
      }

      /* ── Esa boleta ya se anotó en esta sala ─────────────────────────────
       *
       * El número de una boleta de POS es el ID de la transacción: el aparato
       * no lo repite nunca. Así que el mismo número, en la misma sala y para el
       * MISMO sentido, es la misma operación anotada dos veces — y eso cuenta
       * el dinero doble.
       *
       * El sentido contrario NO frena: es la corrección de un movimiento
       * anotado al revés (una remesa entra al cajón cuando en realidad sale), y
       * las tres correcciones reales de septiembre tienen esa forma.
       *
       * Usa la MISMA función que consulta la pantalla, a propósito: escrita dos
       * veces, el día que una cambie la otra diría algo distinto y la sala vería
       * un aviso que el servidor no respeta, o al revés.
       *
       * Va antes de tocar la caja. Después sería tarde: el dinero ya se movió. */
      /* Un voucher SÍ se reparte: la inyección y la glucosa del mismo cliente
       * pueden ir en el mismo pase de tarjeta. Lo que no puede es repartirse
       * más de lo que dice: la suma de sus partes no pasa de su total. */
      if (noEfectivo && String(body.boleta ?? "").trim()) {
        const numero = String(body.boleta).trim().slice(0, 40);
        const { data: partes, error: errPartes } = await supabase
          .from("caja_movimientos_portal")
          .select("monto, comprobante_total")
          .eq("branch_id", sala).eq("forma_pago", formaPago).eq("numero_boleta", numero)
          .is("anulado_at", null);
        if (errPartes) console.error(`[operar-caja] ${accion} voucher sala=${sala}: ${errPartes.message}`);
        const ya = (partes ?? []).reduce((t: number, p: { monto: number }) => t + Number(p.monto), 0);
        const tope = Math.max(comprobanteTotal ?? 0,
          ...(partes ?? []).map((p: { comprobante_total: number | null }) => Number(p.comprobante_total ?? 0)));
        if (ya > 0 && tope > 0 && ya + monto > tope + 0.004) {
          return json({
            ok: false,
            error: `Ese comprobante ya tiene $${ya.toFixed(2)} anotados de $${tope.toFixed(2)}: no alcanza para $${monto.toFixed(2)} más.`,
          }, 409);
        }
      }
      if (!noEfectivo && String(body.boleta ?? "").trim()) {
        const { data: repetidas, error: errBoleta } = await supabase
          .rpc("boleta_ya_en_caja", { p_branch_id: sala, p_numero_boleta: String(body.boleta) });
        // Un fallo de lectura no frena el movimiento: es una comprobación, no
        // un permiso, y la sala tiene el papel en la mano.
        if (errBoleta) console.error(`[operar-caja] ${accion} boleta sala=${sala}: ${errBoleta.message}`);
        const sentido = esEntrada ? "ENTRADA" : "SALIDA";
        const choque = (Array.isArray(repetidas) ? repetidas : [])
          .find((m: { tipo?: string }) => String(m?.tipo ?? "").toUpperCase() === sentido);
        if (choque) {
          const c = choque as { numero_boleta?: string; fecha?: string; monto?: number; concepto?: string };
          return json({
            ok: false,
            error: `La boleta ${c.numero_boleta ?? ""} ya se anotó en esta sala`
              + `${c.fecha ? ` el ${c.fecha}` : ""}`
              + `${c.monto != null ? ` por $${Number(c.monto).toFixed(2)}` : ""}`
              + `${c.concepto ? ` (${c.concepto})` : ""}.`,
          }, 409);
        }
      }

      /* ── LA APLICACIÓN DE INYECCIÓN ─────────────────────────────────────
       *
       * Es un ingreso con un CONTROL encima, igual que el abono: además del
       * dinero queda una fila por aplicación pagada, asignada a la venta, que
       * después se canjea (pedido del usuario, 2026-10-02). Antes era un
       * detalle de texto libre y la pestaña Inyecciones lo adivinaba.
       *
       * Dos formas, y el navegador dice cuál en `aplicacion.origen`:
       *   COMPRADA → la venta y sus renglones: se asigna.
       *   TRAIDA   → el cliente trajo la inyección: producto y cantidad.
       *
       * NO hay forma de cobrar una comprada sin su venta (usuario,
       * 2026-10-02): la salida «la venta no aparece todavía» se quitó. Una
       * venta recién hecha tarda hasta un minuto en llegar; se espera y se
       * actualiza, y así toda aplicación comprada queda asignada.
       *
       * EL MONTO LO PONE EL SERVIDOR con el precio vigente, nunca el
       * navegador. Si no coincide con el que la pantalla mostró —el precio
       * cambió en el medio— se frena: cobrar otro número del que la sala le
       * dijo al cliente es peor que pedirle que lo vuelva a abrir.
       *
       * Va DESPUÉS de las dos guardas de repetido: un reintento del mismo
       * envío tiene que contestar con lo que ya se escribió, y si cotizara
       * primero lo rechazaría por «ya no quedan» — las que pagó él mismo. */
      type Aplicacion = { origen?: string; items?: unknown; cantidad?: number; producto?: string; aplicar_ahora?: number; cliente?: string; customer_id?: number };
      const aplicacion = (body.aplicacion && typeof body.aplicacion === "object") ? body.aplicacion as Aplicacion : null;
      const esAplicacion = esEntrada && !esAbono && String(body.tipo ?? "") === "APLICACION";
      /* Exigirla depende de la BANDERA del catálogo (`lleva_comprobante` de
       * APLICACION), no de este código: es el interruptor del circuito. Con
       * la bandera apagada la pantalla vieja sigue cobrando como siempre; al
       * encenderla, la pantalla abre el diálogo nuevo y esto lo exige. Así el
       * pase a producción no deja una ventana en que la sala no pueda cobrar,
       * y la marcha atrás es apagar una fila — no una migración. */
      if (esAplicacion && !aplicacion) {
        const { data: tipoApl, error: errTipo } = await supabase.from("caja_tipos_movimiento")
          .select("lleva_comprobante").eq("codigo", "APLICACION").maybeSingle();
        if (errTipo) console.error(`[operar-caja] aplicacion: leyendo el tipo: ${errTipo.message}`);
        if (errTipo || tipoApl?.lleva_comprobante !== false) {
          return json({ ok: false, error: "Falta elegir la venta, o decir que el cliente trajo la inyección." }, 400);
        }
      }
      if (esAplicacion && aplicacion) {
        const origen = String(aplicacion.origen ?? "");
        if (!["COMPRADA", "TRAIDA"].includes(origen)) {
          return json({ ok: false, error: "Falta decir si la inyección se compró aquí o la trajo el cliente." }, 400);
        }
        const { data: cot, error: errCot } = await supabase.rpc("inyeccion_cotizar", {
          p_branch_id: sala,
          p_origen: origen,
          p_items: origen === "COMPRADA" ? (aplicacion.items ?? []) : null,
          p_cantidad: origen === "COMPRADA" ? null : Number(aplicacion.cantidad ?? 0),
          p_producto: origen === "COMPRADA" ? null : String(aplicacion.producto ?? ""),
        });
        if (errCot || !cot) {
          console.error(`[operar-caja] aplicacion sala=${sala}: cotizar: ${errCot?.message}`);
          return json({ ok: false, error: errCot?.message || "No se pudo calcular el cobro." }, 409);
        }
        const cotizado = Number((cot as { monto?: number }).monto);
        if (Math.abs(cotizado - monto) > 0.004) {
          return json({ ok: false, precio_cambio: true,
            error: `El cobro es de $${cotizado.toFixed(2)} y la pantalla decía $${monto.toFixed(2)}. Vuelve a abrir el cobro.` }, 409);
        }
        monto = cotizado;
        const etiqueta = "Aplicacion de inyeccion";
        const detalleCot = String((cot as { detalle?: string }).detalle ?? "");
        concepto = `${etiqueta} · ${detalleCot}`.slice(0, 50);
        body.detalle = `${etiqueta} · ${detalleCot}`;
      }

      /* ── EL PAGO DEL ASEGURADO DE MAPFRE (2026-10-19) ─────────────────────
       *
       * La venta a Mapfre se factura al crédito y lo que paga el asegurado se
       * descuenta con puntos: es el renglón `erp_product_id = 0` de la
       * factura. Este ingreso es ESE pago, y por eso nace de la factura:
       *   · el monto lo pone `mapfre_cotizar` desde el renglón, nunca el
       *     navegador, y si no coincide con lo que la pantalla mostró se frena;
       *   · el asegurado sale del listado de clientes;
       *   · una factura se cobra una sola vez (índice único sobre las vivas).
       *
       * Va DESPUÉS de las guardas de repetido por lo mismo que la aplicación:
       * un reintento del mismo envío tiene que contestar con lo ya escrito, y
       * si cotizara primero lo rechazaría por «ya tiene su pago». */
      const esMapfre = esEntrada && !esAbono && String(body.tipo ?? "") === "MAPFRE";
      let mapfreFactura: number | null = null;
      let mapfreAsegurado: number | null = null;
      if (esMapfre) {
        const m = (body.mapfre && typeof body.mapfre === "object") ? body.mapfre as { invoice_id?: unknown; customer_id?: unknown } : {};
        mapfreFactura = Number(m.invoice_id) || null;
        mapfreAsegurado = Number(m.customer_id) || null;
        if (!mapfreFactura) return json({ ok: false, error: "Elige la factura de Mapfre." }, 400);
        if (!mapfreAsegurado) return json({ ok: false, error: "Elige al asegurado del listado de clientes." }, 400);
        const { data: cot, error: errCot } = await supabase.rpc("mapfre_cotizar", {
          p_branch_id: sala, p_invoice_id: mapfreFactura,
        });
        if (errCot || !cot) {
          return json({ ok: false, error: errCot?.message || "No se pudo leer la factura de Mapfre." }, 409);
        }
        const c = cot as { monto: number; correlativo: string };
        if (Math.abs(Number(c.monto) - monto) > 0.004) {
          return json({ ok: false, error: `La factura dice que el asegurado paga $${Number(c.monto).toFixed(2)} y la pantalla decía $${monto.toFixed(2)}. Vuelve a abrir el cobro.` }, 409);
        }
        const { data: asegurado, error: errAseg } = await supabase.from("customers")
          .select("id, name").eq("id", mapfreAsegurado).maybeSingle();
        if (errAseg) {
          console.error(`[operar-caja] mapfre: asegurado ${mapfreAsegurado}: ${errAseg.message}`);
          return json({ ok: false, error: "No se pudo leer la ficha del asegurado. Vuelve a intentarlo." }, 503);
        }
        if (!asegurado) return json({ ok: false, error: "Ese asegurado no está en el listado de clientes." }, 400);
        monto = Number(c.monto);
        const factura = String(c.correlativo ?? "").replace(/^0+/, "").split("_")[0];
        concepto = `Pago asegurado Mapfre · Fac ${factura} · ${asegurado.name}`.slice(0, 50);
        body.detalle = `Pago asegurado Mapfre · Fac ${factura} · ${asegurado.name}`;
      }

      /* ── EL ANTICIPO DE UN PRODUCTO APARTADO O ENCARGADO (2026-10-20) ─────
       *
       * «Apartar o encargar» reemplaza al abono de cliente: nace de una ficha
       * y de un producto del catálogo, y el portal decide si se aparta (hay en
       * la sala: anticipo mínimo del 50 %) o se encarga (el 100 % de un
       * encargo con el precio ya confirmado por Compras). Igual que Mapfre, el
       * monto lo valida el servidor (`apartado_cotizar`), nunca el navegador. */
      const esAnticipo = esEntrada && !esAbono && String(body.tipo ?? "") === "APARTADO";
      let apartado: Record<string, unknown> | null = null;
      let apartadoCot: { cliente?: string; detalle?: string; codigo?: string; minimo: number; maximo: number } | null = null;
      if (esAnticipo) {
        apartado = (body.apartado && typeof body.apartado === "object") ? body.apartado as Record<string, unknown> : null;
        if (!apartado) return json({ ok: false, error: "Falta qué se aparta." }, 400);
        const { data: cot, error: errCot } = await supabase.rpc("apartado_cotizar", { p_branch_id: sala, p_apartado: apartado });
        if (errCot || !cot) return json({ ok: false, error: errCot?.message || "No se pudo leer lo que se aparta." }, 409);
        apartadoCot = cot as typeof apartadoCot;
        if (monto < Number(apartadoCot!.minimo) - 0.004 || monto > Number(apartadoCot!.maximo) + 0.004) {
          return json({ ok: false, error: `El cobro va de $${Number(apartadoCot!.minimo).toFixed(2)} a $${Number(apartadoCot!.maximo).toFixed(2)}.` }, 409);
        }
        const texto = `Anticipo${apartadoCot!.codigo ? ` ${apartadoCot!.codigo}` : ""} · ${apartadoCot!.detalle ?? ""} · ${apartadoCot!.cliente ?? ""}`;
        concepto = texto.slice(0, 50);
        body.detalle = texto;
      }

      /* ── EL RETIRO AL CONTADO DE LO APARTADO (2026-10-20) ──────────────
       *
       * Si el anticipo se cobró en efectivo y el resto también se paga en
       * efectivo, se factura AL CONTADO por el total —la caja no acepta pago
       * parcial— y la factura vuelve a contar un efectivo que entró el día
       * del anticipo. Este vale lo saca: el cajón queda con lo que de verdad
       * hay. Lo decide la base: el monto es el anticipo en efectivo, entero,
       * y sólo vale si TODO lo pagado fue en efectivo de la caja (lo demás va
       * al crédito, ver `aplicar_anticipo` de creditos-erp). Una vez por
       * reserva o encargo: lo frena su índice único. */
      const esAplicaAnticipo = !esEntrada && String(body.tipo ?? "") === "APLICA_ANTICIPO";
      let aplicaRef: { reserva_id?: number; encargo_id?: number } | null = null;
      if (esAplicaAnticipo) {
        const ref = body.aplicar && typeof body.aplicar === "object" ? body.aplicar as Record<string, unknown> : null;
        if (!ref || !(ref.reserva_id || ref.encargo_id)) return json({ ok: false, error: "Falta qué se retira." }, 400);
        aplicaRef = ref.reserva_id ? { reserva_id: Number(ref.reserva_id) } : { encargo_id: Number(ref.encargo_id) };
        const { data: v, error: errV } = await supabase.rpc("apartado_para_retirar", { p_branch_id: sala, p_apartado: aplicaRef });
        if (errV || !v) return json({ ok: false, error: errV?.message || "No se pudo leer lo apartado." }, 409);
        if (v.aplicado) return json({ ok: false, error: "El anticipo de esto ya se aplicó." }, 409);
        if (!v.listo) return json({ ok: false, error: "Todavía no está listo para retirar." }, 409);
        if (Number(v.otras_formas) > 0.004 || Number(v.en_linea) > 0.004) {
          return json({ ok: false, error: "Parte del anticipo no fue en efectivo: se factura al crédito y se abona." }, 409);
        }
        if (!(Number(v.efectivo) > 0) || Math.abs(Number(v.efectivo) - monto) > 0.004) {
          return json({ ok: false, error: `El vale es por el anticipo en efectivo: $${Number(v.efectivo).toFixed(2)}.` }, 409);
        }
        const texto = `Aplica anticipo ${v.codigo} a su factura · ${v.cliente ?? ""}`;
        concepto = texto.slice(0, 50);
        body.detalle = texto;
        body.recibe = String(v.cliente ?? "").slice(0, 60);
      }

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
      /* ── LA PARTE DEL CAJÓN DE UNA SALIDA QUE SALIÓ PRIMERO DE UNA BOLSA ──
       *
       * «primero la bolsa y luego de caja. el vale sale 1 solo» (usuario,
       * 2026-10-02). La bolsa ya se descontó en `registrar_salida_de_bolsa`;
       * esto anota el resto y lo LIGA a esa operación, que es lo que hace de
       * las dos una sola salida: un vale, y se anulan juntas.
       *
       * La operación se RELEE: el navegador manda un id y nada más. Tiene que
       * ser de esta sala, de quien está escribiendo y de hace minutos — sin eso
       * cualquiera podría colgarle un retiro del cajón a una salida ajena.
       *
       * Y la identidad de quien retira se HEREDA de ella: ya se comprobó contra
       * el servidor y el vale de identidad es de un solo uso, así que pedirlo
       * otra vez dejaría la salida a medias justo después de abrir la bolsa. */
      let operacionBolsa: { id: number; recibido_por: string | null; recibido_metodo: string | null } | null = null;
      if (!esEntrada && body.operacion_bolsa != null && body.operacion_bolsa !== "") {
        const opId = Number(body.operacion_bolsa);
        if (!Number.isFinite(opId)) return json({ ok: false, error: "La parte de la bolsa no es válida." }, 400);
        const { data: op, error: errOp } = await supabase.from("bolsas_operaciones")
          .select("id, branch_id, registrado_por, registrado_at, anulada_at, recibido_por, recibido_metodo")
          .eq("id", opId).maybeSingle();
        if (errOp) throw new Error(`leyendo la parte de la bolsa: ${errOp.message}`);
        if (!op || op.anulada_at) {
          return json({ ok: false, error: "La parte de la bolsa no existe o ya se anuló." }, 409);
        }
        if (Number(op.branch_id) !== sala) {
          return json({ ok: false, error: "La parte de la bolsa es de otra sala." }, 400);
        }
        if (op.registrado_por !== quien.id) {
          return json({ ok: false, error: "La parte de la bolsa la registró otra persona." }, 403);
        }
        if (Date.now() - new Date(op.registrado_at).getTime() > 15 * 60_000) {
          return json({ ok: false, error: "La parte de la bolsa se registró hace demasiado: anúlala y vuelve a registrar la salida entera." }, 409);
        }
        operacionBolsa = op as typeof operacionBolsa;
      }

      let recibidoPor: string | null = null;
      let recibidoMetodo: string | null = null;
      if (operacionBolsa?.recibido_por) {
        recibidoPor = operacionBolsa.recibido_por;
        recibidoMetodo = operacionBolsa.recibido_metodo;
      } else if (!esEntrada && body.recibido_por) {
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
          /* QUÉ LEYÓ la máquina de esa foto, tal cual lo contestó.
           *
           * `bolsas_operaciones` ya lo guardaba y el cajón no. La boleta 018540
           * de Salud 4 (5-sep-2026) dice US$240.50 y el lector puso 248.50 —el
           * cero de estas impresoras lleva una barra diagonal que a la
           * resolución en que la foto viaja se confunde con un 8—, y la única
           * evidencia que quedó de esa lectura fue la frase que una persona
           * escribió al pedir la corrección. Sin rastro no se puede contar
           * cuántas veces falla, ni saber si algo lo mejoró.
           *
           * No frena nada y no se valida campo por campo: es auditoría de lo que
           * contestó un tercero, y recortarla a lo que hoy entendemos perdería
           * justo el campo nuevo del día que haga falta. */
          foto_lectura: lecturaParaGuardar(body.lectura),
          // Y si ese monto lo respalda el papel o lo puso una persona. Sale de
          // comparar las dos cosas que esta función ya tiene en la mano.
          monto_origen: origenDelMonto(body.lectura, Number(dosDecimales(monto)), body.monto_cotejado === true),
          // Las dos mitades de «quien recibio», y nunca las dos a la vez: o se
          // comprobo con carne, o se escribio un nombre porque el receptor no
          // es de la casa.
          recibido_por: recibidoPor,
          recibido_metodo: recibidoMetodo,
          recibido_texto: !esEntrada && !recibidoPor && body.recibe
            ? String(body.recibe).slice(0, 60) : null,
          fecha: diaAbierto, erp_apertura_id: Number(estado.aper),
          registrado_por: quien.id,
          // La clave de ESTE envío: su índice único es lo que hace que dos
          // peticiones en paralelo no puedan escribir dos movimientos.
          clave_envio: claveEnvio,
          // De qué salida de bolsa es el resto, si lo es. Ver `operacionBolsa`.
          bolsa_operacion_id: operacionBolsa?.id ?? null,
          // La factura y el asegurado de un pago de Mapfre. Ver `esMapfre`.
          invoice_id: mapfreFactura,
          customer_id: mapfreAsegurado,
          // El vale del retiro nace ligado: su índice único impide un segundo.
          reserva_id: aplicaRef?.reserva_id ?? null,
          encargo_id: aplicaRef?.encargo_id ?? null,
          forma_pago: formaPago,
          comprobante_total: comprobanteTotal,
        })
        .select("*").single();

      /* Las dos peticiones pasaron la comprobación de arriba a la vez.
       *
       * Es EL caso real: en producción los `erp_movimiento_id` volvieron en
       * orden invertido respecto al de inserción, o sea que viajaban juntas. La
       * comprobación de arriba sola no alcanza —entre leer y escribir hay un
       * hueco—; lo que decide es el índice único, y acá se traduce su rechazo a
       * la misma respuesta que hubiera dado la primera. */
      if (errFila?.code === "23505" && claveEnvio) {
        const { data: ya, error: errRelectura } = await supabase
          .from("caja_movimientos_portal")
          .select("*").eq("clave_envio", claveEnvio).maybeSingle();
        /* Si NO se pudo releer, no se inventa una respuesta buena: cae al
         * `throw` de abajo y quien llama ve que algo falló. Decir «ok» sin
         * tener la fila en la mano sería afirmar que el movimiento existe sin
         * haberlo comprobado — y el índice ya garantizó que no se duplicó. */
        if (errRelectura) {
          console.error(`[operar-caja] ${accion} carrera clave=${claveEnvio}: ${errRelectura.message}`);
        }
        if (ya) {
          console.log(`[operar-caja] ${accion} carrera: clave=${claveEnvio} gano la fila ${ya.id}`);
          return json({
            ok: true, movimiento_del_portal: ya.id, movimiento_en_caja: ya.erp_movimiento_id,
            abono: null, movimiento: ya, repetido: true,
          });
        }
      }
      // El índice `caja_mov_portal_una_parte_por_operacion`: esa salida ya
      // tiene su parte de la caja viva.
      if (errFila?.code === "23505" && operacionBolsa) {
        return json({ ok: false, error: "Esa salida ya tiene su parte de la caja anotada." }, 409);
      }
      // El índice de Mapfre: otro envío cobró esa factura en el medio.
      if (errFila?.code === "23505" && esMapfre) {
        return json({ ok: false, error: "Esa factura de Mapfre ya tiene su pago anotado." }, 409);
      }
      if (errFila?.code === "23505" && aplicaRef) {
        return json({ ok: false, error: "El anticipo de esto ya se aplicó." }, 409);
      }
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

      /* Las aplicaciones se escriben ANTES de tocar la caja, igual que el
       * abono, y nacen SIN CONFIRMAR: si la caja rechaza, quedan ligadas a un
       * intento y no se pueden canjear. Se confirman abajo, cuando la caja
       * aceptó. La función vuelve a validar bajo candado: entre cotizar y
       * esto pudo cobrarse el mismo renglón desde otra caja.
       *
       * Si no se pueden escribir, el movimiento se ANULA acá mismo y no se
       * toca la caja: un cobro sin su control es justo lo que esto viene a
       * cerrar. */
      let aplicaciones: Record<string, unknown> | null = null;
      if (esAplicacion && aplicacion) {
        const { data: reg, error: errReg } = await supabase.rpc("inyeccion_registrar", {
          p_cobro_id: fila.id,
          p_origen: String(aplicacion.origen),
          p_items: aplicacion.origen === "COMPRADA" ? (aplicacion.items ?? []) : null,
          p_cantidad: aplicacion.origen === "TRAIDA" ? Number(aplicacion.cantidad ?? 0) : null,
          p_producto: aplicacion.origen === "TRAIDA" ? String(aplicacion.producto ?? "") : null,
          p_aplicar_ahora: Number(aplicacion.aplicar_ahora ?? 0),
          p_por: quien.id,
          // A nombre de quién quedan las pendientes. La pantalla lo pide cuando
          // queda alguna; sin él, la comprada toma el nombre de la factura.
          p_cliente: aplicacion.cliente ? String(aplicacion.cliente).slice(0, 80) : null,
        });
        if (errReg) {
          console.error(`[operar-caja] aplicacion sala=${sala} fila=${fila.id}: ${errReg.message}`);
          const { error: errAnular } = await supabase.from("caja_movimientos_portal")
            .update({ anulado_at: new Date().toISOString(), anulado_motivo: "No se pudieron registrar las aplicaciones",
                      updated_at: new Date().toISOString() })
            .eq("id", fila.id);
          if (errAnular) console.error(`[operar-caja] aplicacion fila=${fila.id}: anular: ${errAnular.message}`);
          return json({ ok: false, error: `${errReg.message} No se movio dinero.` }, 409);
        }
        aplicaciones = reg as Record<string, unknown>;

        /* La que trajo el cliente, ligada a su FICHA si la sala la eligió
         * (2026-10-06): así entra a su historial y la ve en la app. Las
         * compradas ya la toman de la factura. Que falle esto no deshace el
         * cobro —el dinero y las aplicaciones ya quedaron bien—: se avisa en
         * el registro y la aplicación queda con el nombre escrito, como antes. */
        const fichaId = Number(aplicacion.customer_id);
        if (aplicacion.origen === "TRAIDA" && Number.isInteger(fichaId) && fichaId > 0) {
          const { data: ficha, error: errFicha } = await supabase.from("customers").select("id").eq("id", fichaId).maybeSingle();
          if (errFicha) console.error(`[operar-caja] aplicacion fila=${fila.id}: ficha ${fichaId}: ${errFicha.message}`);
          else if (ficha) {
            const { error: errLiga } = await supabase.from("inyeccion_aplicaciones")
              .update({ customer_id: fichaId }).eq("cobro_id", fila.id).is("customer_id", null);
            if (errLiga) console.error(`[operar-caja] aplicacion fila=${fila.id}: ligar ficha ${fichaId}: ${errLiga.message}`);
          }
        }
      }

      /* El vale del retiro RECLAMA su aplicación antes de tocar la caja: una
       * por reserva o encargo, también contra el abono al crédito que pudiera
       * estar haciéndose a la vez desde otra pantalla. */
      if (aplicaRef) {
        const { error: errRec } = await supabase.rpc("apartado_aplicacion_registrar", {
          p_branch_id: sala, p_apartado: aplicaRef, p_modo: "VALE", p_monto: Number(dosDecimales(monto)),
          p_credito: null, p_movimiento: fila.id, p_employee: quien.id, p_entregar: false,
        });
        if (errRec) {
          console.error(`[operar-caja] retiro fila=${fila.id}: reclamar: ${errRec.message}`);
          const { error: errAn } = await supabase.from("caja_movimientos_portal")
            .update({ anulado_at: new Date().toISOString(), anulado_motivo: "El anticipo ya estaba aplicado",
                      reserva_id: null, encargo_id: null, clave_envio: null, updated_at: new Date().toISOString() })
            .eq("id", fila.id);
          if (errAn) console.error(`[operar-caja] retiro fila=${fila.id}: anular: ${errAn.message}`);
          return json({ ok: false, error: "El anticipo de esto ya se aplicó. No se movió dinero." }, 409);
        }
      }

      /* El anticipo se aplica ANTES de tocar la caja, como las aplicaciones:
       * así el concepto que viaja lleva el código de la reserva. Si no se
       * puede, el movimiento se anula y no se mueve dinero. Si después la caja
       * rechaza el efectivo, `apartado_deshacer` lo devuelve todo. */
      let apartadoRes: Record<string, unknown> | null = null;
      if (esAnticipo && apartado) {
        const { data: ap, error: errAp } = await supabase.rpc("apartado_aplicar", {
          p_branch_id: sala, p_apartado: apartado, p_movimiento: fila.id,
          p_monto: Number(dosDecimales(monto)), p_forma: formaPago, p_employee: quien.id,
        });
        if (errAp || !ap) {
          console.error(`[operar-caja] anticipo sala=${sala} fila=${fila.id}: ${errAp?.message}`);
          const { error: errAnular } = await supabase.from("caja_movimientos_portal")
            .update({ anulado_at: new Date().toISOString(), anulado_motivo: "No se pudo aplicar el anticipo",
                      // Sin la clave, el reintento del MISMO envío vuelve a intentar en vez
                      // de contestar con este intento muerto.
                      clave_envio: null, updated_at: new Date().toISOString() })
            .eq("id", fila.id);
          if (errAnular) console.error(`[operar-caja] anticipo fila=${fila.id}: anular: ${errAnular.message}`);
          return json({ ok: false, error: `${errAp?.message ?? "No se pudo aplicar el anticipo."} No se movio dinero.` }, 409);
        }
        apartadoRes = ap as Record<string, unknown>;
        if (apartadoRes.codigo && !apartadoCot?.codigo) {
          const texto = `Anticipo ${apartadoRes.codigo} · ${apartadoCot?.detalle ?? ""} · ${apartadoCot?.cliente ?? ""}`;
          concepto = texto.slice(0, 50);
          const { error: errConc } = await supabase.from("caja_movimientos_portal")
            .update({ concepto, detalle: texto, updated_at: new Date().toISOString() }).eq("id", fila.id);
          if (errConc) console.error(`[operar-caja] anticipo fila=${fila.id}: concepto: ${errConc.message}`);
          else { fila.concepto = concepto; fila.detalle = texto; }
        }
      }

      /* ── Lo que no es efectivo termina ACÁ ─────────────────────────────────
       *
       * No va a la caja: allá sería efectivo. Las aplicaciones se confirman
       * ya —el dinero entró, por otra vía— y, sin comprobante, se pide la
       * autorización con la MISMA función que usa el reenvío. Si pedirla
       * falla, el ingreso queda escrito sin autorización pedida: se dice, para
       * que no parezca autorizado. */
      if (noEfectivo) {
        let avisoNoEfectivo: string | null = null;
        if (aplicaciones) {
          const { error: errConf } = await supabase.from("inyeccion_aplicaciones")
            .update({ confirmada: true }).eq("cobro_id", fila.id);
          if (errConf) {
            console.error(`[operar-caja] aplicacion fila=${fila.id}: confirmar: ${errConf.message}`);
            avisoNoEfectivo = "El cobro quedó anotado, pero las aplicaciones no quedaron confirmadas. Avisa a Sistemas.";
          }
        }
        if (sinComprobante) {
          const { error: errAut } = await supabase.rpc("caja_ingreso_pedir_autorizacion", {
            p_movimiento: fila.id, p_pide: quien.id, p_nota: motivoSinComprobante,
          });
          if (errAut) {
            console.error(`[operar-caja] autorizacion fila=${fila.id}: ${errAut.message}`);
            avisoNoEfectivo = "El ingreso quedó anotado, pero no se pudo pedir la autorización. Avisa a Supervisión.";
          }
        }
        const { data: escrita, error: errRel } = await supabase.from("caja_movimientos_portal")
          .select("*").eq("id", fila.id).single();
        if (errRel) console.error(`[operar-caja] ${accion} fila=${fila.id}: releyendo: ${errRel.message}`);
        return json({
          ok: true, movimiento_del_portal: fila.id, movimiento_en_caja: null, abono, aplicaciones, apartado: apartadoRes,
          movimiento: escrita ?? fila, no_va_a_caja: true,
          ...(avisoNoEfectivo ? { aviso: avisoNoEfectivo } : {}),
        });
      }

      // El concepto lleva el número del portal adelante: es lo único que ata
      // las dos filas cuando alguien mira del otro lado, y el campo trunca a 50.
      const conceptoCaja = `P${fila.id} ${concepto}`.slice(0, 50);
      // En pruebas no hay caja a la que mandarlo: se contesta como si la caja
      // hubiera aceptado, sin número de movimiento.
      /* El vale del retiro que la caja no acepta se ANULA: vivo, su índice
       * único trabaría la reserva para siempre («ya se aplicó») sin que el
       * dinero se haya movido. Lo mismo si la petición lanza. */
      const anularValeDeRetiro = async (motivo: string) => {
        if (!aplicaRef) return;
        const { error: errSu } = await supabase.from("apartado_aplicaciones").delete().eq("movimiento_id", fila.id);
        if (errSu) console.error(`[operar-caja] retiro fila=${fila.id}: soltar: ${errSu.message}`);
        const { error: errAn } = await supabase.from("caja_movimientos_portal")
          .update({ anulado_at: new Date().toISOString(), anulado_motivo: motivo, clave_envio: null, updated_at: new Date().toISOString() })
          .eq("id", fila.id);
        if (errAn) console.error(`[operar-caja] retiro fila=${fila.id}: anular: ${errAn.message}`);
      };
      let resp = "";
      try {
      resp = cajaSimulada ? "" : await (await fetch(esEntrada ? INGRESO : SALIDA, {
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
      } catch (e) {
        // No se sabe si la caja lo anotó: el vale se anula para no trabar la
        // reserva y se avisa para revisar la caja antes de repetirlo.
        if (aplicaRef) {
          await anularValeDeRetiro("La caja no contestó");
          if (apartadoRes) await supabase.rpc("apartado_deshacer", { p_movimiento: fila.id });
          return json({ ok: false, movimiento_del_portal: fila.id,
            error: "La caja no contestó. Revisa en la caja si el vale salió antes de repetirlo." }, 504);
        }
        throw e;
      }

      if (!cajaSimulada && !exito(resp)) {
        console.error(`[operar-caja] ${accion} sala=${sala} fila=${fila.id}: ${resp.slice(0, 1000)}`);
        await anularValeDeRetiro("La caja no aceptó el vale");
        // El efectivo no entró: la reserva o el encargo vuelven a como estaban.
        if (apartadoRes) {
          const { error: errDes } = await supabase.rpc("apartado_deshacer", { p_movimiento: fila.id });
          if (errDes) console.error(`[operar-caja] anticipo fila=${fila.id}: deshacer: ${errDes.message}`);
        }
        return json({
          ok: false, movimiento_del_portal: fila.id,
          error: "La caja no aceptó el movimiento. Vuelve a intentarlo; si sigue igual, avisa a Sistemas.",
        }, 502);
      }
      let idMov: number | null = null;
      try { idMov = Number(JSON.parse(resp)?.id_mov) || null; } catch { idMov = null; }

      /* La caja aceptó: recién ahora las aplicaciones valen. Se confirman
       * antes de ligar el número del sistema porque son lo que el cliente se
       * lleva pagado; si esto falla, el dinero entró y el control no — se dice
       * y queda en el log, para confirmarlas a mano. */
      let avisoAplicaciones: string | null = null;
      // El vale salió: el anticipo queda aplicado y lo apartado, entregado.
      if (aplicaRef) {
        /* La aplicación ya se reclamó antes de la caja; la entrega va APARTE:
         * si falla (la reserva venció, alguien la tocó), la aplicación queda
         * y se entrega después con «Entregado», sin otro vale. */
        const { error: errEnt } = await supabase.rpc("apartado_marcar_entregado", { p_apartado: aplicaRef, p_employee: quien.id });
        if (errEnt) {
          console.error(`[operar-caja] retiro fila=${fila.id}: entregar: ${errEnt.message}`);
          avisoAplicaciones = `El vale salió y el anticipo quedó aplicado, pero no se marcó entregado (${errEnt.message}). Márcalo con «Entregado».`;
        }
      }
      if (aplicaciones) {
        const { error: errConf } = await supabase.from("inyeccion_aplicaciones")
          .update({ confirmada: true }).eq("cobro_id", fila.id);
        if (errConf) {
          console.error(`[operar-caja] aplicacion fila=${fila.id}: confirmar: ${errConf.message}`);
          avisoAplicaciones = "El cobro entró, pero las aplicaciones no quedaron confirmadas. Avisa a Sistemas.";
        }
      }

      const { error: errLigar } = await supabase.from("caja_movimientos_portal")
        .update({ erp_movimiento_id: idMov, updated_at: new Date().toISOString() })
        .eq("id", fila.id);
      // El movimiento ya ocurrió en la caja. Si no se pudo ligar, el portal
      // tiene la fila sin el número del sistema: se puede reintentar, pero
      // alguien tiene que enterarse.
      if (errLigar) {
        return json({ ok: true, movimiento_del_portal: fila.id, movimiento_en_caja: idMov, abono, aplicaciones, apartado: apartadoRes,
          aviso: avisoAplicaciones ?? "El movimiento se hizo, pero no se pudo enlazar con el del sistema." });
      }

      // El abono viaja de vuelta ENTERO: el comprobante se arma con la fila que
      // quedó escrita —con su folio y su vencimiento—, no con lo que el
      // navegador creía que estaba mandando. Si los dos difieren, el papel
      // tiene que decir lo que dice la base.
      // `fila` entera: el comprobante se arma con lo que QUEDÓ ESCRITO —su
      // número, su fecha, su boleta—, no con lo que el formulario creía estar
      // mandando. Mismo criterio que el papel del abono.
      return json({ ok: true, movimiento_del_portal: fila.id, movimiento_en_caja: idMov, abono,
        aplicaciones, apartado: apartadoRes, movimiento: fila, ...(avisoAplicaciones ? { aviso: avisoAplicaciones } : {}),
        ...(cajaSimulada ? { simulado: true } : {}) });
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

      /* ── Y NINGUNO PUEDE QUEDAR SIN RESOLVER (regla del usuario, 6-sep) ───
       *
       * El freno de arriba pide que HAYA uno confirmado; éste pide que no
       * quede NINGUNO a medias. No son el mismo freno y se ve en los datos:
       * Salud 1 el 5-sep cerró su día a las 22:04 con el corte de las 21:17 y
       * el de las 22:02 **los dos en PENDIENTE**, porque el del mediodía —el
       * de las 14:18— sí estaba confirmado y alcanzaba para pasar. O sea que
       * el efectivo de toda la tarde y la noche se cerró sin que nadie firmara
       * el conteo, y el cierre no se deshace.
       *
       * Los cortes del día se SUMAN —el de la noche contiene al de la
       * mañana—, así que uno sin resolver deja sin base a todos los que vienen
       * después: `resolver_corte_caja` ya se niega a confirmar salteado. Cerrar
       * encima de eso convierte un pendiente en algo que ya no se puede
       * arreglar. */
      const sinResolver = (cortesDelDia ?? []).filter(
        (c) => c.tipo === "C" && c.estado === "PENDIENTE");
      if (sinResolver.length) {
        const horas = sinResolver.map((c) => hora12(c.hora))
          .filter(Boolean).join(", ");
        return json({
          ok: false, corte_sin_resolver: true,
          error: sinResolver.length === 1
            ? `El corte de las ${horas} no está confirmado ni descartado. Resuélvelo antes `
              + "de cerrar: los cortes del día se suman, y el cierre no se deshace."
            : `Hay ${sinResolver.length} cortes sin resolver (${horas}). Resuélvelos antes `
              + "de cerrar: los cortes del día se suman, y el cierre no se deshace.",
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

    const zEmitido = await hayZdelDia(cookie, diaAbierto);

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
