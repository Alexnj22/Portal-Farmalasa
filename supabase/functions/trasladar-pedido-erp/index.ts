import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireActiveEmployeeUser, requireInvokeSecret } from "../_shared/security.ts";
import { BASE, login, pedir, leerRespuesta } from "../_shared/erp-dte.ts";
import {
  anotar,
  armarConcepto,
  apartadoQueEstorba,
  avisoDelAreaDeVencidos,
  disponibleEnBodega,
  estadoDeRecepcion,
  leerUbicacion,
  hayEnTexto,
  hoySV,
  identificarTrasladoNuevo,
  lectorDeRecepcion,
  leerBien,
  nombreCorto,
  pendientesDeOrigen,
  repartirEnLotes,
  resolverPresentacion,
  sesionEn,
  traerFila,
  RECIBIR,
  TRASLADO,
  trasladoQueSalioPeseAlFallo,
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

// Cuánto tiene que llevar tomada una línea de recepción para darla por huérfana.
// Una viva tarda como mucho ~90 s (dos pedidos al sistema, 45 s de espera cada
// uno), y el reloj de pared del worker corta a los 400 s: 15 minutos no puede
// pisar una corrida en curso, y es corto comparado con dejarla trabada para
// siempre.
const RESCATE_TOMADA_MS = 15 * 60_000;

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

/**
 * Los lotes que el PEDIDO reservó, en paquetes de la presentación.
 *
 * `take`/`packs` ya vienen en PAQUETES —a diferencia de la solicitud de
 * traslado, que los guarda en unidades base—, así que acá no se divide por el
 * factor. Es la única diferencia entre las dos puntas y por eso la conversión
 * vive en cada llamador y no dentro de `repartirEnLotes`.
 *
 * El `unidad` se recibe igual para que la firma no mienta el día que este lado
 * también empiece a guardar unidades.
 */
function reservadosDe(it: ItemPedido, _unidad: number): { numero: string; vence?: string; paquetes: number }[] {
  return (it.lotes_asignados ?? [])
    .map((l) => ({
      numero: String(l.lote ?? ""),
      vence: String(l.fecha_vencimiento ?? "").slice(0, 10),
      paquetes: Number(l.take ?? l.packs ?? 0),
    }))
    .filter((l) => l.paquetes > 0);
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

/**
 * El área de vencidos, que NO es origen y sin embargo manda.
 *
 * El sistema descarga de ahí primero y no pasa al estante — ver
 * `disponibleEnBodega`. Hoy sólo Bodega tiene dos ubicaciones; para una sala
 * esto da 0 y el freno se comporta como siempre.
 */
function ubicacionDeVencidos(m: { inv_ubicaciones?: unknown } | null): number {
  const lista = Array.isArray(m?.inv_ubicaciones)
    ? m!.inv_ubicaciones as { id: number; isVencidos: boolean }[]
    : [];
  return Number(lista.find((u) => u.isVencidos)?.id ?? 0);
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

    // ── La RECEPCIÓN que se retoma sola ───────────────────────────────────
    // El despacho se retoma adoptando su fila de corrida. La recepción no deja
    // ninguna, así que hasta el 2026-08-19 lo que no entraba en su presupuesto
    // se quedaba ahí hasta que una persona viera la tarjeta y apretara
    // «Reintentar». Medido en el pedido 120 de Salud 2: la recepción trabajó
    // 238,8 s contra un techo de 240 y se cortó con 6 renglones sin entrar, que
    // pasaron un día en tránsito —fuera de Bodega y sin entrar a la sala—
    // mientras la tarjeta lo decía en rojo y nadie miraba.
    //
    // El cron dice QUÉ (pedido, sucursal) mirar; QUÉ recibir lo decide esta
    // función: sale de `items_sin_ingresar`, que es «lo que la sala ya contó y
    // no entró». Aunque el llamador pidiera otra cosa, acá no se ingresa a una
    // sala nada que nadie haya contado — que es la única forma de que un
    // reintento automático no invente que una caja llegó.
    if (interno && cuerpo.accion === "recibir") {
      pedidoId = String(cuerpo.pedido_id ?? "");
      sucId = Number(cuerpo.erp_sucursal_id ?? 0);
      if (!pedidoId || !sucId)
        return json({ ok: false, error: "Faltan pedido_id o erp_sucursal_id." }, 400);

      const { data: contados, error: contErr } = await admin
        .rpc("items_sin_ingresar", { p_pedido_id: pedidoId, p_sucursal_id: sucId });
      if (contErr) throw contErr;
      const soloContados = (Array.isArray(contados) ? contados : []).map(Number).filter(Number.isFinite);
      if (soloContados.length === 0)
        return json({ ok: true, codigo: "NADA_QUE_REINTENTAR", recibidas: 0 });
      // Se REEMPLAZA lo que viniera en el payload, no se suma: la lista de qué
      // recibir es la que salió de la base, y nada más.
      itemIds.length = 0;
      itemIds.push(...soloContados);

      // Firma con quien CONTÓ la caja, no con la máquina — igual que el
      // despacho, que se retoma firmando con quien finalizó el pedido. Si no
      // hay nadie anotado no se sigue: un ingreso sin responsable no es un
      // asiento, y que no lo haya significa que algo más está mal.
      // `roto` NO es lo mismo que «no hay nadie anotado», y hasta el 2026-08-21
      // las dos cosas salían por la misma puerta: con el error descartado, una
      // consulta que fallaba devolvía `SIN_QUIEN_CONTO` y el cron daba por
      // resuelto que la sala no había contado la caja. Se dejaba de reintentar
      // un ingreso que sí correspondía, y no quedaba rastro de por qué.
      const { dato: conto, roto: rotoConto } = await leerBien<{ received_by: string | null }>(
        admin.from("pedido_items").select("received_by")
          .in("id", soloContados.slice(0, 200))
          .not("received_by", "is", null)
          .limit(1).maybeSingle(),
        "quién contó la caja",
      );
      if (rotoConto) return json({ ok: false, codigo: "NO_SE_PUDO_LEER", error: rotoConto }, 503);
      if (!conto?.received_by)
        return json({ ok: true, codigo: "SIN_QUIEN_CONTO", recibidas: 0 });
      const { dato: autor, roto: rotoAutor } = await leerBien<{ id: string; name: string; first_names?: string; last_names?: string }>(
        admin.from("employees").select("id, name, first_names, last_names")
          .eq("id", conto.received_by).maybeSingle(),
        "el empleado que contó",
      );
      if (rotoAutor) return json({ ok: false, codigo: "NO_SE_PUDO_LEER", error: rotoAutor }, 503);
      if (!autor) return json({ ok: true, codigo: "SIN_QUIEN_CONTO", recibidas: 0 });
      quien = { id: autor.id as string, name: autor.name as string };
      yo = nombreCorto(autor);

      alcanceTodo = true;
      accion = "recibir";
      simulacro = false;
      background = true;
    } else if (interno) {
      const runId = String(cuerpo.run_id ?? "");
      if (!runId) return json({ ok: false, error: "Falta run_id." }, 400);
      // Igual que arriba: «esa corrida no está en curso» es una respuesta, y
      // «no se pudo preguntar» es otra. Confundirlas hacía que el cron
      // abandonara para siempre un despacho a medias —producto fuera del
      // estante y sin llegar— por una lectura que falló una vez.
      const { dato: run, roto: rotoRun } = await leerBien<{ id: string; pedido_id: string; erp_sucursal_id: number; estado: string; modo: string; paso: string; creado_por: string }>(
        admin.from("pedido_traslado_erp")
          .select("id, pedido_id, erp_sucursal_id, estado, modo, paso, creado_por")
          .eq("id", runId).maybeSingle(),
        "la corrida que se retoma",
      );
      if (rotoRun) return json({ ok: false, codigo: "NO_SE_PUDO_LEER", error: rotoRun }, 503);
      if (!run || run.estado !== "en_curso" || run.modo !== "real" || run.paso !== "enviar")
        return json({
          ok: false, codigo: "NADA_QUE_CONTINUAR",
          error: "Esa corrida no está en curso.",
        }, 409);
      pedidoId = String(run.pedido_id);
      sucId = Number(run.erp_sucursal_id);
      // Acá el fallo SÍ puede seguir: quedarse sin el nombre de quien finalizó
      // el pedido no justifica abandonar el despacho. Pero se anota, porque ese
      // nombre es lo único que identifica a la persona real en el concepto del
      // sistema, y «Continuacion automatica» es indistinguible de un empleado
      // que de verdad ya no existe.
      const { dato: autor } = await leerBien<{ id: string; name: string; first_names?: string; last_names?: string }>(
        admin.from("employees").select("id, name, first_names, last_names")
          .eq("id", run.creado_por).maybeSingle(),
        "quién finalizó el pedido (el concepto va a decir «Continuacion automatica»)",
      );
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
      // Si estas dos lecturas fallan, `emp` y `permisos` quedan vacíos y el
      // camino de abajo contesta **403 «No tienes permiso de edición en
      // Pedidos»** — a alguien que sí lo tiene. Un permiso denegado se
      // interpreta como una decisión (pedir el permiso, avisar al jefe), no
      // como una falla que se reintenta, así que el mensaje equivocado manda a
      // la persona por el camino equivocado. Se distinguen.
      const { dato: emp, roto: rotoEmp } = await leerBien<{ role_id: number | null; secondary_role_id: number | null; branch_id: number | null; first_names?: string; last_names?: string }>(
        admin.from("employees").select("role_id, secondary_role_id, branch_id, first_names, last_names")
          .eq("id", usuario.id).maybeSingle(),
        "tu ficha de empleado",
      );
      if (rotoEmp) return json({ ok: false, codigo: "NO_SE_PUDO_LEER", error: rotoEmp }, 503);
      yo = nombreCorto({ ...(emp ?? {}), name: usuario.name });
      const roles = [emp?.role_id, emp?.secondary_role_id].filter((r) => r != null);
      const { dato: permisos, roto: rotoPerm } = await leerBien<{ can_edit: boolean; scope: string }[]>(
        admin.from("role_permissions").select("can_edit, scope")
          .in("role_id", roles.length ? roles : [-1])
          .eq("module_key", "pedidos"),
        "tus permisos de Pedidos",
      );
      if (rotoPerm) return json({ ok: false, codigo: "NO_SE_PUDO_LEER", error: rotoPerm }, 503);
      // La rama `system_role === "SUPERADMIN"` se retiró el 2026-08-28: era la
      // llave maestra que se saltaba el permiso por módulo, y la única ficha que
      // la portaba —la cuenta técnica— se borró. Código muerto medido.
      const puede = (permisos ?? []).some((p) => p.can_edit);
      if (!puede)
        return json({ ok: false, error: "No tienes permiso de edición en Pedidos." }, 403);
      alcanceTodo = (permisos ?? []).some((p) => p.can_edit && p.scope === "ALL");
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

      // ── Rescate de las líneas que quedaron tomadas ────────────────────────
      // `recibiendo` es el candado: se toma la línea ANTES de tocar el sistema.
      // Si la corrida muere entre las dos cosas —al worker lo matan por reloj
      // de pared, o el sistema se cuelga— la línea queda tomada para siempre:
      // el reintento sólo levanta las `enviada`, así que la tarjeta se quedaba
      // en «sin ingresar» sin ninguna forma de arreglarlo desde el portal.
      //
      // Se devuelve a la cola, y NO es un reintento a ciegas: el bucle de abajo
      // abre primero la pantalla del traslado, y un traslado ya recibido no
      // muestra líneas — ese caso ya está contemplado y lo anota como recibido
      // sin volver a moverlo. O sea que la verificación contra el sistema es
      // parte del camino normal, y por eso acá alcanza con re-encolar.
      //
      // El corte es holgado a propósito: una línea viva puede tardar hasta ~90 s
      // (dos pedidos con 45 s de espera cada uno), así que 15 minutos no puede
      // pisar una corrida en curso.
      const corteTomada = new Date(Date.now() - RESCATE_TOMADA_MS).toISOString();
      // Si este rescate falla en silencio, las líneas tomadas siguen tomadas y
      // la tarjeta queda en «sin ingresar» sin forma de arreglarlo desde el
      // portal — que es exactamente el problema que este bloque vino a
      // resolver. No lanza: lo que sigue igual puede recibir las que no están
      // trabadas.
      await anotar(
        admin.from("pedido_traslado_linea")
          .update({
            estado: "enviada",
            aviso: "Una corrida anterior se cortó con esta línea tomada. Se vuelve a la cola: "
              + "antes de recibirla se comprueba en el sistema si ya había entrado.",
            updated_at: new Date().toISOString(),
          })
          .eq("pedido_id", pedidoId).eq("erp_sucursal_id", sucId)
          .eq("estado", "recibiendo")
          .lt("updated_at", corteTomada),
        "el rescate de las líneas que quedaron tomadas",
      );

      const traerLineas = async () => {
        let q = admin.from("pedido_traslado_linea")
          .select("id, pedido_item_id, erp_product_id, id_traslado, clave, hoja, cantidad")
          .eq("pedido_id", pedidoId).eq("erp_sucursal_id", sucId)
          .eq("estado", "enviada")
          .not("id_traslado", "is", null)
          .order("hoja", { ascending: true })
          .limit(500);
        if (hoja != null)     q = q.eq("hoja", hoja);
        if (itemIds.length)   q = q.in("pedido_item_id", itemIds);
        const { data, error } = await q;
        if (error) throw error;
        return data ?? [];
      };

      const lineas = await traerLineas();
      if (!lineas.length)
        return json({
          ok: false, codigo: "NADA_QUE_RECIBIR",
          error: hoja != null
            ? `La hoja ${hoja} no tiene traslados pendientes de recibir.`
            : "No hay traslados pendientes de recibir para eso.",
        }, 409);

      // ── Quién espera el resultado ─────────────────────────────────────────
      // Recibir un producto suelto es rápido y quien lo aprieta necesita saber
      // si ya lo puede facturar: ése espera. Confirmar una hoja entera son 35
      // productos × dos viajes al sistema, medido en 18-45 s, y la sala no tiene
      // por qué quedarse mirando la pantalla: ésa lo pide en segundo plano.
      //
      // Explícito y no `!== false` como en el despacho: el valor por omisión
      // acá es ESPERAR. Un llamador viejo que no sabe de esto sigue recibiendo
      // la respuesta completa que espera.
      const enSegundoPlano = cuerpo.background === true;
      const presupuesto = enSegundoPlano ? PRESUPUESTO_BG_MS : PRESUPUESTO_FG_MS;

      let recibidas = 0;
      const fallos: { clave: string; error: string }[] = [];

      const correr = async (lote: typeof lineas) => {
        // Sesión en el DESTINO: la sucursal es estado global de la sesión del
        // sistema, y recibir escribe en la sala que recibe.
        const cookie = await sesionEn(sucId, login);

        // Con qué se comprueba, antes de cargar, si el traslado ya entró. Lee la
        // cola una vez por lote en vez de una vez por renglón — ver
        // `lectorDeRecepcion`. Se crea acá y no afuera para que cada corrida
        // arranque con la cola fresca.
        const comoVaLaEntrada = lectorDeRecepcion(cookie);

        for (const ln of lote) {
          if (Date.now() - arranque > presupuesto) break;

          // Se toma la línea ANTES de tocar el sistema. Dos personas de la sala
          // confirmando la misma hoja a la vez pasarían las dos la lectura de
          // arriba; acá la segunda no entra. Recibir dos veces duplicaría la
          // existencia, y eso no se deshace solo.
          // Con el error descartado, «no la pude tomar» y «se la llevó otra
          // corrida» eran indistinguibles: las dos hacían `continue` y la línea
          // se quedaba sin recibir sin que nadie supiera por qué. Fallar cerrado
          // acá está bien —tomar el candado es lo que impide recibir dos veces—,
          // pero tiene que dejar rastro.
          const { data: tomadaRec, error: tomarErr } = await admin.from("pedido_traslado_linea")
            .update({ estado: "recibiendo", updated_at: new Date().toISOString() })
            .eq("id", ln.id).eq("estado", "enviada")
            .select("id").maybeSingle();
          if (tomarErr) {
            console.error(`[trasladar] no se pudo tomar la línea ${ln.clave}: ${tomarErr.message}`);
            fallos.push({ clave: String(ln.clave), error: `No se pudo tomar la línea: ${tomarErr.message}` });
            continue;
          }
          if (!tomadaRec) continue;   // otra corrida se la llevó

          // ── Se le pregunta al listado ANTES de cargar ─────────────────────
          // Hasta el 2026-08-19 la única defensa contra cargar dos veces era el
          // «no muestra líneas» de más abajo, y esa frase es FALSA:
          // `recibir_traslado.php` sigue pintando las mismas filas y el mismo
          // botón para un traslado YA recibido (medido el 2026-08-17 sobre el
          // 29445 y el 29444). O sea que si alguien lo recibió por el sistema
          // —cosa que pasa: los 3 de Salud 3 del pedido 121 entraron así— esta
          // función lo cargaba de nuevo, y eso no se deshace solo.
          //
          // Quien sí sabe es el listado, con la sesión puesta en la sala que
          // recibe. Es la misma guarda que `aplicar-traslado-inventario` ya
          // tenía; acá faltaba.
          //
          // `desconocido` NO frena: si no se pudo preguntar se hace lo de
          // siempre. Una guarda que corta con lo que no sabe deja de recibir
          // por culpa de una consulta secundaria.
          const antesDeRecibir = await comoVaLaEntrada(String(ln.id_traslado));

          if (antesDeRecibir === "anulado") {
            // Anulado es lo contrario de recibido: el producto NO entró y ya no
            // va a entrar por este traslado. Se cierra en error para que no se
            // reintente para siempre y alguien lo vuelva a pedir.
            await anotar(
              admin.from("pedido_traslado_linea").update({
                estado: "error",
                error_msg: `El traslado ${ln.id_traslado} está anulado en el sistema: el producto no entró `
                  + `a la sala. Hay que volver a pedirlo.`,
                updated_at: new Date().toISOString(),
              }).eq("id", ln.id),
              `que ${ln.clave} está anulado en el sistema`,
              (m) => fallos.push({ clave: String(ln.clave), error: m }),
            );
            fallos.push({ clave: String(ln.clave), error: "El traslado está anulado en el sistema." });
            continue;
          }

          if (antesDeRecibir === "recibido") {
            await anotar(
              admin.from("pedido_traslado_linea").update({
                estado: "recibida", recibido_at: new Date().toISOString(), recibido_por: quien.id,
                // Quién lo recibió no lo dice el sistema, así que no se inventa.
                // Lo que sí hay que poder leer después es que la carga NO la hizo
                // esta llamada: acá no se escribió inventario.
                aviso: "El sistema ya lo tenía recibido; no se volvió a cargar.",
                updated_at: new Date().toISOString(),
              }).eq("id", ln.id),
              `que ${ln.clave} ya estaba recibido en el sistema`,
              (m) => fallos.push({ clave: String(ln.clave), error: m }),
            );
            // Se cuenta igual: en el sistema el producto ESTÁ recibido, y eso es
            // lo cierto. Si la anotación falló, el `fallo` de arriba hace que la
            // respuesta salga con `ok:false` — el número y la tabla dejan de
            // coincidir y hay que verlo, no taparlo bajando el conteo.
            recibidas++;
            continue;
          }

          const pagina = await pedir(cookie, `${RECIBIR}?id_movimiento=${encodeURIComponent(String(ln.id_traslado))}`,
            undefined, { extra: { Referer: `${BASE}/admin_traslados.php` } });

          const filas = [...pagina.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/g)]
            .map((m) => m[0]).filter((tr) => /class="id_p"/.test(tr));

          if (filas.length === 0) {
            // Queda como red, no como detector: una pantalla sin líneas no
            // prueba que ya entró —lo prueba el listado, que ya se consultó
            // arriba—, pero tampoco hay nada que enviar. Se anota para que el
            // pedido no quede colgado esperándolo.
            await anotar(
              admin.from("pedido_traslado_linea").update({
                estado: "recibida", recibido_at: new Date().toISOString(), recibido_por: quien.id,
                aviso: "No mostraba líneas que recibir y el listado no lo daba por recibido. Conviene mirarlo.",
                updated_at: new Date().toISOString(),
              }).eq("id", ln.id),
              `que ${ln.clave} no mostraba líneas que recibir`,
              (m) => fallos.push({ clave: String(ln.clave), error: m }),
            );
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
            // Devolverla a 'enviada' es lo que permite reintentarla. Si esta
            // escritura falla, la línea se queda en 'recibiendo' y NADIE la
            // vuelve a tomar: el rescate de arriba tarda 15 minutos y el bucle
            // sólo levanta las 'enviada'.
            await anotar(
              admin.from("pedido_traslado_linea")
                .update({ estado: "enviada", updated_at: new Date().toISOString() })
                .eq("id", ln.id),
              `la devuelta a la cola de ${ln.clave}`,
              (m) => fallos.push({ clave: String(ln.clave), error: m }),
            );
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
            // Un fallo NO prueba que no entró: el sistema contesta cosas que no
            // se pueden leer como éxito habiendo cargado el producto igual
            // (medido en `aplicar-traslado-inventario` con el 29444 y el 29446).
            // Volver a 'enviada' sin preguntar es dejar la línea lista para un
            // reintento sobre producto ya cargado — la otra mitad del hueco.
            if (await estadoDeRecepcion(cookie, String(ln.id_traslado)) === "recibido") {
              // Éste es el peor de todos para dejarlo en silencio: el producto
              // ENTRÓ a la sala y esta línea es la única prueba. Si no se anota,
              // la tarjeta dice «sin ingresar» sobre existencia que ya está
              // adentro.
              await anotar(
                admin.from("pedido_traslado_linea").update({
                  estado: "recibida", recibido_at: new Date().toISOString(), recibido_por: quien.id,
                  aviso: `El sistema contestó un fallo y sin embargo lo recibió: ${resp.msg || "sin detalle"}`,
                  updated_at: new Date().toISOString(),
                }).eq("id", ln.id),
                `que ${ln.clave} entró pese al fallo del sistema`,
                (m) => fallos.push({ clave: String(ln.clave), error: m }),
              );
              recibidas++;
              continue;
            }
            // Vuelve a 'enviada': el traslado sigue vivo y se puede reintentar.
            await anotar(
              admin.from("pedido_traslado_linea")
                .update({ estado: "enviada", error_msg: resp.msg || "El sistema no aceptó la recepción.",
                          updated_at: new Date().toISOString() })
                .eq("id", ln.id),
              `la devuelta a la cola de ${ln.clave} tras el fallo del sistema`,
              (m) => fallos.push({ clave: String(ln.clave), error: m }),
            );
            fallos.push({ clave: String(ln.clave), error: resp.msg || "sin detalle" });
            continue;
          }

          recibidas++;
          // El camino de éxito, y el que más caro sale callado: el producto ya
          // está adentro de la sala. Sin esta anotación la línea sigue
          // 'recibiendo', ninguna corrida la vuelve a tomar hasta que el rescate
          // de 15 minutos la libere, y la tarjeta la cuenta como «sin ingresar»
          // sobre existencia que ya entró.
          await anotar(
            admin.from("pedido_traslado_linea").update({
              estado: "recibida",
              recibido_at: new Date().toISOString(),
              recibido_por: quien.id,
              updated_at: new Date().toISOString(),
            }).eq("id", ln.id),
            `la recepción de ${ln.clave} (el producto YA entró a la sala)`,
            (m) => fallos.push({ clave: String(ln.clave), error: m }),
          );
        }
      };

      // En segundo plano se sigue hasta vaciar la cola: el lote es de 500 y un
      // pedido grande los pasa. Con la respuesta ya entregada no hay a quién
      // avisarle del corte, así que lo que queda tiene que quedar en la tabla —
      // y queda: las líneas siguen 'enviada' y la tarjeta las cuenta como «sin
      // ingresar», con su reintento.
      const correrTodo = async () => {
        let lote = lineas;
        while (lote.length && Date.now() - arranque < presupuesto) {
          await correr(lote);
          if (!enSegundoPlano || lote.length < 500) break;
          lote = await traerLineas();
        }
      };

      if (enSegundoPlano) {
        // 202: recibido el encargo, todavía no terminado. La sala no espera —lo
        // que le importa, el conteo, ya está guardado— y el resultado se lee en
        // la tarjeta del pedido, que sabe decir «en el inventario» o «sin
        // ingresar» con su reintento.
        // @ts-ignore — EdgeRuntime es global del runtime de Supabase
        EdgeRuntime.waitUntil(
          correrTodo().catch((e: unknown) => {
            console.error("recibir en segundo plano:", e instanceof Error ? e.message : String(e));
          }),
        );
        return json({
          ok: true,
          en_segundo_plano: true,
          pedidas: lineas.length,
        }, 202);
      }

      await correrTodo();

      // Acá el resumen sí es informativo —viaja en la respuesta y nada depende
      // de él—, pero se lee igual: que la pantalla muestre el resumen vacío
      // porque la consulta falló no puede ser indistinguible de un pedido sin
      // nada pendiente.
      const { dato: resumen } = await leerBien<Record<string, unknown>>(
        admin.rpc("resumen_traslado_pedido", { p_pedido_id: pedidoId, p_sucursal_id: sucId }),
        "el resumen de la recepción",
      );

      return json({
        ok: fallos.length === 0,
        // Cortar por presupuesto NO es un fallo, pero tampoco es haber
        // terminado: sin esto la respuesta decía `ok: true` con la mitad de las
        // líneas adentro, y quien la lee sólo miraba `ok`. Lo que falta se
        // reintenta desde la tarjeta.
        completo: recibidas === lineas.length && fallos.length === 0,
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
        // «Ya se despachó» es una respuesta que CIERRA el pedido para siempre
        // desde el punto de vista de quien la lee. Si sale de una consulta que
        // falló, se está declarando despachado algo que quizá quedó a medias.
        const { dato: viva, roto: rotoViva } = await leerBien<{ id: string; estado: string }>(
          admin.from("pedido_traslado_erp")
            .select("id, estado")
            .eq("pedido_id", pedidoId).eq("erp_sucursal_id", sucId)
            .eq("modo", "real").eq("paso", "enviar")
            .neq("estado", "error")
            .maybeSingle(),
          "la corrida que ya estaba abierta",
        );
        if (rotoViva) return json({ ok: false, codigo: "NO_SE_PUDO_LEER", error: rotoViva }, 503);
        if (!viva || viva.estado !== "en_curso")
          return json({
            ok: false,
            codigo: "YA_DESPACHADO",
            error: "Este pedido ya se despachó para esa sucursal.",
          }, 409);
        filaId = viva.id as string;
        // El contador de reanudaciones es lo que deja ver que un pedido se está
        // retomando en círculos. Que no suba no frena nada, pero callarlo
        // esconde justo la señal de que algo no avanza.
        await anotar(
          admin.rpc("incrementar_reanudacion_traslado", { p_run_id: filaId }),
          "la reanudación de la corrida",
        );
      } else {
        throw filaErr;
      }
    }
    if (!filaId) throw new Error("No se pudo abrir ni adoptar la corrida.");

    // Cerrar la corrida NO puede quedar en silencio: el estado de esta fila es
    // lo que mira el cron de cada minuto para decidir si retomar. Si el cierre
    // falla, una corrida terminada se queda en 'en_curso' y el cron la reintenta
    // para siempre; o una que falló se queda 'en_curso' y nadie se entera de que
    // el pedido no salió.
    const cerrar = async (patch: Record<string, unknown>) => {
      await anotar(
        admin.from("pedido_traslado_erp")
          .update({ ...patch, ms_total: Date.now() - arranque, updated_at: new Date().toISOString() })
          .eq("id", filaId),
        `el cierre de la corrida (${JSON.stringify(patch.estado ?? "sin estado")})`,
      );
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
      // Si esta marca no se escribe, las líneas siguen en 'enviando' y la
      // próxima corrida las ve como tomadas por otra: nadie las mira nunca, y el
      // producto que quizá salió del estante no aparece en ninguna lista.
      await anotar(
        admin.from("pedido_traslado_linea")
          .update({
            estado: "error",
            error_msg: "La corrida anterior se cortó mientras se despachaba este producto. "
              + "Hay que verificar en el sistema si el traslado entró (buscar la clave en el concepto) "
              + "antes de reintentarlo — reintentar a ciegas lo movería dos veces.",
            updated_at: new Date().toISOString(),
          })
          .eq("pedido_id", pedidoId).eq("erp_sucursal_id", sucId).eq("estado", "enviando"),
        "las líneas que quedaron a medio despachar en la corrida anterior",
      );

      const porItem = new Map(items.map((i) => [i.id, i]));
      // El número del pedido ya no se lee: viaja DENTRO de la clave (`P102-…`),
      // así que traerlo era una consulta por corrida para repetir un dato.

      // La foto de los pendientes: el traslado nuevo es el que no estaba. El
      // `insert` no devuelve el id y el listado ignora el orden que se le pide.
      let conocidos = await pendientesDeOrigen(cookie, ubicOrigen);

      // Cuánto hay DE VERDAD en el área de trabajo. La casilla de la pantalla
      // de traslado es el total de la sucursal —vencidos incluidos— y no sirve
      // de freno. Una sola lectura por corrida: 4 s y 1.5 MB para las 2,644
      // filas de Bodega, contra ~370 ms por producto. Ver
      // `existenciasDeUbicacion`.
      const lecturaEstante = await leerUbicacion(cookie, erpOrigen, ubicOrigen);
      const enUbicacion = lecturaEstante?.unidades ?? null;

      // Y el área de vencidos, para saber qué filas de ahí no se pueden
      // distinguir de las del estante — ver `apartadoQueEstorba`. Otra lectura
      // por corrida, no por producto: son 82 filas.
      const ubicVencidos = ubicacionDeVencidos(mapaOrigen);
      const lecturaVencidos = ubicVencidos
        ? await leerUbicacion(cookie, erpOrigen, ubicVencidos)
        : null;

      let hechas = 0, fallidas = 0, sinTiempo = false;

      // Los renglones que salieron de un producto con existencia apartada
      // INDISTINGUIBLE. Al final de la corrida se relee el área de vencidos y
      // se comprueba que no haya bajado: si bajó, el sistema descontó la fila
      // equivocada y hay que reponerla. Ver `apartadoQueEstorba`.
      const conRiesgo: {
        id: string; clave: string; producto: string; pid: number; antes: number; avisoPrevio: string;
      }[] = [];

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

          // `fallar` es lo ÚNICO que le cuenta a alguien por qué un producto no
          // salió: en background no hay respuesta que leer. Si la anotación del
          // fallo falla a su vez, el renglón queda en 'enviando' y desaparece de
          // toda pantalla — el fallo del fallo es el que no puede ser mudo.
          const fallar = async (msg: string) => {
            fallidas++;
            await anotar(
              admin.from("pedido_traslado_linea")
                .update({ estado: "error", error_msg: msg, updated_at: new Date().toISOString() })
                .eq("id", ln.id),
              `por qué no salió ${ln.clave} («${msg}»)`,
            );
          };

          const it = porItem.get(ln.pedido_item_id as number);
          if (!it) { await fallar("El renglón ya no está en el pedido."); continue; }

          // Se toma la línea ANTES de tocar el sistema: si esto no escribe,
          // nadie más la agarra, y si el worker muere después queda la marca.
          const { data: tomada, error: tomarErr } = await admin.from("pedido_traslado_linea")
            .update({ estado: "enviando", updated_at: new Date().toISOString() })
            .eq("id", ln.id).eq("estado", "planificada")
            .select("id").maybeSingle();
          if (tomarErr) {
            // Fallar cerrado está bien —sin el candado, dos corridas despachan
            // el mismo producto—, pero «no la pude tomar» y «se la llevó otra»
            // no pueden salir por la misma puerta muda: la primera significa que
            // la base está mal y el pedido no va a avanzar nunca.
            console.error(`[trasladar] no se pudo tomar la línea ${ln.clave}: ${tomarErr.message}`);
            continue;
          }
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
          // trae la del primer lote y no la del producto. Y sin lotes sale del
          // reporte por ubicación, no de la casilla, que suma vencidos. Ver
          // `disponibleEnBodega`.
          //
          // Ausente del reporte es CERO en esa ubicación, no «no sé»: el
          // reporte trae el área entera.
          const hay = disponibleEnBodega(
            f, Number(pres.unidad),
            enUbicacion ? (enUbicacion.get(Number(ln.erp_product_id)) ?? 0) : null,
            apartadoQueEstorba(lecturaEstante, lecturaVencidos, Number(ln.erp_product_id)),
          );
          // Lo apartado en el área de vencidos ya NO achica este número: el
          // sistema respeta la ubicación desde el 26-ago (ver
          // `disponibleEnBodega`). Si falta, falta en el estante.
          if (Number(ln.cantidad) > hay.paquetes) {
            await fallar(`Hoy ${hayEnTexto(hay)}: alcanzan para ${hay.paquetes} y hacen falta ${ln.cantidad}.`);
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
            // El reparto es `repartirEnLotes` de `_shared` y no una copia: hasta
            // el 2026-08-18 esta función tenía la suya, y las dos se movieron por
            // separado. La copia se quedó sin el cruce por número (v2.658.2) y
            // sin el retorno al lote reservado por lo que le sobra — que es lo
            // que hace que el tope y el reparto digan lo mismo.
            const reparto = repartirEnLotes(
              f.lotes, Number(ln.cantidad), Number(pres.unidad), reservadosDe(it, Number(pres.unidad)), "el pedido",
            );
            renglones.push(...reparto.renglones);
            avisos.push(...reparto.avisos);

            if (reparto.faltan > 0) {
              await fallar(
                `Ningún lote en bodega alcanza para las ${ln.cantidad} confirmadas: faltan ${reparto.faltan}. `
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

          // La foto de DESPUÉS se toma pase lo que pase, porque hace falta
          // tanto para saber cuál es el propio como para saber si salió pese al
          // «no». Y `conocidos` se actualiza igual aunque esta línea falle: los
          // traslados que aparecieron existen, y dejarlos como «no estaban»
          // haría que la línea siguiente los cuente como candidatos suyos.
          const despues = await pendientesDeOrigen(cookie, ubicOrigen);

          let idTraslado: string | null;
          let candidatos: string[];

          if (!resp.ok) {
            /* ── Un «no» del sistema no siempre significa que no salió ──────
             *
             * Es la misma lección que la recepción ya tenía aprendida —ahí se
             * midió el 2026-08-17: diez respuestas de fallo y dos traslados
             * FINALIZADOS igual—. Acá el desenlace es peor: la línea quedaría
             * en error con el producto ya fuera del estante, y el pedido diría
             * que nunca salió.
             *
             * Ojo con reusar `identificarTrasladoNuevo` para esto: esa función
             * da por sentado que el propio existe, así que con UN solo traslado
             * nuevo lo toma sin abrirlo — y acá ese único bien puede ser el de
             * otra persona. Por eso se exige que el contenido coincida. */
            const { id, nuevos } = await trasladoQueSalioPeseAlFallo(
              cookie, conocidos, despues, [it.nombre],
            );
            conocidos = despues;
            if (!id) {
              await fallar(
                `El sistema no aceptó el traslado: ${resp.msg || "sin detalle"}`
                // Aparecieron traslados nuevos y ninguno es claramente éste. No
                // es lo mismo que «no salió nada», y quien lo reintente tiene
                // que saberlo antes de despachar dos veces.
                + (nuevos.length ? ` · aparecieron ${nuevos.length} traslado(s) nuevo(s) en esa ubicación (${nuevos.join(", ")}): comprobar antes de reintentar` : ""),
              );
              continue;
            }
            idTraslado = id;
            candidatos = [id];
            avisos.push(`el sistema contestó un fallo y sin embargo lo despachó: ${resp.msg || "sin detalle"}`);
          } else {
            // Cuál de los nuevos es el propio. NO alcanza con «el que no
            // estaba»: Bodega despacha solicitudes a mano desde esta misma
            // ubicación todo el día, y una que caiga entre las dos fotos
            // aparece como candidata. Ahí desempatan el destino y, si los dos
            // van a la misma sala, el producto que llevan adentro. Ver
            // `identificarTrasladoNuevo`.
            ({ id: idTraslado, candidatos } = await identificarTrasladoNuevo(
              cookie, conocidos, despues, html, sucId, [it.nombre],
            ));
            conocidos = despues;
          }

          hechas++;
          if (hay.desdeVencidos > 0) {
            conRiesgo.push({
              id: String(ln.id), clave: String(ln.clave), producto: it.nombre,
              pid: Number(ln.erp_product_id), antes: hay.desdeVencidos,
              // Lo que ya se anotó al despachar —el lote que no era el
              // reservado, por ejemplo—: el aviso se SUMA, no se pisa.
              avisoPrevio: avisos.length ? avisos.join(" · ") : "",
            });
          }
          // El producto YA SALIÓ del estante de Bodega. Esta fila es la única
          // prueba de que salió y del número con el que se puede recibir: si no
          // se escribe, el traslado existe en el sistema y no existe para el
          // portal — ni la sala puede recibirlo, ni nadie sabe que hay que ir a
          // buscarlo. Es la escritura más cara de todo el archivo para dejarla
          // muda, y era una de las 42.
          await anotar(
            admin.from("pedido_traslado_linea").update({
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
              : `Entró, pero no se pudo distinguir cuál es entre ${candidatos.length} candidatos `
                + `(${candidatos.join(", ") || "ninguno"}). Buscar «${ln.clave}» en el concepto.`,
            }).eq("id", ln.id),
            `el despacho de ${ln.clave} (el producto YA salió de Bodega, traslado ${idTraslado ?? "sin identificar"})`,
          );
        }
      }

      // ── Que el área de vencidos quede como estaba ──────────────────────
      //
      // El sistema puede descontar la fila apartada en vez de la del estante
      // cuando las dos son indistinguibles (mismo producto, mismo lote, misma
      // presentación y ninguna con fecha). Lo que sale físicamente lo levanta
      // Bodega del estante, así que lo que queda torcido es el PAPEL: el área
      // de vencidos pierde una unidad que sigue estando en su caja.
      //
      // Se relee UNA vez, y sólo si algún renglón de riesgo salió: en un
      // despacho normal esto no cuesta nada. El texto vive en
      // `avisoDelAreaDeVencidos` porque las CUATRO funciones que despachan
      // desde Bodega hacen esta misma comprobación.
      if (conRiesgo.length && ubicVencidos) {
        const despues = await leerUbicacion(cookie, erpOrigen, ubicVencidos);
        for (const r of conRiesgo) {
          const nota = avisoDelAreaDeVencidos(r, despues);
          if (!nota) continue;
          await anotar(
            admin.from("pedido_traslado_linea")
              .update({
                aviso: [r.avisoPrevio, nota].filter(Boolean).join(" · "),
                updated_at: new Date().toISOString(),
              })
              .eq("id", r.id),
            `el aviso del área de vencidos de ${r.clave}`,
          );
        }
      }

      // Este resumen NO es decorativo: de él sale `quedan`, y `quedan` decide si
      // la corrida se cierra como «despachado» o se queda «en_curso» para que el
      // cron la retome. Con el error descartado, `resumen` venía null, `quedan`
      // caía a 0 por el `?? 0` y **la corrida se declaraba despachada con
      // producto sin salir** — el pedido quedaba a medias y nadie lo retomaba
      // nunca, porque ya figuraba terminado.
      //
      // Si no se puede leer, se deja 'en_curso': un pedido que se retoma de más
      // no rompe nada (el bucle sólo levanta líneas 'planificada'), y uno que se
      // da por terminado de menos deja producto en el estante que la sala espera.
      const { dato: resumen, roto: rotoResumen } = await leerBien<Record<string, unknown>>(
        admin.rpc("resumen_traslado_pedido", { p_pedido_id: pedidoId, p_sucursal_id: sucId }),
        "el resumen del despacho",
      );
      const quedan = rotoResumen ? 1 : Number((resumen as Record<string, unknown>)?.por_despachar ?? 0);

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
      // La misma lectura que hace el despacho: si esta pantalla contara de otra
      // forma, pondría en cero productos que el despacho sí puede mandar. Por
      // eso también lee lo apartado en vencidos: es la mitad del tope, y una
      // pantalla que no la mire deja a Bodega armando una caja que el sistema
      // va a rechazar.
      const lecturaEstanteSim = await leerUbicacion(cookie, erpOrigen, ubicOrigen);
      const enUbicacion = lecturaEstanteSim?.unidades ?? null;
      const ubicVencidosSim = ubicacionDeVencidos(mapaOrigen);
      const lecturaVencidosSim = ubicVencidosSim
        ? await leerUbicacion(cookie, erpOrigen, ubicVencidosSim)
        : null;

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
        const hay = disponibleEnBodega(
          f, Number(pres.unidad),
          enUbicacion ? (enUbicacion.get(Number(it.erp_product_id)) ?? 0) : null,
          apartadoQueEstorba(lecturaEstanteSim, lecturaVencidosSim, Number(it.erp_product_id)),
        );
        if (it.cantidad > hay.paquetes) {
          hallazgos.push({
            erp_product_id: it.erp_product_id, producto: it.nombre, codigo: "SIN_EXISTENCIA",
            // Lo apartado en el área de vencidos ya no achica este número: el
            // sistema respeta la ubicación desde el 26-ago. Lo que falta,
            // falta en el estante.
            detalle: hay.unidades <= 0
              ? "Ya no tiene existencia en bodega."
              : `Hoy ${hayEnTexto(hay)}: alcanzan para ${hay.paquetes} y el pedido lleva ${it.cantidad}.`,
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
          // Que el pedido no haya guardado lote no corta: se cubre igual con lo
          // que hay, empezando por el que vence primero. El despacho real hace
          // exactamente eso, y las dos tienen que coincidir.
          //
          // ⚠️ Esta repartición tiene que dar el MISMO resultado que la del
          // despacho real. El simulacro es lo que le avisa a Bodega qué va a
          // pasar, y su salida pone en cero los productos con problema en la
          // pantalla de confirmar: si acá se marcara como problema un lote que
          // el despacho resuelve solo, Bodega dejaría de enviar mercadería que
          // sí está en la caja. Por eso hoy las dos llaman a la MISMA función:
          // eran dos copias del mismo criterio y «si se toca una, se toca la
          // otra» no alcanzó — el 2026-08-18 las dos arrastraban el mismo error
          // de cerrar un lote del que había salido menos de lo que tenía.
          //
          // Que el lote reservado ya no esté NO es un problema: se cubre con el
          // que vence primero, que es lo que quien levanta hizo físicamente.
          const reparto = repartirEnLotes(
            f.lotes, it.cantidad, Number(pres.unidad), reservadosDe(it, Number(pres.unidad)), "el pedido",
          );
          lineasItem.push(...reparto.renglones);

          if (reparto.faltan > 0) {
            hallazgos.push({
              erp_product_id: it.erp_product_id, producto: it.nombre, codigo: "SIN_LOTE_SUFICIENTE",
              detalle: `Ningún lote en bodega alcanza para las ${it.cantidad} unidades: faltan ${reparto.faltan}. `
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
