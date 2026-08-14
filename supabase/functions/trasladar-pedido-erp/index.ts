import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireActiveEmployeeUser, requireInvokeSecret } from "../_shared/security.ts";
import { BASE, login, pedir, leerRespuesta } from "../_shared/erp-dte.ts";
import {
  armarConcepto,
  disponibleEnBodega,
  hoySV,
  nombreCorto,
  norm,
  pendientesDeOrigen,
  resolverPresentacion,
  sesionEn,
  traerFila,
  RECIBIR,
  TRASLADO,
} from "../_shared/erp-traslado.ts";

// Mueve al sistema de origen el pedido de reposición que Bodega ya terminó de
// preparar. Hasta hoy ese movimiento se tecleaba a mano: el portal solo dejaba
// una marca de «recibido en el sistema», que era una promesa, no un asiento.
//
// ── Por qué NO se parece a `aplicar-traslado-inventario` ───────────────────
// Aquella despacha lo que una sala le pidió a otra: 1 a 5 líneas, con una
// persona mirando. Acá son **147 a 553 líneas** por sucursal (medido sobre los
// pedidos #89 a #96), y cada una necesita al menos dos viajes al sistema
// —`traerdatos` para la existencia y los lotes, `getpresentacion` para
// confirmar el factor—. Eso son ~900 llamadas, y la respuesta de una Edge
// Function vive 150 s. De ahí las dos diferencias de fondo:
//
//   1. **Corre en background por defecto.** La respuesta sale enseguida con el
//      id de la fila y el trabajo sigue con `EdgeRuntime.waitUntil`. Es el
//      mismo patrón de `sync-erp-purchases`, por el mismo motivo: el sistema es
//      más lento que el límite de la respuesta.
//   2. **El rastro es una TABLA, no la respuesta.** `pedido_traslado_erp`
//      guarda el intento entero. En background no hay a quién contarle un
//      error, así que si no queda escrito no pasó.
//
// ── El simulacro ───────────────────────────────────────────────────────────
// `simulacro: true` (el valor por omisión) hace TODAS las verificaciones contra
// el sistema y no escribe ni una línea. Existe porque un traslado que se cae en
// la línea 300 no dice nada útil, y porque la única forma honesta de saber
// cuánto tarda esto de verdad es medirlo. Devuelve la lista de productos que no
// se pudieron resolver, con el motivo de cada uno.
//
// ── La cantidad sale de la presentación REAL, nunca de la de picking ───────
// `dispatch_tipo`/`dispatch_factor` son comodidad para armar las cajas —la
// «CAJA ×12» que se imprime en la hoja—, no la presentación con la que el
// producto vive en el sistema. El movimiento va con `erp_presentacion_id` y
// `factor`, que es lo que se le descuenta a Bodega. Confundirlos mueve una
// cantidad distinta de la despachada.

// El techo NO es negociable y NO lo corre `EdgeRuntime.waitUntil`: la
// documentación de Supabase dice que evita que maten al worker por inactividad,
// pero el límite de reloj de pared sigue siendo **400 s** en plan Pro (150 s en
// free). Un presupuesto por encima de eso es una guarda que nunca se dispara:
// al worker lo matan antes, y el trabajo queda cortado sin que nadie lo anote.
//
// 240 s deja un 40% de margen para un día lento del sistema de origen — que los
// tiene: hay endpoints suyos medidos en 167 s.
const PRESUPUESTO_FG_MS = 110_000; // respuesta directa: hay que alcanzar a contestar
const PRESUPUESTO_BG_MS = 240_000; // background: corto y se retoma, nunca una corrida larga

interface ItemPedido {
  id: number;
  erp_product_id: number;
  erp_presentacion_id: number | null;
  /** Lo que se mueve: lo que Bodega confirmó que sale, o lo asignado si todavía no confirmó. */
  cantidad: number;
  cantidad_asignada: number;
  confirmada: boolean;
  factor: number | null;
  lotes_asignados: { lote?: string; fecha_vencimiento?: string; take?: number; packs?: number }[] | null;
  presentacion_tipo: string;
  nombre: string;
}

interface Hallazgo {
  erp_product_id: number;
  producto: string;
  codigo: string;
  detalle: string;
}

/** Trae TODOS los ítems despachables del pedido para esa sucursal, paginando. */
async function leerItems(
  admin: ReturnType<typeof createClient>, pedidoId: string, sucId: number,
): Promise<ItemPedido[]> {
  const CHUNK = 1000;
  const todos: ItemPedido[] = [];
  for (let page = 0; ; page++) {
    // El `.range()` va pegado al `.select()` y no al final de la cadena a
    // propósito: `gate:data` mira los 450 caracteres que siguen al `.from()`
    // para decidir si la consulta pagina, y con el select largo de acá el
    // `.range()` quedaba fuera de esa ventana. La paginación era real igual,
    // pero un detector que no la ve es un detector que no sirve.
    const { data, error } = await admin
      .from("pedido_items")
      .select(`id, erp_product_id, erp_presentacion_id, cantidad_asignada,
               cantidad_enviada, status, factor, lotes_asignados,
               products ( nombre ), presentaciones!erp_presentacion_id ( tipo )`)
      .range(page * CHUNK, (page + 1) * CHUNK - 1)
      .eq("pedido_id", pedidoId)
      .eq("erp_sucursal_id", sucId)
      .eq("sin_stock", false)
      .gt("cantidad_asignada", 0)
      // Lo que Bodega decidió no mandar no se traslada. Es un estado terminal:
      // el renglón ya está cerrado y el MIN/MAX lo volverá a pedir.
      .neq("status", "no_enviado")
      .order("id", { ascending: true });
    if (error) throw error;
    const filas = (data ?? []) as Record<string, unknown>[];
    for (const r of filas) {
      // Se mueve lo ENVIADO. El COALESCE deja que el simulacro corra antes de
      // que Bodega confirme —que es justo cuando sirve, para saber qué avisarle—
      // y que un pedido viejo, sin la columna, siga comportándose igual.
      const confirmada = r.cantidad_enviada != null;
      todos.push({
        id: Number(r.id),
        erp_product_id: Number(r.erp_product_id),
        erp_presentacion_id: r.erp_presentacion_id == null ? null : Number(r.erp_presentacion_id),
        cantidad: Number(confirmada ? r.cantidad_enviada : r.cantidad_asignada),
        confirmada,
        cantidad_asignada: Number(r.cantidad_asignada),
        factor: r.factor == null ? null : Number(r.factor),
        lotes_asignados: Array.isArray(r.lotes_asignados) ? r.lotes_asignados as ItemPedido["lotes_asignados"] : null,
        presentacion_tipo: String((r.presentaciones as { tipo?: string } | null)?.tipo ?? ""),
        nombre: String((r.products as { nombre?: string } | null)?.nombre ?? r.erp_product_id),
      });
    }
    if (filas.length < CHUNK) break;
  }
  return todos;
}

