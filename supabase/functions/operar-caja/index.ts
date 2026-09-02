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
    const aper = panel.match(/id_apertura=(\d+)/)?.[1];
    if (aper) {
      // Lo que el sistema espera adentro AHORA, quién abrió y a qué hora. Está
      // en el mismo panel: no cuesta una petición más y es la primera pregunta
      // de quien mira la pantalla — «¿cuánto hay?».
      const campo = (etiqueta: string) =>
        (panel.match(new RegExp(`${etiqueta}:\\s*([^<]*)<`))?.[1] ?? "")
          .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() || null;
      const num = (v: string | null) => {
        const limpio = String(v ?? "").replace(/[^0-9.-]/g, "");
        const n = Number(limpio);
        return limpio && Number.isFinite(n) ? n : null;
      };
      return {
        abierta: true, idCaja,
        aper, emp: panel.match(/emp=(\d+)/)?.[1] ?? idEmple,
        turno: panel.match(/turno=(\d+)/)?.[1] ?? "1",
        idEmple,
        registrado: num(campo("Monto Registrado")),
        apertura: num(campo("Monto Apertura")),
        quien: campo("Nombre"),
        desde: campo("Hora Apertura"),
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
    // ⚠️ Esta lista es una PUERTA, no una etiqueta. `aplicar_correccion` estuvo
    // acá antes de existir, y el bloque de CERRAR no era una rama sino la COLA
    // de la función: una acción aceptada y sin implementar caía en él y
    // **cerraba el día**, el único acto irreversible del módulo. Hoy la cola ya
    // no es cola (ver el `if (accion === "cerrar")` de abajo), pero la regla
    // queda: no se agrega un nombre acá hasta que su rama esté escrita.
    if (!["abrir", "ingreso", "salida", "cerrar", "estado", "corregir",
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
      if (errSol) throw new Error(`creando la solicitud: ${errSol.message}`);
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
      return json({
        ok: true, abierta: estado.abierta, caja: estado.idCaja, turno: estado.turno,
        registrado: (estado as { registrado?: number | null }).registrado ?? null,
        apertura: (estado as { apertura?: number | null }).apertura ?? null,
        quien: (estado as { quien?: string | null }).quien ?? null,
        desde: (estado as { desde?: string | null }).desde ?? null,
        dia: diaAbierto,
        cortes: cortesDelDia ?? [],
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
        return json({ ok: false, error: "La caja no aceptó la apertura. Vuelve a intentarlo; si sigue igual, avisa a Sistemas." }, 502);
      }

      // Quién la abrió DE VERDAD. La captura de cada media hora va a traer el
      // resto (hora, monto, id de apertura); esto es lo que ella no puede saber.
      const { error: errApertura } = await supabase.from("caja_aperturas_del_portal").insert({
        branch_id: sala, abierta_por: quien.id, erp_empleado_id: empErp,
        caja_erp: Number(estado.idCaja), monto_apertura: monto,
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
      const { data: fila, error: errFila } = await supabase
        .from("caja_movimientos_portal")
        .insert({
          branch_id: sala, tipo: esEntrada ? "ENTRADA" : "SALIDA",
          monto: Number(dosDecimales(monto)), concepto,
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
      if (!(cortesDelDia ?? []).some((c) => c.tipo === "C")) {
        return json({
          ok: false,
          error: "Esta caja no tiene ningún corte del día. Haz el corte antes de cerrar: "
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
