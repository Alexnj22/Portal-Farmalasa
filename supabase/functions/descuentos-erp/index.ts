import {
  getCorsHeaders, getErpBranchMap, permisoDeModulo, requireActiveEmployeeUser,
} from "../_shared/security.ts";
import {
  borrarDescuento, contextoDelFormulario, detalleDelDescuento, getPromosCreds,
  getSessionCookie, guardarDescuento, listarDescuentos, productosDelDescuento,
  salasDelOrigen, type DescuentoDelOrigen, type TipoDescuento,
} from "../_shared/descuentos.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ═══════════════════════════════════════════════════════════════════════════
// DESCUENTOS POR PRODUCTO — verlos y configurarlos desde el portal.
//
// ── Por qué pasa por acá y no por el navegador ────────────────────────────
// El sistema de la caja no habla con el navegador de nadie: hay que entrar con
// credenciales propias. Y un descuento mal puesto VENDE A PÉRDIDA en las siete
// salas hasta que alguien lo note, así que el permiso, el alcance y las tres
// verificaciones se cobran del lado del servidor — no en un formulario que
// cualquiera puede saltarse cambiando el cuerpo de la petición.
//
// ── Las tres cosas que el portal sabe y el sistema de la caja no ──────────
//  1. **Cuánto queda el precio, y si cae bajo el costo.** El portal tiene
//     `product_precios` (`vineta` es el precio al público, `costo` el costo).
//     Un 29.67 % sobre $13.50 deja $9.49 contra un costo de $6.21 y está bien;
//     un 60 % dejaría $5.40 y se vende perdiendo. El origen no avisa nada.
//  2. **Si otro descuento ya toma ese producto en esas fechas.** Nada lo
//     impide allá, y cuando pasa el origen aplica UNO SOLO sin decir cuál.
//  3. **Quién lo hizo.** Allá todo queda a nombre de la cuenta con la que el
//     portal entra, que es una sola. La firma real vive en `audit_logs`.
//
// Los avisos NO bloquean: devuelven `avisos` y la pantalla pregunta. Un
// candado que espera a un tercero produce el atajo — ver
// [[feedback_una_verificacion_que_traba_la_accion_no_se_hace]] —, así que acá
// la persona confirma y sigue, pero queda escrito qué confirmó.
//
// ── Alcance ───────────────────────────────────────────────────────────────
// Con alcance de una sala sólo se ven y se tocan los descuentos de la propia,
// y no se puede crear uno «para todas»: el alcance lo decide el permiso, nunca
// lo que venga en el cuerpo de la petición.
// ═══════════════════════════════════════════════════════════════════════════

const json = (b: unknown, s = 200, h: HeadersInit = {}) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", ...h } });

const MODULO = "promociones";

/** Cuánto queda el precio con el descuento aplicado a UNA unidad. */
function precioConDescuento(precio: number, tipo: TipoDescuento, monto: number): number {
  return tipo === "%" ? precio * (1 - monto / 100) : precio - monto;
}

