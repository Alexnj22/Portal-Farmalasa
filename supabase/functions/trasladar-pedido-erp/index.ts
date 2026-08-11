import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireActiveEmployeeUser } from "../_shared/security.ts";
import { BASE, login, pedir, leerRespuesta } from "../_shared/erp-dte.ts";
import {
  CONCEPTO_MAX,
  hoySV,
  identificarTrasladoNuevo,
  norm,
  pendientesDeOrigen,
  resolverPresentacion,
  sesionEn,
  soloAscii,
  traerFila,
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
    const pedidoId = String(cuerpo.pedido_id ?? "");
    const sucId = Number(cuerpo.erp_sucursal_id ?? 0);
    // El simulacro es el valor por omisión a propósito: esta función mueve
    // inventario real, y escribir tiene que ser una decisión explícita.
    const simulacro = cuerpo.simulacro !== false;
    // Y el background también: 450 productos no entran en una respuesta.
    const background = cuerpo.background !== false;

    if (!pedidoId || !sucId)
      return json({ ok: false, error: "Faltan pedido_id o erp_sucursal_id." }, 400);

    // ── Quién llama. Nunca del payload: del JWT. ──────────────────────────
    const quien = await requireActiveEmployeeUser(req, admin);
    if (!quien) return json({ ok: false, error: "Sesión inválida o empleado inactivo." }, 401);

    // ── El permiso es el del módulo Pedidos ───────────────────────────────
    // Se repite acá porque esta función usa la llave de servicio y el RLS no la
    // frena. Es el mismo que exige `confirm_pedido`: quien puede generar y
    // finalizar un pedido es quien puede mandarlo al sistema.
    const { data: emp } = await admin
      .from("employees").select("role_id, secondary_role_id, system_role")
      .eq("id", quien.id).maybeSingle();
    const roles = [emp?.role_id, emp?.secondary_role_id].filter((r) => r != null);
    const { data: permisos } = await admin
      .from("role_permissions").select("can_edit")
      .in("role_id", roles.length ? roles : [-1])
      .eq("module_key", "pedidos");
    const puede = emp?.system_role === "SUPERADMIN" || (permisos ?? []).some((p) => p.can_edit);
    if (!puede)
      return json({ ok: false, error: "No tienes permiso de edición en Pedidos." }, 403);

    // ── Origen y destino salen del mapa, nunca del cliente ────────────────
    // La ubicación es una propiedad de la sala. Pedírsela al navegador sería
    // dejar que elija de dónde sale el producto — la misma razón por la que
    // `aplicar-traslado-inventario` dejó de recibirla.
    const { data: mapas, error: mapaErr } = await admin
      .from("erp_sucursal_map")
      .select("erp_sucursal_id, nombre, es_bodega, inv_ubicaciones");
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
    if (filaErr) {
      // 23505 = el índice único. Ya hay un traslado real vivo para esta sucursal.
      if (String((filaErr as { code?: string }).code) === "23505")
        return json({
          ok: false,
          codigo: "YA_DESPACHADO",
          error: "Este pedido ya tiene un traslado en curso o despachado para esa sucursal.",
        }, 409);
      throw filaErr;
    }
    const filaId = fila!.id as string;

    const cerrar = async (patch: Record<string, unknown>) => {
      await admin.from("pedido_traslado_erp")
        .update({ ...patch, ms_total: Date.now() - arranque, updated_at: new Date().toISOString() })
        .eq("id", filaId);
    };

    // ══════════════════════════════════════════════════════════════════════
    // El trabajo
    // ══════════════════════════════════════════════════════════════════════
    const correr = async () => {
      const presupuesto = background ? PRESUPUESTO_BG_MS : PRESUPUESTO_FG_MS;
      const cookie = await sesionEn(erpOrigen, login);

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
        const enUnidades = it.cantidad * Number(pres.unidad);
        if (enUnidades > f.existencia) {
          hallazgos.push({
            erp_product_id: it.erp_product_id, producto: it.nombre, codigo: "SIN_EXISTENCIA",
            detalle: `Quedan ${f.existencia} unidades en bodega y el pedido lleva `
              + `${it.cantidad} × ${pres.unidad} = ${enUnidades}.`,
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

          if (asignados.length === 0) {
            hallazgos.push({
              erp_product_id: it.erp_product_id, producto: it.nombre, codigo: "LLEVA_LOTE_SIN_ASIGNAR",
              detalle: "El sistema le exige lote y el pedido no guardó ninguno.",
            });
            continue;
          }
          // Los lotes se reparten sobre lo que REALMENTE se envía, que puede no
          // ser lo asignado. Vienen en orden de vencimiento desde que se armó el
          // pedido, así que mandar de menos es tomar de los que vencen primero.
          // Si Bodega mandó de MÁS, los lotes no alcanzan: no se adivina de
          // dónde salió el excedente — se avisa y no se despacha ese renglón.
          const suma = asignados.reduce((s, l) => s + l.cantidad, 0);
          let resto = it.cantidad;
          const aTomar: typeof asignados = [];
          for (const a of asignados) {
            if (resto <= 0) break;
            const toma = Math.min(a.cantidad, resto);
            aTomar.push({ ...a, cantidad: toma });
            resto -= toma;
          }
          if (resto > 0) {
            hallazgos.push({
              erp_product_id: it.erp_product_id, producto: it.nombre, codigo: "LOTES_NO_CUADRAN",
              detalle: `Los lotes del pedido suman ${suma} y se confirmaron ${it.cantidad} para enviar. `
                + `Falta decir de qué lote salen los ${resto} de más.`,
            });
            continue;
          }

          let falla: string | null = null;
          for (const a of aTomar) {
            const lote = f.lotes.find((x) =>
              norm(x.numero) === norm(a.numero) && (!a.vence || x.vence.slice(0, 10) === a.vence)
            );
            if (!lote) {
              falla = `El lote ${a.numero || "(sin número)"} ya no está en bodega. `
                + `Hay: ${f.lotes.map((x) => `${x.numero} ${x.vence}`).join(", ") || "ninguno"}.`;
              break;
            }
            const necesita = a.cantidad * Number(pres.unidad);
            if (necesita > lote.stock) {
              falla = `El lote ${lote.numero} tiene ${lote.stock} unidades y hacen falta ${necesita}.`;
              break;
            }
            lineasItem.push({ cantidad: a.cantidad, idLote: lote.id, lote: lote.numero });
          }
          if (falla) {
            hallazgos.push({
              erp_product_id: it.erp_product_id, producto: it.nombre, codigo: "LOTE_NO_EXISTE", detalle: falla,
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

      // ── Real: o entra entero, o no entra ────────────────────────────────
      // Medio traslado es peor que ninguno — el mismo criterio que
      // `aplicar-traslado-inventario`. El simulacro existe justamente para que
      // los hallazgos se vean ANTES y no frenen el despacho del día.
      if (hallazgos.length > 0) {
        await cerrar({
          estado: "error",
          hallazgos,
          detalle,
          error_msg: `No se despachó nada: ${hallazgos.length} producto(s) no se pudieron resolver.`,
        });
        return { despachado: false, hallazgos: hallazgos.length };
      }
      if (partes.length === 0) {
        await cerrar({ estado: "error", error_msg: "No quedó ni una línea que mandar." });
        return { despachado: false, hallazgos: 0 };
      }
      // Despachar sin que Bodega haya confirmado sería mover lo que el reparto
      // supuso, no lo que salió — que es justo lo que esta columna vino a
      // arreglar. El simulacro sí corre sin confirmar, porque su trabajo es
      // avisarle a Bodega ANTES de que confirme.
      const sinConfirmar = items.filter((i) => !i.confirmada).length;
      if (sinConfirmar > 0) {
        await cerrar({
          estado: "error",
          error_msg: `El envío todavía no se confirmó: ${sinConfirmar} de ${items.length} productos `
            + `no tienen cantidad confirmada por Bodega.`,
        });
        return { despachado: false, codigo: "SIN_CONFIRMAR" };
      }

      // El vale no se inventa: es un `uniqid()` que el servidor pre-rellena en
      // el HTML de cada carga de la página, y su JS lo valida pero nunca lo
      // genera. Hay que hacer el GET y sacarlo de ahí.
      const html = await pedir(cookie, TRASLADO, undefined, { extra: { Referer: `${BASE}/dashboard.php` } });
      const vale = html.match(/numero_vale["'][^>]*value=["']([^"']+)["']/)?.[1] ?? "";
      if (!vale) {
        await cerrar({ estado: "error", error_msg: "El sistema no entregó el número de vale del traslado." });
        return { despachado: false };
      }

      const { data: ped } = await admin.from("pedidos").select("numero").eq("id", pedidoId).maybeSingle();
      const concepto = soloAscii(
        `Pedido ${ped?.numero ?? "-"} - prepara: ${quien.name} - destino: ${mapaDestino.nombre}`,
      ).slice(0, CONCEPTO_MAX);

      // La foto de ANTES: el id del traslado nuevo es el que no estaba. El
      // `insert` no lo devuelve y el listado no respeta el orden que se le pide.
      const antes = await pendientesDeOrigen(cookie, ubicOrigen);

      const resp = leerRespuesta(await pedir(cookie, TRASLADO, new URLSearchParams({
        process: "insert",
        datos: partes.join("#") + "#",
        id_traslado_guardado: "0",
        cuantos: String(partes.length),
        total: total.toFixed(4),
        fecha: hoySV(),
        concepto,
        origen: String(ubicOrigen),
        id_suc_destino: String(sucId),
        id_ubicacion_destino: "0",
        numero_vale: vale,
      }), { extra: { Referer: TRASLADO } }));

      if (!resp.ok) {
        await cerrar({
          estado: "error",
          numero_vale: vale,
          lineas: partes.length,
          detalle,
          error_msg: `El sistema no aceptó el traslado: ${resp.msg || "sin detalle"}`,
        });
        return { despachado: false, error: resp.msg };
      }

      const despues = await pendientesDeOrigen(cookie, ubicOrigen);
      const { id: idTraslado, candidatos } = await identificarTrasladoNuevo(
        cookie, antes, despues, html, sucId, detalle.slice(0, 5).map((d) => String(d.producto ?? "")),
      );

      await cerrar({
        estado: "despachado",
        id_traslado: idTraslado,
        numero_vale: vale,
        lineas: partes.length,
        unidades,
        total: Number(total.toFixed(4)),
        detalle,
        // Si quedó sin id el traslado ENTRÓ igual: lo único que falta es el
        // número para poder recibirlo desde el portal. Se dice, no se calla.
        hallazgos: idTraslado
          ? []
          : [{
            erp_product_id: 0, producto: "—", codigo: "ID_AMBIGUO",
            detalle: `El traslado entró, pero no se pudo distinguir cuál es entre ${candidatos.length} candidatos.`,
          }],
      });
      return { despachado: true, id_traslado: idTraslado, lineas: partes.length };
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
