import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireActiveEmployeeUser } from "../_shared/security.ts";
import { BASE, login, pedir, leerRespuesta } from "../_shared/erp-dte.ts";
import {
  CONCEPTO_MAX,
  hoySV,
  norm,
  pendientesDeOrigen,
  resolverPresentacion,
  sesionEn,
  soloAscii,
  traerFila,
  RECIBIR,
  TRASLADO,
} from "../_shared/erp-traslado.ts";

// Devuelve a Bodega lo que quedó de más en la sala después de contar la caja.
//
// ── El agujero que tapa ─────────────────────────────────────────────────────
// El traslado del pedido es todo o nada: la recepción ingresa la cantidad
// COMPLETA que salió de Bodega, aunque la sala haya contado menos. Hasta hoy la
// diferencia se anotaba en el portal y ahí moría — nunca tocaba las existencias.
// Si la sala contó 28 de 30, el sistema seguía diciendo 30 para siempre.
//
// Y esos 2 casi siempre están en Bodega: un faltante suele ser que se empacó de
// menos. Por eso la salida no es recibir menos —eso los haría desaparecer de los
// dos lados— sino devolverlos.
//
// ── Es el camino del rollback, con rastro ───────────────────────────────────
// `scripts/qa/rollback-traslado.mjs` ya hizo exactamente este viaje contra
// inventario real el 2026-08-11: sesión en la sala, traslado hacia Bodega, y
// —la mitad que se le había olvidado la primera vez— **recibirlo en Bodega**.
// Sin esa segunda mitad el producto queda en tránsito: fuera de la sala y
// todavía no en Bodega, que es peor que estar en cualquiera de los dos lados.
//
// Acá lo mismo deja de ser un guion de una vez y pasa a tener fila, candado,
// clave y freno.
//
// ── Por qué NO vive dentro de `trasladar-pedido-erp` ────────────────────────
// Aquella tiene el origen clavado en Bodega —lee `es_bodega` del mapa y arma
// todo alrededor de eso— y despacha 150 a 550 líneas en corridas que se
// retoman. Ésta va al revés (sale de la sala, entra a Bodega) y son un puñado
// de renglones con alguien mirando. Meterle un tercer sentido a la función que
// mueve el pedido entero, que recién estrenó su primera escritura real, es
// justo el cambio que no se hace en el mismo movimiento.
//
// ── Dos sabores, y la fila dice cuál ────────────────────────────────────────
// `viaja = false` (faltante): el producto NUNCA salió de Bodega. Nada viaja;
// es un arreglo en el sistema y Bodega lo confirma en el momento.
// `viaja = true` (dañado, vencido): el producto está en la sala y vuelve
// físicamente. Bodega lo confirma CUANDO LO TENGA.
// La función no decide eso —no puede saber cuándo llegó una caja—: lo dice la
// pantalla, para que nadie dé por recibido lo que va en el camión.

// Una devolución son pocos renglones y hay alguien esperando la respuesta, así
// que no hay background ni corrida que se retome: si no alcanza el tiempo se
// contesta qué se hizo y qué falta, y se vuelve a apretar.
const PRESUPUESTO_MS = 110_000;

// Más que el presupuesto de una invocación: una fila que lleva más de esto en
// 'enviando' es residuo de una corrida que murió, no de una en curso.
const CORTADA_MS = 5 * 60_000;

interface Devolucion {
  id: string;
  pedido_id: string;
  erp_sucursal_id: number;
  pedido_item_id: number;
  erp_product_id: number;
  motivo: string;
  viaja: boolean;
  cantidad: number;
  clave: string;
  estado: string;
  id_traslado: string | null;
}

