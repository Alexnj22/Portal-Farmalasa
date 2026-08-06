import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireActiveEmployeeUser } from "../_shared/security.ts";
import { BASE, login, pedir, leerRespuesta } from "../_shared/erp-dte.ts";

// Aplica en el ERP la carga o el descarte de inventario que el supervisor
// aprobó. Cuarta pieza de la misma familia que `aplicar-solicitud-facturacion`,
// y por eso reusa `_shared/erp-dte.ts` en vez de copiarlo.
//
// ── El orden importa: primero el ERP, después APPROVED ─────────────────────
// Si se marcara APPROVED antes y el ERP fallara, quedaría una solicitud que
// dice "aplicada" sobre un inventario intacto — y nadie volvería a mirarla.
//
// ── La sucursal es estado de SESIÓN, al revés que en DTE ───────────────────
// Verificado el 2026-08-06 recorriendo las 7: `ingreso_inventario.php` y
// `descargo_inventario.php` no aceptan la sucursal como parámetro; siguen a la
// sesión, y su <select> de ubicación solo ofrece la de esa sucursal. Hay que
// pasar por `cambio_sesion.php` antes.
//
// Y como esa sucursal es estado GLOBAL de la sesión PHP, cada invocación abre
// su PROPIA sesión con `login()`. Compartir una cookie entre sucursales sería
// que dos aplicaciones simultáneas se pisen el contexto y una termine
// escribiendo en la sucursal de la otra. No cachear la cookie acá.
//
// ── Las trampas del ERP que ya costaron caro ───────────────────────────────
//  1. Contesta HTTP 200 con {"typeinfo":"Error"} cuando rechaza. Hay que leer
//     el cuerpo: un rechazo silencioso se ve igual que un éxito.
//  2. La presentación NO se elige por posición. `consultar_stock` devuelve un
//     <select> en HTML con opciones de etiqueta idéntica, y el orden cambia
//     entre la pantalla de carga y la de descarte. Acá se exige que el
//     `id_presentacion` de la solicitud esté ENTRE las que el ERP ofrece.
//  3. El costo y el precio salen del ERP, no de la solicitud: un descarte no
//     debe poder mover precios de paso.

// La carga tiene DOS destinos posibles en el ERP: si la ubicación elegida es la
// local de la sucursal (`t='l'` en su <option>) va a `ingreso_inventario.php`, y
// si no, a `ingreso_sucursal.php`, que es un traslado. Acá siempre es la
// primera: la ubicación sale de `erp_sucursal_map`, que solo tiene las locales
// de cada sucursal. Un traslado entre sucursales es otra operación y otro
// widget.
const INGRESO  = `${BASE}/ingreso_inventario.php`;
const DESCARGO = `${BASE}/descargo_inventario.php`;
const SESION   = `${BASE}/cambio_sesion.php`;

// Una Edge Function vive 150 s. Cada paso contra el ERP tarda ~0.3 s medido, y
// una solicitud grande necesita un `consultar_stock` por línea. El presupuesto
// se corta ANTES de empezar otra línea para que siempre alcance a contestar.
const PRESUPUESTO_MS = 110_000;

// El ERP no declara cuánto aguanta el `concepto` y no hay forma de leerlo sin
// escribir. Se recorta a un largo conservador y —regla de la casa— se AVISA
// cuando pasa: un tope callado se lee como que entró completo. El texto íntegro
// queda siempre en la solicitud, que es el registro de verdad.
const CONCEPTO_MAX = 200;

interface Linea {
  erp_product_id: number;
  id_presentacion: number;
  cantidad: number;
  numero_lote?: string;
  id_lote?: number;
  vence?: string;
  descripcion?: string;
}

/** Lo que `consultar_stock` contesta, ya sin el HTML. */
interface Consulta {
  ok: boolean;
  msg: string;
  presentaciones: string[];
  costo: string;
  precio: string;
  unidad: string;
  stock: number | null;
  perecedero: boolean;
}

function leerConsulta(cuerpo: string): Consulta {
  let j: Record<string, unknown>;
  try { j = JSON.parse(cuerpo); } catch {
    return { ok: false, msg: `Respuesta ilegible del ERP: ${cuerpo.slice(0, 160)}`,
             presentaciones: [], costo: "", precio: "", unidad: "", stock: null, perecedero: false };
  }
  // `ingreso_inventario.php` contesta con typeinfo; el descargo también. Si no
  // viene, la respuesta igual sirve mientras traiga el producto.
  const tipo = String(j.typeinfo ?? "").toLowerCase();
  const ok   = tipo ? tipo === "success" : Boolean(j.id_p);
  const sel  = String(j.select ?? "");
  return {
    ok,
    msg: String(j.msg ?? ""),
    presentaciones: [...sel.matchAll(/<option value='(\d+)'/g)].map((m) => m[1]),
    costo:  String(j.costop ?? ""),
    precio: String(j.preciop ?? ""),
    unidad: String(j.unidadp ?? "1"),
    stock:  j.stock === undefined ? null : Number(j.stock),
    perecedero: String(j.perecedero ?? "0") === "1",
  };
}

