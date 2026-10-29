import {
  getCorsHeaders, getErpBranchMap, permisoDeModulo, requireActiveEmployeeUser,
} from "../_shared/security.ts";
import {
  abonosDelCredito, creditosDeLaSala, FORMAS_DEL_PORTAL as FORMAS,
  getCortesCreds, getSessionCookie, quitarAbonoDelOrigen, abonarEnOrigen, abrirSala, ABONO_URL,
} from "../_shared/creditos.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  abonoQueYaEntro, decidirAprobacion, revisarContraElSaldoVivo, verificarLectura,
  type CreditoVivo,
} from "../_shared/cobroCredito.ts";

// ═══════════════════════════════════════════════════════════════════════════
// LOS CRÉDITOS DE LOS CLIENTES — verlos y abonarles desde el portal.
//
// ── Por qué pasa por acá y no por el navegador ────────────────────────────
// El sistema de la caja no habla con el navegador de nadie: hay que entrar con
// las credenciales del portal y fijar la sucursal en la sesión. Y el abono
// MUEVE DINERO —entra al cajón como efectivo— así que el permiso y el alcance
// se cobran del lado del servidor, igual que en `operar-caja`.
//
// ── Lo que se midió antes de escribir esto (1-sep) ────────────────────────
// 126 créditos con saldo entre las seis salas, $4,646.21, 43 clientes. De esos,
// **35 pasados del mes de plazo** ($443.70) y el más viejo con **462 días**.
// Nadie los está mirando: no existe ninguna pantalla que los liste.
//
// ── La trampa del nombre, que rompe en silencio ───────────────────────────
// El formulario del origen manda el parámetro `id_factura`, y **lo que lleva
// adentro es el ID DEL CRÉDITO**. Medido: el crédito 102 se pide con
// `?id_credito=102`, su campo oculto `id_factura` vale `102`, y la factura de
// ese mismo crédito es la **19228**. Mandar el número de la factura abonaría al
// crédito de otra persona —o a ninguno— sin dar error. Por eso acá el parámetro
// se llama `credito` y la traducción al nombre ajeno se hace en un solo sitio.
// ═══════════════════════════════════════════════════════════════════════════


const json = (b: unknown, s = 200, h: HeadersInit = {}) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", ...h } });

/** El día de El Salvador (UTC−6, sin horario de verano) de un instante. */
const diaSV = (ms = Date.now()) => new Date(ms - 6 * 3600_000).toISOString().slice(0, 10);

// ── Un envío = UNA escritura en la caja (2026-10-23) ──────────────────────
//
// Un abono en el origen NO se deshace. Antes de escribirlo se RECLAMA el
// envío en la base (`creditos_cobro_tomar`, atómico por la clave primaria):
//   · `pagar`          clave 'pagar:<clave_envio>', la genera el diálogo una
//                      vez por intento y viaja igual en cada reintento.
//   · `resolver_otro`  clave 'resolver:<solicitud>'.
// Quien no lo gana no toca la caja: si ya se hizo, contesta lo mismo que la
// primera vez; si otro lo está haciendo, lo dice. Un reclamo de una ejecución
// muerta (>10 min) se RETOMA, y quien retoma busca en el historial del crédito
// lo que la anterior alcanzó a abonar antes de escribir nada.
type Toma =
  | { tomado: true; retomado: boolean; desde?: string }
  | { tomado: false; estado: "hecho" | "en_curso"; respuesta?: Record<string, unknown> | null; hace_seg?: number };

// deno-lint-ignore no-explicit-any
type Db = any;

