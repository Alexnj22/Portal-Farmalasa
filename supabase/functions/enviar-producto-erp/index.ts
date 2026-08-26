import { createClient } from "npm:@supabase/supabase-js@2";
import { checkCronSecret, getCorsHeaders, permisoDeModulo, requireActiveEmployeeUser } from "../_shared/security.ts";
import { BASE, login, pedir, leerRespuesta } from "../_shared/erp-dte.ts";
import {
  anotar,
  armarConcepto,
  conSala,
  apartadoQueEstorba,
  avisoDelAreaDeVencidos,
  type RenglonEnRiesgo,
  disponibleEnBodega,
  estadoDeRecepcion,
  leerUbicacion,
  hayEnTexto,
  hoySV,
  identificarTrasladoNuevo,
  lectorDeRecepcion,
  leerBien,
  pendientesDeOrigen,
  repartirEnLotes,
  resolverPresentacion,
  sesionEn as abrirSesionEn,
  traerFila,
  trasladoQueSalioPeseAlFallo,
  RECIBIR,
  TRASLADO,
} from "../_shared/erp-traslado.ts";

// Empujar producto a otra sala: el traslado al REVÉS.
//
// El portal ya sabía pedir —`aplicar-traslado-inventario`, donde la sala que no
// tiene abre la solicitud y la que tiene confirma—. Esto es el movimiento
// contrario y el más común de una bodega: llega un producto nuevo y hay que
// repartirlo, o uno está próximo a vencer y en esta sala no rota.
//
// ── La diferencia que ordena todo el archivo ───────────────────────────────
// **El producto sale ANTES de que nadie del otro lado opine.** No es una
// decisión de diseño: la caja va con el motorista y la sala de destino la ve
// cuando la tiene enfrente. Así que acá se despacha primero (`despachar`) y
// recién después llega la respuesta (`decidir`), que puede ser aceptar o
// devolver — y devolver es un segundo traslado, de vuelta, que la sala que
// envió confirma cuando la caja está en su estante (`recibir_devolucion`).
//
// ── UN TRASLADO POR RENGLÓN, y por qué no es un detalle ────────────────────
// `aplicar-traslado-inventario` manda un traslado con N líneas, porque del otro
// lado se recibe entero. Acá la decisión es POR PRODUCTO —la sala acepta tres y
// devuelve dos—, y la pantalla de recepción del sistema recibe el traslado
// COMPLETO: no hay forma de recibir media hoja. Entonces cada renglón es su
// propio traslado, igual que en el pedido de Bodega desde el 2026-08-11. Ese es
// el motivo de que exista `envio_linea` y de que el estado no viva en la
// cabecera.
//
// ── Lo que NO vive acá ─────────────────────────────────────────────────────
// Los parsers de las pantallas del sistema: viven en `_shared/erp-traslado.ts`
// y son los mismos que usan las otras tres funciones que mueven inventario. Dos
// copias de un parser de HTML leen la misma pantalla distinto en cuanto una se
// toca.

const sesionEn = (erpSucursal: number) => abrirSesionEn(erpSucursal, login);

/* Cuánto se permite trabajar contra el sistema antes de cortar y contestar qué
 * se hizo. Una Edge Function vive 150 s; 110 s deja margen para escribir el
 * resultado y responder. Lo que quede sin hacer se retoma apretando de nuevo:
 * cada renglón lleva su propio estado, así que reintentar no repite nada. */
const PRESUPUESTO_MS = 110_000;

interface Linea {
  id: string;
  posicion: number;
  erp_product_id: number;
  descripcion: string | null;
  presentacion_tipo: string;
  factor: number;
  cantidad: number;
  unidades: number;
  lotes: { lote?: string; vence?: string; unidades?: number }[] | null;
  estado: string;
  id_traslado: string | null;
  id_traslado_devolucion: string | null;
  detalle: Record<string, unknown> | null;
  motivo_rechazo: string | null;
}

/** La marca que deja este envío en el concepto del sistema. */
const claveDe = (requestId: string, posicion: number) =>
  `EV${String(requestId).replace(/-/g, "").slice(0, 8).toUpperCase()}-L${posicion}`;

/**
 * Los lotes con los que SALIÓ el renglón, en paquetes de su presentación.
 *
 * Es lo que ordena la devolución: lo que vuelve tiene que salir de los mismos
 * lotes con los que llegó, y sólo lo que no alcance se cubre con otro (con su
 * aviso). El despacho los deja en `detalle.renglones`, que es la única prueba
 * de qué lote salió — el sistema no lo muestra en el listado.
 */
