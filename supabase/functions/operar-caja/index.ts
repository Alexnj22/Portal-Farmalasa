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
    if (!["abrir", "ingreso", "salida", "cerrar", "estado", "corregir", "aplicar_correccion"].includes(accion)) {
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
    if (accion === "ingreso" || accion === "salida") {
      const esEntrada = accion === "ingreso";
      const monto = Number(body.monto);
      const concepto = String(body.concepto ?? "").trim();
      if (!(Number.isFinite(monto) && monto > 0)) return json({ ok: false, error: "Falta el monto." }, 400);
      if (!concepto) return json({ ok: false, error: "Falta el concepto." }, 400);

      // La fila del portal se escribe ANTES: si la caja lo acepta y el portal no
      // llega a anotarlo, queda un movimiento sin respaldo y sin forma de
      // corregirlo. Al revés, una fila sin `erp_movimiento_id` es un intento
      // visible que se puede reintentar.
      const { data: fila, error: errFila } = await supabase
        .from("caja_movimientos_portal")
        .insert({
          branch_id: sala, tipo: esEntrada ? "ENTRADA" : "SALIDA",
          monto: Number(dosDecimales(monto)), concepto,
          numero_boleta: body.boleta ? String(body.boleta).slice(0, 40) : null,
          foto_url: body.foto_url ? String(body.foto_url) : null,
          fecha: diaAbierto, erp_apertura_id: Number(estado.aper),
          registrado_por: quien.id,
        })
        .select("id").single();
      if (errFila) throw new Error(`guardando el movimiento: ${errFila.message}`);

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
            // El otro campo de su formulario. Va vacío cuando no aplica: el
            // sistema lo acepta así, y no todos los ingresos tienen vendedor.
            codigo_vendedor: String(body.vendedor ?? ""),
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
        return json({
          ok: false, movimiento_del_portal: fila.id,
          error: `La caja no aceptó el movimiento: ${resp.slice(0, 200)}`,
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
        return json({ ok: true, movimiento_del_portal: fila.id, movimiento_en_caja: idMov,
          aviso: "El movimiento se hizo, pero no se pudo enlazar con el del sistema." });
      }

      return json({ ok: true, movimiento_del_portal: fila.id, movimiento_en_caja: idMov });
    }

    // ── CERRAR EL DÍA ───────────────────────────────────────────────────────
    //
    // NO se cierra sin al menos un corte del día (regla del usuario, 30-ago).
    // El cierre emite el Z, y un día que cierra sin haber cortado deja el
    // efectivo de toda la jornada sin haberse contado ni una vez: la diferencia
    // ya no se puede atribuir a ningún turno, y el Z no se deshace.
    //
    // El corte se cuenta del DÍA QUE LA CAJA TIENE ABIERTO —no de hoy—: una
    // caja que quedó abierta pasada la medianoche sigue en su día, y pedirle un
    // corte «de hoy» le exigiría cortar dos veces.
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

    if (!exito(resp)) return json({ ok: false, error: `La caja no aceptó el cierre: ${resp.slice(0, 200)}` }, 502);
    return json({ ok: true, cerrada: true });
  } catch (e) {
    console.error("operar-caja:", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error)?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