async function tomarEnvio(db: Db, clave: string, sala: number, quienId: string): Promise<Toma> {
  const { data, error } = await db.rpc("creditos_cobro_tomar",
    { p_clave: clave, p_branch_id: sala, p_tomado_por: quienId });
  // Sin reclamo no se escribe: un freno que falla abierto no es un freno.
  if (error) throw new Error(`reclamando el envío ${clave}: ${error.message}`);
  return data as Toma;
}
async function terminarEnvio(db: Db, clave: string, respuesta: Record<string, unknown>) {
  const { error } = await db.from("creditos_cobro_envios")
    .update({ estado: "hecho", respuesta, terminado_at: new Date().toISOString() })
    .eq("clave", clave);
  if (error) console.error(`[creditos-erp] cerrando el envío ${clave}: ${error.message}`);
}
/** Sólo cuando NADA llegó a la caja: deja reintentar con la misma clave. */
async function soltarEnvio(db: Db, clave: string) {
  const { error } = await db.from("creditos_cobro_envios")
    .delete().eq("clave", clave).eq("estado", "en_curso");
  if (error) console.error(`[creditos-erp] soltando el envío ${clave}: ${error.message}`);
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const responder = (b: unknown, s = 200) => json(b, s, cors);

  try {
    const body = await req.json().catch(() => ({}));
    let accion = String(body.accion ?? "listar");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const quien = await requireActiveEmployeeUser(req, supabase);
    if (!quien) return responder({ ok: false, error: "Sesión inválida o empleado inactivo." }, 401);

    /* Módulo propio —`cuentas_por_cobrar`, la vista «Cuentas por cobrar»— y no
     * `caja_vales`: son dos preguntas distintas y las mira otra gente. Mirar la
     * cartera es `can_view`; abonar es MOVER el cajón, así que es `can_edit`.
     *
     * `pagar` también: es el cobro de hoy (un documento, uno o varios
     * créditos) y hasta el 2026-10-02 pasaba con `can_view` porque esta lista
     * sólo nombraba a `abonar`, que es el cobro viejo. Quien tenía la cartera
     * en sólo lectura —Supervisor/a de Ventas, en toda la red— podía cobrar en
     * cualquier sala mandando la petición a mano. La pantalla nunca le mostró
     * el botón; el freno real es éste. */
    const ESCRIBEN = ["abonar", "pagar"];
    /* Aplicar el anticipo de lo apartado a su factura al crédito (2026-10-20)
     * es parte del RETIRO en la caja, no del cobro de la cartera: lo hace
     * quien opera la caja, aunque no cobre créditos. */
    const [modulo, capacidad] = accion === "aplicar_anticipo"
      ? ["caja_vales", "can_edit"]
      : ESCRIBEN.includes(accion)
      ? ["cuentas_por_cobrar", "can_edit"]
      : ["cuentas_por_cobrar", "can_view"];
    const permiso = await permisoDeModulo(supabase, quien.id, modulo, capacidad as "can_view" | "can_edit");
    if (permiso.roto) return responder({ ok: false, error: permiso.roto }, 503);
    if (!permiso.puede) {
      return responder({ ok: false, error: capacidad === "can_edit"
        ? "No tienes permiso para cobrar créditos."
        : "No tienes permiso para ver las cuentas por cobrar." }, 403);
    }

    const mapa = getErpBranchMap().filter((e) => e.erpId !== 6);   // Bodega no vende al crédito

    // ── REFRESCAR HOY — la pantalla abierta relee los créditos del día ────
    //
    // «Se vendió al crédito y se quería abonar en el mismo momento» (usuario,
    // 2-oct): el cron de cada 10 min dejaba hasta 10 minutos sin ver el crédito
    // recién vendido. Ahora la pantalla lo pide al abrirse, cada minuto mientras
    // está a la vista, y cuando una búsqueda no encuentra nada.
    //
    // Va ANTES del login a propósito: lo normal es que otra pantalla de la misma
    // sala ya haya leído hace menos de un minuto, y entonces no se toca la caja
    // en absoluto. El tope lo decide la BASE (`creditos_tomar_lectura`, atómico)
    // y es por sala, no por persona: diez pantallas abiertas cuestan lo mismo
    // que una. La búsqueda sin resultado usa un tope corto —es el caso «lo
    // acaban de vender»— y es rara, así que no mueve el número.
    if (accion === "refrescar_hoy") {
      const tope = body.motivo === "busqueda" ? 10 : 60;
      const salas = permiso.alcanceTodo
        ? (body.sala ? mapa.filter((e) => e.branchId === Number(body.sala)) : mapa)
        : mapa.filter((e) => e.branchId === Number(permiso.emp?.branch_id));
      const hoy = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);

      let cookie: string | null = null;
      const filas: Record<string, unknown>[] = [];
      const leidas: number[] = [];
      const fallidas: string[] = [];
      for (const { branchId, erpId } of salas) {
        const { data: toca, error: eToca } = await supabase.rpc("creditos_tomar_lectura",
          { p_branch_id: branchId, p_segundos: tope });
        if (eToca) { fallidas.push(`sala ${branchId}: ${eToca.message}`); continue; }
        if (!toca) continue;
        try {
          if (!cookie) {
            const { username, password } = getCortesCreds();
            cookie = await getSessionCookie(username, password);
          }
          // En serie: la sucursal vive en la SESIÓN del origen.
          for (const c of await creditosDeLaSala(cookie, erpId, hoy, hoy)) filas.push({ ...c, branch_id: branchId });
          leidas.push(branchId);
        } catch (e) {
          fallidas.push(`sala ${branchId}: ${(e as Error).message}`);
        }
      }

      let cambiadas = 0;
      if (filas.length) {
        const { data, error } = await supabase.rpc("sync_creditos_batch", { p_filas: filas });
        if (error) {
          console.error("[creditos-erp] refrescar_hoy:", error.message);
          return responder({ ok: false, error: "No se pudo guardar la lectura." }, 500);
        }
        const r = Array.isArray(data) ? data[0] : data;
        cambiadas = Number(r?.cambiadas ?? 0);
      }
      if (fallidas.length) console.error("[creditos-erp] refrescar_hoy:", fallidas.join(" · "));

      // Cuándo se leyó por última vez cada sala que mira esta pantalla —leyera
      // ésta o la de otra persona—, para que el sello de «actualizado hace…»
      // diga la verdad.
      const { data: sellos, error: errSellos } = await supabase.from("creditos_lectura_sala")
        .select("leido_el").in("branch_id", salas.map((s) => s.branchId))
        .order("leido_el", { ascending: true }).limit(1);
      if (errSellos) console.error("[creditos-erp] sello de lectura:", errSellos.message);
      return responder({
        ok: fallidas.length === 0, leidas: leidas.length, cambiadas,
        leido_el: sellos?.[0]?.leido_el ?? null,
      });
    }

    const { username, password } = getCortesCreds();
    const cookie = await getSessionCookie(username, password);

    // ── LISTAR ───────────────────────────────────────────────────────────
    if (accion === "listar") {
      const desde = String(body.desde ?? "2025-01-01");
      const hasta = String(body.hasta ?? new Date().toISOString().slice(0, 10));
      /* Con alcance de una sala se lee SÓLO la suya. El navegador manda `sala`,
       * pero quien decide es el permiso: sin esto, cambiar un número en la
       * petición mostraría la cartera de otra sucursal. */
      const salas = permiso.alcanceTodo
        ? (body.sala ? mapa.filter((e) => e.branchId === Number(body.sala)) : mapa)
        : mapa.filter((e) => e.branchId === Number(permiso.emp?.branch_id));
      if (!salas.length) return responder({ ok: true, creditos: [] });

      const creditos: unknown[] = [];
      for (const { branchId, erpId } of salas) {
        // En serie y no en paralelo: la sucursal vive en la SESIÓN del origen,
        // así que dos lecturas a la vez se pisarían la sala y devolverían la
        // cartera equivocada sin dar ningún error.
        const filas = await creditosDeLaSala(cookie, erpId, desde, hasta);
        for (const c of filas) creditos.push({ ...c, branch_id: branchId });
      }
      return responder({ ok: true, creditos });
    }

    // ── PEDIR CORRECCIÓN — anular o corregir un abono ya cobrado ─────────
    //
    // «Si se quiere editar un abono, no permite; que sea como solicitud a
    // supervisor» (usuario, 2-sep). Quien cobró NO puede deshacerlo: un abono
    // ya aplicado es dinero, y borrarlo en silencio es justamente lo que la
    // bitácora existe para impedir.
    //
    // Un tipo solo, `ABONO_CREDITO_CHANGE`, con el qué adentro del `metadata`:
    // anular y corregir son la misma pregunta —«esto quedó mal, arréglalo»— y
    // separarlas obligaría a duplicar el enrutador de aprobadores por una
    // diferencia que sólo importa al aplicarla.
    if (accion === "pedir_correccion") {
      const sala = Number(body.sala);
      const credito = String(body.credito ?? "").trim();
      const abonoErp = String(body.abonoErp ?? "").trim();
      const que = String(body.que ?? "");
      const motivo = String(body.motivo ?? "").trim();

      /* Con alcance de una sala, sólo se piden correcciones de la PROPIA. Sin
       * esto, cambiar el número en la petición dejaba pedir la anulación de un
       * abono de otra sucursal — la decide un supervisor, pero la solicitud no
       * tendría que poder existir. Mismo freno que `historial` y `pagar`. */
      if (!permiso.alcanceTodo && Number(permiso.emp?.branch_id) !== sala) {
        return responder({ ok: false, error: "Ese crédito es de otra sucursal." }, 403);
      }
      if (!["ANULAR", "MONTO", "FORMA"].includes(que)) {
        return responder({ ok: false, error: "No se dijo qué corregir." }, 400);
      }
      if (!abonoErp) return responder({ ok: false, error: "Falta el abono." }, 400);
      if (motivo.length < 5) {
        return responder({ ok: false, error: "Escribe por qué hay que corregirlo." }, 400);
      }
      if (que === "MONTO" && !(Number(body.montoNuevo) > 0)) {
        return responder({ ok: false, error: "Falta el monto nuevo." }, 400);
      }
      if (que === "FORMA" && !FORMAS.includes(String(body.formaNueva))) {
        return responder({ ok: false, error: "Esa forma de pago no se acepta." }, 400);
      }

      /* Una sola solicitud viva por abono. Sin esto, dos personas piden lo
       * mismo, un supervisor aprueba las dos, y el abono se borra una vez y la
       * segunda corrección se aplica sobre un abono que ya no existe. */
      const { data: yaHay, error: eYaHay } = await supabase.from("approval_requests")
        .select("id").eq("type", "ABONO_CREDITO_CHANGE").eq("status", "PENDING")
        .eq("metadata->>abono_erp", abonoErp).maybeSingle();
      /* Nunca descartar el error de un query. Si esta lectura falla en silencio
       * el freno desaparece: dos solicitudes vivas sobre el mismo abono, y la
       * segunda se aplicaría sobre un abono que la primera ya borró. */
      if (eYaHay) throw new Error(`buscando solicitudes vivas: ${eYaHay.message}`);
      if (yaHay) {
        return responder({ ok: false, error: "Ya hay una solicitud pendiente sobre ese abono." }, 409);
      }

      const { data: sol, error: eSol } = await supabase.from("approval_requests").insert({
        type: "ABONO_CREDITO_CHANGE",
        employee_id: quien.id,
        status: "PENDING",
        note: motivo,
        metadata: {
          branch_id: sala, credito_erp: credito, abono_erp: abonoErp,
          que,
          monto_actual: body.montoActual ?? null,
          monto_nuevo: que === "MONTO" ? Number(body.montoNuevo) : null,
          forma_actual: body.formaActual ?? null,
          forma_nueva: que === "FORMA" ? String(body.formaNueva) : null,
          documento_nuevo: body.documentoNuevo ?? null,
          fecha_documento: body.fechaDocumento ?? null,
          pos: body.pos ?? null,
          comprobante_url: body.comprobanteUrl ?? null,
          lectura: body.lectura ?? null,
          cliente: body.cliente ?? null,
        },
      }).select("id").single();
      if (eSol) {
        /* 23505 es el índice único `approval_requests_un_abono_pendiente`: otra
         * persona pidió lo mismo entre la comprobación de arriba y este insert.
         * La ventana es estrecha y real, y por eso la garantía vive en la base
         * y no en el `if`. Acá sólo se traduce a algo que se pueda leer. */
        if (String((eSol as { code?: string }).code) === "23505") {
          return responder({ ok: false, error: "Ya hay una solicitud pendiente sobre ese abono." }, 409);
        }
        throw new Error(`creando la solicitud: ${eSol.message}`);
      }
      return responder({ ok: true, solicitud: sol.id });
    }

    // ── APLICAR una corrección ya aprobada ───────────────────────────────
    //
    // Editar es BORRAR y volver a abonar, decidido por el usuario y por lo que
    // el origen permite: su panel abona y borra, no edita. Deja dos renglones
    // en el historial de allá, y eso es la verdad — un abono corregido no es el
    // mismo abono.
    if (accion === "aplicar_correccion") {
      const solId = String(body.solicitud ?? "");
      if (!solId) return responder({ ok: false, error: "Falta la solicitud." }, 400);

      const { data: sol, error: eSol } = await supabase.from("approval_requests")
        .select("id, type, status, metadata, employee_id, note")
        .eq("id", solId).maybeSingle();
      if (eSol) throw new Error(`leyendo la solicitud: ${eSol.message}`);
      if (!sol) return responder({ ok: false, error: "Esa solicitud no existe." }, 404);
      if (sol.type !== "ABONO_CREDITO_CHANGE") {
        return responder({ ok: false, error: "Esa solicitud no es de un abono." }, 400);
      }
      if (sol.status !== "PENDING") {
        return responder({ ok: false, error: "Esa solicitud ya se resolvió." }, 409);
      }
      /* Quien pidió no puede aprobarse a sí mismo. La policy no alcanza: la
       * escritura la hace esta función con la llave del servidor, que no pasa
       * por RLS. Es la misma lección del kiosco, que aceptaba el PIN del propio
       * jefe que marcaba. */
      if (String(sol.employee_id) === String(quien.id)) {
        return responder({ ok: false, error: "No puedes aprobar tu propia solicitud." }, 403);
      }

      const meta = (sol.metadata ?? {}) as Record<string, unknown>;
      const sala = Number(meta.branch_id);
      const credito = String(meta.credito_erp ?? "");
      const abonoErp = String(meta.abono_erp ?? "");
      const que = String(meta.que ?? "");
      const entrada = mapa.find((e) => e.branchId === sala);
      if (!entrada) return responder({ ok: false, error: "Esa sala no está configurada." }, 400);

      const permisoDecidir = await permisoDeModulo(
        supabase, quien.id, "requests_cuentas_por_cobrar", "can_approve");
      if (permisoDecidir.roto) return responder({ ok: false, error: permisoDecidir.roto }, 503);
      if (!permisoDecidir.puede) {
        return responder({ ok: false, error: "No tienes permiso para decidir esto." }, 403);
      }

      /* Quien decide, sólo sobre SU sala si su permiso de aprobar es de una
       * sala. Hoy aprueban sólo cargos de toda la red, así que no frena a nadie
       * — está para el día que se le dé el permiso a un cargo de sala: sin
       * esto, borraría o aplicaría abonos en la caja de otra sucursal. */
      if (!permisoDecidir.alcanceTodo && Number(permisoDecidir.emp?.branch_id) !== sala) {
        return responder({ ok: false, error: "Esa solicitud es de otra sucursal." }, 403);
      }

      /* 1. ¿El abono TODAVÍA está? Si ya no está, no hay nada que corregir.
       *
       * ⚠️ **El borrado del origen NO se puede repetir.** `quitar` lleva el
       * `monto` y se lo devuelve al saldo del crédito **lo haya borrado o no**:
       * mandarlo dos veces sobre el mismo abono descuenta dos veces, y el
       * origen contesta «Success» las dos. Medido el 15-sep en el crédito 2405
       * de Salud 3: se aprobó TRES veces —la solicitud no se cerraba, ver
       * `resolved_at` más abajo— y el crédito quedó debiendo $20.85 sobre una
       * deuda real de $6.95, con el abonado en −$13.90.
       *
       * Cerrar bien la solicitud ya evita esa repetición. Esto es el segundo
       * cerrojo, y existe porque el primero falló: que no se le cobre de más a
       * un cliente no puede depender de que otra escritura no falle. Con el
       * abono ausente se cierra la solicitud y NO se escribe nada en la caja
       * —ni el borrado ni el abono nuevo—, porque no se puede distinguir «ya se
       * aplicó» de «lo borraron a mano», y de los dos errores posibles, cobrar
       * dos veces es el que no se deshace. */
      const antesDeBorrar = await abonosDelCredito(cookie, entrada.erpId, credito);
      if (!antesDeBorrar.some((a) => a.erp_id === abonoErp)) {
        const { error: eYaEstaba } = await supabase.from("approval_requests")
          .update({ status: "APPROVED", approver_id: quien.id })
          .eq("id", solId);
        if (eYaEstaba) {
          console.error("[creditos-erp] cerrando una ya aplicada:", eYaEstaba.message);
          return responder({
            ok: false,
            error: "Ese abono ya no estaba en la caja y la solicitud no se pudo cerrar. "
                 + "NO la apruebes de nuevo: avísale a Sistemas.",
          }, 500);
        }
        return responder({
          ok: true,
          que,
          nuevo: null,
          aviso: "Ese abono ya no estaba en la caja, así que no se volvió a tocar nada. "
               + "La solicitud queda cerrada.",
        });
      }

      // 2. Borrarlo, y COMPROBARLO releyendo: el origen contesta «Success»
      //    aunque no haya borrado nada, así que su palabra no prueba.
      const dijoQueSi = await quitarAbonoDelOrigen(
        cookie, entrada.erpId, abonoErp, credito, Number(meta.monto_actual) || 0);
      const quedan = await abonosDelCredito(cookie, entrada.erpId, credito);
      if (quedan.some((a) => a.erp_id === abonoErp)) {
        return responder({
          ok: false,
          error: dijoQueSi
            ? "El sistema de la caja dijo que lo borró, pero el abono sigue ahí."
            : "No se pudo borrar el abono.",
        }, 502);
      }

      // 3. Si era una corrección, se vuelve a abonar con los datos nuevos.
      let nuevo: Record<string, unknown> | null = null;
      let montoNuevo = 0;
      let formaNueva = "";
      if (que !== "ANULAR") {
        const monto = que === "MONTO" ? Number(meta.monto_nuevo) : Number(meta.monto_actual);
        const forma = que === "FORMA" ? String(meta.forma_nueva) : String(meta.forma_actual ?? "Efectivo");
        montoNuevo = monto;
        formaNueva = forma;
        const resp = await (await fetch(ABONO_URL, {
          method: "POST",
          headers: {
            Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: new URLSearchParams({
            process: "abonar", id_factura: credito, monto: monto.toFixed(2),
            tipo_doc: forma, num_doc: String(meta.documento_nuevo ?? ""),
          }).toString(),
          signal: AbortSignal.timeout(45_000),
        })).text();
        try { nuevo = JSON.parse(resp); } catch { nuevo = null; }
        if (String(nuevo?.typeinfo ?? "").toLowerCase() !== "success") {
          /* El viejo YA se borró. No hay forma de deshacerlo —el origen no tiene
           * «restaurar»— así que se contesta en rojo con el detalle: el crédito
           * quedó con MÁS saldo del que debe y alguien tiene que abonarlo a
           * mano. Callarlo sería dejar una deuda inventada. */
          console.error(`[creditos-erp] recolocar abono credito=${credito}: ${resp.slice(0, 600)}`);
          return responder({
            ok: false,
            error: `Se borró el abono viejo pero NO se pudo poner el nuevo de `
                 + `${monto.toFixed(2)}. Ese abono hay que rehacerlo a mano en la caja.`,
          }, 502);
        }
      }

      /* 4. Cerrar la solicitud y dejar el rastro del lado del portal.
       *
       * ⚠️ Esto escribía además `resolved_at`, que en `approval_requests` **no
       * existe** — sus columnas de cierre son `status`, `approver_id`,
       * `approver_note` y `updated_at`, que es como cierran `operar-caja` y las
       * otras tres. PostgREST rechaza el UPDATE ENTERO con PGRST204 cuando una
       * sola columna no está, así que el cierre no se escribía nunca; y como el
       * error sólo iba a consola, la corrección se aplicaba y la solicitud
       * seguía PENDING. Es la misma familia que el borrado de arriba: una
       * escritura que falla sin que nadie se entere.
       *
       * Su fallo NO se traga: acá el abono ya se borró y no hay «restaurar», así
       * que una solicitud que queda pendiente es una que alguien va a aprobar de
       * nuevo — y si era MONTO o FORMA, el segundo intento vuelve a abonar. */
      const { error: eCerrar } = await supabase.from("approval_requests")
        .update({ status: "APPROVED", approver_id: quien.id })
        .eq("id", solId);
      if (eCerrar) console.error("[creditos-erp] cerrando la solicitud:", eCerrar.message);

      /* El abono del portal se marca anulado —el trigger recalcula la fecha del
       * último abono— y, si hubo uno nuevo, se anota como otra fila. No se EDITA
       * la vieja: la bitácora dice lo que pasó, no lo que hubiera querido.
       *
       * ⚠️ Hasta el 2026-09-22 esto sólo anulaba: el comentario ya prometía la
       * fila nueva y el código nunca la escribía. La corrección del 19-sep
       * (crédito 2365 de Salud 1, $19.40 de efectivo a transferencia) dejó el
       * crédito pagado en la caja y, en el portal, un único abono ANULADO. Con
       * una corrección de MONTO en efectivo el daño es de plata: el corte de ese
       * día pierde el efectivo del esperado —`creditos_abonos_portal` es lo que
       * lee `cobros_portal_en_efectivo`— y anuncia un sobrante que nadie hizo.
       *
       * La fila nueva copia de la vieja lo que no cambió, **incluida la fecha**:
       * el cobro ocurrió ese día, con otro monto o por otra vía, y es ese corte
       * el que lo tiene que contar. */
      const { data: anulados, error: eAnular } = await supabase.from("creditos_abonos_portal")
        .update({ anulado_at: new Date().toISOString(), anulado_por: quien.id })
        .eq("branch_id", sala).eq("credito_erp", credito).is("anulado_at", null)
        .eq("monto", Number(meta.monto_actual))
        .select("pago_id, factura_erp, cliente, saldo_antes, abonado_por, created_at, fecha_documento, pos_proveedor, comprobante_url");
      if (eAnular) console.error("[creditos-erp] anulando el abono del portal:", eAnular.message);

      if (nuevo) {
        const viejo = (anulados ?? [])[0] as Record<string, unknown> | undefined;
        const saldoAntes = viejo?.saldo_antes == null ? null : Number(viejo.saldo_antes);
        const { error: eNuevo } = await supabase.from("creditos_abonos_portal").insert({
          pago_id: viejo?.pago_id ?? null,
          branch_id: sala,
          credito_erp: credito,
          factura_erp: viejo?.factura_erp ?? null,
          cliente: String(viejo?.cliente ?? meta.cliente ?? ""),
          monto: Number(montoNuevo.toFixed(2)),
          forma: formaNueva,
          // Lo mismo que se le mandó a la caja como `num_doc` al volver a abonar.
          documento: String(meta.documento_nuevo ?? "") || null,
          saldo_antes: saldoAntes,
          saldo_despues: saldoAntes == null ? null : Number((saldoAntes - montoNuevo).toFixed(2)),
          /* Quien COBRÓ, no quien firmó la corrección: el cobro sigue siendo de
           * quien lo recibió del cliente. */
          abonado_por: viejo?.abonado_por ?? sol.employee_id,
          ...(viejo?.created_at ? { created_at: viejo.created_at } : {}),
          fecha_documento: (meta.fecha_documento as string | null) || (viejo?.fecha_documento ?? null),
          comprobante_url: (meta.comprobante_url as string | null) || (viejo?.comprobante_url ?? null),
          lectura: meta.lectura ?? null,
          pos_proveedor: (meta.pos as string | null) || (viejo?.pos_proveedor ?? null),
          erp_abono_id: nuevo.id_abono_credito ? String(nuevo.id_abono_credito) : null,
        });
        if (eNuevo) console.error("[creditos-erp] anotando el abono corregido:", eNuevo.message);
      }

      // Refrescar el espejo para que la pantalla no muestre el saldo viejo.
      try {
        const { data: enEspejo, error: eLee } = await supabase.from("creditos_de_clientes")
          .select("fecha").eq("branch_id", sala).eq("credito_erp", credito).maybeSingle();
        if (eLee) console.error(`[creditos-erp] espejo lee: ${eLee.message}`);
        if (enEspejo?.fecha) {
          const filas = await creditosDeLaSala(cookie, entrada.erpId,
            String(enEspejo.fecha), String(enEspejo.fecha));
          // El error NO se descarta: si el espejo no se refresca, la pantalla
          // sigue mostrando el saldo VIEJO de un crédito que ya se corrigió, y
          // eso se ve exactamente igual que un saldo bueno. No lanza —la
          // corrección ya ocurrió y no se deshace por esto— pero queda anotado.
          const { error: eEspejo } = await supabase.rpc("sync_creditos_batch",
            { p_filas: filas.map((c) => ({ ...c, branch_id: sala })) });
          if (eEspejo) console.error(`[creditos-erp] espejo tras corregir: ${eEspejo.message}`);
        }
      } catch (e) {
        console.error(`[creditos-erp] espejo tras corregir: ${(e as Error).message}`);
      }

      /* Se contesta en rojo, pero recién acá: el rastro de arriba —marcar el
       * abono anulado y refrescar el espejo— tiene que escribirse igual, porque
       * en la caja la corrección ya ocurrió. Lo que NO puede pasar es que la
       * pantalla diga «aprobada» sobre una solicitud que sigue pendiente. */
      if (eCerrar) {
        return responder({
          ok: false,
          error: "El abono se corrigió en la caja, pero la solicitud no se pudo "
               + "cerrar. NO la apruebes de nuevo: avísale a Sistemas.",
        }, 500);
      }

      return responder({ ok: true, que, nuevo });
    }

    // ── RESOLVER un pago con «Otro», crédito por crédito ─────────────────
    //
    // «En la solicitud se debe poder confirmar individualmente si van más de 1
    // cuenta a abonar, si se rechaza 1 o más con motivo» (usuario, 2-sep). Una
    // liquidación del ISSS puede cubrir tres créditos y que dos correspondan y
    // el tercero no — resolverla en bloque obligaría a rechazar los tres.
    //
    // Aprobar sólo CONFIRMA: el abono ya se aplicó cuando la sala lo registró.
    // Rechazar lo DESHACE en el sistema de la caja y le devuelve el saldo al
    // crédito. Eso se puede desde hoy: la acción de borrado se auditó esta
    // mañana y el portal comprueba releyendo, porque el origen contesta
    // «Success» aunque no haya borrado nada.
    if (accion === "resolver_otro") {
      const solId = String(body.solicitud ?? "");
      const decisiones: { credito: string; decision: string; motivo?: string }[] =
        Array.isArray(body.decisiones) ? body.decisiones : [];
      if (!solId) return responder({ ok: false, error: "Falta la solicitud." }, 400);
      if (!decisiones.length) return responder({ ok: false, error: "No se decidió nada." }, 400);

      const { data: sol, error: eSol } = await supabase.from("approval_requests")
        .select("id, type, status, metadata, employee_id")
        .eq("id", solId).maybeSingle();
      if (eSol) throw new Error(`leyendo la solicitud: ${eSol.message}`);
      if (!sol) return responder({ ok: false, error: "Esa solicitud no existe." }, 404);
      if (sol.type !== "ABONO_APROBACION") {
        return responder({ ok: false, error: "Esa solicitud no es de un abono en aprobación." }, 400);
      }
      if (sol.status !== "PENDING") {
        return responder({ ok: false, error: "Esa solicitud ya se resolvió." }, 409);
      }
      // Quien pidió no se aprueba. La policy no alcanza: esto lo escribe la
      // función con la llave del servidor, que no pasa por RLS.
      if (String(sol.employee_id) === String(quien.id)) {
        return responder({ ok: false, error: "No puedes aprobar tu propia solicitud." }, 403);
      }

      const permisoDecidir = await permisoDeModulo(
        supabase, quien.id, "requests_cuentas_por_cobrar", "can_approve");
      if (permisoDecidir.roto) return responder({ ok: false, error: permisoDecidir.roto }, 503);
      if (!permisoDecidir.puede) {
        return responder({ ok: false, error: "No tienes permiso para decidir esto." }, 403);
      }

      const meta = (sol.metadata ?? {}) as Record<string, unknown>;
      const sala = Number(meta.branch_id);
      const entrada = mapa.find((e) => e.branchId === sala);
      if (!entrada) return responder({ ok: false, error: "Esa sala no está configurada." }, 400);
      /* Quien decide, sólo sobre SU sala si su permiso de aprobar es de una
       * sala. Hoy aprueban sólo cargos de toda la red, así que no frena a nadie
       * — está para el día que se le dé el permiso a un cargo de sala: sin
       * esto, borraría o aplicaría abonos en la caja de otra sucursal. */
      if (!permisoDecidir.alcanceTodo && Number(permisoDecidir.emp?.branch_id) !== sala) {
        return responder({ ok: false, error: "Esa solicitud es de otra sucursal." }, 403);
      }
      const renglones = (Array.isArray(meta.creditos) ? meta.creditos : []) as
        Record<string, unknown>[];

      // Un rechazo SIN motivo no es un rechazo: quien pagó tiene derecho a
      // saber por qué se le devolvió el abono.
      for (const d of decisiones) {
        if (d.decision === "RECHAZADO" && String(d.motivo ?? "").trim().length < 5) {
          return responder({ ok: false, error: "Un rechazo necesita motivo." }, 400);
        }
      }

      /* ── Aprobar es APLICAR ─────────────────────────────────────────────
       *
       * Desde el cambio de modelo del 3-sep, un cobro que espera firma NO se
       * aplicó: el crédito sigue con su saldo. Así que confirmar un renglón es
       * abonarlo de verdad, y devolverlo no deshace nada — nunca bajó.
       *
       * `ya_aplicado` marca las solicitudes creadas con el modelo VIEJO, donde
       * el abono sí había entrado. Ahí vale lo de antes: confirmar sólo cierra
       * la solicitud y devolver deshace el abono en el origen. Son dos —las de
       * MAPFRE del 3-sep— y se dejan andar por su camino en vez de reescribir
       * su historia, que es lo único honesto: ese dinero sí se movió.
       */
      const yaAplicado = meta.ya_aplicado === true;
      const formaDelPago = String(meta.forma ?? "Otro");
      const docDelPago = String(meta.detalle ?? "");

      /* ── Reclamar ANTES de tocar la caja (HA2, 2026-10-23) ──────────────
       *
       * El orden era leer el estado, abonar —hasta 45 s por renglón— y recién
       * al final pasar la solicitud a APPROVED. Dos personas con permiso de
       * aprobar que la abrían a la vez pasaban las dos el chequeo de PENDING y
       * abonaban las dos; y un reintento después de un 504 la encontraba
       * todavía PENDING y abonaba otra vez. Los anticipos y el pago en línea ya
       * reclamaban antes de escribir; éste era el único camino que no. */
      const claveEnvio = `resolver:${solId}`;
      const toma = await tomarEnvio(supabase, claveEnvio, sala, String(quien.id));
      if (!toma.tomado) {
        if (toma.estado === "hecho") {
          /* Ya se aplicó. Si la solicitud quedó PENDING porque el cierre
           * falló, se intenta cerrar otra vez con lo que se guardó — sin
           * volver a escribir en la caja. */
          const previa = (toma.respuesta ?? {}) as Record<string, unknown>;
          const cierre = previa.cierre as Record<string, unknown> | null | undefined;
          if (cierre) {
            const { error: eCierre } = await supabase.from("approval_requests")
              .update(cierre).eq("id", solId).eq("status", "PENDING");
            if (eCierre) console.error(`[creditos-erp] re-cerrando ${solId}: ${eCierre.message}`);
            const { error: eLib } = await supabase.from("creditos_cobros_por_aprobar")
              .update({ resuelto_at: new Date().toISOString() })
              .eq("solicitud_id", solId).is("resuelto_at", null);
            if (eLib) console.error("[creditos-erp] liberando la reserva:", eLib.message);
          }
          return responder({ ...((previa.respuesta ?? { ok: true }) as Record<string, unknown>), repetido: true });
        }
        return responder({
          ok: false, codigo: "envio_en_curso",
          error: "Otra persona está resolviendo esta solicitud en este momento. "
               + "Espera un minuto y vuelve a abrirla antes de intentarlo otra vez.",
        }, 409);
      }

      /* Con el reclamo en la mano se mira el estado OTRA vez: el chequeo de
       * arriba fue antes de reclamar y entre los dos pudo cerrarse por otro
       * camino (cancelada, por ejemplo). */
      const { data: ahora, error: eAhora } = await supabase.from("approval_requests")
        .select("status").eq("id", solId).maybeSingle();
      if (eAhora) {
        await soltarEnvio(supabase, claveEnvio);
        throw new Error(`releyendo la solicitud: ${eAhora.message}`);
      }
      if (ahora?.status !== "PENDING") {
        await soltarEnvio(supabase, claveEnvio);
        return responder({ ok: false, error: "Esa solicitud ya se resolvió." }, 409);
      }

      const resultado: Record<string, unknown>[] = [];
      const fallidos: string[] = [];
      const entraron: { credito: string; monto: number; erp: Record<string, unknown>;
                        cliente: string; factura_erp: string; saldo_antes: number }[] = [];
      /* Si se llegó a LLAMAR al origen para abonar, el reclamo ya no se suelta
       * aunque algo falle después: una llamada que cortó por tiempo pudo haber
       * entrado, y soltarlo dejaría que un reintento la repita. */
      let tocoLaCaja = false;

      try {
        await abrirSala(cookie, entrada.erpId);

        /* ── El saldo VIVO, justo antes de abonar (HA1) ──────────────────
         *
         * El monto que se abona es el que se guardó al pedir la firma, y en el
         * medio el crédito pudo cobrarse en la caja o recibir otra
         * transferencia. Se relee del origen, igual que `pagar`, y un renglón
         * que ya no cabe NO se abona: queda sin decidir y se dice por qué. */
        const vivos = new Map<string, CreditoVivo>();
        if (!yaAplicado) {
          const aAprobar = renglones.filter((r) =>
            decisiones.find((x) => String(x.credito) === String(r.credito ?? ""))?.decision !== "RECHAZADO");
          const fechas = [...new Set(aAprobar.map((r) => String(r.fecha ?? "")))];
          const ventanas = fechas.some((f) => !f)
            ? [{ desde: "2020-01-01", hasta: diaSV() }]
            : fechas.map((f) => ({ desde: f, hasta: f }));
          for (const v of aAprobar.length ? ventanas : []) {
            for (const c of await creditosDeLaSala(cookie, entrada.erpId, v.desde, v.hasta)) vivos.set(c.credito, c);
          }
        }
        const { frenados } = revisarContraElSaldoVivo(
          renglones.map((r) => ({ credito: String(r.credito ?? ""), monto: Number(r.monto) })), vivos);
        const frenadoPor = new Map(frenados.map((f) => [f.renglon.credito, f.motivo]));
        const desde = toma.retomado && toma.desde ? diaSV(Date.parse(toma.desde)) : null;
        const usados = new Set<string>();

        for (const r of renglones) {
          const credito = String(r.credito ?? "");
          const monto = Number(r.monto);
          const d = decisiones.find((x) => String(x.credito) === credito);
          const devuelto = d?.decision === "RECHAZADO";

          if (!yaAplicado) {
            if (devuelto) {
              // Nada que hacer: nunca se aplicó. Ése es el punto del modelo nuevo.
              resultado.push({ ...r, decision: "RECHAZADO", motivo: d?.motivo ?? null });
              continue;
            }
            /* Retomando un envío que otra ejecución dejó a medias: lo que ésa
             * alcanzó a abonar ya está en el historial del crédito. */
            if (desde) {
              const previo = abonoQueYaEntro(
                await abonosDelCredito(cookie, entrada.erpId, credito),
                { monto, forma: formaDelPago, documento: docDelPago, desde }, usados);
              if (previo) {
                if (previo.erp_id) usados.add(previo.erp_id);
                entraron.push({
                  credito, monto, erp: { id_abono_credito: previo.erp_id },
                  cliente: String(r.cliente ?? ""),
                  factura_erp: String(r.factura_erp ?? ""),
                  saldo_antes: Number(r.saldo_antes ?? 0),
                });
                resultado.push({ ...r, decision: "APROBADO", motivo: null });
                continue;
              }
            }
            const frenado = frenadoPor.get(credito);
            if (frenado) {
              fallidos.push(frenado);
              resultado.push({ ...r, decision: null, motivo: null });
              continue;
            }
            tocoLaCaja = true;
            const ok = await abonarEnOrigen(cookie, credito, monto, formaDelPago, docDelPago);
            if (!ok.ok) {
              /* No entró. La solicitud NO se cierra por este renglón —se informa
               * y el renglón queda sin decidir— porque cerrarla diría que el
               * cobro se resolvió cuando ese dinero sigue sin aplicarse. */
              fallidos.push(`${credito}: la caja no aceptó el abono de ${monto.toFixed(2)}`);
              resultado.push({ ...r, decision: null, motivo: null });
              continue;
            }
            const vivo = vivos.get(credito);
            entraron.push({
              credito, monto, erp: ok.datos,
              cliente: String(r.cliente ?? ""),
              factura_erp: String(r.factura_erp ?? ""),
              // El saldo que el origen dio justo antes, no el de hace días.
              saldo_antes: vivo ? Number(vivo.saldo) : Number(r.saldo_antes ?? 0),
            });
            resultado.push({ ...r, decision: "APROBADO", motivo: null });
            continue;
          }

          /* ── El camino viejo: el abono YA está aplicado ───────────────── */
          if (!devuelto) {
            resultado.push({ ...r, decision: "APROBADO", motivo: null });
            continue;
          }
          /* Para deshacerlo hay que saber QUÉ abono es, y el id se lo puso el
           * origen. Se relee el crédito y se busca por monto; la forma acota pero
           * no se exige — hasta el 3-sep esto pedía `forma === "Otro"` y desde
           * v2.950.0 la forma real es la del pago, así que la condición
           * descartaba justo el abono que había que quitar. */
          const suyos = await abonosDelCredito(cookie, entrada.erpId, credito);
          const delMonto = suyos.filter((a) => Math.abs(a.monto - monto) < 0.005);
          const abono = (formaDelPago && delMonto.find((a) => a.forma === formaDelPago))
            || delMonto[0];
          if (!abono?.erp_id) {
            fallidos.push(`${credito}: no se encontró el abono para deshacerlo`);
            resultado.push({ ...r, decision: "RECHAZADO", motivo: d?.motivo ?? null, deshecho: false });
            continue;
          }
          tocoLaCaja = true;
          await quitarAbonoDelOrigen(cookie, entrada.erpId, abono.erp_id, credito, abono.monto);
          // El origen dice «Success» aunque no borre nada: se comprueba releyendo.
          const quedan = await abonosDelCredito(cookie, entrada.erpId, credito);
          const sigue = quedan.some((a) => a.erp_id === abono.erp_id);
          if (sigue) fallidos.push(`${credito}: el abono sigue ahí`);
          resultado.push({ ...r, decision: "RECHAZADO", motivo: d?.motivo ?? null, deshecho: !sigue });

          if (!sigue) {
            const { error: eAnular } = await supabase.from("creditos_abonos_portal")
              .update({ anulado_at: new Date().toISOString(), anulado_por: quien.id })
              .eq("branch_id", sala).eq("credito_erp", credito)
              .eq("monto", monto).is("anulado_at", null);
            if (eAnular) console.error("[creditos-erp] anulando el abono:", eAnular.message);
          }
        }
      } catch (e) {
        /* Algo cortó a mitad. Si nada llegó a la caja, se suelta para poder
         * reintentar; si algo se llamó, el reclamo se queda — el reintento lo
         * retoma a los 10 minutos y revisa el historial antes de escribir. */
        if (!tocoLaCaja && !entraron.length) await soltarEnvio(supabase, claveEnvio);
        throw e;
      }

      /* Lo que entró se anota del lado del portal, con la MISMA forma que un
       * cobro directo: el pago (el documento, una vez) y sus abonos. Se escribe
       * acá y no al pedir la firma porque hasta ahora no había cobro que anotar
       * — y `creditos_abonos_portal` es lo que el corte del día lee. */
      let pagoId: number | null = null;
      if (entraron.length) {
        const aplicado = Number(entraron.reduce((t, e) => t + e.monto, 0).toFixed(2));
        const { data: pago, error: ePago } = await supabase.from("creditos_pagos").insert({
          branch_id: sala,
          customer_id: (meta.customer_id as number | null) ?? null,
          cliente: String(meta.cliente ?? entraron[0].cliente),
          forma: formaDelPago,
          monto: aplicado,
          documento: docDelPago || null,
          fecha_documento: (meta.fecha_documento as string | null) || null,
          pos_proveedor: (meta.pos as string | null) || null,
          comprobante_url: (meta.comprobante_url as string | null) || null,
          lectura: meta.lectura ?? null,
          /* Quien COBRÓ, no quien firmó: el pago es de quien lo recibió del
           * cliente. Quién lo aprobó queda en la solicitud. */
          registrado_por: sol.employee_id,
        }).select("id").single();
        if (ePago) console.error("[creditos-erp] creditos_pagos:", ePago.message);
        pagoId = pago?.id ?? null;

        const { error: eAbonos } = await supabase.from("creditos_abonos_portal").insert(
          entraron.map((e) => ({
            pago_id: pagoId,
            branch_id: sala,
            credito_erp: e.credito,
            factura_erp: e.factura_erp || null,
            cliente: e.cliente,
            monto: Number(e.monto.toFixed(2)),
            forma: formaDelPago,
            documento: docDelPago || null,
            saldo_antes: e.saldo_antes,
            saldo_despues: Number((e.saldo_antes - e.monto).toFixed(2)),
            abonado_por: sol.employee_id,
            comprobante_url: (meta.comprobante_url as string | null) || null,
            lectura: meta.lectura ?? null,
            fecha_documento: (meta.fecha_documento as string | null) || null,
            pos_proveedor: (meta.pos as string | null) || null,
            erp_abono_id: e.erp?.id_abono_credito ? String(e.erp.id_abono_credito) : null,
          })),
        );
        if (eAbonos) console.error("[creditos-erp] abonos:", eAbonos.message);
      }

      /* La solicitud queda APROBADA aunque se haya devuelto algún renglón: lo
       * que se resolvió fue la solicitud, y el detalle de qué entró y qué no
       * vive en `creditos`. Marcarla RECHAZADA por un renglón diría que no se
       * aprobó nada, que es falso.
       *
       * Salvo que NADA se haya podido aplicar —por un fallo del origen o
       * porque el saldo ya no lo admite—: ahí sigue PENDING, porque el cobro no
       * se resolvió. Hay que reintentarlo o devolverlo. */
      const nadaEntro = !yaAplicado && !entraron.length
        && resultado.some((r) => r.decision === null);
      const respuesta = {
        ok: fallidos.length === 0,
        creditos: resultado,
        pago_id: pagoId,
        pendiente: nadaEntro,
        aviso: fallidos.length
          ? (yaAplicado
              ? `No se pudo deshacer: ${fallidos.join(" · ")}. Hay que quitarlo a mano en la caja.`
              : `No entró: ${fallidos.join(" · ")}. Ese dinero sigue sin aplicarse. `
                + "Si el crédito ya se cobró por otro lado, devuelve este cobro; si no, vuelve a intentarlo.")
          : undefined,
      };

      if (nadaEntro) {
        /* No se escribió nada que haya entrado: se suelta para que se pueda
         * reintentar o devolver. Si se LLAMÓ al origen y contestó que no, no
         * entró — es la misma lectura que hace `pagar`. */
        await soltarEnvio(supabase, claveEnvio);
      } else {
        const cierre = {
          // Sin `resolved_at`: esa columna no existe en `approval_requests` y
          // PostgREST rechazaba el UPDATE entero (PGRST204).
          status: "APPROVED", approver_id: quien.id,
          metadata: { ...meta, creditos: resultado, resuelto_por: quien.id,
                      pago_id: pagoId ? String(pagoId) : (meta.pago_id ?? null) },
        };
        /* El envío se marca HECHO antes de cerrar la solicitud: si el cierre
         * falla, el reintento encuentra «hecho» y cierra con lo guardado, sin
         * volver a abonar. Hasta hoy el cierre fallido dejaba la solicitud
         * PENDING y el reintento abonaba otra vez. */
        await terminarEnvio(supabase, claveEnvio, { respuesta, cierre });
        const { error: eCerrar } = await supabase.from("approval_requests")
          .update(cierre).eq("id", solId);
        if (eCerrar) {
          console.error(`[creditos-erp] cerrando la solicitud ${solId}: ${eCerrar.message}`);
          return responder({
            ...respuesta, ok: false,
            aviso: "El cobro se aplicó, pero la solicitud no se pudo cerrar. "
                 + "Vuelve a abrirla y confírmala otra vez: no se va a cobrar de nuevo.",
          }, 207);
        }

        /* Y se libera la reserva: ya nadie está esperando por esos créditos.
         * Se sella entre o no entre el abono — lo que la reserva impide es que
         * dos cobros esperen a la vez, no que el crédito se cobre otra vez. */
        const { error: eLib } = await supabase.from("creditos_cobros_por_aprobar")
          .update({ resuelto_at: new Date().toISOString() })
          .eq("solicitud_id", solId).is("resuelto_at", null);
        if (eLib) console.error("[creditos-erp] liberando la reserva:", eLib.message);
      }

      // Refrescar el espejo de los créditos que cambiaron.
      try {
        const fechas = [...new Set(renglones.map((r) => String(r.fecha)).filter(Boolean))];
        for (const f of fechas) {
          const filas = await creditosDeLaSala(cookie, entrada.erpId, f, f);
          const { error: eSync } = await supabase.rpc("sync_creditos_batch",
            { p_filas: filas.map((c) => ({ ...c, branch_id: sala })) });
          /* El resultado NO se descarta: si el espejo no se refresca, la
           * pantalla sigue mostrando el saldo viejo y quien acaba de resolver
           * cree que no pasó nada. No corta la respuesta —lo del origen ya está
           * hecho— pero queda en el log. */
          if (eSync) console.error(`[creditos-erp] espejo ${f}: ${eSync.message}`);
        }
      } catch (e) {
        console.error(`[creditos-erp] espejo tras resolver: ${(e as Error).message}`);
      }

      return responder(respuesta, fallidos.length ? 207 : 200);
    }

    // ── HISTORIAL — los abonos que el ORIGEN tiene de un crédito ─────────
    //
    // Corrige una afirmación equivocada: el portal decía que el sistema de la
    // caja «no expone la fecha de sus abonos, sólo el acumulado». Es falso — su
    // panel trae la tabla completa con fecha, hora, tipo, número y monto. La
    // conclusión vieja salió de mirar el LISTADO de créditos, que sí da sólo el
    // total, y de no abrir el panel.
    if (accion === "historial") {
      const sala = Number(body.sala);
      const credito = String(body.credito ?? "").trim();
      const entrada = mapa.find((e) => e.branchId === sala);
      if (!entrada) return responder({ ok: false, error: "Esa sala no está configurada." }, 400);
      if (!permiso.alcanceTodo && Number(permiso.emp?.branch_id) !== sala) {
        return responder({ ok: false, error: "Solo puedes ver tu propia sala." }, 403);
      }
      if (!credito) return responder({ ok: false, error: "Falta el crédito." }, 400);
      const abonos = await abonosDelCredito(cookie, entrada.erpId, credito);
      return responder({ ok: true, abonos });
    }

    // ── PAGAR — un documento que cubre uno o VARIOS créditos ─────────────
    //
    // Pregunta del usuario (2-sep): «¿qué pasa si hace una sola transferencia
    // para pagar 3 créditos?». No es un caso raro: medido, **24 de los 43
    // clientes con saldo tienen más de un crédito**, y uno tiene once.
    //
    // Un PAGO es el documento —un monto, una referencia, una vez— y los ABONOS
    // dicen cuánto de él se aplicó a cada crédito. Sin esa separación, el mismo
    // comprobante se anexaría N veces y la suma de los abonos daría el triple
    // de lo que el banco movió.
    if (accion === "pagar") {
      const sala = Number(body.sala);
      const forma = String(body.forma ?? "Efectivo");
      const documento = String(body.documento ?? "").trim();
      const montoDoc = Number(body.montoDocumento);
      const aplicaciones: { credito: string; monto: number }[] =
        Array.isArray(body.aplicaciones) ? body.aplicaciones : [];

      const entrada = mapa.find((e) => e.branchId === sala);
      if (!entrada) return responder({ ok: false, error: "Esa sala no está configurada." }, 400);
      if (!permiso.alcanceTodo && Number(permiso.emp?.branch_id) !== sala) {
        return responder({ ok: false, error: "Solo puedes cobrar en tu propia sala." }, 403);
      }
      if (!FORMAS.includes(forma)) {
        return responder({ ok: false, error: "Esa forma de pago no se acepta." }, 400);
      }
      if (!aplicaciones.length) {
        return responder({ ok: false, error: "No se eligió a qué crédito aplicar el pago." }, 400);
      }
      const limpias = aplicaciones
        .map((a) => ({ credito: String(a?.credito ?? "").trim(), monto: Number(a?.monto) }))
        .filter((a) => a.credito && Number.isFinite(a.monto) && a.monto > 0);
      if (limpias.length !== aplicaciones.length) {
        return responder({ ok: false, error: "Hay un renglón sin crédito o sin monto." }, 400);
      }
      const suma = Number(limpias.reduce((t, a) => t + a.monto, 0).toFixed(2));
      if (!(Number.isFinite(montoDoc) && montoDoc > 0)) {
        return responder({ ok: false, error: "Falta el monto del pago." }, 400);
      }
      /* La suma tiene que dar EXACTO. Aceptar menos dejaría una diferencia sin
       * dueño: el banco movió $50 y el portal explicaría $45, y esos $5 no
       * aparecerían en ninguna cuenta hasta la conciliación del mes. Si el
       * cliente pagó de más, eso es un saldo a favor y el sistema de la caja no
       * sabe qué es — hay que decirlo, no repartirlo. */
      if (Math.abs(suma - montoDoc) > 0.004) {
        return responder({
          ok: false,
          error: suma < montoDoc
            ? `El pago es de ${montoDoc.toFixed(2)} y lo repartido suma ${suma.toFixed(2)}. `
              + `Faltan ${(montoDoc - suma).toFixed(2)} por aplicar.`
            : `Lo repartido suma ${suma.toFixed(2)} y el pago es de ${montoDoc.toFixed(2)}.`,
        }, 400);
      }

      /* El mismo comprobante no se puede usar dos veces. Lo garantiza un índice
       * único, pero se comprueba ANTES de tocar el sistema de la caja: llegar
       * al índice significaría haber abonado ya y no poder registrarlo. */
      if (forma !== "Efectivo" && documento) {
        const { data: yaUsado, error: eDup } = await supabase
          .from("creditos_pagos").select("id, cliente, created_at")
          .eq("forma", forma).eq("documento", documento).maybeSingle();
        if (eDup) console.error("[creditos-erp] duplicado:", eDup.message);
        if (yaUsado) {
          return responder({
            ok: false,
            error: `Ese comprobante ya se usó el ${String(yaUsado.created_at).slice(0, 10)} `
                 + `para ${yaUsado.cliente}.`,
          }, 409);
        }
      }

      /* ── Un crédito que espera firma no se cobra por otro lado (HA1) ────
       *
       * Desde el 3-sep un cobro en aprobación NO se aplica: el crédito sigue
       * con su saldo y lo único que dice que ya tiene dueño es la reserva. La
       * pantalla apagaba el botón, pero `pagar` no la miraba — y el reparto de
       * una transferencia entre varios créditos sí lo proponía. Cobrarlo acá y
       * aprobar después la solicitud es cobrarlo dos veces. */
      const { data: reservados, error: eReservados } = await supabase
        .from("creditos_cobros_por_aprobar").select("credito_erp")
        .eq("branch_id", sala).is("resuelto_at", null)
        .in("credito_erp", limpias.map((a) => a.credito));
      if (eReservados) throw new Error(`leyendo las reservas: ${eReservados.message}`);
      if (reservados?.length) {
        return responder({
          ok: false,
          error: `El crédito ${reservados.map((r) => r.credito_erp).join(", ")} tiene un cobro esperando `
               + "aprobación. Hay que resolver ése primero.",
        }, 409);
      }

      /* ── La lectura del comprobante, la que firmó el SERVIDOR (HA5) ─────
       *
       * Pedido del usuario (2026-09-04), sobre el pago QR que trabó un cobro:
       * «debería de quedar como solicitud, a admin, así validan si se hizo
       * efectivo el pago y confirman, sólo cuando hay duda o pasa eso del
       * beneficiario».
       *
       * La duda la decide `leer-pago-de-credito`, y su respuesta viaja por el
       * navegador. Hasta el 2026-10-23 se le creía tal cual: con mandar
       * `lectura.nombreSinReconocer: false` una transferencia a una cuenta
       * personal entraba aplicada. Ahora sólo cuenta una lectura FIRMADA por el
       * servidor, de esta persona, de esta forma y reciente; sin eso el cobro
       * no se pierde, va a aprobación. La bandera del navegador sólo puede
       * SUMAR: si pide firma, va a firma. */
      const lecturaFirmada = await verificarLectura(
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, body.lectura, String(quien.id), forma);
      if (lecturaFirmada.valida && lecturaFirmada.veredicto !== "OK") {
        return responder({
          ok: false,
          error: "El comprobante no pasó la lectura. Vuelve a leerlo o cobra con otra forma.",
        }, 409);
      }
      const decision = decidirAprobacion({
        forma, pideElNavegador: body.requiereAprobacion === true, lectura: lecturaFirmada,
      });
      const dudaDeBeneficiario = decision.porBeneficiario || decision.porLecturaSinFirma;
      const pideAprobacion = decision.pide;
      if (decision.porLecturaSinFirma) {
        console.log(`[creditos-erp] pagar sala=${sala}: lectura sin firma válida `
          + `(${(lecturaFirmada as { motivo?: string }).motivo ?? "?"}) → aprobación`);
      }

      /* El EFECTIVO no espera, y esto no es una preferencia: ese dinero está
       * en el cajón desde que el cliente lo puso. Sin registrarlo en la caja,
       * el conteo del día daría un sobrante del tamaño del cobro — el mismo
       * defecto que costó anunciar +$78.40 sobre un faltante de $9.85, al
       * revés. Decisión del usuario (3-sep): el efectivo no pide aprobación.
       *
       * La guarda vive acá y no sólo en la pantalla: el navegador puede mandar
       * la bandera con cualquier forma. */
      if (pideAprobacion && forma === "Efectivo") {
        return responder({
          ok: false,
          error: "Un cobro en efectivo no puede quedar esperando aprobación: "
               + "ese dinero ya está en la caja y tiene que cuadrar con el conteo del día.",
        }, 400);
      }

      /* ── El MISMO intento no escribe dos veces (HA3, 2026-10-23) ───────
       *
       * Si la llamada corta —504 del gateway, la red del mostrador— con el
       * abono ya hecho, la pantalla dice «No se pudo cobrar» y el segundo toque
       * cobraba otra vez: un abono parcial cabe dos veces en el saldo, y las
       * dos filas suben el esperado del corte por un dinero que entró una sola
       * vez. El diálogo genera `clave_envio` UNA vez por intento y la manda
       * igual en cada reintento; acá se reclama antes de tocar la caja. Es el
       * mismo patrón que `operar-caja`, pero reclamando ANTES y no anotando
       * después: dos peticiones simultáneas no pasan las dos. */
      const claveCruda = String(body.clave_envio ?? "").trim().slice(0, 100);
      const claveEnvio = claveCruda ? `pagar:${claveCruda}` : null;
      let toma: Toma | null = null;
      if (claveEnvio) {
        toma = await tomarEnvio(supabase, claveEnvio, sala, String(quien.id));
        if (!toma.tomado) {
          if (toma.estado === "hecho") {
            console.log(`[creditos-erp] pagar repetido: ${claveEnvio}`);
            return responder({ ...(toma.respuesta ?? { ok: true }), repetido: true });
          }
          return responder({
            ok: false, codigo: "envio_en_curso",
            error: "Ese cobro ya se está enviando a la caja. Espera un momento y revisa el saldo "
                 + "del crédito antes de volver a intentarlo.",
          }, 409);
        }
      }
      /* Si se llegó a LLAMAR al origen para abonar, el reclamo no se suelta
       * aunque algo falle después: una llamada que cortó por tiempo pudo haber
       * entrado. Se retoma a los 10 minutos revisando el historial. */
      let tocoLaCaja = false;
      const soltar = async () => { if (claveEnvio) await soltarEnvio(supabase, claveEnvio); };
      const terminar = async (r: Record<string, unknown>) => {
        if (claveEnvio) await terminarEnvio(supabase, claveEnvio, r);
      };

      try {
        // El saldo vivo de cada crédito, releído del ORIGEN por la FECHA de cada
        // uno. Se agrupan las fechas: varios créditos del mismo día son una sola
        // lectura, y lo normal es que un cliente deba de días cercanos.
        const { data: enEspejo, error: eEspejo } = await supabase
          .from("creditos_de_clientes").select("credito_erp, fecha, cliente, customer_id")
          .eq("branch_id", sala).in("credito_erp", limpias.map((a) => a.credito));
        if (eEspejo) console.error("[creditos-erp] espejo:", eEspejo.message);
        const porCredito = new Map((enEspejo ?? []).map((r) => [r.credito_erp, r]));

        const fechas = [...new Set((enEspejo ?? []).map((r) => String(r.fecha)))];
        const vivos = new Map<string, Awaited<ReturnType<typeof creditosDeLaSala>>[number]>();
        const leidos: Awaited<ReturnType<typeof creditosDeLaSala>> = [];
        const ventanas = fechas.length
          ? fechas.map((f) => ({ desde: f, hasta: f }))
          : [{ desde: "2020-01-01", hasta: diaSV() }];
        for (const v of ventanas) {
          const filas = await creditosDeLaSala(cookie, entrada.erpId, v.desde, v.hasta);
          for (const c of filas) { vivos.set(c.credito, c); leidos.push(c); }
        }

        /* Retomando un intento que otra ejecución dejó a medias: lo que ésa
         * alcanzó a abonar ya está en el historial de cada crédito y NO se vuelve
         * a escribir — ni se cuenta contra el saldo, que ya lo descontó. */
        const yaEntraron = new Map<string, string | null>();
        if (toma?.tomado && toma.retomado && toma.desde) {
          const desde = diaSV(Date.parse(toma.desde));
          const usados = new Set<string>();
          for (const a of limpias) {
            const previo = abonoQueYaEntro(
              await abonosDelCredito(cookie, entrada.erpId, a.credito),
              { monto: a.monto, forma, documento, desde }, usados);
            if (previo) { yaEntraron.set(a.credito, previo.erp_id); if (previo.erp_id) usados.add(previo.erp_id); }
          }
        }

        for (const a of limpias) {
          if (yaEntraron.has(a.credito)) continue;
          const vivo = vivos.get(a.credito);
          if (!vivo) {
            await soltar();
            return responder({ ok: false, error: `El crédito ${a.credito} no existe en esta sala.` }, 404);
          }
          if (a.monto > vivo.saldo + 0.004) {
            await soltar();
            return responder({
              ok: false,
              error: `${vivo.cliente}: el crédito del ${vivo.fecha} debe ${vivo.saldo.toFixed(2)} `
                   + `y se le quiso aplicar ${a.monto.toFixed(2)}.`,
            }, 409);
          }
        }

        /* ── El cobro que espera firma NO se aplica ────────────────────────
         *
         * Decisión del usuario (3-sep), mirando la pantalla: «ahorita sale como
         * pagado, ¿no debería quedar como pendiente y con saldo? … si se aprueba
         * pasa a pagado, si se descarta continúa con saldo».
         *
         * Invierte lo del 2-sep. El motivo es que un abono aplicado deja el
         * crédito en $0.00, y un cero que todavía puede volver a subir se lee
         * como cobrado — nadie mira la solicitud detrás. Ahora el cobro se
         * GUARDA: al aprobar se abona de verdad, y al devolverlo no hay nada que
         * deshacer porque el saldo nunca bajó.
         *
         * Va DESPUÉS de validar el saldo vivo contra el origen y ANTES de
         * escribirle: lo que se guarda ya se comprobó que cabe, y no se toca
         * nada. */
        if (pideAprobacion) {
          const ficha = porCredito.get(limpias[0].credito);
          const beneficiarioLeido = String(
            (body.lectura as { leido?: { beneficiario?: unknown } } | null)?.leido?.beneficiario ?? "",
          ).trim();
          const renglones = limpias.map((a) => {
            const vivo = vivos.get(a.credito)!;
            return {
              credito: a.credito, monto: a.monto,
              cliente: vivo.cliente, fecha: vivo.fecha,
              factura_erp: vivo.factura_erp, saldo_antes: vivo.saldo,
              decision: null, motivo: null,
            };
          });

          const { data: sol, error: eSol } = await supabase.from("approval_requests").insert({
            type: "ABONO_APROBACION",
            employee_id: quien.id,
            status: "PENDING",
            /* La nota es el MOTIVO que escribió quien cobró —la pantalla se lo
             * exige, mínimo 5 caracteres—, no el número del documento: ése ya
             * viaja en `detalle`. */
            /* Cuando el cobro llegó acá por la duda del beneficiario, la nota lo
             * DICE: quien firma tiene que saber qué se le está preguntando. Sin
             * esto le llega un abono normal y no hay nada que le indique que lo
             * que se le pide es comprobar que el dinero entró. */
            note: dudaDeBeneficiario
              ? ((decision.porBeneficiario
                  ? "El comprobante no está a nombre de la empresa"
                    + (beneficiarioLeido ? `: dice «${beneficiarioLeido}»` : " y no se leyó a quién se le pagó")
                  : "No se pudo comprobar la lectura del comprobante")
                 + ". Comprobar que el pago entró antes de confirmarlo."
                 + (String(body.motivo ?? "").trim() ? ` — ${String(body.motivo).trim()}` : ""))
              : (String(body.motivo ?? "").trim() || documento || "Sin detalle"),
            metadata: {
              branch_id: sala, cliente: ficha?.cliente ?? renglones[0].cliente,
              customer_id: ficha?.customer_id ?? null,
              monto: Number(montoDoc.toFixed(2)),
              detalle: documento || null,
              forma,
              /* Todo lo que hace falta para APLICARLO después vive acá. Al
               * aprobar no se le vuelve a preguntar al navegador: si el monto o
               * la forma viajaran en la decisión, quien firma podría abonar algo
               * distinto de lo que se pidió. */
              fecha_documento: body.fechaDocumento || null,
              pos: body.pos || null,
              comprobante_url: body.comprobanteUrl || null,
              lectura: body.lectura || null,
              /* Por qué esta solicitud existe. `dudaDeBeneficiario` distingue el
               * cobro que alguien mandó a firmar del que el portal mandó solo. */
              por_beneficiario: dudaDeBeneficiario,
              creditos: renglones,
            },
          }).select("id").single();
          if (eSol) throw new Error(`creando la solicitud: ${eSol.message}`);

          /* La reserva. Sin esto el crédito queda con saldo y sin nada que diga
           * que ya lo están cobrando: dos personas lo cobran y el cliente paga
           * dos veces. El índice único es la garantía; el 23505 se traduce acá.
           *
           * Si falla, la solicitud NO puede quedar viva: sería un cobro esperando
           * firma sobre un crédito que sigue libre. Se borra —y la reserva se va
           * con ella por el CASCADE— y se avisa. */
          const { error: eRes } = await supabase.from("creditos_cobros_por_aprobar").insert(
            renglones.map((r) => ({
              solicitud_id: sol.id, branch_id: sala,
              credito_erp: r.credito, cliente: r.cliente, monto: r.monto,
            })),
          );
          if (eRes) {
            /* El borrado NO se descarta. Si falla, la solicitud queda VIVA sin su
             * reserva: un cobro esperando firma sobre un crédito que sigue libre,
             * o sea el agujero que la reserva vino a tapar. Se anota con el id
             * para poder ir a buscarla, y el mensaje al usuario lo dice: hay algo
             * a medias que alguien tiene que mirar. */
            const { error: eBorrar } = await supabase.from("approval_requests")
              .delete().eq("id", sol.id);
            if (eBorrar) {
              console.error(`[creditos-erp] solicitud ${sol.id} sin reserva y no se pudo borrar: ${eBorrar.message}`);
              return responder({
                ok: false,
                error: "El cobro no se registró y quedó una solicitud a medias. "
                     + "Avísale a Sistemas antes de volver a intentarlo.",
              }, 500);
            }
            await soltar();
            if (String((eRes as { code?: string }).code) === "23505") {
              return responder({
                ok: false,
                error: "Uno de esos créditos ya tiene un cobro esperando aprobación. "
                     + "Hay que resolver ése primero.",
              }, 409);
            }
            throw new Error(`reservando los créditos: ${eRes.message}`);
          }

          const pedida = {
            ok: true,
            solicitud: sol.id,
            aprobacionPedida: true,
            /* `aplicado: 0` y no el monto: no entró nada. Decir el monto acá
             * haría que la pantalla anunciara un cobro que todavía no ocurrió. */
            aplicado: 0,
            aplicaciones: renglones.map((r) => ({
              credito: r.credito, monto: r.monto, saldo_despues: r.saldo_antes,
            })),
          };
          await terminar(pedida);
          return responder(pedida);
        }

        /* ── Se escribe en el origen, de a uno ─────────────────────────────
         * No hay forma de hacerlo atómico: el sistema de la caja recibe un abono
         * por llamada. Si el tercero falla, los dos primeros YA entraron y ese
         * dinero se movió — así que no se deshace nada y se registra lo que sí
         * entró. Lo que NO se puede hacer es contestar 200: quien cobra tiene que
         * saber que el pago quedó a medias, con el cliente todavía enfrente. */
        const hechos: { credito: string; monto: number; vivo: typeof leidos[number]; erp: unknown }[] = [];
        const fallidos: string[] = [];
        for (const a of limpias) {
          const vivo = vivos.get(a.credito) ?? { credito: a.credito, saldo: a.monto, cliente: "", fecha: "", factura_erp: "" } as typeof leidos[number];
          if (yaEntraron.has(a.credito)) {
            // Ya estaba: lo abonó el intento anterior. Se anota, no se repite.
            hechos.push({ credito: a.credito, monto: a.monto, vivo: { ...vivo, saldo: Number((vivo.saldo + a.monto).toFixed(2)) },
                          erp: { id_abono_credito: yaEntraron.get(a.credito) } });
            continue;
          }
          tocoLaCaja = true;
          const r = await abonarEnOrigen(cookie, a.credito, a.monto, forma, documento);
          if (!r.ok) {
            fallidos.push(`${a.credito} (${a.monto.toFixed(2)})`);
            continue;
          }
          hechos.push({ credito: a.credito, monto: a.monto, vivo, erp: r.datos });
        }

        if (!hechos.length) {
          /* El origen contestó que no a todos: no entró nada, se puede volver a
           * intentar con la misma clave. */
          await soltar();
          return responder({
            ok: false,
            error: "La caja no aceptó el pago. Vuelve a intentarlo; si sigue igual, avisa a Sistemas.",
          }, 502);
        }

        // Releer para CONFIRMAR y refrescar el espejo al instante.
        const confirmados = new Map<string, number>();
        try {
          for (const v of ventanas) {
            const filas = await creditosDeLaSala(cookie, entrada.erpId, v.desde, v.hasta);
            for (const c of filas) confirmados.set(c.credito, c.saldo);
            const { error: eSync } = await supabase.rpc("sync_creditos_batch", {
              p_filas: filas.map((c) => ({ ...c, branch_id: sala })),
            });
            if (eSync) console.error(`[creditos-erp] espejo: ${eSync.message}`);
          }
        } catch (e) {
          console.error(`[creditos-erp] releer sala=${sala}: ${(e as Error).message}`);
        }

        const ficha = porCredito.get(hechos[0].credito);
        const aplicado = Number(hechos.reduce((t, h) => t + h.monto, 0).toFixed(2));

        const { data: pago, error: ePago } = await supabase.from("creditos_pagos").insert({
          branch_id: sala,
          customer_id: ficha?.customer_id ?? null,
          cliente: ficha?.cliente ?? hechos[0].vivo.cliente,
          forma,
          // El monto del DOCUMENTO cuando entró completo; lo aplicado cuando
          // quedó a medias. Guardar el del papel sobre un pago parcial diría que
          // entró un dinero que el portal no puede explicar.
          monto: fallidos.length ? aplicado : Number(montoDoc.toFixed(2)),
          documento: documento || null,
          fecha_documento: body.fechaDocumento || null,
          pos_proveedor: body.pos || null,
          comprobante_url: body.comprobanteUrl || null,
          lectura: body.lectura || null,
          registrado_por: quien.id,
        }).select("id").single();
        if (ePago) console.error("[creditos-erp] creditos_pagos:", ePago.message);

        const { error: eAbonos } = await supabase.from("creditos_abonos_portal").insert(
          hechos.map((h) => ({
            pago_id: pago?.id ?? null,
            branch_id: sala,
            credito_erp: h.credito,
            factura_erp: h.vivo.factura_erp,
            cliente: h.vivo.cliente,
            monto: Number(h.monto.toFixed(2)),
            forma,
            documento: documento || null,
            saldo_antes: h.vivo.saldo,
            // El saldo CONFIRMADO por el origen, no la resta: es lo que hace que
            // la bitácora sirva para auditar y no sólo para narrar.
            saldo_despues: confirmados.has(h.credito)
              ? confirmados.get(h.credito)
              : Number((h.vivo.saldo - h.monto).toFixed(2)),
            abonado_por: quien.id,
            comprobante_url: body.comprobanteUrl || null,
            lectura: body.lectura || null,
            fecha_documento: body.fechaDocumento || null,
            pos_proveedor: body.pos || null,
            erp_abono_id: (h.erp as Record<string, unknown>)?.id_abono_credito
              ? String((h.erp as Record<string, unknown>).id_abono_credito) : null,
          })),
        );
        if (eAbonos) console.error("[creditos-erp] abonos:", eAbonos.message);

        /* Acá vivía la creación de la solicitud de confirmación, DESPUÉS de haber
         * abonado. Se fue el 2026-09-03 con el cambio de modelo: hoy el cobro que
         * necesita firma ni siquiera llega a este punto — sale más arriba, sin
         * tocar el origen. Ver «El cobro que espera firma NO se aplica». */

        const avisos = [
          fallidos.length
            ? `Entraron ${hechos.length} de ${limpias.length}. NO entró: ${fallidos.join(", ")}. `
              + "Ese dinero no se aplicó; vuelve a intentarlo sólo por lo que faltó."
            : null,
          eAbonos ? "El pago entró, pero no se pudo anotar quién lo recibió. Avísale a Sistemas." : null,
        ].filter(Boolean);

        const respuesta = {
          ok: fallidos.length === 0,
          pago_id: pago?.id ?? null,
          aplicado,
          // Llegar acá significa que el cobro NO necesitaba firma: el que la
          // necesita salió mucho antes, sin tocar el origen.
          aprobacionPedida: false,
          aplicaciones: hechos.map((h) => ({
            credito: h.credito,
            monto: h.monto,
            saldo_despues: confirmados.get(h.credito) ?? null,
          })),
          aviso: avisos.length ? avisos.join(" ") : undefined,
        };
        /* HECHO con la respuesta: un reintento de este mismo intento recibe
         * esto mismo y no vuelve a tocar la caja. Lo que faltó se cobra con un
         * intento nuevo (otra clave), que es lo que hace la pantalla. */
        await terminar(respuesta);
        return responder(respuesta, fallidos.length ? 207 : 200);
      } catch (e) {
        if (!tocoLaCaja) await soltar();
        throw e;
      }
    }

    /* ── APLICAR EL ANTICIPO DE LO APARTADO (2026-10-20) ───────────────
     *
     * El sistema de la caja no acepta pago parcial: lo apartado con un pago
     * de por medio que no fue todo en efectivo se factura AL CRÉDITO, y lo
     * que el cliente ya pagó se abona a ese crédito (decisión del usuario:
     * «se envía al crédito, y ahí se abona parcialmente según el tipo de
     * pago»). Ese abono va con la forma «Recibo» y el código de la reserva:
     * el dinero ya entró el día del anticipo —al cajón o por otra vía—, y
     * abonarlo como «Efectivo» lo volvería a sumar al esperado del corte. Lo
     * que falta se cobra después como cualquier crédito, con su forma.
     *
     * El monto y el cliente los decide la base (`apartado_para_retirar`),
     * nunca el navegador; y el crédito tiene que ser de ESE cliente: abonar
     * el anticipo de una persona al crédito de otra no da error en el origen
     * y no se deshace. Después cae al abono de siempre. */
    let anticipoAplicado: { apartado: { reserva_id?: number; encargo_id?: number }; codigo: string; monto: number; reclamo: number } | null = null;
    if (accion === "aplicar_anticipo") {
      const sala = Number(body.sala);
      const credito = String(body.credito ?? "").trim();
      const ref = body.apartado && typeof body.apartado === "object" ? body.apartado as Record<string, unknown> : null;
      if (!ref || !(ref.reserva_id || ref.encargo_id)) return responder({ ok: false, error: "Falta qué se retira." }, 400);
      if (!permiso.alcanceTodo && Number(permiso.emp?.branch_id) !== sala) {
        return responder({ ok: false, error: "Sólo puedes retirar en tu propia sala." }, 403);
      }
      const apartado = ref.reserva_id ? { reserva_id: Number(ref.reserva_id) } : { encargo_id: Number(ref.encargo_id) };
      const { data: v, error: errV } = await supabase.rpc("apartado_para_retirar", { p_branch_id: sala, p_apartado: apartado });
      if (errV || !v) return responder({ ok: false, error: errV?.message || "No se pudo leer lo apartado." }, 409);
      if (v.aplicado) return responder({ ok: false, error: "El anticipo de esto ya se aplicó." }, 409);
      if (!v.listo) return responder({ ok: false, error: "Todavía no está listo para retirar." }, 409);
      if (!(Number(v.pagado) > 0)) return responder({ ok: false, error: "No tiene anticipo que aplicar." }, 409);

      /* Sin crédito elegido: se lee el día de HOY de la sala en el origen —la
       * factura al crédito se acaba de hacer y la pasada de diez minutos aún
       * no la trae— y se contestan los créditos de ESE cliente que pueden
       * recibir el anticipo. Elegir entre ellos es de quien tiene la factura
       * en la mano. El amarre con la ficha sale de la factura sincronizada:
       * una recién hecha tarda hasta un minuto. */
      if (!credito) {
        const entrada = mapa.find((e) => e.branchId === sala);
        if (!entrada) return responder({ ok: false, error: "Esa sala no está configurada." }, 400);
        const hoy = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
        try {
          const delDia = await creditosDeLaSala(cookie, entrada.erpId, hoy, hoy);
          if (delDia.length) {
            const { error: errEspejo } = await supabase.rpc("sync_creditos_batch", {
              p_filas: delDia.map((c) => ({ ...c, branch_id: sala })),
            });
            if (errEspejo) console.error(`[creditos-erp] retiro espejo: ${errEspejo.message}`);
          }
        } catch (e) {
          console.error(`[creditos-erp] retiro leer hoy sala=${sala}: ${(e as Error).message}`);
        }
        const desde = new Date(Date.now() - 6 * 3600_000 - 3 * 86400_000).toISOString().slice(0, 10);
        const { data: cands, error: errC } = await supabase.from("creditos_de_clientes")
          .select("credito_erp, factura_erp, numero_doc, fecha, saldo, total")
          .eq("branch_id", sala).eq("customer_id", Number(v.customer_id)).gte("fecha", desde)
          .gte("saldo", Number(v.pagado) - 0.004).order("fecha", { ascending: false });
        if (errC) return responder({ ok: false, error: "No se pudieron leer los créditos." }, 503);
        return responder({ ok: true, candidatos: cands ?? [], retiro: v });
      }
      const { data: cred, error: errCred } = await supabase.from("creditos_de_clientes")
        .select("customer_id, saldo").eq("branch_id", sala).eq("credito_erp", credito).maybeSingle();
      if (errCred) return responder({ ok: false, error: "No se pudo leer el crédito." }, 503);
      if (!cred) return responder({ ok: false, error: "Ese crédito todavía no aparece. Espera un minuto y vuelve a intentarlo." }, 404);
      if (Number(cred.customer_id) !== Number(v.customer_id)) {
        return responder({ ok: false, error: `Ese crédito no es de ${v.cliente}. Factura al crédito a su nombre.` }, 409);
      }
      /* El anticipo se RECLAMA antes de tocar el origen: el índice único de
       * `apartado_aplicaciones` deja pasar uno solo aunque lleguen dos a la
       * vez (doble toque, portal y teléfono). Un abono en el origen no se
       * deshace, así que el freno tiene que estar antes y no después. Si el
       * origen lo rechaza, se suelta. */
      const { data: reclamo, error: errRec } = await supabase.from("apartado_aplicaciones").insert({
        ...apartado, branch_id: sala, modo: "CREDITO", monto: Number(v.pagado), credito_erp: credito, creado_por: quien.id,
      }).select("id").single();
      if (errRec?.code === "23505") return responder({ ok: false, error: "El anticipo de esto ya se aplicó." }, 409);
      if (errRec || !reclamo) return responder({ ok: false, error: "No se pudo reservar la aplicación. No se abonó nada." }, 503);
      anticipoAplicado = { apartado, codigo: v.codigo, monto: Number(v.pagado), reclamo: reclamo.id };
      body.credito = credito;
      body.monto = Number(v.pagado);
      body.forma = "Recibo";
      body.documento = String(v.codigo);
      accion = "abonar";
    }

    // ── ABONAR ───────────────────────────────────────────────────────────
    if (accion === "abonar") {
      /* Si el abono NO entra, el reclamo del anticipo se suelta para poder
       * reintentar. Si la petición lanza, se queda: no se sabe si el origen
       * lo aplicó, y un abono repetido no se deshace. */
      const fallar = async (b: Record<string, unknown>, st: number) => {
        if (anticipoAplicado?.reclamo) {
          const { error: errS } = await supabase.from("apartado_aplicaciones").delete().eq("id", anticipoAplicado.reclamo);
          if (errS) console.error(`[creditos-erp] soltar reclamo ${anticipoAplicado.reclamo}: ${errS.message}`);
        }
        return responder(b, st);
      };
      const sala = Number(body.sala);
      const credito = String(body.credito ?? "").trim();
      const monto = Number(body.monto);
      const forma = String(body.forma ?? "Efectivo");
      const documento = String(body.documento ?? "").trim();

      const entrada = mapa.find((e) => e.branchId === sala);
      if (!entrada) return fallar({ ok: false, error: "Esa sala no está configurada." }, 400);
      if (!permiso.alcanceTodo && Number(permiso.emp?.branch_id) !== sala) {
        return fallar({ ok: false, error: "Solo puedes abonar en tu propia sala." }, 403);
      }
      if (!credito) return fallar({ ok: false, error: "Falta a qué crédito se abona." }, 400);
      if (!(Number.isFinite(monto) && monto > 0)) {
        return fallar({ ok: false, error: "Falta el monto." }, 400);
      }
      // «Recibo» sólo para el anticipo ya cobrado: ver `aplicar_anticipo`.
      if (!FORMAS.includes(forma) && !(anticipoAplicado && forma === "Recibo")) {
        return fallar({ ok: false, error: "Esa forma de pago no se acepta." }, 400);
      }

      /* El saldo se relee del ORIGEN, no se cree el que mandó el navegador.
       * Entre que la pantalla cargó y alguien aprieta pueden haber abonado en
       * la caja: sin esto, un abono de más deja el crédito en saldo negativo y
       * el cliente pagó dos veces.
       *
       * Pero se relee SÓLO EL DÍA de ese crédito, y no el histórico entero:
       * la FECHA de un crédito no cambia nunca, así que sale del espejo del
       * portal y no hace falta ir a buscarla. Medido el 2-sep: la ventana de
       * un día son ~250 ms contra los 17.3 s de la tanda completa, y eso era
       * lo que alguien esperaba parado frente al cliente antes de cada abono.
       *
       * Si el espejo todavía no conoce el crédito —recién vendido, y la pasada
       * de los diez minutos aún no pasó— se cae al histórico. Es lento, pero es
       * el único caso donde no hay fecha de dónde partir. */
      const { data: enEspejo, error: errEspejoLee } = await supabase
        .from("creditos_de_clientes").select("fecha")
        .eq("branch_id", sala).eq("credito_erp", credito).maybeSingle();
      /* Nunca descartar el error de un query: si esta lectura falla en silencio
       * el abono sigue funcionando —cae al histórico entero— pero vuelve a
       * costar 17 s con el cliente enfrente, y nadie sabría por qué. */
      if (errEspejoLee) console.error(`[creditos-erp] espejo lee: ${errEspejoLee.message}`);
      const ventana = enEspejo?.fecha
        ? { desde: String(enEspejo.fecha), hasta: String(enEspejo.fecha) }
        : { desde: "2020-01-01", hasta: new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10) };

      const filas = await creditosDeLaSala(cookie, entrada.erpId, ventana.desde, ventana.hasta);
      const vivo = filas.find((c) => c.credito === credito);
      if (!vivo) return fallar({ ok: false, error: "Ese crédito no existe en esta sala." }, 404);
      if (monto > vivo.saldo + 0.004) {
        return fallar({
          ok: false,
          error: `Ese crédito debe ${vivo.saldo.toFixed(2)}. No se puede abonar más que eso.`,
          saldo: vivo.saldo,
        }, 409);
      }

      /* ⚠️ `id_factura` lleva el ID DEL CRÉDITO. No es un descuido de acá: es
       * el nombre que usa el formulario del origen, y su propio campo oculto
       * viaja con el número del crédito. Mandar el de la factura abonaría al
       * crédito de otra persona sin dar error. La traducción vive en esta
       * línea y en ninguna otra. */
      const resp = await (await fetch(ABONO_URL, {
        method: "POST",
        headers: {
          Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: new URLSearchParams({
          process: "abonar",
          id_factura: credito,
          monto: monto.toFixed(2),
          tipo_doc: forma,
          num_doc: documento,
        }).toString(),
        signal: AbortSignal.timeout(45_000),
      })).text();

      let datos: Record<string, unknown> = {};
      try { datos = JSON.parse(resp); } catch { /* se trata como fallo abajo */ }
      if (String(datos.typeinfo ?? "").toLowerCase() !== "success") {
        console.error(`[creditos-erp] abonar credito=${credito} sala=${sala}: ${resp.slice(0, 1000)}`);
        return fallar({
          ok: false,
          error: "La caja no aceptó el abono. Vuelve a intentarlo; si sigue igual, avisa a Sistemas.",
        }, 502);
      }

      /* ── CONFIRMAR que entró, releyendo esa sala en esa fecha ───────────
       *
       * Idea del usuario (2-sep): «luego de un abono verificar esa fecha y
       * sucursal … para confirmar que sí se hizo». Vale la pena y es barata:
       * una petición sobre el DÍA del crédito trae un puñado de filas, no las
       * 2,387 del histórico.
       *
       * Y no es ceremonia. Hasta acá lo único que decía que el abono entró era
       * el `typeinfo: success` del origen; el saldo que se devolvía era una
       * RESTA hecha en el portal. Si allá el abono se aplicara distinto —o a
       * otro crédito, que es exactamente lo que pasa si se manda el número
       * equivocado y **no da error**—, el portal informaría el saldo bonito y
       * nadie lo sabría. Acá el número que se guarda y se muestra es el que el
       * origen dice tener.
       *
       * Un fallo de la relectura NO invalida el abono: el dinero ya entró. Se
       * cae a la resta y se avisa. */
      let saldoConfirmado: number | null = null;
      let confirmado = false;
      let delDia: Awaited<ReturnType<typeof creditosDeLaSala>> = [];
      try {
        delDia = await creditosDeLaSala(cookie, entrada.erpId, vivo.fecha, vivo.fecha);
        const post = delDia.find((c) => c.credito === credito);
        if (post) { saldoConfirmado = post.saldo; confirmado = true; }
      } catch (e) {
        console.error(`[creditos-erp] releer sala=${sala} fecha=${vivo.fecha}: ${(e as Error).message}`);
      }

      const esperado = Number((vivo.saldo - monto).toFixed(2));
      const saldoFinal = saldoConfirmado ?? esperado;
      // Una diferencia acá no es un redondeo: es que el origen aplicó otra cosa.
      const descuadre = confirmado && Math.abs(saldoFinal - esperado) > 0.004;
      if (descuadre) {
        console.error(`[creditos-erp] descuadre credito=${credito}: esperado ${esperado}, `
                    + `el origen dice ${saldoFinal}`);
      }

      /* El espejo se actualiza YA con lo releído, no dentro de diez minutos.
       * Quien acaba de cobrar mira la pantalla en ese momento, y verla con la
       * deuda vieja se lee como que el abono no entró — y el segundo intento
       * es cobrarle dos veces al cliente. */
      if (delDia.length) {
        const { error: errEspejo } = await supabase.rpc("sync_creditos_batch", {
          p_filas: delDia.map((c) => ({ ...c, branch_id: sala })),
        });
        if (errEspejo) console.error(`[creditos-erp] espejo: ${errEspejo.message}`);
      }

      /* Quién cobró y a qué hora — que es lo que el origen NO guarda: allá el
       * abono queda a nombre del usuario de la caja, que es el mismo para toda
       * la sala. Sin esta fila, «¿quién recibió ese dinero?» no tiene respuesta.
       *
       * Va DESPUÉS del abono y su fallo no lo deshace: el dinero ya entró. Se
       * anota el error y se contesta ok con aviso, que es lo honesto. */
      const { error: errLog } = await supabase.from("creditos_abonos_portal").insert({
        branch_id: sala, credito_erp: credito, factura_erp: vivo.factura_erp,
        cliente: vivo.cliente, monto: Number(monto.toFixed(2)),
        forma, documento: documento || null,
        // El saldo de DESPUÉS es el que el origen confirmó, no la resta: es lo
        // que hace que la bitácora sirva para auditar y no sólo para narrar.
        saldo_antes: vivo.saldo, saldo_despues: saldoFinal,
        abonado_por: quien.id,
        erp_abono_id: datos.id_abono_credito ? String(datos.id_abono_credito) : null,
      });

      /* El anticipo queda APLICADO —una vez por reserva o encargo— y lo
       * apartado, entregado. Si esto falla, el abono ya entró: se dice. */
      let errAplicacion: string | null = null;
      if (anticipoAplicado) {
        // La aplicación ya quedó reclamada arriba; acá sólo se entrega.
        const { error: errReg } = await supabase.rpc("apartado_marcar_entregado", {
          p_apartado: anticipoAplicado.apartado, p_employee: quien.id,
        });
        if (errReg) {
          console.error(`[creditos-erp] aplicar anticipo ${anticipoAplicado.codigo}: ${errReg.message}`);
          errAplicacion = errReg.message;
        }
      }

      const avisos = [
        errAplicacion
          ? `El anticipo se abonó al crédito, pero no se marcó entregado (${errAplicacion}). Márcalo con «Entregado».`
          : null,
        descuadre
          ? `El abono entró, pero el crédito quedó en ${saldoFinal.toFixed(2)} y se esperaba `
            + `${esperado.toFixed(2)}. Revísalo antes de cobrar otra vez.`
          : null,
        !confirmado ? "El abono se mandó, pero no se pudo confirmar el saldo nuevo." : null,
        errLog ? "El abono se hizo, pero no se pudo anotar quién lo recibió. Avísale a Sistemas." : null,
      ].filter(Boolean);

      return responder({
        ok: true,
        abono: datos,
        saldo_despues: saldoFinal,
        confirmado,
        aviso: avisos.length ? avisos.join(" ") : undefined,
      });
    }

    return responder({ ok: false, error: "Acción desconocida." }, 400);
  } catch (e) {
    console.error("creditos-erp:", e);
    return responder({ ok: false, error: (e as Error).message ?? "Error" }, 500);
  }
});