/** La ubicación de trabajo de una sucursal (la de vencidos nunca es origen). */
function ubicacionDeTrabajo(m: { inv_ubicaciones?: unknown } | null): number {
  const lista = Array.isArray(m?.inv_ubicaciones)
    ? m!.inv_ubicaciones as { id: number; isVencidos: boolean }[]
    : [];
  return Number(lista.find((u) => !u.isVencidos)?.id ?? 0);
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
    const cuerpo = await req.json().catch(() => ({}));
    let pedidoId = String(cuerpo.pedido_id ?? "");
    let sucId = Number(cuerpo.erp_sucursal_id ?? 0);
    // El simulacro es el valor por omisión a propósito: esta función mueve
    // inventario real, y escribir tiene que ser una decisión explícita.
    let simulacro = cuerpo.simulacro !== false;
    // 'enviar' saca de bodega; 'recibir' ingresa en la sucursal. Son las dos
    // mitades que el sistema distingue, y corren en sesiones distintas.
    let accion = cuerpo.accion === "recibir" ? "recibir" : "enviar";
    // Qué recibir: una hoja entera, o unos productos sueltos —el que la
    // sucursal va a vender antes de contar la caja—.
    const hoja = cuerpo.hoja == null ? null : Number(cuerpo.hoja);
    const itemIds: number[] = Array.isArray(cuerpo.pedido_item_ids)
      ? cuerpo.pedido_item_ids.map(Number).filter(Number.isFinite)
      : [];
    // Y el background también: 450 productos no entran en una respuesta.
    let background = cuerpo.background !== false;
    let empBranchId: number | null = null;

    // ── Continuación automática ───────────────────────────────────────────
    // 900 productos no entran en una corrida: el despacho se corta por
    // presupuesto y hay que retomarlo. Sin esto la maquinaria de reanudación no
    // servía de nada — nadie la llamaba, y un pedido grande se quedaba a medio
    // despachar en silencio, que es justo el escenario peligroso.
    //
    // El cron la invoca con el secreto de siempre y SOLO un `run_id`: ni el
    // pedido ni la sucursal ni el actor vienen de afuera, salen de la corrida.
    const interno = requireInvokeSecret(req);
    let quien: { id: string; name: string } | null = null;
    let alcanceTodo = false;
    // El nombre que va al concepto. Es el único lugar del sistema donde aparece
    // la persona real: su columna «usuario» muestra siempre la cuenta del portal.
    let yo = "-";

    if (interno) {
      const runId = String(cuerpo.run_id ?? "");
      if (!runId) return json({ ok: false, error: "Falta run_id." }, 400);
      const { data: run } = await admin
        .from("pedido_traslado_erp")
        .select("id, pedido_id, erp_sucursal_id, estado, modo, paso, creado_por")
        .eq("id", runId).maybeSingle();
      if (!run || run.estado !== "en_curso" || run.modo !== "real" || run.paso !== "enviar")
        return json({
          ok: false, codigo: "NADA_QUE_CONTINUAR",
          error: "Esa corrida no está en curso.",
        }, 409);
      pedidoId = String(run.pedido_id);
      sucId = Number(run.erp_sucursal_id);
      const { data: autor } = await admin
        .from("employees").select("id, name, first_names, last_names")
        .eq("id", run.creado_por).maybeSingle();
      quien = autor ?? { id: String(run.creado_por ?? ""), name: "Continuacion automatica" };
      // La corrida que retoma el cron sigue firmando con quien FINALIZÓ el
      // pedido, no con la máquina: el asiento es de esa persona.
      yo = nombreCorto(autor ?? { name: "Continuacion automatica" });
      alcanceTodo = true;
      accion = "enviar";
      simulacro = false;
      background = true;
    }

    if (!pedidoId || !sucId)
      return json({ ok: false, error: "Faltan pedido_id o erp_sucursal_id." }, 400);

    // ── Interruptor de pausa ──────────────────────────────────────────────
    // El freno para cuando algo sale mal. Se consulta acá, antes de tocar
    // nada, y alcanza también al cron: la continuación automática entra por
    // este mismo punto, así que pausar detiene lo que ya venía corriendo.
    //
    // FALLA CERRADO. Si no se puede leer el interruptor no se despacha: un
    // producto que no se movió se mueve después, uno que se movió de más hay
    // que ir a buscarlo. El simulacro sigue permitido —no escribe— para poder
    // mirar en qué estado quedó todo mientras está pausado.
    if (!simulacro) {
      const { data: sw, error: swErr } = await admin
        .from("traslado_interruptor")
        .select("pausado, motivo")
        .eq("accion", accion)
        .maybeSingle();
      if (swErr || !sw) {
        return json({
          ok: false, codigo: "INTERRUPTOR_ILEGIBLE",
          error: "No se pudo comprobar si los traslados están pausados. No se movió nada.",
        }, 503);
      }
      if (sw.pausado) {
        return json({
          ok: false, codigo: "TRASLADOS_PAUSADOS",
          error: accion === "recibir"
            ? `La recepción de pedidos está pausada${sw.motivo ? `: ${sw.motivo}` : "."}`
            : `El envío de pedidos está pausado${sw.motivo ? `: ${sw.motivo}` : "."}`,
        }, 409);
      }
    }

    if (!interno) {
      // ── Quién llama. Nunca del payload: del JWT. ────────────────────────
      const usuario = await requireActiveEmployeeUser(req, admin);
      if (!usuario) return json({ ok: false, error: "Sesión inválida o empleado inactivo." }, 401);
      quien = { id: usuario.id, name: usuario.name };

      // ── El permiso es el del módulo Pedidos ─────────────────────────────
      // Se repite acá porque esta función usa la llave de servicio y el RLS no
      // la frena. Es el mismo que exige `confirm_pedido`.
      const { data: emp } = await admin
        .from("employees").select("role_id, secondary_role_id, system_role, branch_id, first_names, last_names")
        .eq("id", usuario.id).maybeSingle();
      yo = nombreCorto({ ...emp, name: usuario.name });
      const roles = [emp?.role_id, emp?.secondary_role_id].filter((r) => r != null);
      const { data: permisos } = await admin
        .from("role_permissions").select("can_edit, scope")
        .in("role_id", roles.length ? roles : [-1])
        .eq("module_key", "pedidos");
      const puede = emp?.system_role === "SUPERADMIN" || (permisos ?? []).some((p) => p.can_edit);
      if (!puede)
        return json({ ok: false, error: "No tienes permiso de edición en Pedidos." }, 403);
      alcanceTodo = emp?.system_role === "SUPERADMIN"
        || (permisos ?? []).some((p) => p.can_edit && p.scope === "ALL");
      empBranchId = emp?.branch_id == null ? null : Number(emp.branch_id);
    }

    // ── Origen y destino salen del mapa, nunca del cliente ────────────────
    // La ubicación es una propiedad de la sala. Pedírsela al navegador sería
    // dejar que elija de dónde sale el producto — la misma razón por la que
    // `aplicar-traslado-inventario` dejó de recibirla.
    const { data: mapas, error: mapaErr } = await admin
      .from("erp_sucursal_map")
      .select("erp_sucursal_id, nombre, es_bodega, branch_id, inv_ubicaciones");
    if (mapaErr) throw mapaErr;
    const mapaOrigen = (mapas ?? []).find((m) => m.es_bodega) ?? null;
    const mapaDestino = (mapas ?? []).find((m) => m.erp_sucursal_id === sucId) ?? null;
    if (!mapaOrigen) return json({ ok: false, error: "No hay una bodega marcada en el mapa de sucursales." }, 422);
    if (!mapaDestino) return json({ ok: false, error: `La sucursal ${sucId} no existe en el mapa.` }, 422);
    if (mapaDestino.es_bodega)
      return json({ ok: false, error: "El destino no puede ser la propia bodega." }, 422);

    const erpOrigen = Number(mapaOrigen.erp_sucursal_id);
    const ubicOrigen = ubicacionDeTrabajo(mapaOrigen);
    if (!ubicOrigen)
      return json({ ok: false, error: "No se conoce la ubicación de trabajo de la bodega." }, 422);

    // ══════════════════════════════════════════════════════════════════════
    // PASO 2 · RECIBIR — una hoja entera, o un producto suelto
    // ══════════════════════════════════════════════════════════════════════
    //
    // Acá se ve para qué sirvió mandar un traslado por producto: cada uno se
    // recibe ENTERO, así que «confirmo la hoja 3» son los N traslados de esa
    // hoja y «necesito este producto para venderlo» es el suyo y nada más. No
    // hace falta que el sistema soporte recepción parcial, que no la soporta.
    //
    // No lleva fila de corrida: recibir pasa muchas veces por pedido —una por
    // hoja, o una por producto apurado— y el índice único de `pedido_traslado_erp`
    // está pensado para lo contrario, un despacho y nada más.
    if (accion === "recibir") {
      const ubicDestino = ubicacionDeTrabajo(mapaDestino);
      if (!ubicDestino)
        return json({ ok: false, error: `No se conoce la ubicación de la sala que recibe (${sucId}).` }, 422);

      // Recibir mete inventario en una sala, así que tiene que ser LA SUYA.
      // Sin esto, cualquiera con permiso de edición en Pedidos podía ingresar
      // el traslado de otra sucursal — y eso mueve existencias ajenas.
      // `aplicar-traslado-inventario` ya exigía lo mismo; acá faltaba.
      if (!alcanceTodo) {
        const branchDestino = Number(mapaDestino.branch_id ?? 0);
        if (!empBranchId || empBranchId !== branchDestino)
          return json({
            ok: false,
            error: "El traslado lo recibe la sala a la que va.",
          }, 403);
      }

      let q = admin.from("pedido_traslado_linea")
        .select("id, pedido_item_id, erp_product_id, id_traslado, clave, hoja, cantidad")
        .eq("pedido_id", pedidoId).eq("erp_sucursal_id", sucId)
        .eq("estado", "enviada")
        .not("id_traslado", "is", null)
        .order("hoja", { ascending: true })
        .limit(500);
      if (hoja != null)     q = q.eq("hoja", hoja);
      if (itemIds.length)   q = q.in("pedido_item_id", itemIds);

      const { data: lineas, error: lineasErr } = await q;
      if (lineasErr) throw lineasErr;
      if (!lineas?.length)
        return json({
          ok: false, codigo: "NADA_QUE_RECIBIR",
          error: hoja != null
            ? `La hoja ${hoja} no tiene traslados pendientes de recibir.`
            : "No hay traslados pendientes de recibir para eso.",
        }, 409);

      // Sesión en el DESTINO: la sucursal es estado global de la sesión del
      // sistema, y recibir escribe en la sala que recibe.
      const cookie = await sesionEn(sucId, login);
      let recibidas = 0;
      const fallos: { clave: string; error: string }[] = [];

      for (const ln of lineas) {
        if (Date.now() - arranque > PRESUPUESTO_FG_MS) break;

        // Se toma la línea ANTES de tocar el sistema. Dos personas de la sala
        // confirmando la misma hoja a la vez pasarían las dos la lectura de
        // arriba; acá la segunda no entra. Recibir dos veces duplicaría la
        // existencia, y eso no se deshace solo.
        const { data: tomadaRec } = await admin.from("pedido_traslado_linea")
          .update({ estado: "recibiendo", updated_at: new Date().toISOString() })
          .eq("id", ln.id).eq("estado", "enviada")
          .select("id").maybeSingle();
        if (!tomadaRec) continue;

        const pagina = await pedir(cookie, `${RECIBIR}?id_movimiento=${encodeURIComponent(String(ln.id_traslado))}`,
          undefined, { extra: { Referer: `${BASE}/admin_traslados.php` } });

        const filas = [...pagina.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/g)]
          .map((m) => m[0]).filter((tr) => /class="id_p"/.test(tr));

        if (filas.length === 0) {
          // Un traslado ya recibido deja de mostrar líneas. No es un error del
          // portal: es que alguien lo recibió por el sistema. Se anota como
          // recibido para que el pedido no quede colgado esperándolo.
          await admin.from("pedido_traslado_linea").update({
            estado: "recibida", recibido_at: new Date().toISOString(), recibido_por: quien.id,
            aviso: "Ya no mostraba líneas: se había recibido o anulado desde el sistema.",
            updated_at: new Date().toISOString(),
          }).eq("id", ln.id);
          recibidas++;
          continue;
        }

        // Se recibe COMPLETO lo que se despachó. Recibir de menos es declarar un
        // faltante, y eso necesita a alguien mirando la caja, no una función:
        // esa diferencia se cuenta en el portal, en la pantalla de recepción.
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
          // ⚠️ El octavo campo acá NO es el lote: es lo ESPERADO. El encabezado
          // lo dice —Esperado · Recibido · Lote · Vence— y `cant` es lo
          // RECIBIDO. Mismo lugar del string que en el envío, otro significado.
          partes.push([idProd, compra, venta, esp, unidad, vence, idPres, esp].join("|"));
          total += Number(compra) * Number(esp);
        }

        if (partes.length === 0) {
          await admin.from("pedido_traslado_linea")
            .update({ estado: "enviada", updated_at: new Date().toISOString() })
            .eq("id", ln.id);
          fallos.push({ clave: String(ln.clave), error: "No se pudo leer ni una línea del traslado." });
          continue;
        }

        const { concepto } = armarConcepto(`${ln.clave} REC ${yo}`);
        const resp = leerRespuesta(await pedir(cookie, RECIBIR, new URLSearchParams({
          process: "insert",
          datos: partes.join("#") + "#",
          cuantos: String(partes.length),
          total: total.toFixed(4),
          fecha: hoySV(),
          concepto,
          destino: String(ubicDestino),
          id_traslado: String(ln.id_traslado),
        }), { extra: { Referer: RECIBIR } }));

        if (!resp.ok) {
          // Vuelve a 'enviada': el traslado sigue vivo y se puede reintentar.
          await admin.from("pedido_traslado_linea")
            .update({ estado: "enviada", error_msg: resp.msg || "El sistema no aceptó la recepción.",
                      updated_at: new Date().toISOString() })
            .eq("id", ln.id);
          fallos.push({ clave: String(ln.clave), error: resp.msg || "sin detalle" });
          continue;
        }

        recibidas++;
        await admin.from("pedido_traslado_linea").update({
          estado: "recibida",
          recibido_at: new Date().toISOString(),
          recibido_por: quien.id,
          updated_at: new Date().toISOString(),
        }).eq("id", ln.id);
      }

      const { data: resumen } = await admin.rpc("resumen_traslado_pedido", {
        p_pedido_id: pedidoId, p_sucursal_id: sucId,
      });

      return json({
        ok: fallos.length === 0,
        recibidas,
        pedidas: lineas.length,
        fallos,
        resumen,
      }, fallos.length === 0 ? 200 : 207);
    }

    // ── El pedido tiene que estar finalizado ──────────────────────────────
    // Para el traslado real: finalizar es el momento en que Bodega dice que
    // terminó de preparar, y es el disparo que se acordó. El simulacro no lo
    // exige, porque su gracia es poder probarlo sobre un pedido cualquiera.
    const { data: pss, error: pssErr } = await admin
      .from("pedido_sucursal_status")
      .select("finalizado_at")
      .eq("pedido_id", pedidoId).eq("erp_sucursal_id", sucId)
      .maybeSingle();
    if (pssErr) throw pssErr;
    if (!simulacro && !pss?.finalizado_at)
      return json({
        ok: false,
        codigo: "SIN_FINALIZAR",
        error: "El pedido de esa sucursal todavía no está finalizado.",
      }, 409);

    const items = await leerItems(admin, pedidoId, sucId);
    if (items.length === 0)
      return json({ ok: false, error: "El pedido no tiene productos que despachar para esa sucursal." }, 422);

    // ── La fila del intento. Es el candado y es el rastro. ────────────────
    // En modo real el índice único (pedido, sucursal, paso) WHERE estado<>error
    // hace que un segundo despacho simultáneo no entre: la fila no se puede
    // insertar dos veces. En simulacro no hay candado — verificar no rompe nada.
    const { data: fila, error: filaErr } = await admin
      .from("pedido_traslado_erp")
      .insert({
        pedido_id: pedidoId,
        erp_sucursal_id: sucId,
        modo: simulacro ? "simulacro" : "real",
        paso: "enviar",
        estado: "en_curso",
        productos: items.length,
        creado_por: quien.id,
      })
      .select("id")
      .maybeSingle();
    let filaId = fila?.id as string | undefined;
    if (filaErr) {
      // 23505 = el índice único: ya hay una corrida real viva para esta
      // sucursal. Eso NO es un error — es lo normal cuando se retoma. 900
      // productos no entran en los 400 s de techo del runtime, así que el
      // despacho se hace en varias corridas y cada una adopta la anterior.
      // Solo una ya DESPACHADA por completo se rechaza.
      if (String((filaErr as { code?: string }).code) === "23505") {
        const { data: viva } = await admin
          .from("pedido_traslado_erp")
          .select("id, estado")
          .eq("pedido_id", pedidoId).eq("erp_sucursal_id", sucId)
          .eq("modo", "real").eq("paso", "enviar")
          .neq("estado", "error")
          .maybeSingle();
        if (!viva || viva.estado !== "en_curso")
          return json({
            ok: false,
            codigo: "YA_DESPACHADO",
            error: "Este pedido ya se despachó para esa sucursal.",
          }, 409);
        filaId = viva.id as string;
        await admin.rpc("incrementar_reanudacion_traslado", { p_run_id: filaId });
      } else {
        throw filaErr;
      }
    }
    if (!filaId) throw new Error("No se pudo abrir ni adoptar la corrida.");

    const cerrar = async (patch: Record<string, unknown>) => {
      await admin.from("pedido_traslado_erp")
        .update({ ...patch, ms_total: Date.now() - arranque, updated_at: new Date().toISOString() })
        .eq("id", filaId);
    };

    // ══════════════════════════════════════════════════════════════════════
    // PASO 1 · DESPACHAR — un traslado por producto, retomable
    // ══════════════════════════════════════════════════════════════════════
    //
    // Un traslado por producto y no uno por pedido, porque el sistema trata el
    // traslado como un hecho binario: o está pendiente o está finalizado. No
    // hay «recibí la mitad». Con un traslado por producto, recibir uno es
    // recibirlo ENTERO, y la sucursal puede confirmar una hoja completa o un
    // solo producto —el que va a vender— sin pelearse con eso.
    //
    // Verifica y despacha en la MISMA pasada por producto. Separar «verificar
    // todo» de «despachar todo» haría que retomar tuviera que reconstruir en
    // qué punto quedó; así cada producto se resuelve entero antes de pasar al
    // siguiente y el estado vive en su propia fila.
    const despachar = async (cookie: string, presupuesto: number) => {
      // El plan se arma en la base y es idempotente. Se NIEGA si las hojas
      // guardadas no son las del PDF impreso: el traslado lleva el número de
      // hoja adentro, y una hoja equivocada es peor que ninguna.
      const { data: plan, error: planErr } = await admin.rpc("planificar_traslado_pedido", {
        p_pedido_id: pedidoId, p_sucursal_id: sucId, p_run_id: filaId,
      });
      if (planErr) {
        await cerrar({ estado: "error", error_msg: planErr.message });
        return { despachado: false, error: planErr.message };
      }

      // Despachar sin que Bodega haya confirmado sería mover lo que el reparto
      // supuso, no lo que salió.
      const sinConfirmar = items.filter((i) => !i.confirmada).length;
      if (sinConfirmar > 0) {
        await cerrar({
          estado: "error",
          error_msg: `El envío todavía no se confirmó: ${sinConfirmar} de ${items.length} productos `
            + `no tienen cantidad confirmada por Bodega.`,
        });
        return { despachado: false, codigo: "SIN_CONFIRMAR" };
      }

      // Una línea en 'enviando' es residuo de una corrida que murió justo entre
      // que el sistema creó el traslado y que alcanzamos a anotarlo. NO se
      // reintenta a ciegas: reintentar movería el inventario dos veces y eso no
      // se deshace solo. Se marca para que alguien la mire con la clave en la
      // mano, que es lo que permite encontrarla en el sistema.
      await admin.from("pedido_traslado_linea")
        .update({
          estado: "error",
          error_msg: "La corrida anterior se cortó mientras se despachaba este producto. "
            + "Hay que verificar en el sistema si el traslado entró (buscar la clave en el concepto) "
            + "antes de reintentarlo — reintentar a ciegas lo movería dos veces.",
          updated_at: new Date().toISOString(),
        })
        .eq("pedido_id", pedidoId).eq("erp_sucursal_id", sucId).eq("estado", "enviando");

      const porItem = new Map(items.map((i) => [i.id, i]));
      // El número del pedido ya no se lee: viaja DENTRO de la clave (`P102-…`),
      // así que traerlo era una consulta por corrida para repetir un dato.

      // La foto de los pendientes: el traslado nuevo es el que no estaba. El
      // `insert` no devuelve el id y el listado ignora el orden que se le pide.
      let conocidos = await pendientesDeOrigen(cookie, ubicOrigen);

      let hechas = 0, fallidas = 0, sinTiempo = false;

      for (;;) {
        if (Date.now() - arranque > presupuesto) { sinTiempo = true; break; }

        const { data: tanda, error: tandaErr } = await admin
          .from("pedido_traslado_linea")
          .select("id, pedido_item_id, erp_product_id, hoja, cantidad, clave")
          .eq("pedido_id", pedidoId).eq("erp_sucursal_id", sucId)
          .eq("estado", "planificada")
          .order("hoja", { ascending: true })
          .order("pedido_item_id", { ascending: true })
          .limit(25);
        if (tandaErr) throw tandaErr;
        if (!tanda?.length) break;

        for (const ln of tanda) {
          if (Date.now() - arranque > presupuesto) { sinTiempo = true; break; }

          const fallar = async (msg: string) => {
            fallidas++;
            await admin.from("pedido_traslado_linea")
              .update({ estado: "error", error_msg: msg, updated_at: new Date().toISOString() })
              .eq("id", ln.id);
          };

          const it = porItem.get(ln.pedido_item_id as number);
          if (!it) { await fallar("El renglón ya no está en el pedido."); continue; }

          // Se toma la línea ANTES de tocar el sistema: si esto no escribe,
          // nadie más la agarra, y si el worker muere después queda la marca.
          const { data: tomada } = await admin.from("pedido_traslado_linea")
            .update({ estado: "enviando", updated_at: new Date().toISOString() })
            .eq("id", ln.id).eq("estado", "planificada")
            .select("id").maybeSingle();
          if (!tomada) continue;   // otra corrida se la llevó

          const f = await traerFila(cookie, ln.erp_product_id as number, ubicOrigen);
          if (!f.encontrado) { await fallar("Ya no tiene existencia en bodega."); continue; }

          const pres = await resolverPresentacion(cookie, f, it.presentacion_tipo, Number(it.factor ?? 0));
          if (!pres) {
            await fallar(`Se despachó ${it.presentacion_tipo} de ${it.factor}, y hoy ninguna presentación `
              + `con ese nombre trae ese factor. Ofrece: ${f.presentaciones.map((p) => p.tipo).join(", ") || "ninguna"}.`);
            continue;
          }

          // El tope sale de los LOTES, no de la casilla de existencia — que
          // trae la del primer lote y no la del producto. Ver
          // `disponibleEnBodega`.
          const hay = disponibleEnBodega(f, Number(pres.unidad));
          if (Number(ln.cantidad) > hay.paquetes) {
            await fallar(
              `Bodega tiene ${hay.unidades} unidades`
              + (hay.lotes ? ` en ${hay.lotes} lote(s)` : "")
              + `: alcanzan para ${hay.paquetes} y hacen falta ${ln.cantidad}.`,
            );
            continue;
          }

          // ── Los lotes van DENTRO del mismo traslado ────────────────────
          // Un producto con dos lotes son dos renglones del mismo traslado, no
          // dos traslados: sigue siendo un producto y se recibe de una vez.
          const renglones: { cantidad: number; idLote: string; lote: string | null }[] = [];
          const avisos: string[] = [];

          if (!f.regulado) {
            renglones.push({ cantidad: Number(ln.cantidad), idLote: "0", lote: null });
          } else {
            const asignados = (it.lotes_asignados ?? [])
              .map((l) => ({
                numero: String(l.lote ?? ""),
                vence: String(l.fecha_vencimiento ?? "").slice(0, 10),
                cantidad: Number(l.take ?? l.packs ?? 0),
              }))
              .filter((l) => l.cantidad > 0);

            let resto = Number(ln.cantidad);
            const usados = new Set<string>();

            // 1. Lo que el pedido reservó y todavía está. Un lote que ya no
            //    está NO corta: se anota y se cubre más abajo.
            for (const a of asignados) {
              if (resto <= 0) break;
              const lote = f.lotes.find((x) =>
                norm(x.numero) === norm(a.numero) && (!a.vence || x.vence.slice(0, 10) === a.vence)
              );
              if (!lote) {
                avisos.push(`el lote ${a.numero || "(sin número)"} que reservó el pedido ya no está en bodega`);
                continue;
              }
              const cabe = Math.floor(lote.stock / Number(pres.unidad));
              const toma = Math.min(a.cantidad, resto, cabe);
              if (toma <= 0) {
                avisos.push(`el lote ${lote.numero} quedó sin existencia suficiente`);
                continue;
              }
              if (toma < Math.min(a.cantidad, resto)) {
                avisos.push(`del lote ${lote.numero} solo alcanzaban ${toma}`);
              }
              renglones.push({ cantidad: toma, idLote: lote.id, lote: lote.numero });
              usados.add(lote.id);
              resto -= toma;
            }

            // 2. Lo que quedó sin cubrir sale del lote que VENCE PRIMERO entre
            //    los que hay. Es lo que quien levanta hizo físicamente: tomó lo
            //    del estante, no consultó la reserva del portal. Frenar acá
            //    sería frenar mercadería que sí va en la caja.
            //    Decisión del usuario (2026-08-11): despachar y avisar.
            if (resto > 0) {
              const disponibles = [...f.lotes]
                .filter((x) => !usados.has(x.id) && x.stock > 0)
                .sort((a, b) => (a.vence || "9999-99-99").localeCompare(b.vence || "9999-99-99"));
              for (const lote of disponibles) {
                if (resto <= 0) break;
                const cabe = Math.floor(lote.stock / Number(pres.unidad));
                if (cabe <= 0) continue;
                const toma = Math.min(cabe, resto);
                renglones.push({ cantidad: toma, idLote: lote.id, lote: lote.numero });
                usados.add(lote.id);
                avisos.push(
                  `se despacharon ${toma} del lote ${lote.numero} (vence ${lote.vence || "sin fecha"}), `
                  + `que no es el que el pedido había reservado`,
                );
                resto -= toma;
              }
            }

            if (resto > 0) {
              await fallar(
                `Ningún lote en bodega alcanza para las ${ln.cantidad} confirmadas: faltan ${resto}. `
                + `Hay: ${f.lotes.map((x) => `${x.numero} (${x.stock})`).join(", ") || "ninguno"}.`,
              );
              continue;
            }
          }

          // El vale se lee de la página y no se inventa: es un `uniqid()` que el
          // servidor pre-rellena en cada carga. Uno por traslado, no se reutiliza.
          const html = await pedir(cookie, TRASLADO, undefined, { extra: { Referer: `${BASE}/dashboard.php` } });
          const vale = html.match(/numero_vale["'][^>]*value=["']([^"']+)["']/)?.[1] ?? "";
          if (!vale) { await fallar("El sistema no entregó el número de vale."); continue; }

          // La CLAVE va primero en el concepto: es lo que permite encontrar este
          // traslado entre los ~900 del pedido, y lo que se busca al retomar
          // para no duplicarlo.
          //
          // Y nada más que la clave y la persona. Lo que decía antes —«Pedido
          // 102 Salud 5 hoja 1 <producto>»— es todo dato que el sistema ya
          // muestra en la misma pantalla (destino) o en el detalle del traslado
          // (producto), o que va DENTRO de la clave (pedido y hoja). Medido el
          // 2026-08-12: se repetían 45 de los 75 caracteres.
          const { concepto } = armarConcepto(`${ln.clave} ENV ${yo}`);

          const total = renglones.reduce((s, r) => s + Number(pres.costo || 0) * r.cantidad, 0);
          const datos = renglones.map((r) => [
            ln.erp_product_id, pres.costo, pres.precio, r.cantidad, pres.unidad,
            f.vence || "", pres.id, r.idLote,
          ].join("|")).join("#") + "#";

          const resp = leerRespuesta(await pedir(cookie, TRASLADO, new URLSearchParams({
            process: "insert",
            datos,
            id_traslado_guardado: "0",
            cuantos: String(renglones.length),
            total: total.toFixed(4),
            fecha: hoySV(),
            concepto,
            origen: String(ubicOrigen),
            id_suc_destino: String(sucId),
            id_ubicacion_destino: "0",
            numero_vale: vale,
          }), { extra: { Referer: TRASLADO } }));

          if (!resp.ok) {
            await fallar(`El sistema no aceptó el traslado: ${resp.msg || "sin detalle"}`);
            continue;
          }

          const despues = await pendientesDeOrigen(cookie, ubicOrigen);
          const nuevos = [...despues.keys()].filter((id) => !conocidos.has(id));
          conocidos = despues;
          const idTraslado = nuevos.length === 1 ? nuevos[0] : null;

          hechas++;
          await admin.from("pedido_traslado_linea").update({
            estado: "enviada",
            id_traslado: idTraslado,
            numero_vale: vale,
            enviado_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            // Lo que no frenó el envío pero hay que mirar — casi siempre, que
            // el lote despachado no es el que el pedido había reservado.
            aviso: avisos.length ? avisos.join(" · ") : null,
            detalle: {
              producto: it.nombre,
              presentacion: `${it.presentacion_tipo} (${pres.unidad})`,
              id_presentacion_erp: pres.id,
              renglones,
              concepto,
              existencia_previa: f.existencia,
              regulado: f.regulado,
            },
            // El traslado ENTRÓ igual; lo único que falta es su número para
            // poder recibirlo desde el portal. Se dice, no se calla.
            error_msg: idTraslado ? null
              : `Entró, pero no se pudo distinguir cuál es entre ${nuevos.length} candidatos. `
                + `Buscar «${ln.clave}» en el concepto.`,
          }).eq("id", ln.id);
        }
      }

      const { data: resumen } = await admin.rpc("resumen_traslado_pedido", {
        p_pedido_id: pedidoId, p_sucursal_id: sucId,
      });
      const quedan = Number((resumen as Record<string, unknown>)?.por_despachar ?? 0);

      await cerrar({
        estado: quedan > 0 ? "en_curso" : "despachado",
        lineas: Number((resumen as Record<string, unknown>)?.enviadas ?? hechas),
        detalle: resumen ?? null,
      });

      // ── Retomar ──────────────────────────────────────────────────────
      // Si se cortó por presupuesto y todavía queda, hay que volver. El cron
      // de cada minuto levanta las corridas 'en_curso', así que basta con
      // dejarla en ese estado — que es lo que hace `cerrar` de arriba.
      //
      // Y si una corrida avanza CERO, se corta la cadena: sin ese freno, un
      // sistema caído genera reintentos para siempre.
      if (sinTiempo && quedan > 0 && hechas === 0) {
        await cerrar({
          estado: "error",
          error_msg: `La corrida no pudo despachar ni un producto y quedan ${quedan}. `
            + `Se detiene para no reintentar en vano; revisar el sistema de origen.`,
        });
      }

      return {
        despachado: quedan === 0,
        en_esta_corrida: hechas,
        fallidas,
        quedan,
        sin_tiempo: sinTiempo,
        continua: sinTiempo && quedan > 0 && hechas > 0,
        plan,
      };
    };

    // ══════════════════════════════════════════════════════════════════════
    // El trabajo
    // ══════════════════════════════════════════════════════════════════════
    const correr = async () => {
      const presupuesto = background ? PRESUPUESTO_BG_MS : PRESUPUESTO_FG_MS;
      const cookie = await sesionEn(erpOrigen, login);

      if (!simulacro) return await despachar(cookie, presupuesto);

      const partes: string[] = [];
      const detalle: Record<string, unknown>[] = [];
      const hallazgos: Hallazgo[] = [];
      let total = 0;
      let unidades = 0;
      let verificados = 0;

      for (const it of items) {
        if (Date.now() - arranque > presupuesto) {
          hallazgos.push({
            erp_product_id: 0, producto: "—", codigo: "SIN_TIEMPO",
            detalle: `Se verificaron ${verificados} de ${items.length} productos antes de agotar el tiempo.`,
          });
          break;
        }
        verificados++;

        const factor = Number(it.factor ?? 0);
        if (!it.erp_presentacion_id || !factor) {
          hallazgos.push({
            erp_product_id: it.erp_product_id, producto: it.nombre, codigo: "SIN_PRESENTACION",
            detalle: "El ítem del pedido no guardó presentación o factor, así que no se sabe qué mover.",
          });
          continue;
        }

        const f = await traerFila(cookie, it.erp_product_id, ubicOrigen);
        if (!f.encontrado) {
          hallazgos.push({
            erp_product_id: it.erp_product_id, producto: it.nombre, codigo: "SIN_EXISTENCIA",
            detalle: "Ya no tiene existencia en bodega.",
          });
          continue;
        }

        const pres = await resolverPresentacion(cookie, f, it.presentacion_tipo, factor);
        if (!pres) {
          hallazgos.push({
            erp_product_id: it.erp_product_id, producto: it.nombre, codigo: "FACTOR_CAMBIO",
            detalle: `Se despachó ${it.presentacion_tipo} de ${factor}, y hoy ninguna presentación con ese nombre `
              + `trae ese factor. Ofrece: ${f.presentaciones.map((p) => p.tipo).join(", ") || "ninguna"}.`,
          });
          continue;
        }

        // El tope se relee ACÁ y no al generar el pedido: entre que se armó y
        // se despacha, bodega vendió, trasladó o descartó.
        //
        // Y sale de los LOTES, no de la casilla de existencia — que trae la del
        // primer lote y no la del producto (ver `disponibleEnBodega`). Tiene que
        // ser la MISMA cuenta que hace el despacho: si esta pantalla pone en
        // cero algo que el despacho sí podía mandar, Bodega deja de enviar
        // mercadería que está en el estante.
        const hay = disponibleEnBodega(f, Number(pres.unidad));
        if (it.cantidad > hay.paquetes) {
          hallazgos.push({
            erp_product_id: it.erp_product_id, producto: it.nombre, codigo: "SIN_EXISTENCIA",
            detalle: `Bodega tiene ${hay.unidades} unidades`
              + (hay.lotes ? ` en ${hay.lotes} lote(s)` : "")
              + `: alcanzan para ${hay.paquetes} y el pedido lleva ${it.cantidad}.`,
          });
          continue;
        }

        // ── Los lotes ─────────────────────────────────────────────────────
        // Solo los regulados llevan control de lote; para el resto el selector
        // viene vacío y va 0, en una sola línea. Un ítem regulado con dos lotes
        // son DOS líneas: la identidad de un lote es número + fecha, porque hay
        // productos con dos lotes de igual número y vencimientos distintos.
        const lineasItem: { cantidad: number; idLote: string; lote: string | null }[] = [];
        if (!f.regulado) {
          lineasItem.push({ cantidad: it.cantidad, idLote: "0", lote: null });
        } else {
          const asignados = (it.lotes_asignados ?? [])
            .map((l) => ({
              numero: String(l.lote ?? ""),
              vence: String(l.fecha_vencimiento ?? "").slice(0, 10),
              cantidad: Number(l.take ?? l.packs ?? 0),
            }))
            .filter((l) => l.cantidad > 0);

          // Que el pedido no haya guardado lote no corta: se cubre igual con lo
          // que hay, empezando por el que vence primero. El despacho real hace
          // exactamente eso, y las dos tienen que coincidir.
          //
          // ⚠️ Esta repartición tiene que dar el MISMO resultado que la del
          // despacho real. El simulacro es lo que le avisa a Bodega qué va a
          // pasar, y su salida pone en cero los productos con problema en la
          // pantalla de confirmar: si acá se marcara como problema un lote que
          // el despacho resuelve solo, Bodega dejaría de enviar mercadería que
          // sí está en la caja. Si se toca una, se toca la otra.
          //
          // Que el lote reservado ya no esté NO es un problema: se cubre con el
          // que vence primero, que es lo que quien levanta hizo físicamente.
          let resto = it.cantidad;
          const usados = new Set<string>();

          for (const a of asignados) {
            if (resto <= 0) break;
            const lote = f.lotes.find((x) =>
              norm(x.numero) === norm(a.numero) && (!a.vence || x.vence.slice(0, 10) === a.vence)
            );
            if (!lote) continue;
            const cabe = Math.floor(lote.stock / Number(pres.unidad));
            const toma = Math.min(a.cantidad, resto, cabe);
            if (toma <= 0) continue;
            lineasItem.push({ cantidad: toma, idLote: lote.id, lote: lote.numero });
            usados.add(lote.id);
            resto -= toma;
          }

          if (resto > 0) {
            const disponibles = [...f.lotes]
              .filter((x) => !usados.has(x.id) && x.stock > 0)
              .sort((a, b) => (a.vence || "9999-99-99").localeCompare(b.vence || "9999-99-99"));
            for (const lote of disponibles) {
              if (resto <= 0) break;
              const cabe = Math.floor(lote.stock / Number(pres.unidad));
              if (cabe <= 0) continue;
              const toma = Math.min(cabe, resto);
              lineasItem.push({ cantidad: toma, idLote: lote.id, lote: lote.numero });
              usados.add(lote.id);
              resto -= toma;
            }
          }

          if (resto > 0) {
            hallazgos.push({
              erp_product_id: it.erp_product_id, producto: it.nombre, codigo: "SIN_LOTE_SUFICIENTE",
              detalle: `Ningún lote en bodega alcanza para las ${it.cantidad} unidades: faltan ${resto}. `
                + `Hay: ${f.lotes.map((x) => `${x.numero} (${x.stock})`).join(", ") || "ninguno"}.`,
            });
            continue;
          }
        }

        for (const l of lineasItem) {
          partes.push([
            it.erp_product_id, pres.costo, pres.precio, l.cantidad, pres.unidad,
            f.vence || "", pres.id, l.idLote,
          ].join("|"));
          total += Number(pres.costo || 0) * l.cantidad;
          unidades += l.cantidad;
          detalle.push({
            pedido_item_id: it.id,
            erp_product_id: it.erp_product_id,
            producto: it.nombre,
            presentacion: `${it.presentacion_tipo} (${pres.unidad})`,
            id_presentacion_erp: pres.id,
            cantidad: l.cantidad,
            cantidad_asignada: it.cantidad_asignada,
            envio_confirmado: it.confirmada,
            lote: l.lote,
            id_lote_erp: l.idLote !== "0" ? l.idLote : null,
            regulado: f.regulado,
            existencia_previa: f.existencia,
          });
        }
      }

      // ── Simulacro: se guarda lo que se habría mandado y se termina ──────
      if (simulacro) {
        await cerrar({
          estado: "verificado",
          lineas: partes.length,
          unidades,
          total: Number(total.toFixed(4)),
          hallazgos,
          detalle,
        });
        return { verificados, lineas: partes.length, hallazgos: hallazgos.length };
      }

    };

    // ── Background: la respuesta sale ya ──────────────────────────────────
    // 450 productos × 2 viajes al sistema no entran en los 150 s que vive una
    // respuesta. Un error acá no tiene a quién contarle, así que se escribe en
    // la fila o el intento falla en silencio.
    if (background) {
      // @ts-ignore — EdgeRuntime es global del runtime de Supabase
      EdgeRuntime.waitUntil(correr().catch(async (e: unknown) => {
        await cerrar({
          estado: "error",
          error_msg: `background: ${e instanceof Error ? e.message : String(e)}`,
        });
      }));
      return json({
        ok: true,
        aceptado: true,
        background: true,
        simulacro,
        traslado_id: filaId,
        productos: items.length,
      }, 202);
    }

    return json({ ok: true, simulacro, traslado_id: filaId, ...(await correr()) });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
