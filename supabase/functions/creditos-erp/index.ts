import {
  getCorsHeaders, getErpBranchMap, permisoDeModulo, requireActiveEmployeeUser,
} from "../_shared/security.ts";
import {
  abonosDelCredito, creditosDeLaSala, FORMAS_DEL_PORTAL as FORMAS,
  getCortesCreds, getSessionCookie, quitarAbonoDelOrigen, ABONO_URL,
} from "../_shared/creditos.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const responder = (b: unknown, s = 200) => json(b, s, cors);

  try {
    const body = await req.json().catch(() => ({}));
    const accion = String(body.accion ?? "listar");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const quien = await requireActiveEmployeeUser(req, supabase);
    if (!quien) return responder({ ok: false, error: "Sesión inválida o empleado inactivo." }, 401);

    /* Módulo propio —`cuentas_por_cobrar`, la vista «Cuentas por cobrar»— y no
     * `caja_vales`: son dos preguntas distintas y las mira otra gente. Mirar la
     * cartera es `can_view`; abonar es MOVER el cajón, así que es `can_edit`. */
    const [modulo, capacidad] = accion === "abonar"
      ? ["cuentas_por_cobrar", "can_edit"]
      : ["cuentas_por_cobrar", "can_view"];
    const permiso = await permisoDeModulo(supabase, quien.id, modulo, capacidad as "can_view" | "can_edit");
    if (permiso.roto) return responder({ ok: false, error: permiso.roto }, 503);
    if (!permiso.puede) {
      return responder({ ok: false, error: "No tienes permiso para ver las cuentas por cobrar." }, 403);
    }

    const mapa = getErpBranchMap().filter((e) => e.erpId !== 6);   // Bodega no vende al crédito
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

      // 1. Borrar el abono viejo, y COMPROBARLO releyendo: el origen contesta
      //    «Success» aunque no haya borrado nada, así que su palabra no prueba.
      const dijoQueSi = await quitarAbonoDelOrigen(cookie, entrada.erpId, abonoErp);
      const quedan = await abonosDelCredito(cookie, entrada.erpId, credito);
      if (quedan.some((a) => a.erp_id === abonoErp)) {
        return responder({
          ok: false,
          error: dijoQueSi
            ? "El sistema de la caja dijo que lo borró, pero el abono sigue ahí."
            : "No se pudo borrar el abono.",
        }, 502);
      }

      // 2. Si era una corrección, se vuelve a abonar con los datos nuevos.
      let nuevo: Record<string, unknown> | null = null;
      if (que !== "ANULAR") {
        const monto = que === "MONTO" ? Number(meta.monto_nuevo) : Number(meta.monto_actual);
        const forma = que === "FORMA" ? String(meta.forma_nueva) : String(meta.forma_actual ?? "Efectivo");
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

      // 3. Cerrar la solicitud y dejar el rastro del lado del portal.
      const { error: eCerrar } = await supabase.from("approval_requests")
        .update({ status: "APPROVED", approver_id: quien.id, resolved_at: new Date().toISOString() })
        .eq("id", solId);
      if (eCerrar) console.error("[creditos-erp] cerrando la solicitud:", eCerrar.message);

      /* El abono del portal se marca anulado —el trigger recalcula la fecha del
       * último abono— y, si hubo uno nuevo, se anota como otra fila. No se EDITA
       * la vieja: la bitácora dice lo que pasó, no lo que hubiera querido. */
      const { error: eAnular } = await supabase.from("creditos_abonos_portal")
        .update({ anulado_at: new Date().toISOString(), anulado_por: quien.id })
        .eq("branch_id", sala).eq("credito_erp", credito).is("anulado_at", null)
        .eq("monto", Number(meta.monto_actual));
      if (eAnular) console.error("[creditos-erp] anulando el abono del portal:", eAnular.message);

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

      return responder({ ok: true, que, nuevo });
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
        : [{ desde: "2020-01-01", hasta: new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10) }];
      for (const v of ventanas) {
        const filas = await creditosDeLaSala(cookie, entrada.erpId, v.desde, v.hasta);
        for (const c of filas) { vivos.set(c.credito, c); leidos.push(c); }
      }

      for (const a of limpias) {
        const vivo = vivos.get(a.credito);
        if (!vivo) {
          return responder({ ok: false, error: `El crédito ${a.credito} no existe en esta sala.` }, 404);
        }
        if (a.monto > vivo.saldo + 0.004) {
          return responder({
            ok: false,
            error: `${vivo.cliente}: el crédito del ${vivo.fecha} debe ${vivo.saldo.toFixed(2)} `
                 + `y se le quiso aplicar ${a.monto.toFixed(2)}.`,
          }, 409);
        }
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
        const vivo = vivos.get(a.credito)!;
        const resp = await (await fetch(ABONO_URL, {
          method: "POST",
          headers: {
            Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: new URLSearchParams({
            process: "abonar",
            // ⚠️ `id_factura` lleva el ID DEL CRÉDITO — es el nombre que usa el
            // formulario del origen. Mandar el de la factura abonaría al
            // crédito de otra persona sin dar error.
            id_factura: a.credito,
            monto: a.monto.toFixed(2),
            tipo_doc: forma,
            num_doc: documento,
          }).toString(),
          signal: AbortSignal.timeout(45_000),
        })).text();
        let datos: Record<string, unknown> = {};
        try { datos = JSON.parse(resp); } catch { /* se trata como fallo abajo */ }
        if (String(datos.typeinfo ?? "").toLowerCase() !== "success") {
          console.error(`[creditos-erp] pagar credito=${a.credito}: ${resp.slice(0, 600)}`);
          fallidos.push(`${a.credito} (${a.monto.toFixed(2)})`);
          continue;
        }
        hechos.push({ credito: a.credito, monto: a.monto, vivo, erp: datos });
      }

      if (!hechos.length) {
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

      const avisos = [
        fallidos.length
          ? `Entraron ${hechos.length} de ${limpias.length}. NO entró: ${fallidos.join(", ")}. `
            + "Ese dinero no se aplicó; vuelve a intentarlo sólo por lo que faltó."
          : null,
        eAbonos ? "El pago entró, pero no se pudo anotar quién lo recibió. Avísale a Sistemas." : null,
      ].filter(Boolean);

      return responder({
        ok: fallidos.length === 0,
        pago_id: pago?.id ?? null,
        aplicado,
        aplicaciones: hechos.map((h) => ({
          credito: h.credito,
          monto: h.monto,
          saldo_despues: confirmados.get(h.credito) ?? null,
        })),
        aviso: avisos.length ? avisos.join(" ") : undefined,
      }, fallidos.length ? 207 : 200);
    }

    // ── ABONAR ───────────────────────────────────────────────────────────
    if (accion === "abonar") {
      const sala = Number(body.sala);
      const credito = String(body.credito ?? "").trim();
      const monto = Number(body.monto);
      const forma = String(body.forma ?? "Efectivo");
      const documento = String(body.documento ?? "").trim();

      const entrada = mapa.find((e) => e.branchId === sala);
      if (!entrada) return responder({ ok: false, error: "Esa sala no está configurada." }, 400);
      if (!permiso.alcanceTodo && Number(permiso.emp?.branch_id) !== sala) {
        return responder({ ok: false, error: "Solo puedes abonar en tu propia sala." }, 403);
      }
      if (!credito) return responder({ ok: false, error: "Falta a qué crédito se abona." }, 400);
      if (!(Number.isFinite(monto) && monto > 0)) {
        return responder({ ok: false, error: "Falta el monto." }, 400);
      }
      if (!FORMAS.includes(forma)) {
        return responder({ ok: false, error: "Esa forma de pago no se acepta." }, 400);
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
      if (!vivo) return responder({ ok: false, error: "Ese crédito no existe en esta sala." }, 404);
      if (monto > vivo.saldo + 0.004) {
        return responder({
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
        return responder({
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

      const avisos = [
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