/** La ubicación de trabajo de una sala (la de vencidos nunca es origen). */
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
    const ids: string[] = Array.isArray(cuerpo.devolucion_ids)
      ? cuerpo.devolucion_ids.map(String).filter(Boolean)
      : [];
    const accion = cuerpo.accion === "recibir" ? "recibir" : "enviar";
    // El simulacro es el valor por omisión a propósito: esta función mueve
    // inventario real, y escribir tiene que ser una decisión explícita. Hace
    // TODAS las verificaciones contra el sistema y no escribe ni una línea.
    const simulacro = cuerpo.simulacro !== false;

    if (ids.length === 0)
      return json({ ok: false, error: "No se dijo qué devolución." }, 400);
    if (ids.length > 50)
      return json({ ok: false, error: "Demasiadas devoluciones de una vez (máximo 50)." }, 400);

    // ── Quién llama. Nunca del payload: del JWT. ──────────────────────────
    const usuario = await requireActiveEmployeeUser(req, admin);
    if (!usuario) return json({ ok: false, error: "Sesión inválida o empleado inactivo." }, 401);
    const quien = { id: usuario.id, name: usuario.name };

    // ── El permiso es el del módulo Pedidos ───────────────────────────────
    // Se repite acá porque esta función usa la llave de servicio y el RLS no la
    // frena. Es el mismo que exige la recepción del pedido.
    const { data: emp } = await admin
      .from("employees").select("role_id, secondary_role_id, system_role, branch_id")
      .eq("id", quien.id).maybeSingle();
    const roles = [emp?.role_id, emp?.secondary_role_id].filter((r) => r != null);
    const { data: permisos } = await admin
      .from("role_permissions").select("can_edit, scope")
      .in("role_id", roles.length ? roles : [-1])
      .eq("module_key", "pedidos");
    if (!(emp?.system_role === "SUPERADMIN" || (permisos ?? []).some((p) => p.can_edit)))
      return json({ ok: false, error: "No tienes permiso de edición en Pedidos." }, 403);
    const alcanceTodo = emp?.system_role === "SUPERADMIN"
      || (permisos ?? []).some((p) => p.can_edit && p.scope === "ALL");

    // ── El mapa manda de dónde sale y a dónde entra ───────────────────────
    // La ubicación es una propiedad de la sala, nunca un dato del navegador:
    // pedírsela sería dejar que elija de dónde sacar el producto.
    const { data: mapas, error: mapaErr } = await admin
      .from("erp_sucursal_map")
      .select("erp_sucursal_id, nombre, es_bodega, branch_id, inv_ubicaciones");
    if (mapaErr) throw mapaErr;
    const mapaBodega = (mapas ?? []).find((m) => m.es_bodega) ?? null;
    if (!mapaBodega)
      return json({ ok: false, error: "No hay una bodega marcada en el mapa de salas." }, 422);

    const erpBodega = Number(mapaBodega.erp_sucursal_id);
    // Decisión del usuario (2026-08-12): TODO entra a la ubicación de trabajo,
    // también lo dañado y lo vencido. Bodega mueve después lo que no sirva —y
    // es la única entrada probada contra el sistema.
    const ubicBodega = ubicacionDeTrabajo(mapaBodega);
    if (!ubicBodega)
      return json({ ok: false, error: "No se conoce la ubicación de trabajo de la bodega." }, 422);

    // La devolución entra a Bodega, así que la mueve y la recibe Bodega. Es la
    // misma regla del traslado entre salas: decide quien va a recibir.
    if (!alcanceTodo && Number(emp?.branch_id ?? 0) !== Number(mapaBodega.branch_id ?? -1))
      return json({
        ok: false,
        error: "La devolución la maneja Bodega, que es donde entra el producto.",
      }, 403);

    // ── Interruptor de pausa ──────────────────────────────────────────────
    // FALLA CERRADO: si no se puede leer, no se mueve nada. Un producto que no
    // se movió se mueve después; uno que se movió de más hay que ir a buscarlo.
    // El simulacro sigue permitido —no escribe— para poder mirar cómo quedó
    // todo mientras está pausado.
    if (!simulacro) {
      const llave = accion === "recibir" ? "devolver_recibir" : "devolver_enviar";
      const { data: sw, error: swErr } = await admin
        .from("traslado_interruptor").select("pausado, motivo").eq("accion", llave).maybeSingle();
      if (swErr || !sw)
        return json({
          ok: false, codigo: "INTERRUPTOR_ILEGIBLE",
          error: "No se pudo comprobar si las devoluciones están pausadas. No se movió nada.",
        }, 503);
      if (sw.pausado)
        return json({
          ok: false, codigo: "DEVOLUCIONES_PAUSADAS",
          error: accion === "recibir"
            ? `La entrada de devoluciones está pausada${sw.motivo ? `: ${sw.motivo}` : "."}`
            : `La salida de devoluciones está pausada${sw.motivo ? `: ${sw.motivo}` : "."}`,
        }, 409);
    }

    const { data: devsRaw, error: devErr } = await admin
      .from("pedido_devolucion")
      .select("id, pedido_id, erp_sucursal_id, pedido_item_id, erp_product_id, "
            + "motivo, viaja, cantidad, clave, estado, id_traslado, detalle, updated_at")
      .in("id", ids);
    if (devErr) throw devErr;
    const devs = (devsRaw ?? []) as (Devolucion & { detalle: Record<string, unknown> | null; updated_at: string })[];
    if (devs.length === 0)
      return json({ ok: false, codigo: "NO_EXISTE", error: "Esas devoluciones no existen." }, 404);

    // Una fila que quedó en 'enviando' o 'recibiendo' es residuo de una corrida
    // que murió justo entre que el sistema escribió y que alcanzamos a anotarlo.
    // NO se reintenta a ciegas: reintentar movería el producto dos veces y eso
    // no se deshace solo. Se marca para que alguien la mire con la clave en la
    // mano, que es lo que permite encontrarla en el sistema.
    const corte = new Date(Date.now() - CORTADA_MS).toISOString();
    await admin.from("pedido_devolucion")
      .update({
        estado: "error",
        detalle: { revisar_a_mano: true },
        error_msg: "La corrida anterior se cortó mientras se movía este producto. Hay que verificar "
          + "en el sistema si el movimiento entró (buscar la clave en el concepto) antes de "
          + "reintentarlo — reintentar a ciegas lo movería dos veces.",
        updated_at: new Date().toISOString(),
      })
      .in("id", devs.map((d) => d.id))
      .in("estado", ["enviando", "recibiendo"])
      .lt("updated_at", corte);

    const hechas: Record<string, unknown>[] = [];
    const fallos: { clave: string; error: string }[] = [];
    const pendientes: string[] = [];

    // ══════════════════════════════════════════════════════════════════════
    // PASO 2 · RECIBIR — en Bodega
    // ══════════════════════════════════════════════════════════════════════
    //
    // Sin esto la devolución deja el producto en tránsito. Es el error exacto
    // que tuvo el guion de rollback hasta que se le agregó esta mitad, y el
    // motivo de que esta pieza fuera lo primero de la lista.
    if (accion === "recibir") {
      const aRecibir = devs.filter((d) => d.estado === "enviada" && d.id_traslado);
      if (aRecibir.length === 0)
        return json({
          ok: false, codigo: "NADA_QUE_RECIBIR",
          error: "Ninguna de esas devoluciones tiene un movimiento despachado que recibir.",
        }, 409);

      const cookie = await sesionEn(erpBodega, login);

      for (const d of aRecibir) {
        if (Date.now() - arranque > PRESUPUESTO_MS) { pendientes.push(d.clave); continue; }

        // Se toma la fila ANTES de tocar el sistema. Dos personas de Bodega
        // confirmando a la vez pasarían las dos la lectura de arriba; acá la
        // segunda no entra. Recibir dos veces duplicaría la existencia.
        if (!simulacro) {
          const { data: tomada } = await admin.from("pedido_devolucion")
            .update({ estado: "recibiendo", updated_at: new Date().toISOString() })
            .eq("id", d.id).eq("estado", "enviada")
            .select("id").maybeSingle();
          if (!tomada) continue;
        }

        const pagina = await pedir(cookie, `${RECIBIR}?id_movimiento=${encodeURIComponent(String(d.id_traslado))}`,
          undefined, { extra: { Referer: `${BASE}/admin_traslados.php` } });

        const filas = [...pagina.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/g)]
          .map((m) => m[0]).filter((tr) => /class="id_p"/.test(tr));

        if (filas.length === 0) {
          // Un movimiento ya recibido deja de mostrar líneas. No es un error del
          // portal: es que alguien lo recibió por el sistema. Se anota como
          // recibido para que la devolución no quede colgada esperándolo.
          if (!simulacro) {
            await admin.from("pedido_devolucion").update({
              estado: "recibida", recibido_at: new Date().toISOString(), recibido_por: quien.id,
              aviso: "Ya no mostraba líneas: se había recibido o anulado desde el sistema.",
              updated_at: new Date().toISOString(),
            }).eq("id", d.id);
            await admin.rpc("cerrar_item_por_devolucion", { p_devolucion_id: d.id, p_actor: quien.id });
          }
          hechas.push({ clave: d.clave, ya_estaba: true });
          continue;
        }

        // Se recibe COMPLETO lo que se despachó: la devolución ya salió de la
        // sala con la cantidad acordada, y recibir de menos volvería a partir en
        // dos el mismo producto.
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
          // RECIBIDO. Mismo lugar del string que en la salida, otro significado.
          partes.push([idProd, compra, venta, esp, unidad, vence, idPres, esp].join("|"));
          total += Number(compra) * Number(esp);
        }

        if (partes.length === 0) {
          if (!simulacro) {
            await admin.from("pedido_devolucion")
              .update({ estado: "enviada", updated_at: new Date().toISOString() }).eq("id", d.id);
          }
          fallos.push({ clave: d.clave, error: "No se pudo leer ni una línea del movimiento." });
          continue;
        }

        if (simulacro) {
          hechas.push({ clave: d.clave, lineas: partes.length, simulacro: true });
          continue;
        }

        const concepto = soloAscii(`${d.clave} recibe: ${quien.name}`).slice(0, CONCEPTO_MAX);
        const resp = leerRespuesta(await pedir(cookie, RECIBIR, new URLSearchParams({
          process: "insert",
          datos: partes.join("#") + "#",
          cuantos: String(partes.length),
          total: total.toFixed(4),
          fecha: hoySV(),
          concepto,
          destino: String(ubicBodega),
          id_traslado: String(d.id_traslado),
        }), { extra: { Referer: RECIBIR } }));

        if (!resp.ok) {
          // Vuelve a 'enviada': el movimiento sigue vivo y se puede reintentar.
          await admin.from("pedido_devolucion")
            .update({ estado: "enviada", error_msg: resp.msg || "El sistema no aceptó la entrada.",
                      updated_at: new Date().toISOString() })
            .eq("id", d.id);
          fallos.push({ clave: d.clave, error: resp.msg || "sin detalle" });
          continue;
        }

        await admin.from("pedido_devolucion").update({
          estado: "recibida",
          recibido_at: new Date().toISOString(),
          recibido_por: quien.id,
          error_msg: null,
          updated_at: new Date().toISOString(),
        }).eq("id", d.id);

        // El renglón del pedido se cierra recién ACÁ: cuando el producto entró
        // del otro lado, no cuando la sala lo pidió ni cuando Bodega aceptó.
        const { error: cerrarErr } = await admin
          .rpc("cerrar_item_por_devolucion", { p_devolucion_id: d.id, p_actor: quien.id });
        if (cerrarErr) {
          // El producto YA entró: esto no se puede deshacer ni callar. Queda el
          // aviso en la fila para que se vea que el renglón no cerró solo.
          await admin.from("pedido_devolucion")
            .update({ aviso: `Entró en Bodega, pero el renglón del pedido no cerró: ${cerrarErr.message}`,
                      updated_at: new Date().toISOString() })
            .eq("id", d.id);
        }

        hechas.push({ clave: d.clave, lineas: partes.length, msg: resp.msg });
      }

      return json({
        ok: fallos.length === 0,
        accion: "recibir", simulacro,
        recibidas: hechas.length, hechas, fallos, pendientes,
      }, fallos.length === 0 ? 200 : 207);
    }

    // ══════════════════════════════════════════════════════════════════════
    // PASO 1 · ENVIAR — sale de la sala hacia Bodega
    // ══════════════════════════════════════════════════════════════════════
    const aEnviar = devs.filter((d) =>
      d.estado === "aceptada"
      || (d.estado === "error" && !d.id_traslado && !(d.detalle as { revisar_a_mano?: boolean } | null)?.revisar_a_mano)
    );
    if (aEnviar.length === 0)
      return json({
        ok: false, codigo: "NADA_QUE_ENVIAR",
        error: "Ninguna de esas devoluciones está aceptada y lista para salir.",
      }, 409);

    // Los datos del renglón: la presentación y el factor con los que el producto
    // vive en el sistema. `dispatch_tipo`/`dispatch_factor` son la comodidad
    // para armar cajas, y confundirlos movería una cantidad distinta.
    const { data: items, error: itemsErr } = await admin
      .from("pedido_items")
      .select("id, factor, erp_presentacion_id, products ( nombre ), presentaciones!erp_presentacion_id ( tipo )")
      .in("id", aEnviar.map((d) => d.pedido_item_id));
    if (itemsErr) throw itemsErr;
    const porItem = new Map((items ?? []).map((r: Record<string, unknown>) => [Number(r.id), {
      factor: r.factor == null ? 0 : Number(r.factor),
      nombre: String((r.products as { nombre?: string } | null)?.nombre ?? r.id),
      tipo: String((r.presentaciones as { tipo?: string } | null)?.tipo ?? ""),
    }]));

    // Los lotes con los que el producto LLEGÓ. Salen de lo que de verdad se
    // movió al despachar, no de lo que el pedido había reservado: entre una cosa
    // y la otra Bodega se mueve, y `pedido_traslado_linea.detalle` es el registro
    // de lo que salió.
    const { data: lineasIda } = await admin
      .from("pedido_traslado_linea")
      .select("pedido_item_id, detalle")
      .in("pedido_item_id", aEnviar.map((d) => d.pedido_item_id));
    const lotesDeIda = new Map(
      (lineasIda ?? []).map((l: Record<string, unknown>) => [
        Number(l.pedido_item_id),
        (((l.detalle as { renglones?: { lote?: string | null; cantidad?: number }[] } | null)?.renglones) ?? []),
      ]),
    );

    // Una sesión por sala: la sucursal es estado GLOBAL de la sesión del
    // sistema, y estas devoluciones salen de la sala, no de Bodega.
    const porSala = new Map<number, typeof aEnviar>();
    for (const d of aEnviar) {
      const lista = porSala.get(d.erp_sucursal_id) ?? [];
      lista.push(d);
      porSala.set(d.erp_sucursal_id, lista);
    }

    for (const [erpSala, lista] of porSala) {
      const mapaSala = (mapas ?? []).find((m) => m.erp_sucursal_id === erpSala) ?? null;
      const ubicSala = ubicacionDeTrabajo(mapaSala);
      if (!ubicSala) {
        for (const d of lista) fallos.push({ clave: d.clave, error: `No se conoce la ubicación de la sala ${erpSala}.` });
        continue;
      }

      const cookie = await sesionEn(erpSala, login);
      // La foto de los pendientes: el movimiento nuevo es el que no estaba. El
      // `insert` no devuelve el id y el listado ignora el orden que se le pide.
      let conocidos = await pendientesDeOrigen(cookie, ubicSala);

      for (const d of lista) {
        if (Date.now() - arranque > PRESUPUESTO_MS) { pendientes.push(d.clave); continue; }

        const it = porItem.get(d.pedido_item_id);
        if (!it || !it.factor || !it.tipo) {
          fallos.push({ clave: d.clave, error: "El renglón del pedido no guardó presentación o factor." });
          continue;
        }

        const fallar = async (msg: string) => {
          fallos.push({ clave: d.clave, error: msg });
          if (!simulacro) {
            await admin.from("pedido_devolucion")
              .update({ estado: "error", error_msg: msg, updated_at: new Date().toISOString() })
              .eq("id", d.id);
          }
        };

        // Se toma la fila ANTES de tocar el sistema: si esto no escribe, nadie
        // más la agarra, y si el worker muere después queda la marca.
        if (!simulacro) {
          const { data: tomada } = await admin.from("pedido_devolucion")
            .update({ estado: "enviando", error_msg: null, detalle: null, updated_at: new Date().toISOString() })
            .eq("id", d.id).eq("estado", d.estado)
            .select("id").maybeSingle();
          if (!tomada) continue;   // otra persona se la llevó
        }

        const f = await traerFila(cookie, d.erp_product_id, ubicSala);
        if (!f.encontrado) { await fallar(`${it.nombre} ya no tiene existencia en la sala.`); continue; }

        const pres = await resolverPresentacion(cookie, f, it.tipo, it.factor);
        if (!pres) {
          await fallar(`${it.nombre}: llegó como ${it.tipo} de ${it.factor}, y hoy ninguna presentación `
            + `con ese nombre trae ese factor. Ofrece: ${f.presentaciones.map((p) => p.tipo).join(", ") || "ninguna"}.`);
          continue;
        }

        const enUnidades = Number(d.cantidad) * Number(pres.unidad);
        if (enUnidades > f.existencia) {
          await fallar(`En la sala quedan ${f.existencia} unidades de ${it.nombre} y la devolución `
            + `son ${d.cantidad} × ${pres.unidad} = ${enUnidades}.`);
          continue;
        }

        // ── El lote ───────────────────────────────────────────────────────
        // Vuelve con el MISMO lote con el que llegó. Es lo que de verdad está en
        // la sala, y devolver un lote distinto del que salió deja las dos salas
        // cuadradas en total y torcidas por lote — que es peor, porque no se ve.
        const renglones: { cantidad: number; idLote: string; lote: string | null }[] = [];
        const avisos: string[] = [];

        if (!f.regulado) {
          renglones.push({ cantidad: Number(d.cantidad), idLote: "0", lote: null });
        } else {
          let resto = Number(d.cantidad);
          const usados = new Set<string>();

          for (const r of (lotesDeIda.get(d.pedido_item_id) ?? [])) {
            if (resto <= 0) break;
            const numero = String(r?.lote ?? "");
            if (!numero) continue;
            const lote = f.lotes.find((x) => norm(x.numero) === norm(numero));
            if (!lote) {
              avisos.push(`el lote ${numero} con el que llegó ya no está en la sala`);
              continue;
            }
            const cabe = Math.floor(lote.stock / Number(pres.unidad));
            const toma = Math.min(resto, cabe);
            if (toma <= 0) { avisos.push(`el lote ${lote.numero} quedó sin existencia suficiente`); continue; }
            renglones.push({ cantidad: toma, idLote: lote.id, lote: lote.numero });
            usados.add(lote.id);
            resto -= toma;
          }

          // Lo que no se pudo cubrir con los lotes de ida sale del que vence
          // primero entre los que hay. Frenar acá sería frenar producto que sí
          // está en el estante — la misma decisión que en el despacho: mover y
          // AVISAR.
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
              avisos.push(`se devolvieron ${toma} del lote ${lote.numero} (vence ${lote.vence || "sin fecha"}), `
                + `que no es con el que llegó`);
              resto -= toma;
            }
          }

          if (resto > 0) {
            await fallar(`Ningún lote de ${it.nombre} en la sala alcanza para las ${d.cantidad} de la `
              + `devolución: faltan ${resto}. Hay: ${f.lotes.map((x) => `${x.numero} (${x.stock})`).join(", ") || "ninguno"}.`);
            continue;
          }
        }

        if (simulacro) {
          hechas.push({
            clave: d.clave, producto: it.nombre, cantidad: d.cantidad,
            presentacion: `${it.tipo} (${pres.unidad})`,
            renglones, avisos, existencia_previa: f.existencia, simulacro: true,
          });
          continue;
        }

        // El vale se lee de la página y no se inventa: es un `uniqid()` que el
        // servidor pre-rellena en cada carga. Uno por movimiento.
        const html = await pedir(cookie, TRASLADO, undefined, { extra: { Referer: `${BASE}/dashboard.php` } });
        const vale = html.match(/numero_vale["'][^>]*value=["']([^"']+)["']/)?.[1] ?? "";
        if (!vale) { await fallar("El sistema no entregó el número de vale."); continue; }

        // La CLAVE va primero en el concepto: es lo que permite encontrar este
        // movimiento en el sistema y lo que se busca antes de reintentar una
        // línea cortada, para no moverla dos veces.
        const concepto = soloAscii(
          `${d.clave} Devuelve ${mapaSala?.nombre ?? erpSala} a Bodega - ${d.motivo} - ${it.nombre}`,
        ).slice(0, CONCEPTO_MAX);

        const total = renglones.reduce((s, r) => s + Number(pres.costo || 0) * r.cantidad, 0);
        const datos = renglones.map((r) => [
          d.erp_product_id, pres.costo, pres.precio, r.cantidad, pres.unidad,
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
          origen: String(ubicSala),          // la UBICACIÓN de donde sale
          id_suc_destino: String(erpBodega), // la SALA que recibe
          id_ubicacion_destino: "0",
          numero_vale: vale,
        }), { extra: { Referer: TRASLADO } }));

        if (!resp.ok) {
          await fallar(`El sistema no aceptó la devolución: ${resp.msg || "sin detalle"}`);
          continue;
        }

        const despues = await pendientesDeOrigen(cookie, ubicSala);
        const nuevos = [...despues.keys()].filter((id) => !conocidos.has(id));
        conocidos = despues;
        const idTraslado = nuevos.length === 1 ? nuevos[0] : null;

        await admin.from("pedido_devolucion").update({
          estado: "enviada",
          id_traslado: idTraslado,
          numero_vale: vale,
          enviado_at: new Date().toISOString(),
          enviado_por: quien.id,
          aviso: avisos.length ? avisos.join(" · ") : null,
          detalle: {
            producto: it.nombre,
            presentacion: `${it.tipo} (${pres.unidad})`,
            id_presentacion_erp: pres.id,
            renglones,
            concepto,
            existencia_previa: f.existencia,
            regulado: f.regulado,
            erp_sucursal_origen: erpSala,
            erp_ubicacion_origen: ubicSala,
          },
          // El movimiento ENTRÓ igual; lo único que falta es su número para
          // poder recibirlo desde el portal. Se dice, no se calla.
          error_msg: idTraslado ? null
            : `Entró, pero no se pudo distinguir cuál es entre ${nuevos.length} candidatos. `
              + `Buscar «${d.clave}» en el concepto.`,
          updated_at: new Date().toISOString(),
        }).eq("id", d.id);

        hechas.push({
          clave: d.clave, producto: it.nombre, cantidad: d.cantidad,
          id_traslado: idTraslado, renglones, avisos, viaja: d.viaja,
        });
      }
    }

    return json({
      ok: fallos.length === 0,
      accion: "enviar", simulacro,
      enviadas: hechas.length, hechas, fallos, pendientes,
    }, fallos.length === 0 ? 200 : 207);

  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
