import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireActiveEmployeeUser } from "../_shared/security.ts";
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
  contenidoDeTraslado,
  direccionesPorSucursal,
  disponibleEnBodega,
  hayEnTexto,
  hoySV,
  norm,
  pendientesDeOrigen,
  RECIBIR,
  sesionEn as abrirSesionEn,
  TRASLADO,
  leerFila,
} from "../_shared/erp-traslado.ts";

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
    const { request_id, approver_note, accion } = await req.json().catch(() => ({}));
    if (!request_id) return json({ ok: false, error: "Falta request_id." }, 400);
    const paso = accion === "recibir" ? "recibir" : "enviar";

    // ── Quién llama. Nunca del payload: del JWT. ──────────────────────────
    const quien = await requireActiveEmployeeUser(req, admin);
    if (!quien) return json({ ok: false, error: "Sesión inválida o empleado inactivo." }, 401);

    // ── El permiso es `traslados`, no `requests` ──────────────────────────
    // Módulos distintos a propósito: `requests` es permisos, vacaciones e
    // incapacidades, y confirmar un traslado no debe arrastrar eso.
    const { data: emp } = await admin
      .from("employees").select("role_id, secondary_role_id, branch_id, system_role, first_names, last_names")
      .eq("id", quien.id).maybeSingle();
    const roles = [emp?.role_id, emp?.secondary_role_id].filter((r) => r != null);
    const { data: permisos } = await admin
      .from("role_permissions").select("can_approve, scope")
      .in("role_id", roles.length ? roles : [-1])
      .eq("module_key", "traslados");
    const puede = emp?.system_role === "SUPERADMIN"
      || (permisos ?? []).some((p) => p.can_approve);
    if (!puede)
      return json({ ok: false, error: "No tienes permiso para confirmar traslados." }, 403);
    const alcanceTodo = emp?.system_role === "SUPERADMIN"
      || (permisos ?? []).some((p) => p.can_approve && p.scope === "ALL");

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
    const destinatarios: string[] = Array.isArray(meta.destinatarios) ? meta.destinatarios : [];

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
    // sale el producto. La de trabajo es la que NO es de vencidos — Bodega tiene
    // las dos y la de vencidos es un destino, nunca un origen.
    //
    // La del destino venía en la solicitud, o sea del navegador. La pantalla de
    // pedido no la manda —no tiene por qué saberla— así que llegaba `undefined`,
    // viajaba como «NaN» y el sistema contestaba «No se proporcionaron los datos
    // correctos para actualizar el stock». Lo destapó la primera prueba de punta
    // a punta POR LA PANTALLA: el mismo camino por API pasaba, porque el script
    // de prueba se la pasaba a mano. La ubicación es una propiedad de la sala,
    // no un dato que el cliente elija.
    const deTrabajo = (m: { inv_ubicaciones?: unknown } | null | undefined) => Number(
      (Array.isArray(m?.inv_ubicaciones) ? m!.inv_ubicaciones as { id: number; isVencidos: boolean }[] : [])
        .find((u) => !u.isVencidos)?.id ?? 0,
    );
    const ubicOrigen  = deTrabajo(porSucursal.get(erpOrigen));
    const ubicDestino = deTrabajo(porSucursal.get(erpDestino));

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

      const cookie = await sesionEn(erpDestino);
      const pagina = await pedir(cookie, `${RECIBIR}?id_movimiento=${encodeURIComponent(idTraslado)}`,
        undefined, { extra: { Referer: `${BASE}/admin_traslados.php` } });

      // El servidor pre-rellena la tabla entera: producto, presentación ya
      // resuelta (una sola opción), costo, precio, lo esperado y el vencimiento.
      // Acá no hay nada que elegir — de ahí que esta mitad no tenga ni la trampa
      // de la presentación ni la del lote.
      const filas = [...pagina.matchAll(/<tr>[\s\S]*?<\/tr>/g)]
        .map((m) => m[0])
        .filter((tr) => /class="id_p"/.test(tr));
      if (filas.length === 0)
        return json({
          ok: false, codigo: "TRASLADO_SIN_LINEAS",
          error: `El traslado ${idTraslado} no muestra líneas para recibir. `
               + `Puede haberse recibido o anulado desde el sistema.`,
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
      if (!resp.ok)
        return json({ ok: false, error: `El sistema no aceptó la recepción: ${resp.msg || "sin detalle"}` }, 502);

      const recibido = {
        at: new Date().toISOString(), by: quien.id, by_name: quien.name,
        id_traslado: idTraslado, concepto,
        lineas: partes.length, unidades, total: Number(total.toFixed(4)),
        msg: resp.msg,
      };
      // `is: null` en la condición y no un chequeo previo: dos personas de la
      // sala que aprieten «ya llegó» a la vez pasan las dos la lectura de más
      // arriba. Acá la segunda no escribe — aunque en la práctica el sistema ya
      // la habría frenado, porque un traslado recibido deja de mostrar líneas.
      const { error: updErr } = await admin
        .from("approval_requests")
        .update({ metadata: { ...meta, erp_recibido: recibido }, updated_at: new Date().toISOString() })
        .eq("id", sol.id)
        .is("metadata->erp_recibido", null);
      if (updErr) throw updErr;

      return json({ ok: true, recibido });
    }

    // ══════════════════════════════════════════════════════════════════════
    // PASO 1 · ENVIAR (en origen)
    // ══════════════════════════════════════════════════════════════════════
    if (sol.status !== "PENDING")
      return json({ ok: false, error: `La solicitud ya está ${sol.status}.` }, 409);
    if (lineas.length === 0)
      return json({ ok: false, error: "La solicitud no pide ni un producto." }, 422);
    if (!ubicOrigen)
      return json({
        ok: false,
        error: `No se conoce la ubicación de la sala de origen (${erpOrigen}).`,
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
    if (!alcanceTodo && !destinatarios.includes(quien.id) && !esDeLaSalaDeOrigen)
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
    const { concepto, recortado: conceptoRecortado, completo: conceptoCompleto } = armarConcepto(
      `PIDE ${conSala(solicitante, codigoDeBranch(solicitante?.branch_id))}`
      + ` ENV ${conSala({ ...emp, name: quien.name }, codigoDespacha)}`,
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
    let total = 0;
    let unidades = 0;
    let cortadoEn = -1;

    for (let i = 0; i < lineas.length; i++) {
      if (Date.now() - arranque > PRESUPUESTO_MS) { cortadoEn = i; break; }
      const l = lineas[i];
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
      // la del primer lote y no la del producto (ver `disponibleEnBodega`). Acá
      // el traslado va con UN lote, así que el filtro de abajo sigue exigiendo
      // que uno solo cubra todo; lo que cambia es que dejó de frenarse un pedido
      // que un lote posterior sí podía cubrir.
      const pedidoEnUnidades = Number(l.cantidad) * Number(unidad);
      const hay = disponibleEnBodega(f, Number(unidad));
      if (Number(l.cantidad) > hay.paquetes)
        return json({
          ok: false, codigo: "SIN_EXISTENCIA",
          error: `De ${nombre} ${hayEnTexto(hay, "la sala de origen")}: alcanzan para `
               + `${hay.paquetes} y se pidieron ${l.cantidad}.`,
        }, 409);

      // ── El lote ──────────────────────────────────────────────────────────
      // Solo los regulados llevan control de lote; para el resto el selector
      // viene vacío y deshabilitado y va 0. La identidad de un lote es número +
      // fecha: hay productos con dos lotes de igual número y vencimientos
      // distintos, que son existencias separadas.
      let idLote = "0";
      if (f.regulado) {
        const buscadoNum = norm(l.numero_lote ?? "");
        const buscadoVen = String(l.vence ?? "").slice(0, 10);
        // Sin lote pedido se toma el que vence primero: es lo que corresponde
        // despachar, y la solicitud nace de una lista de faltantes donde nadie
        // eligió lote.
        const lote = buscadoNum
          ? f.lotes.find((x) => norm(x.numero) === buscadoNum
              && (!buscadoVen || x.vence.slice(0, 10) === buscadoVen))
          : [...f.lotes].filter((x) => x.stock >= pedidoEnUnidades)
              .sort((a, b) => a.vence.localeCompare(b.vence))[0];
        if (!lote)
          return json({
            ok: false, codigo: "LOTE_NO_EXISTE",
            error: buscadoNum
              ? `El lote ${l.numero_lote} de ${nombre} ya no existe en la sala de origen. `
                + `Quedan: ${f.lotes.map((x) => `${x.numero} ${x.vence}`).join(", ") || "ninguno"}.`
              : `Ningún lote de ${nombre} tiene las ${pedidoEnUnidades} unidades juntas. `
                + `Hay: ${f.lotes.map((x) => `${x.numero} (${x.stock})`).join(", ") || "ninguno"}.`,
          }, 409);
        if (pedidoEnUnidades > lote.stock)
          return json({
            ok: false, codigo: "SIN_EXISTENCIA_EN_LOTE",
            error: `El lote ${lote.numero} de ${nombre} tiene ${lote.stock} unidades, `
                 + `y se pidieron ${pedidoEnUnidades}.`,
          }, 409);
        idLote = lote.id;
      }

      partes.push([
        l.erp_product_id, costo, precio, l.cantidad, unidad, f.vence || "", elegida, idLote,
      ].join("|"));

      total    += Number(costo || 0) * Number(l.cantidad);
      unidades += Number(l.cantidad);
      detalle.push({
        erp_product_id: l.erp_product_id, descripcion: l.descripcion,
        presentacion: `${l.presentacion_tipo} (${l.factor})`,
        id_presentacion_erp: elegida,
        cantidad: l.cantidad, unidad, costo, precio,
        existencia_previa: f.existencia,
        regulado: f.regulado,
        id_lote_erp: idLote !== "0" ? idLote : null,
      });
    }

    // Un tope que no se anuncia es un truncamiento silencioso: si el presupuesto
    // cortó, no se manda NADA y se dice dónde quedó. Medio traslado es peor que
    // ninguno.
    if (cortadoEn >= 0)
      return json({
        ok: false, codigo: "SIN_TIEMPO",
        error: `No alcanzó el tiempo: se verificaron ${cortadoEn} de ${lineas.length} productos. `
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
    if (!resp.ok) {
      // Se suelta el candado en vez de esperar a que caduque: el rechazo del
      // sistema suele ser algo que se corrige y se reintenta enseguida, y hacer
      // esperar tres minutos por un error ajeno no protege de nada.
      await admin.from("approval_requests")
        .update({ metadata: meta }).eq("id", sol.id).eq("status", "PENDING");
      return json({ ok: false, error: `El sistema no aceptó el traslado: ${resp.msg || "sin detalle"}` }, 502);
    }

    // ── Recién ahora la solicitud es APPROVED ────────────────────────────
    // El propio es el que aparece y antes no estaba. Si en el medio otra
    // persona despachó desde la misma sala aparecen dos, y ahí desempata el
    // DESTINO: el listado lo trae como la dirección larga y la página del
    // traslado tiene la liga sucursal → dirección.
    //
    // Si ni así queda uno solo —dos despachos simultáneos de la misma sala a la
    // misma sala—, se deja en null con los candidatos anotados. El traslado
    // entró igual; lo único que se pierde es poder recibirlo sin buscarlo a
    // mano, que es infinitamente mejor que recibir el de otro.
    const despues = await pendientesDeOrigen(cookie, ubicOrigen);
    let nuevos = [...despues.keys()].filter((id) => !antes.has(id));
    if (nuevos.length > 1) {
      const dirDestino = direccionesPorSucursal(html).get(String(erpDestino));
      if (dirDestino) {
        const mismos = nuevos.filter((id) => {
          const d = norm(despues.get(id) ?? "");
          return d && (d === dirDestino || d.includes(dirDestino) || dirDestino.includes(d));
        });
        if (mismos.length > 0) nuevos = mismos;
      }
    }
    // Y si el destino tampoco alcanza —dos traslados de esta sala a la misma
    // sala, en el mismo instante— se mira lo que llevan adentro. Es el caso que
    // aparece cuando una sala pide dos productos distintos a la misma sala y
    // dos personas los despachan a la vez.
    if (nuevos.length > 1) {
      const buscado = lineas.map((l) => norm(l.descripcion ?? "")).filter(Boolean);
      if (buscado.length > 0) {
        const coinciden: string[] = [];
        for (const id of nuevos) {
          const c = await contenidoDeTraslado(cookie, id);
          if (c && buscado.every((d) => c.includes(d))) coinciden.push(id);
        }
        if (coinciden.length > 0) nuevos = coinciden;
      }
    }
    const idTraslado = nuevos.length === 1 ? nuevos[0] : null;
    const aplicado = {
      at: new Date().toISOString(),
      by: quien.id, by_name: quien.name,
      // La sala de quien despachó, para que el concepto de la RECEPCIÓN la
      // pueda nombrar: ahí ya no se tiene a esta persona a mano, sólo lo que
      // quedó guardado acá.
      by_sala: codigoDespacha,
      id_traslado: idTraslado,
      // Si quedó en null, el traslado ENTRÓ igual: lo único que falta es el
      // número para poder recibirlo desde el portal. Se dice, no se calla.
      id_traslado_ambiguo: idTraslado === null ? nuevos : undefined,
      numero_vale: vale,
      erp_sucursal_origen: erpOrigen,
      erp_ubicacion_origen: ubicOrigen,
      erp_sucursal_destino: erpDestino,
      concepto,
      concepto_recortado: conceptoRecortado,
      concepto_completo: conceptoRecortado ? conceptoCompleto : undefined,
      lineas: partes.length,
      unidades,
      total: Number(total.toFixed(4)),
      msg: resp.msg,
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
