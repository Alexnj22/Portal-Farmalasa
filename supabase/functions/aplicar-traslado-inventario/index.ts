import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, permisoDeModulo, requireActiveEmployeeUser } from "../_shared/security.ts";
import { BASE, login, pedir, leerRespuesta } from "../_shared/erp-dte.ts";

// Aplica el traslado entre salas que la sala de ORIGEN confirmó. Quinta pieza de
// la familia de `aplicar-solicitud-facturacion`, y por eso reusa
// `_shared/erp-dte.ts` en vez de copiarlo.
//
// ── Son DOS pasos, y el sistema ya los distingue ───────────────────────────
// Un traslado se crea en origen y se recibe en destino. No es una decisión del
// portal: el listado del sistema tiene un estado `pe` (NO RECIBIDO) entre
// «despachado» y «finalizado», y hoy hay 20 traslados parados ahí, el más viejo
// del 29 de julio. Así que:
//
//   accion 'enviar'  → crea el traslado y marca la solicitud APPROVED
//   accion 'recibir' → lo recibe en destino y lo pasa a finalizado
//
// APPROVED exige SOLO el primero. Si exigiera los dos, un traslado despachado y
// no recibido dejaría la solicitud PENDING para siempre sobre producto que ya
// salió de la sala — y el estado real de eso no es «pendiente de aprobar», es
// «en tránsito», que es justo lo que `pe` significa.
//
// ── La sucursal es estado de SESIÓN ────────────────────────────────────────
// Igual que en carga y descarte: `traslado_producto.php` y `recibir_traslado.php`
// siguen a la sesión y su <select> de ubicación solo ofrece la de esa sucursal.
// Y como es estado GLOBAL de la sesión PHP, cada invocación abre su PROPIO
// `login()`. Enviar corre en la sesión de ORIGEN y recibir en la de DESTINO: no
// hay una sola cookie que sirva para las dos mitades, y compartirla entre dos
// aplicaciones simultáneas haría que una escriba en la sucursal de la otra.
//
// ── Lo que esta pantalla hace DISTINTO de carga y descarte ─────────────────
// No usa `consultar_stock`: usa `process=traerdatos`, que devuelve **filas de
// HTML** y no JSON, y que busca por id de producto (mandarle un nombre devuelve
// una fila vacía con «TOTAL STOCK: 0», sin error).
//
// Y sobre todo: **su <select> de presentación trae solo el TIPO** —«UNIDAD»,
// «CAJA»— y no «TIPO (FACTOR)» como el de carga y descarte. Así que la etiqueta
// sola no alcanza para identificarla: hay productos con tres opciones llamadas
// igual. La resolución es en dos tiempos — filtrar por tipo y después preguntar
// `getpresentacion` por cada candidata hasta que el `unidad` coincida con el
// factor aprobado. Es la misma regla de siempre (nunca por posición, nunca por
// el id del portal) adaptada a que acá la etiqueta dice menos.
//
// ── El `numero_vale` no se inventa ─────────────────────────────────────────
// Es un `uniqid()` que el servidor pre-rellena en el HTML de cada carga de la
// página, y el JS lo valida pero nunca lo genera. Hay que hacer el GET y sacarlo
// de ahí — mismo patrón que el token del Ministerio, que tampoco se fabrica: se
// lee de la pantalla que lo cachea.

// ⚠️ Los parsers de estas pantallas VIVEN EN `_shared/erp-traslado.ts`.
// Estaban duplicados acá desde que se creó `trasladar-pedido-erp`, con una nota
// que decía que había que consolidarlos: son parsers de HTML y dos copias que
// se toquen por separado leen la misma pantalla distinto. Consolidado el
// 2026-08-11. El módulo se armó copiando de este archivo, así que la extracción
// es literal — no cambia una coma de comportamiento.
import {
  armarConcepto,
  conSala,
  apartadoQueEstorba,
  disponibleEnBodega,
  estadoDeRecepcion,
  leerUbicacion,
  hayEnTexto,
  hoySV,
  identificarTrasladoNuevo,
  norm,
  pendientesDeOrigen,
  RECIBIR,
  repartirEnLotes,
  sesionEn as abrirSesionEn,
  TRASLADO,
  leerFila,
  trasladoQueSalioPeseAlFallo,
} from "../_shared/erp-traslado.ts";

// Cuánto de lo pedido sale de verdad. Vive aparte de los parsers porque
// `erp-traslado.ts` dice de sí mismo que las decisiones de cantidad se quedan
// fuera de él, y está anclado en `tests/unit/lineasAceptadas.test.js`: lo que
// decide es cuánto medicamento sale de una sala.
import { elegirLineasAceptadas, loQueNoEntro } from "../_shared/lineasAceptadas.ts";

// `sesionEn` compartida recibe el `login` para no acoplar el módulo a un
// proveedor de credenciales. Acá se fija el del ERP y queda igual que antes.
const sesionEn = (erpSucursal: number) => abrirSesionEn(erpSucursal, login);

/* Cuánto se permite tardar verificando líneas antes de cortar sin escribir
 * nada. Una Edge Function vive 150s; 110s deja margen para armar y mandar el
 * traslado con lo que ya se verificó, o para contestar el corte.
 *
 * ⚠️ Esta constante se BORRÓ por accidente el 2026-08-11 (v2.569.2), al mover
 * los parsers de HTML a `_shared/erp-traslado.ts`: se fue con el bloque de
 * arriba y su único uso —el `if` que abre el bucle de líneas— quedó
 * referenciando un nombre inexistente. Deno no chequea tipos al desplegar, así
 * que no falló al subir: fallaba al APRETAR, con un `PRESUPUESTO_MS is not
 * defined` en la cara de quien confirmaba, y desde entonces NINGÚN traslado
 * pudo despacharse (medido: 0 filas APPROVED en la tabla). Vive acá, junto al
 * `arranque` que mide contra ella. */
const PRESUPUESTO_MS = 110_000;

/* Un producto de la solicitud, tal como lo guarda `PedirTrasladoModal` en
 * `metadata.items`. El tipo faltaba —se escribía `Linea[]` contra un nombre que
 * no existía— y como Deno no chequea tipos al desplegar, nada avisó de que
 * `lotes` no se leía en ninguna parte: el reparto por lote que la pantalla hace
 * al pedir viajaba y se tiraba.
 *
 * `cantidad` va en PAQUETES de `presentacion_tipo`; `lotes[].unidades`, en
 * unidades base. Son escalas distintas y `factor` es lo que las une. */
interface Linea {
  erp_product_id: number;
  descripcion?: string;
  presentacion_tipo?: string;
  factor?: number;
  cantidad: number;
  /** El reparto por lote que hizo quien pidió. `null` cuando no los conocía. */
  lotes?: { lote?: string; vence?: string; unidades?: number }[] | null;
  /** Un solo lote, para quien llame a mano. La pantalla no lo escribe. */
  numero_lote?: string;
  vence?: string;
}