/** `[a1,a2]` y `[b1,b2]` se pisan, con los extremos incluidos. */
function seCruzan(a1: string, a2: string, b1: string, b2: string): boolean {
  return a1 <= b2 && b1 <= a2;
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const responder = (b: unknown, s = 200) => json(b, s, cors);

  try {
    const body = await req.json().catch(() => ({}));
    const accion = String(body.accion ?? "listar");

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const quien = await requireActiveEmployeeUser(req, admin);
    if (!quien) return responder({ ok: false, error: "Sesión inválida o empleado inactivo." }, 401);

    const escribe = accion === "guardar" || accion === "borrar";
    const permiso = await permisoDeModulo(
      admin, quien.id, MODULO, escribe ? "can_edit" : "can_view",
    );
    if (permiso.roto) return responder({ ok: false, error: permiso.roto }, 503);
    if (!permiso.puede) {
      return responder({
        ok: false,
        error: escribe
          ? "No tienes permiso para configurar descuentos."
          : "No tienes permiso para ver los descuentos.",
      }, 403);
    }

    const mapa = getErpBranchMap();
    const miSala = mapa.find((e) => e.branchId === Number(permiso.emp?.branch_id)) ?? null;
    if (!permiso.alcanceTodo && !miSala) {
      return responder({
        ok: false,
        error: "Tu ficha no tiene una sala del sistema de la caja asignada, así que no se pueden ver sus descuentos.",
      }, 409);
    }

    const { username, password } = getPromosCreds();
    const cookie = await getSessionCookie(username, password);
    const salas = await salasDelOrigen(cookie);

    /** Traduce la sala del origen a la del portal para que la pantalla no vea ids ajenos. */
    const conSala = (d: DescuentoDelOrigen) => ({
      ...d,
      branch_id: d.erp_sucursal_id === null
        ? null
        : (mapa.find((e) => e.erpId === d.erp_sucursal_id)?.branchId ?? null),
    });

    /** Los que esta persona puede ver: con alcance de una sala, los suyos y los de todas. */
    const visible = (d: DescuentoDelOrigen) =>
      permiso.alcanceTodo || d.todas_las_salas || d.erp_sucursal_id === miSala!.erpId;

    // ── LISTAR ─────────────────────────────────────────────────────────────
    //
    // Los productos se piden en paralelo —una petición por descuento— porque la
    // lista sin ellos no sirve para decidir: «5 productos» y cuáles es lo que
    // se mira antes de crear el siguiente. Hoy son 13.
    if (accion === "listar") {
      const filas = (await listarDescuentos(cookie, salas)).filter(visible);

      const productos = await Promise.all(
        filas.map((d) => productosDelDescuento(cookie, d.id).catch(() => [] as number[])),
      );

      const todosLosIds = [...new Set(productos.flat())];
      const nombres = new Map<number, string>();
      if (todosLosIds.length) {
        /* `products.id` ES el id del sistema de la caja, así que el nombre sale
           de la base del portal y no de otra petición al origen. */
        const { data, error } = await admin
          .from("products").select("id, nombre").in("id", todosLosIds);
        if (error) console.error("[descuentos-erp] products:", error.message);
        for (const p of data ?? []) nombres.set(Number(p.id), String(p.nombre));
      }

      /* De qué promoción es cada uno. Los que no tienen se muestran igual: son
         los que se crearon directamente en el sistema de ventas —13 al
         2026-09-04— y esconderlos dejaría descuentos vivos que el portal no
         nombra. */
      const dePromocion = new Map<number, string>();
      const { data: promos, error: promosErr } = await admin
        .from("promociones").select("nombre, descuento_erp_id")
        .in("descuento_erp_id", filas.length ? filas.map((d) => d.id) : [-1]);
      if (promosErr) console.error("[descuentos-erp] promociones:", promosErr.message);
      for (const p of promos ?? []) dePromocion.set(Number(p.descuento_erp_id), String(p.nombre));

      const hoy = new Date().toISOString().slice(0, 10);
      const descuentos = filas.map((d, i) => ({
        ...conSala(d),
        vigente: d.inicio <= hoy && hoy <= d.fin,
        promocion: dePromocion.get(d.id) ?? null,
        productos: productos[i].map((id) => ({
          id,
          nombre: nombres.get(id) ?? `Producto ${id}`,
        })),
      }));

      return responder({ ok: true, descuentos, alcance_todo: permiso.alcanceTodo });
    }

    // ── DETALLE ────────────────────────────────────────────────────────────
    if (accion === "detalle") {
      const id = Number(body.id);
      if (!Number.isInteger(id) || id <= 0) {
        return responder({ ok: false, error: "Falta el descuento que se quiere ver." }, 400);
      }
      const d = await detalleDelDescuento(cookie, id, salas);
      if (!d) return responder({ ok: false, error: "Ese descuento ya no existe." }, 404);
      if (!visible(d)) {
        return responder({ ok: false, error: "Ese descuento no es de tu sala." }, 403);
      }

      /* El error NO se descarta: sin nombres la pantalla muestra «Producto
         4792», que se lee como un producto que el portal no conoce y no como
         una consulta que falló. */
      const { data, error: prodErr } = await admin
        .from("products").select("id, nombre").in("id", d.productos.length ? d.productos : [-1]);
      if (prodErr) console.error("[descuentos-erp] products (detalle):", prodErr.message);
      const nombres = new Map((data ?? []).map((p) => [Number(p.id), String(p.nombre)]));

      return responder({
        ok: true,
        descuento: {
          ...conSala(d),
          productos: d.productos.map((id) => ({ id, nombre: nombres.get(id) ?? `Producto ${id}` })),
        },
      });
    }

    // ── GUARDAR ────────────────────────────────────────────────────────────
    if (accion === "guardar") {
      const id = Number(body.id ?? 0) || 0;
      const descripcion = String(body.descripcion ?? "").trim();
      const tipo = String(body.tipo ?? "") as TipoDescuento;
      const monto = Number(body.monto);
      const inicio = String(body.inicio ?? "");
      const fin = String(body.fin ?? "");
      const forzar = body.forzar === true;
      /* La promoción que lo pidió, cuando el descuento nace desde ella. Se
         guarda del lado del portal para que la pantalla de descuentos pueda
         decir de quién es cada uno, y para que un informe futuro pueda cruzar
         lo descontado con lo bonificado. */
      const promocionId = Number(body.promocion_id) || 0;

      const productos = [...new Set(
        (Array.isArray(body.productos) ? body.productos : [])
          .map((n: unknown) => Number(n))
          .filter((n: number) => Number.isInteger(n) && n > 0),
      )];

      /* El alcance manda sobre lo que venga en el cuerpo. Con una sola sala no
         se puede crear uno «para todas» ni ponerle la sala de otro. */
      const todas = permiso.alcanceTodo ? body.todas_las_salas === true : false;
      const branchPedido = Number(body.branch_id);
      const erpSucursal = permiso.alcanceTodo
        ? (todas
          ? (mapa.find((e) => e.branchId === branchPedido)?.erpId ?? mapa[0].erpId)
          : mapa.find((e) => e.branchId === branchPedido)?.erpId)
        : miSala!.erpId;

      // ── Lo que no se puede guardar de ninguna manera ─────────────────────
      const falta: string[] = [];
      if (!descripcion) falta.push("Ponle un nombre al descuento.");
      if (tipo !== "%" && tipo !== "$") falta.push("Elige si el descuento es por porcentaje o por monto.");
      if (!Number.isFinite(monto) || monto <= 0) falta.push("El descuento tiene que ser mayor que cero.");
      if (tipo === "%" && monto > 100) falta.push("Un porcentaje no puede pasar de 100.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio)) falta.push("Falta la fecha de inicio.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fin)) falta.push("Falta la fecha de fin.");
      if (inicio && fin && fin < inicio) falta.push("La fecha de fin no puede ser anterior a la de inicio.");
      if (!productos.length) falta.push("Agrega al menos un producto.");
      if (!erpSucursal) falta.push("Elige la sala.");
      if (falta.length) return responder({ ok: false, error: falta.join(" "), campos: falta }, 400);

      /* Si es una corrección, tiene que existir y ser suya. Sin esto,
         `promocion.php?id=<inexistente>` abre un formulario vacío y un `edit`
         sobre un id ajeno pasaría sin decir nada. */
      if (id > 0) {
        const previo = await detalleDelDescuento(cookie, id, salas);
        if (!previo) return responder({ ok: false, error: "Ese descuento ya no existe." }, 404);
        if (!visible(previo)) {
          return responder({ ok: false, error: "Ese descuento no es de tu sala." }, 403);
        }
      }

      // ── Los dos avisos: se confirman, no bloquean ────────────────────────
      const avisos: { tipo: string; texto: string }[] = [];

      if (!forzar) {
        // 1 · el precio queda bajo el costo
        const { data: precios, error: preciosErr } = await admin
          .from("product_precios")
          .select("product_id, vineta, costo, activo")
          .in("product_id", productos);
        if (preciosErr) console.error("[descuentos-erp] product_precios:", preciosErr.message);

        /* Acá el nombre ES el aviso: «quedaría en $1.29 y cuesta $6.21» sólo
           sirve si dice de QUÉ producto. Con la consulta fallada en silencio,
           el aviso saldría nombrando «Producto 4792» y quien decide no tendría
           cómo saber cuál mirar — así que si falla, se corta. */
        const { data: prods, error: prodsErr } = await admin
          .from("products").select("id, nombre").in("id", productos);
        if (prodsErr) {
          console.error("[descuentos-erp] products (guardar):", prodsErr.message);
          return responder({
            ok: false,
            error: "No se pudo leer el catálogo para revisar el descuento. Vuelve a intentar en un momento.",
          }, 503);
        }
        const nombres = new Map((prods ?? []).map((p) => [Number(p.id), String(p.nombre)]));

        /* Se mira el precio MÁS BAJO de cada producto: si el que menos margen
           tiene aguanta, todos aguantan. Y el costo más alto, por el mismo
           motivo — el peor caso es el que decide. */
        const porProducto = new Map<number, { precio: number; costo: number }>();
        for (const p of precios ?? []) {
          if (p.activo === false) continue;
          const pid = Number(p.product_id);
          const precio = Number(p.vineta) || 0;
          const costo = Number(p.costo) || 0;
          const antes = porProducto.get(pid);
          porProducto.set(pid, {
            precio: antes ? Math.min(antes.precio, precio) : precio,
            costo: antes ? Math.max(antes.costo, costo) : costo,
          });
        }

        for (const [pid, { precio, costo }] of porProducto) {
          if (!precio || !costo) continue;
          const queda = precioConDescuento(precio, tipo, monto);
          if (queda < costo) {
            avisos.push({
              tipo: "bajo_costo",
              texto: `${nombres.get(pid) ?? `Producto ${pid}`} quedaría en $${queda.toFixed(2)} y cuesta $${costo.toFixed(2)}.`,
            });
          }
        }

        // 2 · otro descuento ya toma ese producto en esas fechas
        const otros = (await listarDescuentos(cookie, salas))
          .filter((d) => d.id !== id)
          .filter((d) => seCruzan(inicio, fin, d.inicio, d.fin))
          .filter((d) => d.todas_las_salas || todas || d.erp_sucursal_id === erpSucursal);

        for (const otro of otros) {
          const suyos = await productosDelDescuento(cookie, otro.id).catch(() => [] as number[]);
          const chocan = suyos.filter((p) => productos.includes(p));
          if (!chocan.length) continue;
          const lista = chocan.map((p) => nombres.get(p) ?? `Producto ${p}`).join(", ");
          avisos.push({
            tipo: "solape",
            texto: `«${otro.descripcion}» (${otro.inicio} a ${otro.fin}) ya descuenta: ${lista}.`,
          });
        }

        if (avisos.length) return responder({ ok: false, avisos });
      }

      /* Los ids que HABÍA antes de escribir. Sólo al crear, y sólo para poder
         anotar cuál nació: el origen contesta «guardada correctamente» y no
         devuelve el id. Sin esto el alta queda en la bitácora sin número y no
         se puede cruzar con su propia corrección ni con su borrado. */
      const idsAntes = id > 0
        ? null
        : new Set((await listarDescuentos(cookie, salas)).map((d) => d.id));

      const ctx = await contextoDelFormulario(cookie);
      const r = await guardarDescuento(cookie, ctx, {
        id, descripcion, tipo, monto, inicio, fin,
        todas_las_salas: todas,
        erp_sucursal_id: erpSucursal!,
        productos,
      });
      if (!r.success) {
        return responder({ ok: false, error: r.msg || "El sistema de la caja no guardó el descuento." }, 502);
      }

      /* Se relee para saber el id y para CONFIRMAR: el mensaje del origen es
         genérico —contesta lo mismo al borrar—, así que lo que prueba que
         quedó es encontrarlo en la lista. Si no aparece, se dice; suponerlo
         guardado sería informar un éxito que nadie verificó. */
      let idNuevo = id;
      if (idsAntes) {
        const despues = await listarDescuentos(cookie, salas);
        const nacidos = despues.filter((d) => !idsAntes.has(d.id));
        if (!nacidos.length) {
          return responder({
            ok: false,
            error: "El sistema de la caja dijo que sí pero el descuento no aparece en la lista.",
          }, 502);
        }
        /* Si dos sesiones crearon a la vez puede haber más de uno nacido: se
           toma el mayor, que es el propio, y nunca se adivina por el nombre —
           dos descuentos pueden llamarse igual. */
        idNuevo = Math.max(...nacidos.map((d) => d.id));
      }

      /* El vínculo se escribe ACÁ y no desde el navegador: si el navegador se
         cierra entre las dos llamadas, el descuento quedaría vivo en el sistema
         de ventas sin que nadie sepa de qué promoción es. */
      if (promocionId > 0) {
        const { error: ligarErr } = await admin
          .from("promociones")
          .update({ descuento_erp_id: idNuevo })
          .eq("id", promocionId);
        if (ligarErr) console.error("[descuentos-erp] ligar promoción:", ligarErr.message);
      }

      /* Quién lo hizo NO queda en el sistema de la caja —allá todo va a nombre
         de la cuenta con la que el portal entra—, así que la firma vive acá. */
      const { error: auditErr } = await admin.from("audit_logs").insert({
        action: id > 0 ? "DESCUENTO_EDITADO" : "DESCUENTO_CREADO",
        target_id: String(idNuevo),
        user_id: quien.id,
        user_name: quien.name,
        source: "ADMIN_PANEL",
        severity: forzar && !permiso.alcanceTodo ? "WARNING" : "INFO",
        branch_id: permiso.emp?.branch_id ?? null,
        details: {
          descripcion, tipo, monto, inicio, fin,
          todas_las_salas: todas,
          erp_sucursal_id: erpSucursal,
          productos,
          confirmo_avisos: forzar,
          promocion_id: promocionId || null,
        },
      });
      if (auditErr) console.error("[descuentos-erp] audit_logs:", auditErr.message);

      return responder({ ok: true, id: idNuevo });
    }

    // ── BORRAR ─────────────────────────────────────────────────────────────
    if (accion === "borrar") {
      const id = Number(body.id);
      if (!Number.isInteger(id) || id <= 0) {
        return responder({ ok: false, error: "Falta el descuento que se quiere borrar." }, 400);
      }

      /* Se lee ANTES de borrar: para comprobar que existe, que es de su sala, y
         para poder escribir en la bitácora QUÉ se borró. Después del borrado ya
         no hay a quién preguntárselo. */
      const previo = await detalleDelDescuento(cookie, id, salas);
      if (!previo) return responder({ ok: false, error: "Ese descuento ya no existe." }, 404);
      if (!visible(previo)) {
        return responder({ ok: false, error: "Ese descuento no es de tu sala." }, 403);
      }

      const r = await borrarDescuento(cookie, id);
      if (!r.success) {
        return responder({ ok: false, error: r.msg || "El sistema de la caja no borró el descuento." }, 502);
      }

      /* El origen contesta «Promocion guardada correctamente» también al
         borrar: su mensaje es genérico. Lo que confirma el borrado es que ya no
         esté en la lista, así que se relee — igual que el abono de un crédito
         relee el saldo en vez de creerle al «success». */
      const sigue = (await listarDescuentos(cookie, salas)).some((d) => d.id === id);
      if (sigue) {
        return responder({ ok: false, error: "El sistema de la caja dijo que sí pero el descuento sigue ahí." }, 502);
      }

      const { error: auditErr } = await admin.from("audit_logs").insert({
        action: "DESCUENTO_BORRADO",
        target_id: String(id),
        user_id: quien.id,
        user_name: quien.name,
        source: "ADMIN_PANEL",
        severity: "WARNING",
        branch_id: permiso.emp?.branch_id ?? null,
        details: {
          descripcion: previo.descripcion, tipo: previo.tipo, monto: previo.monto,
          inicio: previo.inicio, fin: previo.fin,
          todas_las_salas: previo.todas_las_salas,
          productos: previo.productos,
        },
      });
      if (auditErr) console.error("[descuentos-erp] audit_logs:", auditErr.message);

      return responder({ ok: true });
    }

    return responder({ ok: false, error: `Acción desconocida: ${accion}` }, 400);
  } catch (e) {
    return responder({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
