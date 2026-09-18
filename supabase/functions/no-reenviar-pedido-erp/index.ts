import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireActiveEmployeeUser } from "../_shared/security.ts";
import { BASE, login, pedir } from "../_shared/erp-dte.ts";
import { anotar, estadoDeRecepcion, leerBien, sesionEn } from "../_shared/erp-traslado.ts";

// «No reenviar»: bodega decide que una caja especial que la sala reportó como
// no llegada ya no se manda (2026-09-17, a partir del pedido #178 de Salud 4).
//
// ── Qué hace, en este orden ─────────────────────────────────────────────────
// 1. Si el producto salió en un traslado, lo ANULA en el sistema desde la
//    sesión de Bodega. El propio sistema lo promete en su confirmación: «El
//    traslado solo será anulado y el stock del producto regresará al local de
//    origen». Es el mismo botón «Anular» de su menú de traslados.
// 2. Comprueba, desde la sesión de la SALA, que el traslado ya no está en su
//    cola de recepción y figura anulado. Un «success» del sistema no alcanza:
//    lo que se guarda es lo que el sistema dice tener después.
// 3. Recién entonces cierra en el portal (`cerrar_no_reenviadas`): el producto
//    queda «no enviado» y la sala deja de verlo pendiente.
//
// Al revés, un fallo a mitad dejaría el pendiente cerrado y el producto en
// tránsito —fuera de Bodega y sin entrar a la sala—, que es peor que no haber
// hecho nada.
//
// Si el producto NO salió (se despachó en 0, o su línea quedó `omitida`), no hay
// nada que anular: sólo se cierra en el portal.
//
// ── Por qué sólo el renglón ENTERO ──────────────────────────────────────────
// El sistema hace un traslado por producto y no admite recibir una parte. Si
// una de las cajas de ese producto sí llegó, anular el traslado regresaría
// también la que la sala tiene en la mano. Ese caso se rechaza con `PARCIAL`.
//
// ── Y sólo si el traslado lleva ese renglón y nada más ──────────────────────
// Si otra línea del pedido comparte el `id_traslado`, anularlo se llevaría
// producto que sí llegó. No debería pasar —el despacho arma uno por producto—,
// pero es la clase de supuesto que conviene comprobar antes de un acto que no
// se deshace.

const CORTADA_MS = 5 * 60_000;
const ANULAR = `${BASE}/anular_traslado.php`;