/**
 * Los lotes que la SOLICITUD reservó, en paquetes de la presentación.
 *
 * La pantalla que pide el traslado ya reparte por lote y guarda ese reparto en
 * `items[].lotes` —«los lotes MANDAN», decisión del usuario 2026-08-07—, en
 * unidades BASE. Hasta el 2026-08-18 esta función ni lo miraba: buscaba un
 * `numero_lote` que esa pantalla nunca escribe, así que el reparto viajaba en la
 * solicitud y se tiraba.
 *
 * `numero_lote` se sigue aceptando como el caso de un solo lote, para quien
 * llame por fuera de la pantalla.
 */
function reservadosDe(l: Linea, unidad: number): { numero: string; vence?: string; paquetes: number }[] {
  if (Array.isArray(l.lotes) && l.lotes.length)
    return l.lotes.map((r) => ({
      numero: String(r?.lote ?? ""),
      vence: String(r?.vence ?? "").slice(0, 10),
      // Un lote que no llega a completar UN paquete no se puede despachar en
      // esta presentación; lo que sobre lo cubre el que vence primero.
      paquetes: Math.floor(Number(r?.unidades ?? 0) / (Number(unidad) || 1)),
    })).filter((r) => r.paquetes > 0);
  return l.numero_lote
    ? [{ numero: String(l.numero_lote), vence: String(l.vence ?? "").slice(0, 10), paquetes: Number(l.cantidad) }]
    : [];
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const arranque = Date.now();

  try {
    // `approver_note` es contenido, no identidad: se acepta del cliente. Quién
    // decide sale del JWT y no se recibe nunca por parámetro.
    const { request_id, approver_note, accion, lineas_aceptadas } = await req.json().catch(() => ({}));
    if (!request_id) return json({ ok: false, error: "Falta request_id." }, 400);
    const paso = accion === "recibir" ? "recibir" : "enviar";

    // ── Quién llama. Nunca del payload: del JWT. ──────────────────────────
    const quien = await requireActiveEmployeeUser(req, admin);
    if (!quien) return json({ ok: false, error: "Sesión inválida o empleado inactivo." }, 401);

    // ── El permiso es `traslados`, no `requests` ──────────────────────────
    // Módulos distintos a propósito: `requests` es permisos, vacaciones e
    // incapacidades, y confirmar un traslado no debe arrastrar eso.
    // `permisoDeModulo` resuelve las dos consultas, los DOS roles (principal y
    // secundario), el SUPERADMIN y el `scope = 'ALL'` — que es lo que acá se
    // escribía a mano. Y devuelve `roto` aparte: con el error descartado, una
    // consulta caída contestaba «No tienes permiso para confirmar traslados» a
    // quien sí puede, y esa persona se queda esperando un permiso en vez de
    // reintentar.
    const permiso = await permisoDeModulo(admin, quien.id, "traslados", "can_approve");
    if (permiso.roto) return json({ ok: false, error: permiso.roto }, 503);
    if (!permiso.puede)
      return json({ ok: false, error: "No tienes permiso para confirmar traslados." }, 403);
    const emp = permiso.emp;
    const alcanceTodo = permiso.alcanceTodo;

    // ── La solicitud se relee de la BD, no se recibe ──────────────────────
    const { data: sol, error: solErr } = await admin
      .from("approval_requests")
      .select("id, type, status, employee_id, note, metadata, approver_id")
      .eq("id", request_id)
      .maybeSingle();
    if (solErr) throw solErr;
    if (!sol) return json({ ok: false, error: "La solicitud no existe." }, 404);
    if (sol.type !== "INVENTORY_TRANSFER_REQUEST")
      return json({
        ok: false, codigo: "TIPO_NO_AUTOMATIZADO",
        error: `El tipo ${sol.type} no se aplica desde acá.`,
      }, 422);

    const meta = (typeof sol.metadata === "string" ? JSON.parse(sol.metadata) : sol.metadata) ?? {};
    const lineas: Linea[] = Array.isArray(meta.items) ? meta.items : [];
    const erpOrigen  = Number(meta.origen_erp_sucursal_id);
    const erpDestino = Number(meta.erp_sucursal_id);
    const origenBranch = Number(meta.origen_branch_id);

    if (!erpOrigen || !erpDestino)
      return json({ ok: false, error: "La solicitud no trae la sala de origen o la de destino." }, 422);

    // ── El registro de salas, de una sola vez ─────────────────────────────
    // Son 7 filas. Antes se pedía dos veces —origen y destino— y ahora hace
    // falta una tercera llave, el `branch_id`, para ponerle su sala a cada
    // persona del concepto. Traerlo entero es una consulta MENOS que antes y
    // deja las tres búsquedas contra el mismo dato.
    const { data: mapaSalas, error: mapaErr } = await admin
      .from("erp_sucursal_map").select("erp_sucursal_id, branch_id, codigo, inv_ubicaciones, nombre");
    if (mapaErr) throw mapaErr;
    const porSucursal = new Map((mapaSalas ?? []).map((m) => [Number(m.erp_sucursal_id), m]));
    const porBranch   = new Map((mapaSalas ?? []).map((m) => [Number(m.branch_id), m]));

    // El código con que la sala se nombra en el concepto — «S1», «PO», «BO».
    // Sale del registro y NUNCA del `erp_sucursal_id`: la numeración del sistema
    // de origen no coincide con el nombre de la sala en las tres últimas.
    const codigoDeBranch = (b: unknown) => porBranch.get(Number(b))?.codigo ?? null;

    // ── Las ubicaciones de ORIGEN y DESTINO salen del mapa, no del cliente ─
    // Es la sala de OTRO: pedírsela al navegador sería dejar que elija de dónde
    // sale el producto. El navegador dice de qué ÁREA —y sólo eso—; qué número
    // tiene esa área en el sistema lo contesta el mapa.
    //
    // La del destino venía en la solicitud, o sea del navegador. La pantalla de
    // pedido no la manda —no tiene por qué saberla— así que llegaba `undefined`,
    // viajaba como «NaN» y el sistema contestaba «No se proporcionaron los datos
    // correctos para actualizar el stock». Lo destapó la primera prueba de punta
    // a punta POR LA PANTALLA: el mismo camino por API pasaba, porque el script
    // de prueba se la pasaba a mano. La ubicación es una propiedad de la sala,
    // no un dato que el cliente elija.
    //
    // ── El área de vencidos SÍ es un origen (2026-08-19) ──────────────────
    // Hasta hoy acá se leía «la de vencidos es un destino, nunca un origen», y
    // el origen era siempre la de trabajo. Es lo que hacía que un traslado del
    // área de vencidos —si hubiera podido nacer— sacara el producto del estante
    // equivocado: mismo producto, otro lote, otra existencia.
    //
    // El nombre engaña: ahí Bodega aparta lo PRÓXIMO a vencer. Medido el
    // 2026-08-19: de 89 renglones con existencia, 75 estaban vigentes y 2
    // vencidos. Pedido del usuario: que se pueda solicitar.
    //
    // El DESTINO no cambia nunca: lo que entra a una sala entra a su estante de
    // trabajo, aunque haya salido del área de vencidos de Bodega. Una sala que
    // recibe algo próximo a vencer lo pone a la venta — que es el punto.
    const ubicacionDe = (
      m: { inv_ubicaciones?: unknown } | null | undefined,
      vencidos: boolean,
    ) => Number(
      (Array.isArray(m?.inv_ubicaciones) ? m!.inv_ubicaciones as { id: number; isVencidos: boolean }[] : [])
        .find((u) => Boolean(u.isVencidos) === vencidos)?.id ?? 0,
    );
    const origenVencidos = meta.origen_vencidos === true;
    const ubicOrigen  = ubicacionDe(porSucursal.get(erpOrigen), origenVencidos);
    const ubicDestino = ubicacionDe(porSucursal.get(erpDestino), false);

    // ══════════════════════════════════════════════════════════════════════
    // PASO 2 · RECIBIR (en destino)
    // ══════════════════════════════════════════════════════════════════════
    if (paso === "recibir") {
      if (!ubicDestino)
        return json({
          ok: false,
          error: `No se conoce la ubicación de la sala que recibe (${erpDestino}).`,
        }, 422);

      const idTraslado = String(meta.erp_traslado?.id_traslado ?? "");
      if (!idTraslado)
        return json({
          ok: false, codigo: "SIN_TRASLADO",
          error: "Esta solicitud todavía no tiene un traslado despachado que recibir.",
        }, 409);
      if (meta.erp_recibido)
        return json({ ok: false, codigo: "YA_RECIBIDO", error: "Este traslado ya se recibió." }, 409);

      // Recibe la SALA que lo pidió, no la persona: quien pidió puede estar de
      // descanso cuando llega la caja. Mismo criterio que el RLS, repetido acá
      // porque esta función usa la llave de servicio y el RLS no la frena.
      //
      // Hasta el 2026-08-17 pedía además jefatura, o estar en turno. Las dos
      // condiciones sobraban y la segunda no funcionaba: `empleados_en_turno`
      // sale de los horarios publicados, y esa semana había OCHO personas con
      // horario en toda la empresa. El permiso `traslados.can_approve` —que ya
      // se cobró más arriba— es lo que decide; la sala, dónde.
      if (!alcanceTodo && quien.id !== sol.employee_id) {
        const enLaSala = emp?.branch_id === Number(meta.branch_id);
        if (!enLaSala)
          return json({
            ok: false,
            error: "El traslado lo recibe la sala que lo pidió.",
          }, 403);
      }

      /* Anotar que entró, y sacarlo de la lista.
       *
       * Es UNA función y no dos escrituras sueltas porque hay DOS caminos que
       * terminan acá —el que recibe y el que descubre que ya estaba recibido— y
       * el día que uno de los dos deje de escribir `erp_recibido`, su traslado
       * se queda «en camino» para siempre sin que nada falle.
       *
       * `is: null` en la condición y no un chequeo previo: dos personas de la
       * sala que aprieten «ya llegó» a la vez pasan las dos la lectura de más
       * arriba, y acá la segunda no escribe. */
      const marcarRecibido = async (recibido: Record<string, unknown>) => {
        const { error: updErr } = await admin
          .from("approval_requests")
          .update({ metadata: { ...meta, erp_recibido: recibido }, updated_at: new Date().toISOString() })
          .eq("id", sol.id)
          .is("metadata->erp_recibido", null);
        if (updErr) throw updErr;
        return json({ ok: true, recibido });
      };

      const cookie = await sesionEn(erpDestino);

      /* ── ¿Sigue esperando entrar? ─────────────────────────────────────────
       *
       * Esto se preguntaba mirando la pantalla de recepción, y la pantalla no
       * lo sabe: **sigue mostrando las líneas de un traslado ya recibido**, con
       * las mismas cantidades (medido el 2026-08-17 sobre el 29444 y el 29445).
       * Confiar en eso tenía dos costos, y los dos se pagaron el mismo día:
       *
       *  1. Apretar «ya llegó» por segunda vez volvía a cargar el producto. No
       *     había NADA que lo frenara antes de escribir en el sistema — el
       *     candado de `erp_recibido` es posterior, así que evitaba la segunda
       *     anotación y no la segunda carga.
       *  2. Cuando el sistema recibía el traslado pero contestaba algo que no
       *     se pudo leer como éxito, la solicitud se quedaba «en camino» para
       *     siempre. Medido: el 29444 (Salud 3 → Salud 2) y el 29446 (Bodega →
       *     Salud 3) estaban FINALIZADOS en el sistema y seguían en la lista del
       *     portal, sobre producto ya cargado. Reportado por el usuario así:
       *     «al confirmar uno como llegado se carga, pero no se quita».
       *
       * `desconocido` no frena nada: si no se pudo preguntar, se hace lo de
       * siempre. Una guarda que corta con lo que no sabe deja de recibir por
       * culpa de una consulta secundaria. */
      const antesDeRecibir = await estadoDeRecepcion(cookie, idTraslado);
      if (antesDeRecibir === "anulado")
        return json({
          ok: false, codigo: "TRASLADO_ANULADO",
          error: `El traslado ${idTraslado} está anulado en el sistema: el producto no entró a tu sala. `
               + `Pídelo de nuevo.`,
        }, 409);
      if (antesDeRecibir === "recibido")
        return await marcarRecibido({
          at: new Date().toISOString(), by: quien.id, by_name: quien.name,
          id_traslado: idTraslado,
          // Quién lo recibió no lo dice el sistema, así que no se inventa. Lo
          // que sí se sabe —y es lo que hay que poder leer después— es que la
          // carga NO la hizo esta llamada: acá no se escribió inventario.
          via: "sistema",
          msg: "El sistema ya lo tenía recibido; no se volvió a cargar.",
        });

      const pagina = await pedir(cookie, `${RECIBIR}?id_movimiento=${encodeURIComponent(idTraslado)}`,
        undefined, { extra: { Referer: `${BASE}/admin_traslados.php` } });

      // El servidor pre-rellena la tabla entera: producto, presentación, costo,
      // precio, lo esperado y el vencimiento. Acá no hay nada que elegir, así
      // que esta mitad no tiene la trampa del lote.
      //
      // ⚠️ Lo que sí puede tener es MÁS DE UNA presentación: el `<select>` del
      // 29452 ofrecía «CAJA (1)» y «CAJA X 30 (1)». Se toma la PRIMERA, que es
      // exactamente lo que envía la pantalla del sistema (`$('.sel').val()`
      // sobre un select sin opción marcada). Hacer otra cosa sería recibir
      // distinto de como recibe el sistema; si algún día dos opciones traen
      // factores distintos, este es el lugar.
      const filas = [...pagina.matchAll(/<tr>[\s\S]*?<\/tr>/g)]
        .map((m) => m[0])
        .filter((tr) => /class="id_p"/.test(tr));
      // Con líneas o sin ellas, acá ya se sabe que el traslado está esperando
      // entrar —se preguntó más arriba—, así que quedarse sin filas es que la
      // pantalla no se pudo leer, no que el traslado ya no esté.
      if (filas.length === 0)
        return json({
          ok: false, codigo: "TRASLADO_SIN_LINEAS",
          error: `El traslado ${idTraslado} no muestra líneas para recibir.`,
        }, 409);

      const partes: string[] = [];
      let total = 0;
      let unidades = 0;
      for (const tr of filas) {
        const idProd = tr.match(/class="id_p">\s*([\d]+)/)?.[1] ?? "";
        const idPres = tr.match(/<select[^>]*class=['"]sel['"][^>]*>\s*<option[^>]*value=['"](\d+)['"]/)?.[1] ?? "";
        const compra = tr.match(/class=['"][^'"]*precio_compra[^'"]*['"][^>]*value=['"]\s*([\d.]+)/)?.[1] ?? "0";
        const venta  = tr.match(/class=['"][^'"]*precio_venta[^'"]*['"][^>]*value=['"]\s*([\d.]+)/)?.[1] ?? "0";
        const unidad = tr.match(/class=['"]unidad['"][^>]*value=['"](\d+)/)?.[1] ?? "1";
        const esp    = tr.match(/class=['"][^'"]*\besp\b[^'"]*['"][^>]*value=['"]\s*([\d.]+)/)?.[1] ?? "0";
        const vence  = tr.match(/class=['"][^'"]*\bvence\b[^'"]*['"][^>]*value=['"]([^'"]*)['"]/)?.[1] ?? "";
        if (!idProd || !idPres) continue;
        // ⚠️ El octavo campo de `datos` acá NO es el lote: es lo ESPERADO. El
        // encabezado de la tabla lo dice —Esperado · Recibido · Lote · Vence— y
        // `cant` es lo RECIBIDO. Mismo lugar del string que en el envío, donde
        // el octavo es el id del lote, y significado distinto.
        //
        // Se recibe COMPLETO lo que se despachó: recibir de menos es declarar un
        // faltante, y eso necesita a alguien mirando la caja, no una función.
        partes.push([idProd, compra, venta, esp, unidad, vence, idPres, esp].join("|"));
        total += Number(compra) * Number(esp);
        unidades += Number(esp);
      }
      if (partes.length === 0)
        return json({ ok: false, error: `No se pudo leer ni una línea del traslado ${idTraslado}.` }, 502);

      // Nombra a las DOS personas que el sistema no guarda —quien despachó y
      // quien recibe—, cada una con su sala. Misma gramática que el pedido y la
      // devolución (ver `erp-traslado.ts`): lo que el sistema ya muestra no se
      // repite acá, pero la sala de la PERSONA no la muestra en ningún lado —el
      // listado trae origen y destino del movimiento, que no es lo mismo: una
      // supervisión puede despachar desde una sala que no es la suya.
      //
      // La del despachador se guardó al enviar. Si es una solicitud vieja no
      // está, y entonces el nombre va solo: un paréntesis equivocado es peor que
      // ninguno.
      const despacho = conSala(
        { name: String(meta.erp_traslado?.by_name ?? "-") },
        meta.erp_traslado?.by_sala ?? null,
      );
      const { concepto } = armarConcepto(
        `REC ${conSala({ ...emp, name: quien.name }, codigoDeBranch(emp?.branch_id))} ENV ${despacho}`,
      );

      const resp = leerRespuesta(await pedir(cookie, RECIBIR, new URLSearchParams({
        process: "insert",
        datos: partes.join("#") + "#",
        cuantos: String(partes.length),
        total: total.toFixed(4),
        fecha: hoySV(),
        concepto,
        destino: String(ubicDestino),
        id_traslado: idTraslado,
      }), { extra: { Referer: RECIBIR } }));
      /* ── Un «no» del sistema no siempre significa que no entró ────────────
       *
       * Es la otra mitad de lo mismo: el 2026-08-17 hubo DIEZ respuestas 502 de
       * esta función, y dos de esos traslados terminaron FINALIZADOS igual. O
       * sea que el producto entró y la respuesta no se pudo leer como éxito —y
       * como acá se cortaba con un error, la solicitud se quedaba «en camino»
       * sobre producto ya cargado, y quien apretaba lo volvía a intentar.
       *
       * Así que antes de dar el fallo por bueno se le vuelve a preguntar al
       * listado, que es quien sabe. Si el traslado ya salió de la cola de
       * entrada, entró: se anota y se saca de la lista. El mensaje del sistema
       * se guarda igual — es la única pista de por qué contestó lo que
       * contestó. */
      if (!resp.ok) {
        if (await estadoDeRecepcion(cookie, idTraslado) === "recibido")
          return await marcarRecibido({
            at: new Date().toISOString(), by: quien.id, by_name: quien.name,
            id_traslado: idTraslado, concepto,
            lineas: partes.length, unidades, total: Number(total.toFixed(4)),
            via: "sistema",
            msg: `El sistema contestó un fallo y sin embargo lo recibió: ${resp.msg || "sin detalle"}`,
          });
        return json({ ok: false, error: `El sistema no aceptó la recepción: ${resp.msg || "sin detalle"}` }, 502);
      }

      return await marcarRecibido({
        at: new Date().toISOString(), by: quien.id, by_name: quien.name,
        id_traslado: idTraslado, concepto,
        lineas: partes.length, unidades, total: Number(total.toFixed(4)),
        msg: resp.msg,
      });
    }

    // ══════════════════════════════════════════════════════════════════════
    // PASO 1 · ENVIAR (en origen)
    // ══════════════════════════════════════════════════════════════════════
    if (sol.status !== "PENDING")
      return json({ ok: false, error: `La solicitud ya está ${sol.status}.` }, 409);
    if (lineas.length === 0)
      return json({ ok: false, error: "La solicitud no pide ni un producto." }, 422);

    // ── Qué sale de lo que se pidió ──────────────────────────────────────
    // `lineas` es lo que la solicitud PIDE y no se toca de acá al final;
    // `envio` es lo que se despacha, que puede ser menos. Son dos cosas
    // distintas y por eso son dos variables: confundirlas es exactamente cómo
    // se pierde el rastro de lo que faltó.
    const { aceptadas, error: errRecorte } = elegirLineasAceptadas(
      lineas, lineas_aceptadas,
      "No quedó ningún producto para despachar. Si no sale nada, rechaza la solicitud.",
    );
    if (errRecorte) return json({ ok: false, codigo: "NADA_QUE_ENVIAR", error: errRecorte }, 422);

    const envio: Linea[] = aceptadas.map((a) => ({ ...lineas[a.i], cantidad: a.cantidad }));
    const { ajustados, fuera, parcial: esParcial } = loQueNoEntro(lineas, aceptadas);

    // El motivo es obligatorio cuando no sale todo: es lo único que le va a
    // explicar a quien pidió por qué le llegan 2 de 3. Misma regla que el
    // rechazo —«quien rechaza tiene que decir por qué»— y misma que la
    // aprobación parcial de carga y descarte.
    const motivoParcial = String(approver_note ?? "").trim();
    if (esParcial && !motivoParcial)
      return json({
        ok: false, codigo: "FALTA_MOTIVO",
        error: "Si no sale todo lo que se pidió, hay que decir por qué.",
      }, 422);

    if (!ubicOrigen)
      return json({
        ok: false,
        error: origenVencidos
          // La solicitud pide del área de vencidos y esa sala no tiene una. El
          // trigger ya lo corta al crearla; esto cubre las que nacieron antes o
          // por otro camino, y dice CUÁL de las dos cosas falta.
          ? `La sala de origen (${erpOrigen}) no tiene área de vencidos.`
          : `No se conoce la ubicación de la sala de origen (${erpOrigen}).`,
      }, 422);

    // ── Quién puede despachar: lo mismo que decide el RLS ─────────────────
    // Se repite acá porque esta función usa la llave de servicio y el RLS no la
    // frena. Si las dos reglas se separan, una deja pasar lo que la otra niega.
    //
    // Lo confirma LA SALA que tiene el producto, no una persona de esa sala.
    // Hasta el 2026-08-17 exigía jefatura, y eso lo trababa: en toda la empresa
    // hay 7 JEFE y 2 SUBJEFE para 8 salas, así que cada traslado quedaba
    // colgado de que una persona concreta abriera el portal. Medido en Salud 5:
    // 5 personas activas, las 5 con `traslados.can_approve` (cobrado más
    // arriba) y UNA sola con cargo de jefatura. Reportado por el usuario.
    const esDeLaSalaDeOrigen = emp?.branch_id === origenBranch;

    /* ── Y la sala de RESPALDO, mientras la de origen está CERRADA ────────
     *
     * Bodega trabaja de 8 a 5 y no abre el domingo, así que un traslado que
     * sale de ahí un sábado por la tarde no tenía a nadie que lo confirmara.
     * Salud 3 está en el mismo predio —cuatro metros, la misma dirección— y
     * hasta hoy resolvía eso por fuera del portal, con un usuario compartido.
     *
     * Quién cubre a quién y desde qué hora NO se decide acá: lo contesta
     * `salas_que_cubre_ahora`, la MISMA función que usa la policy. Separadas,
     * la pantalla ofrecería el botón y el despacho lo rebotaría con 403.
     *
     * El error del RPC se propaga a propósito: si no se pudo preguntar, no se
     * puede afirmar que esta persona tenga permiso. */
    let cubreAlOrigen = false;
    if (!esDeLaSalaDeOrigen && emp?.branch_id != null) {
      const { data: cubiertas, error: cubreErr } = await admin
        .rpc("salas_que_cubre_ahora", { p_branch_id: emp.branch_id });
      if (cubreErr) throw cubreErr;
      cubreAlOrigen = Array.isArray(cubiertas) && cubiertas.includes(origenBranch);
    }

    /* `destinatarios` salió de esta guarda el 2026-08-21, junto con la policy.
     *
     * Era la lista que la cascada de avisos dejó grabada al CREAR la solicitud,
     * y daba permiso para siempre: quien estuviera ahí podía despachar meses
     * después y en cualquier horario. Para la sala de respaldo eso significaba
     * poder resolver un traslado de Bodega a las 10 de la mañana, con Bodega
     * abierta y su propia gente adentro — que es justo lo que el respaldo NO
     * es. La lista sirve para avisar; no para autorizar.
     *
     * Los tres criterios que quedan son los mismos tres de la policy, escritos
     * en el mismo orden: alcance sobre todas, ser la sala de origen, o cubrirla
     * AHORA. El `sol.status !== 'PENDING'` de más arriba es la cuarta
     * condición, la que impide volver sobre lo ya resuelto.
     *
     * Que las dos coincidan importa: separadas, la pantalla ofrecería un botón
     * que el servidor rebota con 403, o peor, el servidor dejaría pasar lo que
     * la pantalla ya no muestra. */
    if (!alcanceTodo && !esDeLaSalaDeOrigen && !cubreAlOrigen)
      return json({
        ok: false,
        error: "Este traslado lo confirma la sala que tiene el producto.",
      }, 403);

    const { data: solicitante, error: solicitanteErr } = await admin
      .from("employees").select("name, first_names, last_names, branch_id")
      .eq("id", sol.employee_id).maybeSingle();
    if (solicitanteErr) throw solicitanteErr;

    // Las dos personas del acuerdo, cada una con su sala: quien pidió el
    // producto y quien lo soltó. Este traslado no nace de un pedido, así que no
    // tiene clave donde meter la sala —a diferencia del pedido y la devolución,
    // que la llevan en `P102-S5-…`—, y acá son DOS salas distintas: la que pide
    // y la que suelta. Va junto al nombre porque es lo que identifica a la
    // persona: hay nombres repetidos entre salas y la columna «usuario» del
    // listado es siempre la misma cuenta del portal.
    //
    // La sala es la de la PERSONA y no la del movimiento: con alcance de
    // supervisión se puede despachar desde una sala ajena, y entonces el origen
    // del listado no dice quién lo hizo.
    const codigoDespacha = codigoDeBranch(emp?.branch_id);

    // Y de qué ÁREA salió, cuando no es la de siempre. El listado del sistema
    // muestra origen y destino como SUCURSALES, así que dos traslados de Bodega
    // se ven idénticos aunque uno haya salido del estante de próximos a vencer.
    // Son 14 caracteres sobre los 200 del concepto y es el único sitio donde
    // ese dato queda del lado del sistema de origen.
    const { concepto, recortado: conceptoRecortado, completo: conceptoCompleto } = armarConcepto(
      `PIDE ${conSala(solicitante, codigoDeBranch(solicitante?.branch_id))}`
      + ` ENV ${conSala({ ...emp, name: quien.name }, codigoDespacha)}`
      + (origenVencidos ? ' AREA VENCIDOS' : ''),
    );

    // ── Una sesión propia, en la sala de ORIGEN ───────────────────────────
    const cookie = await sesionEn(erpOrigen);

    // ── El vale, leído de la página ──────────────────────────────────────
    const html = await pedir(cookie, TRASLADO, undefined, { extra: { Referer: `${BASE}/dashboard.php` } });
    const vale = html.match(/numero_vale["'][^>]*value=["']([^"']+)["']/)?.[1] ?? "";
    if (!vale)
      return json({
        ok: false, codigo: "SIN_VALE",
        error: "El sistema no entregó el número de vale del traslado.",
      }, 502);

    // ── Cada línea se confirma contra el sistema antes de armar el envío ──
    const partes: string[] = [];
    const detalle: Record<string, unknown>[] = [];
    // Lo que no frena el envío pero hay que poder leer después: un lote que la
    // solicitud reservó y ya no está, o uno que se despachó en su lugar.
    const avisosTraslado: string[] = [];
    let total = 0;
    let unidades = 0;
    let cortadoEn = -1;

    // Sin lotes la casilla de la pantalla suma la ubicación de vencidos, así que
    // el tope sale del reporte de ESTA ubicación — que acá puede ser justamente
    // la de vencidos, porque desde el 2026-08-19 se puede pedir de ahí. Se lee
    // UNA vez por solicitud y no por renglón: son 4 s, y adentro del bucle un
    // traslado de cinco productos pagaría veinte. Ver `existenciasDeUbicacion`.
    const lecturaOrigen = await leerUbicacion(cookie, erpOrigen, ubicOrigen);
    const enUbicacion = lecturaOrigen?.unidades ?? null;

    // Y el área de vencidos, para saber qué filas de ahí no se pueden
    // distinguir de las del estante — ver `apartadoQueEstorba`. Sólo cuando el
    // origen es el ESTANTE: si ya se está pidiendo del área de vencidos, esa
    // mercadería es justamente la que se quiere y no hay nada que frenar.
    const ubicVencidos = origenVencidos ? 0 : ubicacionDe(porSucursal.get(erpOrigen), true);
    const lecturaVencidos = ubicVencidos
      ? await leerUbicacion(cookie, erpOrigen, ubicVencidos)
      : null;

    // Cuánto tardó cada renglón contra el sistema de origen. No es diagnóstico
    // de sobra: es de dónde va a salir el TOPE de productos por solicitud.
    // Hasta hoy toda solicitud tuvo un renglón, así que el costo marginal del
    // segundo no se puede deducir de ninguna medición vieja — se anota acá y el
    // número se elige con datos en vez de inventarlo.
    const msPorRenglon: number[] = [];

    for (let i = 0; i < envio.length; i++) {
      if (Date.now() - arranque > PRESUPUESTO_MS) { cortadoEn = i; break; }
      const arranqueRenglon = Date.now();
      const l = envio[i];
      const nombre = l.descripcion ?? String(l.erp_product_id);

      const filaHtml = await pedir(cookie, TRASLADO, new URLSearchParams({
        process: "traerdatos", page: "1",
        producto_buscar: String(l.erp_product_id),
        origen: String(ubicOrigen), sortBy: "asc", records: "50",
      }), { extra: { Referer: TRASLADO } });
      const f = leerFila(filaHtml);

      if (!f.encontrado)
        return json({
          ok: false, codigo: "SIN_EXISTENCIA",
          error: `${nombre} no tiene existencia en la sala de origen.`,
        }, 409);

      // ── La presentación, en dos tiempos ──────────────────────────────────
      // Esta pantalla rotula sus opciones solo con el tipo, así que puede haber
      // varias «UNIDAD» y la etiqueta no las distingue. Se filtra por tipo y se
      // le pregunta al sistema el factor de cada candidata: la buena es la que
      // trae el factor que se aprobó. Elegir la primera movería una cantidad
      // distinta de la pedida sin que nada proteste.
      const tipoBuscado = norm(l.presentacion_tipo);
      const candidatas = f.presentaciones.filter((p) => p.tipo === tipoBuscado);
      if (candidatas.length === 0)
        return json({
          ok: false, codigo: "PRESENTACION_NO_EXISTE",
          error: `${nombre} ya no tiene la presentación ${l.presentacion_tipo}. `
               + `Ofrece: ${f.presentaciones.map((p) => p.tipo).join(", ") || "ninguna"}.`,
        }, 409);

      let elegida = "";
      let costo = "0", precio = "0", unidad = "0";
      for (const c of candidatas) {
        const p = await pedir(cookie, TRASLADO, new URLSearchParams({
          process: "getpresentacion", id_presentacion: c.id,
        }), { extra: { Referer: TRASLADO } });
        try {
          const jp = JSON.parse(p);
          if (Number(jp?.unidad) === Number(l.factor)) {
            elegida = c.id;
            costo = String(jp.costo); precio = String(jp.precio); unidad = String(jp.unidad);
            break;
          }
        } catch { /* la siguiente candidata */ }
      }
      if (!elegida)
        return json({
          ok: false, codigo: "FACTOR_CAMBIO",
          error: `${nombre}: se aprobó ${l.presentacion_tipo} de ${l.factor}, `
               + `y ninguna de las ${candidatas.length} presentaciones con ese nombre trae ese factor hoy.`,
        }, 409);

      // El tope se relee ACÁ y no al pedir la solicitud: entre pedirla y
      // despacharla se vendió, se trasladó o alguien la descartó. Y las dos
      // cifras están en unidades distintas — el sistema informa el stock en
      // unidades base y la cantidad viene en la presentación elegida.
      //
      // Y la cifra sale de los LOTES, no de la casilla de existencia — que trae
      // la del primer lote y no la del producto (ver `disponibleEnBodega`).
      const hay = disponibleEnBodega(
        f, Number(unidad),
        enUbicacion ? (enUbicacion.get(Number(l.erp_product_id)) ?? 0) : null,
        apartadoQueEstorba(lecturaOrigen, lecturaVencidos, Number(l.erp_product_id)),
      );
      if (Number(l.cantidad) > hay.paquetes)
        return json({
          ok: false, codigo: "SIN_EXISTENCIA",
          error: hay.desdeVencidos > 0
            ? `De ${nombre} hay ${hay.desdeVencidos} apartada${hay.desdeVencidos === 1 ? "" : "s"} en el área `
              + `de vencidos que no se distinguen de las del estante —ninguna tiene fecha de vencimiento—, así `
              + `que la salida puede llevarse la apartada. Resolvé esa existencia, o pedila desde el área de vencidos.`
            : `De ${nombre} ${hayEnTexto(hay, "la sala de origen")}: alcanzan para `
              + `${hay.paquetes} y se pidieron ${l.cantidad}.`,
        }, 409);

      // ── Los lotes ────────────────────────────────────────────────────────
      // Solo los regulados llevan control de lote; para el resto el selector
      // viene vacío y deshabilitado y va 0. La identidad de un lote es número +
      // fecha: hay productos con dos lotes de igual número y vencimientos
      // distintos, que son existencias separadas.
      //
      // ⚠️ Una línea puede salir de VARIOS lotes, y hasta el 2026-08-18 acá se
      // exigía que UNO solo cubriera todo. Eso frenaba mercadería que sí
      // estaba: Bodega no pudo mandar 6 cajas de ALOPURINOL 300 que tenía en
      // dos lotes (1 caja + 5 cajas), con el tope diciendo que alcanzaba
      // —`disponibleEnBodega` cuenta lote por lote a propósito— y el reparto
      // diciendo que ningún lote tenía «las 60 unidades juntas». El tope y el
      // reparto tienen que decir lo mismo o el tope frena lo que el reparto sí
      // sabía armar.
      //
      // El sistema lo acepta sin cambios: `datos` es una lista de renglones y
      // nada obliga a que el producto no se repita — es exactamente lo que
      // `trasladar-pedido-erp` manda para los pedidos desde el 2026-08-11.
      //
      // Y la reserva ORDENA, no limita (2026-08-18, la misma tarde): llega en
      // unidades y se redondea lote por lote —15 unidades en BLÍSTER X 10 son 1
      // blíster y sobran 5—, mientras el tope de arriba cuenta sobre el stock
      // del sistema, que decía 20. Un lote que dio menos de lo que tiene sigue
      // teniendo lo que le sobra, así que el reparto vuelve sobre él. Costó dos
      // traslados de DOLO APRANAX ese día, los dos con «faltan 1» sobre
      // existencia suficiente.
      //
      // `repartirEnLotes` decide de qué lotes sale y en qué cantidad cada uno:
      // primero lo que la solicitud reservó, después lo que vence primero. Es
      // pura y vive en `_shared` porque lo que produce entra al inventario de
      // una sala — está anclada en `tests/unit/repartirEnLotes.test.js`.
      const noRegulado = [{ cantidad: Number(l.cantidad), idLote: "0", lote: null as string | null }];
      const reparto = f.regulado
        ? repartirEnLotes(f.lotes, Number(l.cantidad), Number(unidad), reservadosDe(l, Number(unidad)))
        : { renglones: noRegulado, faltan: 0, avisos: [] as string[] };

      // Acá sí se corta: no hay de dónde sacar el resto. Se dice cuánto falta y
      // qué hay, para que quien despacha decida sin volver a mirar.
      if (reparto.faltan > 0)
        return json({
          ok: false, codigo: "SIN_EXISTENCIA_EN_LOTE",
          error: `De ${nombre} faltan ${reparto.faltan} de ${l.presentacion_tipo} para `
               + `completar ${l.cantidad}: los lotes de la sala de origen no alcanzan. `
               + `Hay: ${f.lotes.map((x) => `${x.numero} (${x.stock})`).join(", ") || "ninguno"}.`,
        }, 409);

      // El aviso nombra el producto: en un traslado de varias líneas, «el lote
      // X ya no está» sin decir de qué no se puede leer.
      if (reparto.avisos.length)
        avisosTraslado.push(...reparto.avisos.map((a) => `${nombre}: ${a}`));

      for (const r of reparto.renglones) {
        partes.push([
          l.erp_product_id, costo, precio, r.cantidad, unidad, f.vence || "", elegida, r.idLote,
        ].join("|"));

        total    += Number(costo || 0) * r.cantidad;
        unidades += r.cantidad;
        detalle.push({
          erp_product_id: l.erp_product_id, descripcion: l.descripcion,
          presentacion: `${l.presentacion_tipo} (${l.factor})`,
          id_presentacion_erp: elegida,
          cantidad: r.cantidad, unidad, costo, precio,
          existencia_previa: f.existencia,
          regulado: f.regulado,
          id_lote_erp: r.idLote !== "0" ? r.idLote : null,
          numero_lote: r.lote,
        });
      }

      msPorRenglon.push(Date.now() - arranqueRenglon);
    }

    // Un tope que no se anuncia es un truncamiento silencioso: si el presupuesto
    // cortó, no se manda NADA y se dice dónde quedó. Medio traslado es peor que
    // ninguno.
    if (cortadoEn >= 0)
      return json({
        ok: false, codigo: "SIN_TIEMPO",
        error: `No alcanzó el tiempo: se verificaron ${cortadoEn} de ${envio.length} productos. `
             + `Divide la solicitud en tandas más chicas.`,
      }, 504);

    // ── El candado: una sola escritura por solicitud ─────────────────────
    // El aviso le llega a VARIAS personas de la sala y cualquiera puede
    // confirmarlo. Sin esto, dos que aprieten a la vez pasan las dos el chequeo
    // de PENDING —que es una LECTURA— y las dos escriben en el sistema: el
    // producto sale dos veces y solo una de las dos actualiza la solicitud.
    //
    // El candado se toma acá y no al principio a propósito: así una validación
    // que falla —sin existencia, presentación que cambió— no deja la solicitud
    // trabada. Y caduca a los 3 minutos, más que los 150 s que vive una
    // invocación, así que una que muera a mitad se destraba sola.
    const ahora = new Date();
    const caduco = new Date(ahora.getTime() - 3 * 60_000).toISOString();
    const { data: tomada } = await admin
      .from("approval_requests")
      .update({
        metadata: { ...meta, despachando_at: ahora.toISOString(), despachando_by: quien.id },
      })
      .eq("id", sol.id)
      .eq("status", "PENDING")
      .or(`metadata->>despachando_at.is.null,metadata->>despachando_at.lt.${caduco}`)
      .select("id")
      .maybeSingle();
    if (!tomada)
      return json({
        ok: false, codigo: "YA_EN_CURSO",
        error: "Alguien más de tu sala está despachando este traslado en este momento.",
      }, 409);

    // ── El envío ─────────────────────────────────────────────────────────
    // La foto de ANTES: el id del traslado nuevo es el que no estaba. Es la
    // única forma sin ambigüedad de saber cuál es el propio, porque el `insert`
    // no lo devuelve y el listado no respeta el orden que se le pide.
    const antes = await pendientesDeOrigen(cookie, ubicOrigen);

    const resp = leerRespuesta(await pedir(cookie, TRASLADO, new URLSearchParams({
      process: "insert",
      datos: partes.join("#") + "#",
      id_traslado_guardado: "0",          // no viene de un borrador
      cuantos: String(partes.length),
      total: total.toFixed(4),
      fecha: hoySV(),
      concepto,
      origen: String(ubicOrigen),         // la UBICACIÓN de donde sale
      id_suc_destino: String(erpDestino), // la SUCURSAL que recibe
      id_ubicacion_destino: "0",
      numero_vale: vale,
    }), { extra: { Referer: TRASLADO } }));
    /* ── Un «no» del sistema no siempre significa que no salió ─────────────
     *
     * Es la misma lección que la RECEPCIÓN ya tenía aprendida más arriba, y que
     * este lado no aplicaba: el 2026-08-17 hubo diez respuestas de fallo al
     * recibir y dos de esos traslados terminaron FINALIZADOS igual. Del lado
     * del envío el desenlace es peor — la solicitud volvería a PENDING con el
     * producto ya fuera de la sala, y quien la vea la despacharía de nuevo.
     *
     * No sirve `identificarTrasladoNuevo` acá: esa función da por sentado que
     * el propio existe, así que con UN solo traslado nuevo lo toma sin abrirlo,
     * y ese único bien puede ser el de otra persona. El contenido es requisito.
     */
    const despues = await pendientesDeOrigen(cookie, ubicOrigen);
    const descripciones = envio.map((l) => l.descripcion ?? "");

    let idTraslado: string | null;
    let nuevos: string[];
    let avisoDelFallo: string | undefined;

    if (!resp.ok) {
      const { id, nuevos: aparecieron } = await trasladoQueSalioPeseAlFallo(
        cookie, antes, despues, descripciones,
      );
      if (!id) {
        // Se suelta el candado en vez de esperar a que caduque: el rechazo del
        // sistema suele ser algo que se corrige y se reintenta enseguida, y hacer
        // esperar tres minutos por un error ajeno no protege de nada.
        await admin.from("approval_requests")
          .update({ metadata: meta }).eq("id", sol.id).eq("status", "PENDING");
        return json({
          ok: false,
          error: `El sistema no aceptó el traslado: ${resp.msg || "sin detalle"}`
            // Aparecieron traslados nuevos y ninguno es claramente éste. No es
            // lo mismo que «no salió nada», y quien reintente tiene que saberlo
            // antes de despachar dos veces.
            + (aparecieron.length
              ? `. Ojo: en ese momento salieron ${aparecieron.length} traslado(s) más desde esa sala, así que puede haber salido igual — comprobalo antes de volver a intentar.`
              : ""),
        }, 502);
      }
      idTraslado = id;
      nuevos = [id];
      avisoDelFallo = `El sistema contestó un fallo y sin embargo lo despachó: ${resp.msg || "sin detalle"}`;
    } else {
      // ── Recién ahora la solicitud es APPROVED ──────────────────────────
      // El propio es el que aparece y antes no estaba. Si en el medio otra
      // persona despachó desde la misma sala aparecen dos, y ahí desempata el
      // DESTINO: el listado lo trae como la dirección larga y la página del
      // traslado tiene la liga sucursal → dirección.
      //
      // Si ni así queda uno solo —dos despachos simultáneos de la misma sala a la
      // misma sala—, se deja en null con los candidatos anotados. El traslado
      // entró igual; lo único que se pierde es poder recibirlo sin buscarlo a
      // mano, que es infinitamente mejor que recibir el de otro.
      // Y si el destino tampoco alcanza —dos traslados de esta sala a la misma
      // sala, en el mismo instante— se mira lo que llevan adentro. Es el caso que
      // aparece cuando una sala pide dos productos distintos a la misma sala y
      // dos personas los despachan a la vez.
      //
      // Las dos vueltas vivían acá adentro, copiadas del helper compartido que
      // nació con ellas y que nadie llamaba. Eso hizo que las otras dos funciones
      // que despachan —el pedido y la devolución— se quedaran sin desempate
      // durante meses, y el 2026-08-18 nueve renglones quedaron sin número. Una
      // sola copia, la de `_shared`.
      ({ id: idTraslado, candidatos: nuevos } = await identificarTrasladoNuevo(
        cookie, antes, despues, html, erpDestino, descripciones,
      ));
    }

    const aplicado = {
      at: new Date().toISOString(),
      by: quien.id, by_name: quien.name,
      // La sala de quien despachó, para que el concepto de la RECEPCIÓN la
      // pueda nombrar: ahí ya no se tiene a esta persona a mano, sólo lo que
      // quedó guardado acá.
      by_sala: codigoDespacha,
      // Lo despachó la sala de respaldo porque la del producto estaba cerrada.
      // Se guarda para que la sala de origen pueda ver, al abrir, qué salió
      // mientras no había nadie — y para que el historial no lo cuente como si
      // lo hubiera despachado ella. `undefined` en el caso normal: la clave ni
      // siquiera aparece en el jsonb.
      por_respaldo: cubreAlOrigen ? true : undefined,
      id_traslado: idTraslado,
      // Si quedó en null, el traslado ENTRÓ igual: lo único que falta es el
      // número para poder recibirlo desde el portal. Se dice, no se calla.
      id_traslado_ambiguo: idTraslado === null ? nuevos : undefined,
      numero_vale: vale,
      erp_sucursal_origen: erpOrigen,
      erp_ubicacion_origen: ubicOrigen,
      // De qué estante salió, dicho por su nombre y no por el número de la
      // ubicación: el número sólo se entiende con el mapa a la vista.
      // `undefined` en el caso normal — la clave ni aparece en el jsonb.
      origen_vencidos: origenVencidos ? true : undefined,
      erp_sucursal_destino: erpDestino,
      concepto,
      concepto_recortado: conceptoRecortado,
      concepto_completo: conceptoRecortado ? conceptoCompleto : undefined,
      // PRODUCTOS, no renglones: el detalle lo lee como «N productos» y desde
      // que una línea puede salir de varios lotes `partes.length` cuenta lotes.
      // Acá ya se verificaron todos —el bucle sale por `return` o completo—.
      lineas: envio.length,
      renglones: partes.length !== envio.length ? partes.length : undefined,
      // ── Lo que NO salió, y por qué ──────────────────────────────────────
      // `metadata.items` sigue diciendo lo que se pidió; esto dice lo que
      // salió. Sin las dos cosas por separado no hay forma de saber después que
      // faltó algo: la solicitud se leería como cumplida entera.
      //
      // `undefined` cuando salió todo — la clave ni aparece en el jsonb, y así
      // «tiene parcial» es lo mismo que «no salió completo».
      parcial: esParcial
        ? {
          motivo: motivoParcial,
          // Renglones que salieron con menos de lo pedido.
          ajustados: ajustados.map((a) => ({
            i: a.i,
            erp_product_id: lineas[a.i].erp_product_id,
            descripcion: lineas[a.i].descripcion,
            pedida: Number(lineas[a.i].cantidad) || 0,
            enviada: a.cantidad,
          })),
          // Renglones que no salieron en absoluto.
          fuera: fuera.map((i) => ({
            i,
            erp_product_id: lineas[i].erp_product_id,
            descripcion: lineas[i].descripcion,
            pedida: Number(lineas[i].cantidad) || 0,
          })),
        }
        : undefined,
      // De dónde va a salir el tope de productos por solicitud (ver el bucle).
      ms_por_renglon: msPorRenglon,
      ms_total: Date.now() - arranque,
      // Qué se apartó de lo pedido sin llegar a frenarlo.
      avisos: avisosTraslado.length ? avisosTraslado : undefined,
      unidades,
      total: Number(total.toFixed(4)),
      msg: avisoDelFallo ?? resp.msg,
      detalle,
    };

    const { error: updErr } = await admin
      .from("approval_requests")
      .update({
        status: "APPROVED",
        approver_id: quien.id,
        approver_note: typeof approver_note === "string" && approver_note.trim()
          ? approver_note.trim() : null,
        metadata: { ...meta, erp_traslado: aplicado },
        updated_at: new Date().toISOString(),
      })
      .eq("id", sol.id)
      .eq("status", "PENDING");          // no pisar si otro la resolvió en el medio
    if (updErr) throw updErr;

    return json({ ok: true, aplicado });

  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