/** La fecha de El Salvador (UTC-6 todo el año), en yyyy-mm-dd. */
function hoySV(): string {
  const t = new Date(Date.now() - 6 * 60 * 60 * 1000);
  return t.toISOString().slice(0, 10);
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
    // aprueba sale del JWT y no se recibe nunca por parámetro.
    const { request_id, approver_note } = await req.json().catch(() => ({}));
    if (!request_id) return json({ ok: false, error: "Falta request_id." }, 400);

    // ── Quién llama. Nunca del payload: del JWT. ──────────────────────────
    const aprobador = await requireActiveEmployeeUser(req, admin);
    if (!aprobador) return json({ ok: false, error: "Sesión inválida o empleado inactivo." }, 401);

    // ── Y si puede aprobar. El cliente no opina sobre esto. ───────────────
    const { data: emp } = await admin
      .from("employees").select("role_id").eq("id", aprobador.id).maybeSingle();
    const { data: permiso } = await admin
      .from("role_permissions").select("can_approve")
      .eq("role_id", emp?.role_id ?? -1)
      .eq("module_key", "requests")
      .maybeSingle();
    if (!permiso?.can_approve)
      return json({ ok: false, error: "No tenés permiso para aprobar solicitudes." }, 403);

    // ── La solicitud se relee de la BD, no se recibe ──────────────────────
    const { data: sol, error: solErr } = await admin
      .from("approval_requests")
      .select("id, type, status, employee_id, note, metadata")
      .eq("id", request_id)
      .maybeSingle();
    if (solErr) throw solErr;
    if (!sol) return json({ ok: false, error: "La solicitud no existe." }, 404);

    const esCarga = sol.type === "INVENTORY_LOAD_REQUEST";
    if (!esCarga && sol.type !== "INVENTORY_DISCARD_REQUEST")
      return json({
        ok: false, codigo: "TIPO_NO_AUTOMATIZADO",
        error: `El tipo ${sol.type} no se aplica desde acá.`,
      }, 422);
    if (sol.status !== "PENDING")
      return json({ ok: false, error: `La solicitud ya está ${sol.status}.` }, 409);

    const meta = (typeof sol.metadata === "string" ? JSON.parse(sol.metadata) : sol.metadata) ?? {};
    const lineas: Linea[] = Array.isArray(meta.items) ? meta.items : [];
    if (lineas.length === 0)
      return json({ ok: false, error: "La solicitud no tiene ni un producto." }, 422);

    const erpSucursal = Number(meta.erp_sucursal_id);
    const erpUbicacion = Number(meta.erp_ubicacion_id);
    if (!erpSucursal || !erpUbicacion)
      return json({ ok: false, error: "La solicitud no trae la sucursal o la ubicación." }, 422);

    // ── El concepto: causa, quién pide y quién aprueba ────────────────────
    // Es lo único que viaja al asiento del ERP, así que carga la trazabilidad
    // entera. La causa se recorta antes que los nombres: sin ellos el asiento
    // deja de decir quién respondió por el movimiento.
    const { data: solicitante } = await admin
      .from("employees").select("name").eq("id", sol.employee_id).maybeSingle();
    const causa = String(meta.reason ?? sol.note ?? "").trim();
    const firma = ` · Solicita: ${solicitante?.name ?? "—"} · Aprueba: ${aprobador.name}`;
    const cabeza = esCarga ? "CARGA" : String(meta.subtipo ?? "DESCARTE");
    const espacio = CONCEPTO_MAX - cabeza.length - firma.length - 3;
    const causaCorta = causa.length > espacio ? causa.slice(0, Math.max(0, espacio - 1)) + "…" : causa;
    const concepto = `${cabeza} · ${causaCorta}${firma}`;
    const conceptoRecortado = causaCorta !== causa;

    // ── Una sesión propia, y la sucursal antes que nada ───────────────────
    const cookie = await login();
    const rSesion = await pedir(cookie, SESION, new URLSearchParams({
      process: "set_sucursal", id_sucursal: String(erpSucursal),
    }), { extra: { Referer: `${BASE}/dashboard.php` } });
    let sesionOk = false;
    try { sesionOk = Boolean(JSON.parse(rSesion)?.success); } catch { sesionOk = false; }
    if (!sesionOk)
      return json({
        ok: false,
        error: `No se pudo abrir la sucursal ${erpSucursal}: ${rSesion.slice(0, 120)}`,
      }, 502);

    // ── Cada línea se confirma contra el ERP antes de armar el envío ──────
    const pagina = esCarga ? INGRESO : DESCARGO;
    const partes: string[] = [];
    const detalle: Record<string, unknown>[] = [];
    let total = 0;
    let unidades = 0;
    let cortadoEn = -1;

    for (let i = 0; i < lineas.length; i++) {
      if (Date.now() - arranque > PRESUPUESTO_MS) { cortadoEn = i; break; }
      const l = lineas[i];

      const cuerpo = await pedir(cookie, pagina, new URLSearchParams({
        process: "consultar_stock",
        tipo: "D",
        id_producto: String(l.erp_product_id),
        ...(esCarga ? {} : { ubicacion: String(erpUbicacion) }),
      }), { extra: { Referer: pagina } });
      const c = leerConsulta(cuerpo);

      if (!c.ok)
        return json({
          ok: false,
          error: `El sistema no reconoce el producto ${l.erp_product_id}${c.msg ? `: ${c.msg}` : ""}.`,
        }, 502);

      // La presentación tiene que ser una de las que el ERP ofrece para ESE
      // producto. Sin este chequeo, un id viejo o de otro producto entra sin
      // protesta y el movimiento queda contra la presentación equivocada.
      if (c.presentaciones.length && !c.presentaciones.includes(String(l.id_presentacion)))
        return json({
          ok: false,
          error: `La presentación elegida ya no existe para ${l.descripcion ?? l.erp_product_id}.`,
        }, 409);

      // El descarte no puede sacar más de lo que hay. Se relee ACÁ y no al
      // crear la solicitud: entre pedirla y aprobarla se vendió, se trasladó o
      // alguien más descartó. El ERP es el que sabe.
      if (!esCarga && c.stock !== null && l.cantidad > c.stock)
        return json({
          ok: false, codigo: "SIN_EXISTENCIA",
          error: `De ${l.descripcion ?? l.erp_product_id} quedan ${c.stock}, y se pidieron ${l.cantidad}.`,
        }, 409);

      // Un perecedero cargado sin fecha de vencimiento queda sin control de
      // caducidad, que es justo lo que el módulo existe para vigilar.
      if (esCarga && c.perecedero && !l.vence)
        return json({
          ok: false,
          error: `${l.descripcion ?? l.erp_product_id} necesita fecha de vencimiento.`,
        }, 422);

      // Costo y precio SIEMPRE del ERP. Un movimiento de existencias no es el
      // lugar para cambiar precios, y mandarlos desde el portal sería hacerlo
      // sin querer.
      const vence = esCarga ? (c.perecedero ? String(l.vence) : "NULL") : "";
      const cola  = esCarga ? String(l.numero_lote ?? "") : String(l.id_lote ?? 0);
      partes.push([
        l.erp_product_id, c.costo, c.precio, l.cantidad, c.unidad, vence, l.id_presentacion, cola,
      ].join("|"));

      total    += Number(c.costo || 0) * Number(l.cantidad);
      unidades += Number(l.cantidad);
      detalle.push({
        erp_product_id: l.erp_product_id, descripcion: l.descripcion,
        id_presentacion: l.id_presentacion, cantidad: l.cantidad,
        costo: c.costo, precio: c.precio, stock_previo: c.stock,
      });
    }

    // Un tope que no se anuncia es un truncamiento silencioso: si el
    // presupuesto cortó, no se manda NADA y se dice dónde quedó. Media
    // solicitud aplicada es peor que ninguna.
    if (cortadoEn >= 0)
      return json({
        ok: false, codigo: "SIN_TIEMPO",
        error: `No alcanzó el tiempo: se alcanzaron a verificar ${cortadoEn} de ${lineas.length} productos. `
             + `Dividí la solicitud en tandas más chicas.`,
      }, 504);

    // ── El envío ─────────────────────────────────────────────────────────
    const campos: Record<string, string> = {
      process: "insert",
      datos: partes.join("#") + "#",
      cuantos: String(partes.length),
      total: total.toFixed(4),
      fecha: String(meta.fecha ?? hoySV()),
      concepto,
    };
    if (esCarga) {
      campos.destino = String(erpUbicacion);
    } else {
      campos.origen = String(erpUbicacion);
      campos.iden   = String(meta.subtipo ?? "");
    }

    const resp = leerRespuesta(
      await pedir(cookie, pagina, new URLSearchParams(campos), { extra: { Referer: pagina } }),
    );
    if (!resp.ok)
      return json({
        ok: false,
        error: `El sistema no aceptó el movimiento: ${resp.msg || "sin detalle"}`,
      }, 502);

    // ── Recién ahora la solicitud es APPROVED ────────────────────────────
    const aplicado = {
      at: new Date().toISOString(),
      by: aprobador.id, by_name: aprobador.name,
      movimiento: esCarga ? "CARGA" : "DESCARTE",
      subtipo: esCarga ? null : (meta.subtipo ?? null),
      erp_sucursal_id: erpSucursal,
      erp_ubicacion_id: erpUbicacion,
      concepto,
      concepto_recortado: conceptoRecortado,
      concepto_completo: conceptoRecortado ? `${cabeza} · ${causa}${firma}` : undefined,
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
        approver_id: aprobador.id,
        approver_note: typeof approver_note === "string" && approver_note.trim()
          ? approver_note.trim() : null,
        metadata: { ...meta, erp_aplicado: aplicado },
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