type Linea = {
  id: string;
  pedido_item_id: number;
  estado: string;
  id_traslado: string | null;
  clave: string | null;
  detalle: Record<string, unknown> | null;
  updated_at: string;
};

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const cuerpo = await req.json().catch(() => ({}));
    const pedidoId = String(cuerpo.pedido_id ?? "");
    const sucId = Number(cuerpo.erp_sucursal_id);
    const labels: string[] = Array.isArray(cuerpo.labels)
      ? [...new Set(cuerpo.labels.map(String).filter(Boolean))] as string[]
      : [];
    // Simulacro por omisión, como en `devolver-pedido-erp`: anular no se
    // deshace, y hacerlo tiene que ser una decisión explícita del llamador.
    const simulacro = cuerpo.simulacro !== false;

    if (!pedidoId || !Number.isFinite(sucId) || labels.length === 0)
      return json({ ok: false, error: "Falta el pedido, la sala o las cajas." }, 400);
    if (labels.length > 30)
      return json({ ok: false, error: "Demasiadas cajas de una vez (máximo 30)." }, 400);

    // ── Quién llama. Del JWT, nunca del payload ───────────────────────────
    const usuario = await requireActiveEmployeeUser(req, admin);
    if (!usuario) return json({ ok: false, error: "Sesión inválida o empleado inactivo." }, 401);

    // ── Permiso: editar Pedidos, y ser de Bodega (o alcance total) ────────
    // La función usa la llave de servicio y el RLS no la frena: el permiso se
    // repite acá. Es la misma regla que la devolución — el producto vuelve a
    // Bodega, y lo decide quien lo despachó.
    const { dato: emp, roto: rotoEmp } = await leerBien<{ role_id: number | null; secondary_role_id: number | null; branch_id: number | null }>(
      admin.from("employees").select("role_id, secondary_role_id, branch_id").eq("id", usuario.id).maybeSingle(),
      "tu ficha de empleado",
    );
    if (rotoEmp) return json({ ok: false, codigo: "NO_SE_PUDO_LEER", error: rotoEmp }, 503);
    const roles = [emp?.role_id, emp?.secondary_role_id].filter((r) => r != null);
    const { dato: permisos, roto: rotoPerm } = await leerBien<{ can_edit: boolean; scope: string }[]>(
      admin.from("role_permissions").select("can_edit, scope")
        .in("role_id", roles.length ? roles : [-1]).eq("module_key", "pedidos"),
      "tus permisos de Pedidos",
    );
    if (rotoPerm) return json({ ok: false, codigo: "NO_SE_PUDO_LEER", error: rotoPerm }, 503);
    if (!(permisos ?? []).some((p) => p.can_edit))
      return json({ ok: false, error: "No tienes permiso de edición en Pedidos." }, 403);
    const alcanceTodo = (permisos ?? []).some((p) => p.can_edit && p.scope === "ALL");

    const { data: mapas, error: mapaErr } = await admin
      .from("erp_sucursal_map").select("erp_sucursal_id, es_bodega, branch_id");
    if (mapaErr) throw mapaErr;
    const mapaBodega = (mapas ?? []).find((m) => m.es_bodega) ?? null;
    if (!mapaBodega) return json({ ok: false, error: "No hay una bodega marcada en el mapa de salas." }, 422);
    if (!(mapas ?? []).some((m) => Number(m.erp_sucursal_id) === sucId))
      return json({ ok: false, error: "Esa sala no está en el mapa." }, 422);
    if (!alcanceTodo && Number(emp?.branch_id ?? 0) !== Number(mapaBodega.branch_id ?? -1))
      return json({ ok: false, error: "Esto lo decide Bodega, que es a donde regresa el producto." }, 403);

    // ── Qué cajas, de qué renglones ───────────────────────────────────────
    const { dato: pss, roto: rotoPss } = await leerBien<{ cajas_especiales: unknown; cajas_especiales_llegadas: unknown }>(
      admin.from("pedido_sucursal_status").select("cajas_especiales, cajas_especiales_llegadas")
        .eq("pedido_id", pedidoId).eq("erp_sucursal_id", sucId).maybeSingle(),
      "el estado de la sala",
    );
    if (rotoPss) return json({ ok: false, codigo: "NO_SE_PUDO_LEER", error: rotoPss }, 503);
    if (!pss) return json({ ok: false, codigo: "NO_EXISTE", error: "Esa sala no tiene este pedido." }, 404);
    const especiales = (Array.isArray(pss.cajas_especiales) ? pss.cajas_especiales : []) as
      { label: string; pedido_item_id: number; product_name?: string }[];
    const llegadas = (pss.cajas_especiales_llegadas && typeof pss.cajas_especiales_llegadas === "object"
      && !Array.isArray(pss.cajas_especiales_llegadas) ? pss.cajas_especiales_llegadas : {}) as Record<string, string>;

    for (const l of labels) {
      if (!especiales.some((e) => e.label === l))
        return json({ ok: false, codigo: "SIN_RENGLON", error: `La caja ${l} no está en la lista del despacho.` }, 409);
      if (llegadas[l] !== "faltante")
        return json({ ok: false, codigo: "NO_FALTA", error: `La caja ${l} no figura como no llegada.` }, 409);
    }
    const items = [...new Set(especiales.filter((e) => labels.includes(e.label)).map((e) => Number(e.pedido_item_id)))];
    const parcial = especiales.filter((e) => items.includes(Number(e.pedido_item_id)) && !labels.includes(e.label));
    if (parcial.length > 0)
      return json({
        ok: false, codigo: "PARCIAL",
        error: `Parte de ese producto sí llegó (${parcial.map((e) => e.label).join(", ")}). `
          + "Va en un solo traslado: anularlo regresaría también lo que la sala tiene.",
      }, 409);

    // ── Freno: falla cerrado, salvo el simulacro, que no escribe ──────────
    if (!simulacro) {
      const { data: sw, error: swErr } = await admin
        .from("traslado_interruptor").select("pausado, motivo").eq("accion", "anular").maybeSingle();
      if (swErr || !sw)
        return json({ ok: false, codigo: "INTERRUPTOR_ILEGIBLE", error: "No se pudo comprobar si anular está pausado. No se movió nada." }, 503);
      if (sw.pausado)
        return json({ ok: false, codigo: "PAUSADO", error: `Anular traslados está pausado${sw.motivo ? `: ${sw.motivo}` : "."}` }, 423);
    }

    // ── Las líneas del traslado de esos renglones ─────────────────────────
    // Una línea por renglón (índice único `una_por_item`), y `items` sale de
    // ≤30 etiquetas: el tope de 60 nunca recorta, sólo lo deja escrito.
    const { data: lineasRaw, error: linErr } = await admin
      .from("pedido_traslado_linea")
      .select("id, pedido_item_id, estado, id_traslado, clave, detalle, updated_at")
      .eq("pedido_id", pedidoId).eq("erp_sucursal_id", sucId)
      .in("pedido_item_id", items)
      .limit(60);
    if (linErr) throw linErr;
    let lineas = (lineasRaw ?? []) as Linea[];

    // Una línea que quedó en `anulando` es residuo de una corrida que murió
    // entre la anulación y su anotación. NO se reintenta a ciegas: se marca para
    // mirarla a mano con la clave en la mano.
    const corte = Date.now() - CORTADA_MS;
    const cortadas = lineas.filter((l) => l.estado === "anulando" && new Date(l.updated_at).getTime() < corte);
    if (cortadas.length > 0) {
      await anotar(
        admin.from("pedido_traslado_linea").update({
          estado: "error",
          error_msg: "Se cortó mientras se anulaba. Hay que ver en el sistema si el traslado quedó anulado antes de reintentar.",
          updated_at: new Date().toISOString(),
        }).in("id", cortadas.map((l) => l.id)).eq("estado", "anulando"),
        "las anulaciones que quedaron a medio hacer",
      );
      return json({
        ok: false, codigo: "REVISAR_A_MANO",
        error: "Una anulación anterior de este producto se cortó a medias. Hay que revisarla en el sistema antes de seguir.",
      }, 409);
    }

    const vivas = lineas.filter((l) => !["anulada", "omitida"].includes(l.estado));
    const noAnulables = vivas.filter((l) => l.estado !== "enviada" || !l.id_traslado);
    if (noAnulables.length > 0) {
      const l = noAnulables[0];
      const porque = l.estado === "recibida" || l.estado === "recibiendo"
        ? "ya entró a la sala en el sistema"
        : l.estado === "anulando" ? "otra persona lo está anulando ahora mismo"
        : l.estado === "error" ? "su traslado quedó con un error que hay que revisar a mano"
        : "su traslado todavía no terminó de salir";
      return json({ ok: false, codigo: "NO_ANULABLE", error: `No se puede anular: ${porque}.` }, 409);
    }

    // Ningún otro renglón puede viajar en esos traslados.
    const ids = [...new Set(vivas.map((l) => String(l.id_traslado)))];
    if (ids.length > 0) {
      // Basta con saber si hay UNA: `limit(1)`. Y dentro del mismo pedido y
      // sala, que es donde el despacho arma sus traslados — así entra por índice.
      const { data: compartidas, error: compErr } = await admin
        .from("pedido_traslado_linea").select("id")
        .eq("pedido_id", pedidoId).eq("erp_sucursal_id", sucId)
        .in("id_traslado", ids).not("pedido_item_id", "in", `(${items.join(",")})`)
        .limit(1);
      if (compErr) throw compErr;
      if ((compartidas ?? []).length > 0)
        return json({
          ok: false, codigo: "TRASLADO_COMPARTIDO",
          error: "Ese traslado lleva también otro producto del pedido: anularlo regresaría lo que sí llegó.",
        }, 409);
    }

    // ── Antes de anular: ¿sigue pendiente de entrar a la sala? ────────────
    // Desde la sesión de la SALA, que es la que ve su cola de recepción.
    const plan: { linea: Linea; estado: string }[] = [];
    let cookieSala: string | null = null;
    if (vivas.length > 0) {
      cookieSala = await sesionEn(sucId, login);
      for (const l of vivas) plan.push({ linea: l, estado: await estadoDeRecepcion(cookieSala, String(l.id_traslado)) });
      const raro = plan.find((p) => p.estado !== "pendiente" && p.estado !== "anulado");
      if (raro)
        return json({
          ok: false, codigo: "NO_ANULABLE",
          error: raro.estado === "recibido"
            ? "Ese traslado ya entró a la sala en el sistema: no se puede anular. Se resuelve como diferencia."
            : "No se pudo confirmar en el sistema que el traslado siga pendiente. No se movió nada.",
        }, 409);
    }

    if (simulacro)
      return json({
        ok: true, simulacro: true, items, labels,
        anularia: plan.filter((p) => p.estado === "pendiente").map((p) => ({ id_traslado: p.linea.id_traslado, clave: p.linea.clave })),
        ya_anulados: plan.filter((p) => p.estado === "anulado").map((p) => p.linea.id_traslado),
      });

    // ── Anular, de a un traslado, con candado ─────────────────────────────
    const ahora = () => new Date().toISOString();
    let cookieBodega: string | null = null;
    const fallos: string[] = [];
    for (const p of plan) {
      const l = p.linea;
      // El candado: sólo quien pasa `enviada` → `anulando` sigue.
      const { data: tomadas, error: tomErr } = await admin.from("pedido_traslado_linea")
        .update({ estado: "anulando", updated_at: ahora() })
        .eq("id", l.id).eq("estado", "enviada").select("id");
      if (tomErr) throw tomErr;
      if ((tomadas ?? []).length !== 1) { fallos.push(`${l.clave ?? l.id}: otra persona lo está anulando`); continue; }

      let msg = "";
      if (p.estado === "pendiente") {
        cookieBodega ??= await sesionEn(Number(mapaBodega.erp_sucursal_id), login);
        try {
          const r = await pedir(cookieBodega, ANULAR, new URLSearchParams({ process: "anular", id_traslado: String(l.id_traslado) }),
            { extra: { Referer: `${BASE}/admin_traslados.php` } });
          try { msg = String(JSON.parse(r)?.msg ?? ""); } catch { msg = r.slice(0, 200); }
        } catch (e) {
          msg = e instanceof Error ? e.message : String(e);
        }
      }

      // Lo que se guarda es lo que el sistema dice DESPUÉS, no su «success».
      const despues = await estadoDeRecepcion(cookieSala!, String(l.id_traslado));
      if (despues === "anulado") {
        await anotar(
          admin.from("pedido_traslado_linea").update({
            estado: "anulada",
            detalle: { ...(l.detalle ?? {}), anulado_at: ahora(), anulado_por: usuario.id, respuesta_anular: msg || null },
            updated_at: ahora(),
          }).eq("id", l.id),
          `la anulación del traslado ${l.id_traslado}`,
        );
      } else {
        // No quedó anulado, o no se pudo confirmar. La línea vuelve a
        // `enviada` sólo si el sistema la sigue viendo pendiente; si no se
        // sabe, queda en error para mirarla a mano.
        await anotar(
          admin.from("pedido_traslado_linea").update(despues === "pendiente"
            ? { estado: "enviada", updated_at: ahora() }
            : { estado: "error", error_msg: `Se pidió anular y el sistema no lo confirmó (${despues}). Respuesta: ${msg}`.slice(0, 500), updated_at: ahora() },
          ).eq("id", l.id),
          `el resultado de anular el traslado ${l.id_traslado}`,
        );
        fallos.push(`${l.clave ?? l.id}: el sistema no lo dejó anulado${msg ? ` (${msg})` : ""}`);
      }
    }

    if (fallos.length > 0)
      return json({ ok: false, codigo: "NO_ANULADO", error: `No se pudo anular: ${fallos.join("; ")}. No se cerró nada en el portal.` }, 502);

    // ── Cerrar en el portal ───────────────────────────────────────────────
    const { data: cierre, error: cierreErr } = await admin.rpc("cerrar_no_reenviadas", {
      p_pedido_id: pedidoId, p_suc_id: sucId, p_labels: labels, p_actor: usuario.id,
    });
    if (cierreErr)
      return json({
        ok: false, codigo: "NO_CERRADO",
        error: `El traslado se anuló, pero no se pudo cerrar en el portal: ${cierreErr.message}`,
        anulados: plan.map((p) => p.linea.id_traslado),
      }, 500);

    return json({
      ok: true, items, labels,
      anulados: plan.filter((p) => p.estado === "pendiente").map((p) => p.linea.id_traslado),
      ya_anulados: plan.filter((p) => p.estado === "anulado").map((p) => p.linea.id_traslado),
      sin_traslado: vivas.length === 0,
      cierre,
    });
  } catch (e) {
    console.error("[no-reenviar-pedido-erp]", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