function lotesDeIda(l: Linea): { numero: string; vence?: string; paquetes: number }[] {
  const r = (l.detalle?.renglones ?? []) as { cantidad?: number; lote?: string | null }[];
  return (Array.isArray(r) ? r : [])
    .filter((x) => x?.lote)
    .map((x) => ({ numero: String(x.lote), paquetes: Number(x.cantidad ?? 0) }))
    .filter((x) => x.paquetes > 0);
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  const arranque = Date.now();

  try {
    const {
      request_id,
      accion = "despachar",
      decisiones = null,
      nota = "",
    } = await req.json().catch(() => ({}));

    if (!request_id) return json({ ok: false, error: "Falta el envío." }, 400);
    if (!["despachar", "decidir", "recibir_devolucion"].includes(String(accion)))
      return json({ ok: false, error: `Acción desconocida: ${accion}` }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    /* ── Quién llama: una persona, o el cron que retoma lo que quedó ──────
     *
     * El cron existe porque un despacho que corta por tiempo dejaba renglones
     * `por_enviar` y la única salida era que alguien mirara la tarjeta — con
     * parte del envío ya fuera de la sala. Es el mismo hueco que costó los 6
     * renglones del pedido 120, y la misma respuesta.
     *
     * Firma con QUIEN ARMÓ EL ENVÍO y no con una cuenta de máquina: el
     * movimiento en el sistema lleva ese nombre en el concepto, y quien abra el
     * kardex dentro de un año tiene que leer a la persona que decidió mandar el
     * producto, no al proceso que terminó el trabajo. Mismo criterio que
     * `continuar-traslados-pedido`, que firma con `creado_por`.
     *
     * Y el cron NO elige qué renglones salen: manda un `request_id` y la
     * función resuelve el resto con su propia lectura. Un renglón que nadie
     * despachó no puede colarse por acá. */
    const porCron = checkCronSecret(req);
    let quien = porCron ? null : await requireActiveEmployeeUser(req, admin);
    if (!porCron && !quien)
      return json({ ok: false, error: "Sesión inválida o empleado inactivo." }, 401);
    if (porCron && accion !== "despachar")
      return json({ ok: false, error: "El cron sólo retoma despachos." }, 403);

    /* Despachar es `can_edit` —sacar producto de mi sala—; decidir es
     * `can_approve` —resolver sobre lo que llegó—. Son dos permisos porque son
     * dos actos distintos, y la base los separa igual (`puede_enviar_producto`
     * contra `puede_confirmar_traslado`). Recibir la devolución es del lado de
     * quien envió, así que vuelve a ser `can_edit`. */
    const accionPermiso = accion === "decidir" ? "can_approve" : "can_edit";
    const permiso = porCron
      // El cron ya está autorizado por su secreto, y la persona que firma es la
      // que armó el envío: su permiso se cobró cuando lo creó.
      ? { puede: true, alcanceTodo: true, emp: null, roto: null }
      : await permisoDeModulo(admin, quien!.id, "traslados", accionPermiso);
    if (permiso.roto) return json({ ok: false, error: permiso.roto }, 503);
    if (!permiso.puede)
      return json({
        ok: false,
        error: accion === "decidir"
          ? "No tienes permiso para decidir sobre los envíos de tu sala."
          : "No tienes permiso para enviar producto a otra sala.",
      }, 403);
    let emp = permiso.emp as { branch_id?: number } | null;
    const alcanceTodo = permiso.alcanceTodo;

    // ── El envío se relee de la BD, nunca se recibe del navegador ──────────
    const { data: sol, error: solErr } = await admin
      .from("approval_requests")
      .select("id, type, status, employee_id, note, metadata, approver_id")
      .eq("id", request_id)
      .maybeSingle();
    if (solErr) throw solErr;
    if (!sol) return json({ ok: false, error: "Ese envío no existe." }, 404);
    if (sol.type !== "INVENTORY_TRANSFER_PUSH")
      return json({ ok: false, error: `El tipo ${sol.type} no se aplica desde acá.` }, 422);

    /* Y recién acá se sabe con qué nombre firma el cron: el del envío. Se lee
     * de la base, nunca del cuerpo de la petición — quién armó el envío es un
     * hecho de la fila, no algo que el llamador pueda proponer. */
    if (porCron) {
      const { dato: autor, roto } = await leerBien<{ id: string; name: string; branch_id: number }>(
        admin.from("employees").select("id, name, branch_id").eq("id", sol.employee_id).maybeSingle(),
        "quién armó el envío",
      );
      if (roto) return json({ ok: false, error: roto }, 503);
      if (!autor) return json({ ok: false, error: "El envío no tiene a quién atribuirle el despacho." }, 422);
      quien = { id: autor.id, name: autor.name, status: "ACTIVO", code: "" };
      emp = { branch_id: autor.branch_id };
    }

    const meta = (typeof sol.metadata === "string" ? JSON.parse(sol.metadata) : sol.metadata) ?? {};
    const erpOrigen  = Number(meta.origen_erp_sucursal_id);
    const erpDestino = Number(meta.erp_sucursal_id);
    const branchOrigen  = Number(meta.origen_branch_id);
    const branchDestino = Number(meta.branch_id);
    if (!erpOrigen || !erpDestino)
      return json({ ok: false, error: "El envío no dice de qué sala sale o a cuál va." }, 422);

    const { data: mapaSalas, error: mapaErr } = await admin
      .from("erp_sucursal_map").select("erp_sucursal_id, branch_id, codigo, inv_ubicaciones, nombre");
    if (mapaErr) throw mapaErr;
    const porSucursal = new Map((mapaSalas ?? []).map((m) => [Number(m.erp_sucursal_id), m]));
    const porBranch   = new Map((mapaSalas ?? []).map((m) => [Number(m.branch_id), m]));
    const codigoDeBranch = (b: unknown) => porBranch.get(Number(b))?.codigo ?? null;

    /* La ubicación sale del MAPA, nunca del navegador: es de qué estante sale el
     * producto, y leerla mal no da error — saca de otro estante, o sea otro
     * lote y otra existencia.
     *
     * Cuál de los dos lo dice `origen_vencidos`, que el trigger ya validó:
     * contra que esa sala TENGA área de vencidos y contra
     * `v_inventario_disponible_vencidos`. Desde el 2026-08-24 Bodega puede
     * mandar de ahí — antes acá decía «y siempre la de trabajo», y eso dejaba a
     * Bodega sin poder empujar justo lo que más urge mover.
     *
     * El DESTINO no cambia nunca: lo que entra a una sala entra a su estante de
     * trabajo, aunque haya salido del área de vencidos de Bodega. Una sala que
     * recibe algo próximo a vencer lo pone a la venta — que es el punto. */
    const ubicacionDe = (
      m: { inv_ubicaciones?: unknown } | null | undefined,
      vencidos = false,
    ) => Number(
      (Array.isArray(m?.inv_ubicaciones)
        ? m!.inv_ubicaciones as { id: number; isVencidos: boolean }[]
        : []).find((u) => Boolean(u.isVencidos) === vencidos)?.id ?? 0,
    );
    const origenVencidos = meta.origen_vencidos === true;
    const ubicOrigen  = ubicacionDe(porSucursal.get(erpOrigen), origenVencidos);
    const ubicDestino = ubicacionDe(porSucursal.get(erpDestino));

    /* Y qué decir cuando no hay ubicación. Son DOS cosas distintas —la sala no
     * está mapeada, o está mapeada y no tiene área de vencidos— y decir la
     * genérica manda a buscar el problema al lugar equivocado. */
    const sinUbicacionOrigen = origenVencidos
      ? `La sala que envía (${erpOrigen}) no tiene área de vencidos.`
      : `No se conoce la ubicación de la sala que envía (${erpOrigen}).`;

    const { dato: lineasRaw, roto: lineasRoto } = await leerBien<Linea[]>(
      admin.from("envio_linea")
        .select("id, posicion, erp_product_id, descripcion, presentacion_tipo, factor, " +
                "cantidad, unidades, lotes, estado, id_traslado, id_traslado_devolucion, " +
                "detalle, motivo_rechazo")
        .eq("request_id", sol.id).order("posicion"),
      "los renglones del envío",
    );
    if (lineasRoto) return json({ ok: false, error: lineasRoto }, 503);
    const lineas = (lineasRaw ?? []) as Linea[];
    if (lineas.length === 0)
      return json({ ok: false, error: "Ese envío no tiene renglones." }, 422);

    /* Quién puede, y desde dónde. Se repite acá lo que decide el RLS porque
     * esta función usa la llave de servicio y el RLS no la frena; si las dos
     * reglas se separan, una deja pasar lo que la otra niega.
     *
     * La sala de RESPALDO entra igual que en el traslado: quién cubre a quién y
     * desde qué hora lo contesta `salas_que_cubre_ahora`, la MISMA función que
     * usa la policy. El error del RPC se propaga a propósito — si no se pudo
     * preguntar, no se puede afirmar que esta persona tenga permiso. */
    const puedeObrarPor = async (branch: number) => {
      if (alcanceTodo) return true;
      if (emp?.branch_id === branch) return true;
      if (emp?.branch_id == null) return false;
      const { data: cubiertas, error } = await admin
        .rpc("salas_que_cubre_ahora", { p_branch_id: emp.branch_id });
      if (error) throw error;
      return Array.isArray(cubiertas) && cubiertas.includes(branch);
    };

    // Acá `quien` ya está resuelto en los dos caminos —sesión o cron—, así que
    // el resto del archivo no distingue quién llamó.
    const actor = quien!;
    const yo = conSala({ ...(emp ?? {}), name: actor.name }, codigoDeBranch(emp?.branch_id));

    // ══════════════════════════════════════════════════════════════════════
    // DESPACHAR · en la sala que envía
    // ══════════════════════════════════════════════════════════════════════
    if (accion === "despachar") {
      if (sol.status !== "PENDING")
        return json({ ok: false, error: `Este envío ya está ${sol.status}.` }, 409);
      if (!ubicOrigen)
        return json({ ok: false, error: sinUbicacionOrigen }, 422);
      if (!(await puedeObrarPor(branchOrigen)))
        return json({ ok: false, error: "Este envío lo despacha la sala de la que sale el producto." }, 403);

      /* Lo que falta mandar. Una `enviada` no se vuelve a tocar, que es lo que
       * hace seguro apretar dos veces.
       *
       * Una línea en `error` sí se reintenta CUANDO LO PIDE UNA PERSONA —el
       * error suele ser algo que se corrige, como una existencia que volvió— y
       * NUNCA cuando el que retoma es el cron: reintentar a ciegas cada diez
       * minutos un renglón que el sistema ya rechazó es pelearse con él para
       * siempre. Es la misma regla que `reintentar-ingreso-pedido` aprendió con
       * las líneas cerradas a propósito. */
      const pendientes = lineas.filter((l) =>
        l.estado === "por_enviar" || (!porCron && l.estado === "error"));
      if (pendientes.length === 0)
        return json({ ok: false, codigo: "NADA_QUE_ENVIAR", error: "Ya salió todo lo de este envío." }, 409);

      /* El candado: el aviso le llega a varias personas de la sala y cualquiera
       * puede apretar. Sin esto, dos que aprieten a la vez pasan las dos la
       * lectura de estado y las dos escriben en el sistema.
       *
       * Vive en la BASE y no acá porque tomarlo y soltarlo escriben en el mismo
       * `metadata` donde el aviso al destino guarda su contador: un
       * `update({ metadata: { ...meta } })` es leer-modificar-escribir, y
       * borraba lo que la otra escritura había puesto en el medio. El `||` de
       * jsonb funde contra la fila viva. */
      const { data: tomada, error: candadoErr } = await admin
        .rpc("tomar_paso_envio", { p_request_id: sol.id, p_actor: actor.id, p_paso: "despachando" });
      // Sin mirar el `error`, un fallo de la consulta se leería como «alguien
      // más está despachando»: una respuesta del negocio que en realidad
      // significa «no se pudo preguntar». Son dos cosas y hay que decir cuál.
      if (candadoErr) {
        console.error("[enviar-producto-erp] candado:", candadoErr.message);
        return json({ ok: false, error: "No se pudo tomar el envío para despacharlo." }, 503);
      }
      if (tomada !== true)
        return json({
          ok: false, codigo: "YA_EN_CURSO",
          error: "Alguien más de tu sala está despachando este envío en este momento.",
        }, 409);

      const cookie = await sesionEn(erpOrigen);

      // La existencia de la ubicación se lee UNA vez y no por renglón: son ~4 s
      // y adentro del bucle un envío de cinco productos pagaría veinte.
      const lecturaOrigen = await leerUbicacion(cookie, erpOrigen, ubicOrigen);
      const enUbicacion = lecturaOrigen?.unidades ?? null;

      // Lo APARTADO en el área de vencidos de la sucursal que envía: el sistema
      // descarga de ahí primero y no pasa al estante, así que es la otra mitad
      // del tope (ver `disponibleEnBodega`). Hoy sólo Bodega tiene esa segunda
      // ubicación y una sala nunca la tiene, así que esta lectura no se paga en
      // el camino normal.
      //
      // Y NO se lee cuando el envío ya sale de ahí: esa mercadería es
      // justamente la que se quiere mandar, así que no hay nada que frenar —
      // frenarla contra sí misma daría un tope de cero. Mismo criterio que el
      // despacho de la solicitud.
      const ubicVencidos = origenVencidos ? 0 : ubicacionDe(porSucursal.get(erpOrigen), true);
      const lecturaVencidos = ubicVencidos
        ? await leerUbicacion(cookie, erpOrigen, ubicVencidos)
        : null;

      let conocidos = await pendientesDeOrigen(cookie, ubicOrigen);

      const hechas: Record<string, unknown>[] = [];
      const fallos: { producto: string; error: string }[] = [];
      // Los renglones que salieron de un producto con existencia apartada
      // INDISTINGUIBLE. Al terminar se relee el área de vencidos y se comprueba
      // que no bajó — es lo único para lo que sirve hoy `apartadoQueEstorba`,
      // que desde el 2026-08-26 ya no acota el despacho.
      const enRiesgo: (RenglonEnRiesgo & { id: string; avisoPrevio: string })[] = [];
      let cortadoEn = -1;

      /* Cuánto tarda cada renglón contra el sistema. No es diagnóstico de
       * sobra: es de donde va a salir el TOPE de productos por envío.
       *
       * El despacho corta a los 110 s, así que el tope existe hoy —sólo que no
       * está escrito en ningún lado y se descubre a mitad de camino—. Ponerlo
       * sin medir sería inventarlo: la misma decisión que en la solicitud a
       * varias salas, donde se dejó sin tope a propósito hasta tener el dato. */
      const msPorRenglon: number[] = [];

      for (let i = 0; i < pendientes.length; i++) {
        if (Date.now() - arranque > PRESUPUESTO_MS) { cortadoEn = i; break; }
        const arranqueRenglon = Date.now();
        const l = pendientes[i];
        const nombre = l.descripcion ?? String(l.erp_product_id);
        const clave = claveDe(sol.id, l.posicion);

        // Un fallo de un renglón NO tumba los otros: se anota en su fila y el
        // resto sigue. Cortar dejaría MÁS producto a medio camino, no menos.
        const fallar = async (msg: string) => {
          fallos.push({ producto: nombre, error: msg });
          await anotar(
            admin.from("envio_linea")
              .update({ estado: "error", error: msg, updated_at: new Date().toISOString() })
              .eq("id", l.id),
            `el fallo de ${nombre}`,
          );
        };

        const f = await traerFila(cookie, l.erp_product_id, ubicOrigen);
        if (!f.encontrado) { await fallar(`${nombre} no tiene existencia en tu sala.`); continue; }

        const pres = await resolverPresentacion(cookie, f, l.presentacion_tipo, l.factor);
        if (!pres) {
          await fallar(
            `${nombre}: se armó con ${l.presentacion_tipo} de ${l.factor}, y hoy ninguna ` +
            `presentación con ese nombre trae ese factor.`,
          );
          continue;
        }

        // El tope se relee ACÁ y no al armar el envío: entre una cosa y la otra
        // se vendió, se trasladó o alguien lo descartó. Y sale de los LOTES, no
        // de la casilla de existencia —que trae la del primer lote y no la del
        // producto (ver `disponibleEnBodega`)—.
        const hay = disponibleEnBodega(
          f, Number(pres.unidad),
          enUbicacion ? (enUbicacion.get(Number(l.erp_product_id)) ?? 0) : null,
          apartadoQueEstorba(lecturaOrigen, lecturaVencidos, Number(l.erp_product_id)),
        );
        if (Number(l.cantidad) > hay.paquetes) {
          // Lo apartado en el área de vencidos ya no achica este número: el
          // sistema respeta la ubicación desde el 26-ago (ver
          // `disponibleEnBodega`). Si falta, falta en el estante.
          await fallar(
            `De ${nombre} ${hayEnTexto(hay, "tu sala")}: alcanzan para ${hay.paquetes} y ` +
            `el envío lleva ${l.cantidad}.`,
          );
          continue;
        }

        // De qué lotes sale. Primero los que la pantalla eligió al armar el
        // envío, después el que vence primero — que es justo lo que un envío
        // por «próximo a vencer» quiere.
        const reservados = (l.lotes ?? [])
          .map((r) => ({
            numero: String(r?.lote ?? ""),
            vence: String(r?.vence ?? "").slice(0, 10),
            paquetes: Math.floor(Number(r?.unidades ?? 0) / (Number(pres.unidad) || 1)),
          }))
          .filter((r) => r.numero && r.paquetes > 0);

        const reparto = f.regulado
          ? repartirEnLotes(f.lotes, Number(l.cantidad), Number(pres.unidad), reservados, "el envío")
          : { renglones: [{ cantidad: Number(l.cantidad), idLote: "0", lote: null as string | null }], faltan: 0, avisos: [] as string[] };

        if (reparto.faltan > 0) {
          await fallar(
            `De ${nombre} faltan ${reparto.faltan} de ${l.presentacion_tipo}: los lotes de tu sala ` +
            `no alcanzan. Hay: ${f.lotes.map((x) => `${x.numero} (${x.stock})`).join(", ") || "ninguno"}.`,
          );
          continue;
        }

        const avisos = [...reparto.avisos];

        // El vale se LEE de la página y no se inventa: es un `uniqid()` que el
        // servidor pre-rellena en cada carga. Uno por movimiento.
        const html = await pedir(cookie, TRASLADO, undefined, { extra: { Referer: `${BASE}/dashboard.php` } });
        const vale = html.match(/numero_vale["'][^>]*value=["']([^"']+)["']/)?.[1] ?? "";
        if (!vale) { await fallar("El sistema no entregó el número de vale."); continue; }

        /* El concepto dice sólo lo que el sistema NO sabe: la clave para poder
         * encontrar este movimiento, quién lo mandó —con su sala, porque hay
         * nombres repetidos y la columna «usuario» es siempre la misma cuenta
         * del portal— y por qué. El producto, el origen y el destino ya están
         * en su propia pantalla. */
        const { concepto } = armarConcepto(
          `${clave} ENVIA ${yo} MOTIVO ${String(meta.motivo_tipo ?? "").toUpperCase()}`
          // De qué ÁREA salió, cuando no es la de siempre. El listado del
          // sistema muestra origen y destino como SUCURSALES, así que dos
          // envíos de Bodega se ven idénticos aunque uno haya salido del
          // estante de próximos a vencer. Es el único sitio donde ese dato
          // queda del lado del sistema de origen.
          + (origenVencidos ? " AREA VENCIDOS" : ""),
        );

        const total = reparto.renglones.reduce((s, r) => s + Number(pres.costo || 0) * r.cantidad, 0);
        const datos = reparto.renglones.map((r) => [
          l.erp_product_id, pres.costo, pres.precio, r.cantidad, pres.unidad,
          f.vence || "", pres.id, r.idLote,
        ].join("|")).join("#") + "#";

        const resp = leerRespuesta(await pedir(cookie, TRASLADO, new URLSearchParams({
          process: "insert",
          datos,
          id_traslado_guardado: "0",
          cuantos: String(reparto.renglones.length),
          total: total.toFixed(4),
          fecha: hoySV(),
          concepto,
          origen: String(ubicOrigen),          // la UBICACIÓN de donde sale
          id_suc_destino: String(erpDestino),  // la SUCURSAL que recibe
          id_ubicacion_destino: "0",
          numero_vale: vale,
        }), { extra: { Referer: TRASLADO } }));

        // La foto de DESPUÉS se toma pase lo que pase: hace falta tanto para
        // saber cuál es el propio como para saber si salió pese al «no».
        const despues = await pendientesDeOrigen(cookie, ubicOrigen);

        let idTraslado: string | null;
        let candidatos: string[];

        if (!resp.ok) {
          /* Un «no» del sistema no prueba que no salió: medido el 2026-08-17,
           * diez respuestas de fallo y dos traslados FINALIZADOS igual. Acá el
           * desenlace sería peor —el producto fuera de la sala y el portal
           * diciendo que sigue adentro—, así que antes de dar el fallo por
           * bueno se mira si apareció un traslado con este producto. */
          const { id, nuevos } = await trasladoQueSalioPeseAlFallo(cookie, conocidos, despues, [nombre]);
          conocidos = despues;
          if (!id) {
            await fallar(
              `El sistema no aceptó el traslado: ${resp.msg || "sin detalle"}`
              + (nuevos.length
                ? `. Ojo: salieron ${nuevos.length} traslado(s) más de esa sala en ese momento (${nuevos.join(", ")}), así que puede haber salido igual — compruébalo antes de reintentar.`
                : ""),
            );
            continue;
          }
          idTraslado = id;
          candidatos = [id];
          avisos.push(`el sistema contestó un fallo y sin embargo lo despachó: ${resp.msg || "sin detalle"}`);
        } else {
          // Cuál de los nuevos es el propio. «El que no estaba» no alcanza: la
          // sala despacha desde esta misma ubicación todo el día y uno que caiga
          // entre las dos fotos aparece como candidato. Desempatan el destino y
          // el contenido — ver `identificarTrasladoNuevo`.
          ({ id: idTraslado, candidatos } = await identificarTrasladoNuevo(
            cookie, conocidos, despues, html, erpDestino, [nombre],
          ));
          conocidos = despues;
        }

        // El producto YA SALIÓ. Esta fila es la única prueba de que salió y del
        // número con el que la otra sala puede recibirlo: sin ella el traslado
        // existe en el sistema y no existe para el portal.
        await anotar(
          admin.from("envio_linea").update({
            estado: "enviada",
            id_traslado: idTraslado,
            enviado_at: new Date().toISOString(),
            error: idTraslado ? null
              : `Salió, pero no se pudo distinguir cuál es entre ${candidatos.length} candidatos `
                + `(${candidatos.join(", ") || "ninguno"}). Buscar «${clave}» en el concepto.`,
            aviso: avisos.length ? avisos.join(" · ") : null,
            detalle: {
              producto: nombre,
              presentacion: `${l.presentacion_tipo} (${pres.unidad})`,
              id_presentacion_erp: pres.id,
              renglones: reparto.renglones,
              concepto, numero_vale: vale,
              existencia_previa: f.existencia,
              regulado: f.regulado,
              erp_ubicacion_origen: ubicOrigen,
              por: actor.id, por_nombre: actor.name,
              // Lo que tardó ESTE renglón. Es el dato con el que el tope se va
              // a revisar contra las corridas propias del envío, en vez de
              // contra las del pedido de Bodega, que es de donde salió el 20.
              ms: Date.now() - arranqueRenglon,
            },
            updated_at: new Date().toISOString(),
          }).eq("id", l.id),
          `la salida de ${nombre} (el producto YA salió, movimiento ${idTraslado ?? "sin identificar"})`,
          (m) => fallos.push({ producto: nombre, error: m }),
        );

        msPorRenglon.push(Date.now() - arranqueRenglon);
        hechas.push({ producto: nombre, cantidad: l.cantidad, id_traslado: idTraslado, avisos });
        if (hay.desdeVencidos > 0) {
          enRiesgo.push({
            id: String(l.id), pid: Number(l.erp_product_id), producto: nombre,
            antes: hay.desdeVencidos,
            // El aviso se SUMA al que ya se escribió —el lote que no era el
            // reservado, por ejemplo—, no lo pisa.
            avisoPrevio: avisos.join(" · "),
          });
        }
      }

      // Se suelta el candado en cuanto termina la corrida: lo que quedó se
      // reintenta apretando de nuevo, y hacer esperar tres minutos por eso no
      // protege de nada.
      await anotar(
        admin.rpc("soltar_paso_envio", { p_request_id: sol.id, p_paso: "despachando" }),
        "la salida del envío del despacho",
      );

      // ── Que el área de vencidos quede como estaba ──────────────────────────
      // El producto YA salió. Si el sistema descontó la fila apartada en vez de
      // la del estante, lo que queda torcido es el PAPEL y hay que reponer esa
      // existencia. Se relee UNA vez y sólo si algún renglón de riesgo salió: en
      // un envío normal esto no se ejecuta. Ver `avisoDelAreaDeVencidos`.
      //
      // Va DESPUÉS de soltar el candado a propósito: `leerUbicacion` reintenta y
      // puede tardar minutos, y el candado caduca a los 3 — dejarlo tomado por
      // una lectura que sólo agrega un aviso trabaría a quien quiera reintentar
      // lo que no salió.
      if (enRiesgo.length && ubicVencidos) {
        const despuesVencidos = await leerUbicacion(cookie, erpOrigen, ubicVencidos);
        for (const r of enRiesgo) {
          const nota = avisoDelAreaDeVencidos(r, despuesVencidos);
          if (!nota) continue;
          await anotar(
            admin.from("envio_linea").update({
              aviso: [r.avisoPrevio, nota].filter(Boolean).join(" · "),
              updated_at: new Date().toISOString(),
            }).eq("id", r.id),
            `el aviso del área de vencidos de ${r.producto}`,
            (m) => fallos.push({ producto: r.producto, error: m }),
          );
        }
      }

      // El aviso al destino sale AHORA, con los vales en la mano, y sólo si
      // algo salió de verdad. Avisar de una caja que no salió manda a alguien a
      // buscar lo que no existe.
      let avisados = 0;
      if (hechas.length > 0) {
        // Un aviso que no sale deja a la sala de destino con una caja que nadie
        // le anunció, y el producto ya salió: se dice, no se calla.
        const { data: n, error: avisoErr } = await admin
          .rpc("notificar_envio_despachado", { p_request_id: sol.id });
        if (avisoErr) {
          console.error("[enviar-producto-erp] aviso al destino:", avisoErr.message);
          fallos.push({
            producto: "el aviso a la otra sala",
            error: `El producto salió pero no se pudo avisar a ${meta.branch_name ?? "la otra sala"}: `
                 + `${avisoErr.message}. Avísales por otro medio.`,
          });
        }
        avisados = Number(n ?? 0);
      }

      return json({
        ok: fallos.length === 0 && cortadoEn < 0,
        // Lo que va a fijar el tope de renglones por envío, cuando haya
        // suficientes corridas para leerlo.
        ms_por_renglon: msPorRenglon,
        enviadas: hechas.length,
        pendientes: pendientes.length - hechas.length - fallos.length,
        avisados,
        hechas, fallos,
        ...(cortadoEn >= 0
          ? {
            codigo: "SIN_TIEMPO",
            error: `No alcanzó el tiempo: salieron ${hechas.length} de ${pendientes.length} productos. `
                 + `Vuelve a darle a enviar para los que faltan.`,
          }
          : {}),
      });
    }

    // ══════════════════════════════════════════════════════════════════════
    // DECIDIR · en la sala que recibió la caja
    // ══════════════════════════════════════════════════════════════════════
    if (accion === "decidir") {
      if (sol.status !== "PENDING")
        return json({ ok: false, error: `Este envío ya está ${sol.status}.` }, 409);
      if (!ubicDestino)
        return json({ ok: false, error: `No se conoce la ubicación de tu sala (${erpDestino}).` }, 422);
      if (!(await puedeObrarPor(branchDestino)))
        return json({ ok: false, error: "Este envío lo decide la sala a la que llegó el producto." }, 403);

      /* Las decisiones viajan como POSICIONES, nunca como renglones. Con
       * renglones, el navegador elegiría qué producto se mueve y del otro lado
       * hay credenciales para mover inventario de cualquier sala. Con
       * posiciones lo único que puede hacer es señalar cuáles de los que ya se
       * guardaron acepta y cuáles devuelve. Mismo contrato que
       * `lineas_aceptadas` del traslado. */
      const pedidas = Array.isArray(decisiones) ? decisiones : [];
      if (pedidas.length === 0)
        return json({ ok: false, error: "No se dijo qué hacer con ningún producto." }, 422);

      const { dato: motivosOk } = await leerBien<string[]>(
        admin.rpc("motivos_rechazo_envio"), "los motivos de devolución",
      );
      const motivos = (motivosOk ?? []) as string[];

      const trabajo: { l: Linea; aceptar: boolean; motivo: string; nota: string }[] = [];
      for (const d of pedidas) {
        const l = lineas.find((x) => x.posicion === Number(d?.i));
        if (!l) return json({ ok: false, error: `No hay un producto en la posición ${d?.i}.` }, 422);
        if (l.estado !== "enviada") continue;   // ya decidido, o nunca salió
        const aceptar = d?.aceptar !== false;
        const motivo = String(d?.motivo ?? "").trim();
        const notaL  = String(d?.nota ?? "").trim();
        if (!aceptar) {
          // Quien devuelve tiene que decir por qué, y de la lista: un motivo
          // libre no se puede contar ni comparar, y «Otro» sin texto es el
          // motivo vacío con otro nombre.
          if (!motivo || (motivos.length > 0 && !motivos.includes(motivo)))
            return json({
              ok: false, codigo: "FALTA_MOTIVO",
              error: `Para devolver ${l.descripcion ?? "un producto"} hay que decir por qué. `
                   + `Los motivos son: ${motivos.join(", ")}.`,
            }, 422);
          if (motivo === "Otro" && !notaL)
            return json({ ok: false, codigo: "FALTA_MOTIVO", error: "El motivo «Otro» necesita que se escriba cuál." }, 422);
        }
        trabajo.push({ l, aceptar, motivo, nota: notaL });
      }
      if (trabajo.length === 0)
        return json({ ok: false, codigo: "NADA_QUE_DECIDIR", error: "Esos productos ya estaban decididos." }, 409);

      /* ── El candado, también acá ───────────────────────────────────────
       * El aviso les llega a TODOS los que pueden contestar en la sala de
       * destino, así que dos pueden apretar a la vez: los dos pasan la lectura
       * de «¿qué falta decidir?» y los dos mandan a recibir el MISMO
       * movimiento, o sea que el producto entra dos veces al inventario.
       *
       * La guarda de más abajo —preguntarle al listado si el traslado sigue
       * esperando— no cierra esta ventana: reusa la cola hasta 20 segundos, que
       * es justo el tamaño del hueco. La achica; no la tapa. */
      const { data: tomado, error: candadoErr } = await admin
        .rpc("tomar_paso_envio", { p_request_id: sol.id, p_actor: actor.id, p_paso: "decidiendo" });
      if (candadoErr) {
        console.error("[enviar-producto-erp] candado decidir:", candadoErr.message);
        return json({ ok: false, error: "No se pudo tomar el envío para decidirlo." }, 503);
      }
      if (tomado !== true)
        return json({
          ok: false, codigo: "YA_EN_CURSO",
          error: "Alguien más de tu sala está contestando este envío en este momento.",
        }, 409);

      const cookie = await sesionEn(erpDestino);
      /* La cola de recepción se lee UNA vez y se reusa 20 s: preguntar por
       * renglón cuesta 250-880 ms y una guarda que hace lenta la operación es
       * una guarda que alguien quita. El caso que decide —«no está en la
       * cola»— se pregunta fresco igual. */
      const estadoDe = lectorDeRecepcion(cookie);

      const hechas: Record<string, unknown>[] = [];
      const fallos: { producto: string; error: string }[] = [];
      let cortadoEn = -1;
      // Para el traslado de vuelta hace falta saber qué había antes en la
      // ubicación de destino; se toma una vez y se va actualizando.
      let conocidos: Map<string, string> | null = null;

      for (let i = 0; i < trabajo.length; i++) {
        if (Date.now() - arranque > PRESUPUESTO_MS) { cortadoEn = i; break; }
        const { l, aceptar, motivo, nota: notaL } = trabajo[i];
        const nombre = l.descripcion ?? String(l.erp_product_id);
        const clave = claveDe(sol.id, l.posicion);
        const idIda = String(l.id_traslado ?? "");

        const fallar = (msg: string) => { fallos.push({ producto: nombre, error: msg }); };

        if (!idIda) {
          /* Salió del estante y no se pudo distinguir cuál movimiento es. No hay
           * nada que esta función pueda hacer con eso, pero SÍ hay algo que no
           * puede pasar: que la línea se quede en `enviada` para siempre.
           *
           * Mientras quede una `enviada` el envío nunca cierra —la cabecera se
           * queda PENDING, el aviso de vuelta no sale y la tarjeta pide una
           * decisión que ya se tomó—, así que pasa a `error`, que es lo que
           * significa de verdad: hay que mirarla a mano. La decisión de la sala
           * se guarda igual, para no perderla. */
          const msg = `${nombre} salió sin número de movimiento: hay que buscar «${clave}» en el sistema `
            + `y recibirlo a mano.`;
          await anotar(
            admin.from("envio_linea").update({
              estado: "error", error: msg,
              motivo_rechazo: aceptar ? null : motivo,
              nota_rechazo: aceptar ? null : (notaL || null),
              decidido_por: actor.id, decidido_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }).eq("id", l.id),
            `el renglón sin número de ${nombre}`,
          );
          fallar(msg);
          continue;
        }

        // ── Primero, que entre a la sala ───────────────────────────────────
        // Aceptar y devolver empiezan igual: el producto tiene que estar en el
        // inventario de esta sala. Devolver algo que no entró no se puede — no
        // se trasladan existencias que el sistema no tiene.
        let entro = false;
        const antes = await estadoDe(idIda);
        if (antes === "anulado") {
          await anotar(
            admin.from("envio_linea").update({
              estado: "error",
              error: `El movimiento ${idIda} está anulado en el sistema: el producto no entró a tu sala.`,
              updated_at: new Date().toISOString(),
            }).eq("id", l.id),
            `el traslado anulado de ${nombre}`,
          );
          fallar(`${nombre}: el movimiento ${idIda} está anulado, así que el producto no entró a tu sala.`);
          continue;
        }
        if (antes === "recibido") {
          entro = true;   // alguien lo recibió por el sistema; no se vuelve a cargar
        } else {
          const pagina = await pedir(cookie, `${RECIBIR}?id_movimiento=${encodeURIComponent(idIda)}`,
            undefined, { extra: { Referer: `${BASE}/admin_traslados.php` } });
          const filas = [...pagina.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/g)]
            .map((m) => m[0]).filter((tr) => /class="id_p"/.test(tr));
          if (filas.length === 0) { fallar(`El movimiento ${idIda} de ${nombre} no muestra líneas para recibir.`); continue; }

          const partes: string[] = [];
          let total = 0;
          for (const tr of filas) {
            const idProd = tr.match(/class="id_p">\s*([\d]+)/)?.[1] ?? "";
            const idPres = tr.match(/<select[^>]*class=['"]sel['"][^>]*>\s*<option[^>]*value=['"](\d+)['"]/)?.[1] ?? "";
            const compra = tr.match(/class=['"][^'"]*precio_compra[^'"]*['"][^>]*value=['"]\s*([\d.]+)/)?.[1] ?? "0";
            const venta  = tr.match(/class=['"][^'"]*precio_venta[^'"]*['"][^>]*value=['"]\s*([\d.]+)/)?.[1] ?? "0";
            const unidad = tr.match(/class=['"]unidad['"][^>]*value=['"](\d+)/)?.[1] ?? "1";
            const esp    = tr.match(/class=['"][^'"]*\besp\b[^'"]*['"][^>]*value=['"]\s*([\d.]+)/)?.[1] ?? "0";
            const vence  = tr.match(/class=['"][^'"]*\bvence\b[^'"]*['"][^>]*value=['"]([^'"]*)['"]/)?.[1] ?? "";
            if (!idProd || !idPres) continue;
            // ⚠️ El octavo campo acá NO es el lote: es lo ESPERADO. Mismo lugar
            // del string que en la salida, otro significado.
            partes.push([idProd, compra, venta, esp, unidad, vence, idPres, esp].join("|"));
            total += Number(compra) * Number(esp);
          }
          if (partes.length === 0) { fallar(`No se pudo leer ni una línea del movimiento ${idIda}.`); continue; }

          const { concepto } = armarConcepto(`${clave} REC ${yo}`);
          const resp = leerRespuesta(await pedir(cookie, RECIBIR, new URLSearchParams({
            process: "insert",
            datos: partes.join("#") + "#",
            cuantos: String(partes.length),
            total: total.toFixed(4),
            fecha: hoySV(),
            concepto,
            destino: String(ubicDestino),
            id_traslado: idIda,
          }), { extra: { Referer: RECIBIR } }));

          if (!resp.ok) {
            // Un fallo no prueba que no entró: se le pregunta al listado, que es
            // quien sabe. Sin esto, un reintento cargaría el producto dos veces.
            if (await estadoDeRecepcion(cookie, idIda) !== "recibido") {
              fallar(`El sistema no aceptó la entrada de ${nombre}: ${resp.msg || "sin detalle"}`);
              continue;
            }
          }
          entro = true;
        }

        if (!entro) { fallar(`${nombre} no llegó a entrar a tu sala.`); continue; }

        if (aceptar) {
          await anotar(
            admin.from("envio_linea").update({
              estado: "aceptada",
              recibido_at: new Date().toISOString(),
              decidido_por: actor.id, decidido_at: new Date().toISOString(),
              error: null,
              updated_at: new Date().toISOString(),
            }).eq("id", l.id),
            `la aceptación de ${nombre}`,
            (m) => fallos.push({ producto: nombre, error: m }),
          );
          hechas.push({ producto: nombre, decision: "aceptada" });
          continue;
        }

        // ── Y si se devuelve: un traslado de vuelta, ahora mismo ───────────
        // El producto ya está en el inventario de esta sala —acaba de entrar—,
        // así que devolverlo es sacarlo. La caja viaja después: quien envió lo
        // confirma cuando la tenga, igual que la devolución de un pedido.
        const f = await traerFila(cookie, l.erp_product_id, ubicDestino);
        if (!f.encontrado) { fallar(`${nombre} no aparece en el inventario de tu sala para devolverlo.`); continue; }
        const pres = await resolverPresentacion(cookie, f, l.presentacion_tipo, l.factor);
        if (!pres) { fallar(`${nombre}: no se encontró la presentación ${l.presentacion_tipo} de ${l.factor} para devolverlo.`); continue; }

        // Vuelve por los MISMOS lotes con los que llegó; lo que no alcance, por
        // el que vence primero y con su aviso.
        const reparto = f.regulado
          ? repartirEnLotes(f.lotes, Number(l.cantidad), Number(pres.unidad), lotesDeIda(l), "el envío")
          : { renglones: [{ cantidad: Number(l.cantidad), idLote: "0", lote: null as string | null }], faltan: 0, avisos: [] as string[] };
        if (reparto.faltan > 0) {
          fallar(`Para devolver ${nombre} faltan ${reparto.faltan} de ${l.presentacion_tipo} en los lotes de tu sala.`);
          continue;
        }

        if (conocidos === null) conocidos = await pendientesDeOrigen(cookie, ubicDestino);

        const html = await pedir(cookie, TRASLADO, undefined, { extra: { Referer: `${BASE}/dashboard.php` } });
        const vale = html.match(/numero_vale["'][^>]*value=["']([^"']+)["']/)?.[1] ?? "";
        if (!vale) { fallar(`El sistema no entregó el número de vale para devolver ${nombre}.`); continue; }

        const { concepto } = armarConcepto(
          `${clave} DEVUELVE ${yo} MOTIVO ${motivo.toUpperCase()}`,
        );
        const total = reparto.renglones.reduce((s, r) => s + Number(pres.costo || 0) * r.cantidad, 0);
        const datos = reparto.renglones.map((r) => [
          l.erp_product_id, pres.costo, pres.precio, r.cantidad, pres.unidad,
          f.vence || "", pres.id, r.idLote,
        ].join("|")).join("#") + "#";

        const resp = leerRespuesta(await pedir(cookie, TRASLADO, new URLSearchParams({
          process: "insert",
          datos,
          id_traslado_guardado: "0",
          cuantos: String(reparto.renglones.length),
          total: total.toFixed(4),
          fecha: hoySV(),
          concepto,
          origen: String(ubicDestino),
          id_suc_destino: String(erpOrigen),
          id_ubicacion_destino: "0",
          numero_vale: vale,
        }), { extra: { Referer: TRASLADO } }));

        const despues = await pendientesDeOrigen(cookie, ubicDestino);
        let idVuelta: string | null;
        let candidatos: string[];
        if (!resp.ok) {
          const { id, nuevos } = await trasladoQueSalioPeseAlFallo(cookie, conocidos, despues, [nombre]);
          conocidos = despues;
          if (!id) {
            // El producto quedó ENTRADO en esta sala y sin devolver. Se dice
            // tal cual: dejarlo como «devuelta» sería inventar un movimiento.
            fallar(
              `${nombre} entró a tu sala pero el sistema no aceptó la devolución: ${resp.msg || "sin detalle"}`
              + (nuevos.length ? ` · salieron ${nuevos.length} traslado(s) en ese momento (${nuevos.join(", ")}): compruébalo antes de reintentar` : ""),
            );
            continue;
          }
          idVuelta = id;
          candidatos = [id];
          reparto.avisos.push(`el sistema contestó un fallo y sin embargo la despachó: ${resp.msg || "sin detalle"}`);
        } else {
          ({ id: idVuelta, candidatos } = await identificarTrasladoNuevo(
            cookie, conocidos, despues, html, erpOrigen, [nombre],
          ));
          conocidos = despues;
        }

        await anotar(
          admin.from("envio_linea").update({
            estado: "devuelta",
            recibido_at: new Date().toISOString(),
            devuelto_at: new Date().toISOString(),
            id_traslado_devolucion: idVuelta,
            motivo_rechazo: motivo,
            nota_rechazo: notaL || null,
            decidido_por: actor.id, decidido_at: new Date().toISOString(),
            aviso: reparto.avisos.length ? reparto.avisos.join(" · ") : null,
            error: idVuelta ? null
              : `Volvió, pero no se pudo distinguir cuál movimiento es entre ${candidatos.length} candidatos `
                + `(${candidatos.join(", ") || "ninguno"}). Buscar «${clave}» en el concepto.`,
            updated_at: new Date().toISOString(),
          }).eq("id", l.id),
          `la devolución de ${nombre} (el producto YA volvió a salir, movimiento ${idVuelta ?? "sin identificar"})`,
          (m) => fallos.push({ producto: nombre, error: m }),
        );
        hechas.push({ producto: nombre, decision: "devuelta", motivo, id_traslado: idVuelta });
      }

      /* ── Y recién cuando no queda nada por decidir, se cierra la cabecera ──
       * `APPROVED` con que se haya aceptado UNO: el envío llegó a destino y se
       * resolvió. `REJECTED` sólo si volvió todo. Mientras quede un renglón
       * `enviada` el envío sigue PENDING, que es la verdad — la sala todavía no
       * miró esa parte de la caja. */
      const { dato: quedan } = await leerBien<{ estado: string }[]>(
        admin.from("envio_linea").select("estado").eq("request_id", sol.id).eq("estado", "enviada"),
        "los renglones que faltan decidir",
      );
      let cerrado: string | null = null;
      if ((quedan ?? []).length === 0) {
        const { dato: finales } = await leerBien<{ estado: string; motivo_rechazo: string | null }[]>(
          admin.from("envio_linea").select("estado, motivo_rechazo").eq("request_id", sol.id),
          "el resultado del envío",
        );
        const filas = (finales ?? []) as { estado: string; motivo_rechazo: string | null }[];
        const aceptadas = filas.filter((x) => x.estado === "aceptada").length;
        const devueltas = filas.filter((x) => x.estado === "devuelta" || x.estado === "devuelta_recibida");
        cerrado = aceptadas > 0 ? "APPROVED" : (devueltas.length > 0 ? "REJECTED" : null);
        if (cerrado) {
          /* El cierre entero es UNA escritura de la base y no cuatro campos
           * desde acá: toca el mismo `metadata` donde el aviso al destino
           * guarda su contador, y mandarlo entero borraría lo que la otra
           * escritura puso en el medio. El `||` de jsonb funde.
           *
           * El motivo va ahí porque es lo que lee el aviso de vuelta —y lo que
           * `validar_rechazo_con_motivo` exige para un REJECTED—; el
           * `approver_id` pasa a ser quien DECIDIÓ y no quien recibió el aviso,
           * que es lo que hace que ese aviso diga el nombre correcto. */
          const motivosDados = [...new Set(devueltas.map((x) => x.motivo_rechazo).filter(Boolean))];
          await anotar(
            admin.rpc("cerrar_envio", {
              p_request_id: sol.id,
              p_status: cerrado,
              p_actor: actor.id,
              p_nota: String(nota ?? "").trim() || null,
              p_motivos: motivosDados.length ? motivosDados.join("; ") : null,
            }),
            "el cierre del envío",
            (m) => fallos.push({ producto: "el envío", error: m }),
          );
        }
      }

      // Se suelta apenas termina: lo que quedó sin decidir se contesta
      // apretando de nuevo. Si la corrida muere, el candado caduca solo a los
      // 3 minutos — más que lo que vive una invocación.
      await anotar(
        admin.rpc("soltar_paso_envio", { p_request_id: sol.id, p_paso: "decidiendo" }),
        "la salida del envío de la decisión",
      );

      return json({
        ok: fallos.length === 0 && cortadoEn < 0,
        decididas: hechas.length, hechas, fallos, cerrado,
        ...(cortadoEn >= 0
          ? {
            codigo: "SIN_TIEMPO",
            error: `No alcanzó el tiempo: se resolvieron ${hechas.length} de ${trabajo.length} productos. `
                 + `Vuelve a darle para los que faltan.`,
          }
          : {}),
      });
    }

    // ══════════════════════════════════════════════════════════════════════
    // RECIBIR LA DEVOLUCIÓN · de vuelta en la sala que envió
    // ══════════════════════════════════════════════════════════════════════
    // La devolución vuelve al estante DEL QUE SALIÓ —`destino: ubicOrigen` más
    // abajo—, así que lo que se mandó del área de vencidos regresa ahí y no al
    // estante de operación. Si volviera al de operación, el área quedaría corta
    // en el papel y el estante largo, sin que nadie moviera una caja.
    if (!ubicOrigen)
      return json({ ok: false, error: sinUbicacionOrigen }, 422);
    if (!(await puedeObrarPor(branchOrigen)))
      return json({ ok: false, error: "La devolución la recibe la sala de la que salió el producto." }, 403);

    const porVolver = lineas.filter((l) => l.estado === "devuelta" && l.id_traslado_devolucion);
    if (porVolver.length === 0)
      return json({ ok: false, codigo: "NADA_QUE_RECIBIR", error: "No hay nada devuelto esperando entrar." }, 409);

    // Mismo candado que los otros dos pasos: cualquiera de la sala que envió
    // puede apretar «ya está de vuelta», y dos a la vez cargarían el mismo
    // movimiento dos veces.
    const { data: tomadaVuelta, error: candadoVueltaErr } = await admin
      .rpc("tomar_paso_envio", { p_request_id: sol.id, p_actor: actor.id, p_paso: "recibiendo" });
    if (candadoVueltaErr) {
      console.error("[enviar-producto-erp] candado devolución:", candadoVueltaErr.message);
      return json({ ok: false, error: "No se pudo tomar la devolución para recibirla." }, 503);
    }
    if (tomadaVuelta !== true)
      return json({
        ok: false, codigo: "YA_EN_CURSO",
        error: "Alguien más de tu sala está recibiendo esta devolución en este momento.",
      }, 409);

    const cookie = await sesionEn(erpOrigen);
    const estadoDe = lectorDeRecepcion(cookie);
    const hechas: Record<string, unknown>[] = [];
    const fallos: { producto: string; error: string }[] = [];

    for (const l of porVolver) {
      if (Date.now() - arranque > PRESUPUESTO_MS) break;
      const nombre = l.descripcion ?? String(l.erp_product_id);
      const idVuelta = String(l.id_traslado_devolucion);
      const clave = claveDe(sol.id, l.posicion);

      const cerrar = async (aviso: string | null) => {
        await anotar(
          admin.from("envio_linea").update({
            estado: "devuelta_recibida",
            recibido_at: new Date().toISOString(),
            ...(aviso ? { aviso } : {}),
            error: null,
            updated_at: new Date().toISOString(),
          }).eq("id", l.id),
          `la vuelta de ${nombre} a tu sala`,
          (m) => fallos.push({ producto: nombre, error: m }),
        );
        hechas.push({ producto: nombre, id_traslado: idVuelta });
      };

      const antes = await estadoDe(idVuelta);
      if (antes === "anulado") {
        fallos.push({ producto: nombre, error: `El movimiento ${idVuelta} está anulado: el producto no volvió.` });
        continue;
      }
      if (antes === "recibido") { await cerrar("El sistema ya lo tenía recibido; no se volvió a cargar."); continue; }

      const pagina = await pedir(cookie, `${RECIBIR}?id_movimiento=${encodeURIComponent(idVuelta)}`,
        undefined, { extra: { Referer: `${BASE}/admin_traslados.php` } });
      const filas = [...pagina.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/g)]
        .map((m) => m[0]).filter((tr) => /class="id_p"/.test(tr));
      if (filas.length === 0) {
        fallos.push({ producto: nombre, error: `El movimiento ${idVuelta} no muestra líneas para recibir.` });
        continue;
      }

      const partes: string[] = [];
      let total = 0;
      for (const tr of filas) {
        const idProd = tr.match(/class="id_p">\s*([\d]+)/)?.[1] ?? "";
        const idPres = tr.match(/<select[^>]*class=['"]sel['"][^>]*>\s*<option[^>]*value=['"](\d+)['"]/)?.[1] ?? "";
        const compra = tr.match(/class=['"][^'"]*precio_compra[^'"]*['"][^>]*value=['"]\s*([\d.]+)/)?.[1] ?? "0";
        const venta  = tr.match(/class=['"][^'"]*precio_venta[^'"]*['"][^>]*value=['"]\s*([\d.]+)/)?.[1] ?? "0";
        const unidad = tr.match(/class=['"]unidad['"][^>]*value=['"](\d+)/)?.[1] ?? "1";
        const esp    = tr.match(/class=['"][^'"]*\besp\b[^'"]*['"][^>]*value=['"]\s*([\d.]+)/)?.[1] ?? "0";
        const vence  = tr.match(/class=['"][^'"]*\bvence\b[^'"]*['"][^>]*value=['"]([^'"]*)['"]/)?.[1] ?? "";
        if (!idProd || !idPres) continue;
        partes.push([idProd, compra, venta, esp, unidad, vence, idPres, esp].join("|"));
        total += Number(compra) * Number(esp);
      }
      if (partes.length === 0) {
        fallos.push({ producto: nombre, error: `No se pudo leer ni una línea del movimiento ${idVuelta}.` });
        continue;
      }

      const { concepto } = armarConcepto(`${clave} REC DEV ${yo}`);
      const resp = leerRespuesta(await pedir(cookie, RECIBIR, new URLSearchParams({
        process: "insert",
        datos: partes.join("#") + "#",
        cuantos: String(partes.length),
        total: total.toFixed(4),
        fecha: hoySV(),
        concepto,
        destino: String(ubicOrigen),
        id_traslado: idVuelta,
      }), { extra: { Referer: RECIBIR } }));

      if (!resp.ok) {
        if (await estadoDeRecepcion(cookie, idVuelta) === "recibido") {
          await cerrar(`El sistema contestó un fallo y sin embargo lo recibió: ${resp.msg || "sin detalle"}`);
          continue;
        }
        fallos.push({ producto: nombre, error: `El sistema no aceptó la entrada: ${resp.msg || "sin detalle"}` });
        continue;
      }
      await cerrar(null);
    }

    await anotar(
      admin.rpc("soltar_paso_envio", { p_request_id: sol.id, p_paso: "recibiendo" }),
      "la salida de la devolución",
    );

    return json({ ok: fallos.length === 0, recibidas: hechas.length, hechas, fallos });
  } catch (e) {
    console.error("[enviar-producto-erp]", e);
    return json({ ok: false, error: (e as Error)?.message ?? String(e) }, 500);
  }
});
