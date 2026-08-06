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
//  2. La presentación NO se elige por posición NI por el id del portal. Son
//     DOS numeraciones distintas: para el producto 2 el portal tiene 1/102/230
//     y el ERP ofrece 8421/7213/3. Mandar la del portal apuntaría a otra
//     presentación existente y el ERP no protestaría.
//     Y el orden tampoco sirve: el producto 105 pone UNIDAD al final y los
//     productos 6/9/56 la ponen primera.
//     Lo único estable es la ETIQUETA, que es «TIPO (FACTOR)» y coincide con
//     `presentaciones.tipo` + `product_precios.factor` del portal. Así que la
//     solicitud viaja con el SIGNIFICADO —"CAJA", 8— y el id del ERP se
//     resuelve acá, contra lo que el ERP ofrece en ese momento.
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
  presentacion_tipo: string;   // "UNIDAD", "CAJA", "BLISTER X 10"…
  factor: number;              // cuántas unidades trae
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
  presentaciones: { id: string; etiqueta: string }[];
  costo: string;
  precio: string;
  unidad: string;
  stock: number | null;
  perecedero: boolean;
}

/**
 * La etiqueta de una presentación, comparable.
 *
 * El ERP escribe «PAQUETE  (12)» con dos espacios en un producto y con uno en
 * otro, así que comparar el texto crudo perdería la coincidencia sin decir por
 * qué. Se colapsan los espacios y se sube todo a mayúsculas.
 */
const norm = (s: string) => String(s ?? "").replace(/\s+/g, " ").trim().toUpperCase();

/**
 * El concepto, en ASCII puro.
 *
 * El ERP sirve sus páginas en UTF-8 pero vuelve a leer los bytes como Latin-1
 * al guardarlos y al imprimir el kardex: el `·` que mandábamos (C2 B7 en UTF-8)
 * salió impreso como «Â·». No es algo que introduzca el portal —el propio
 * `<option>` del ERP trae la Ñ en UTF-8 y le pasa lo mismo—, pero el concepto
 * es el único rastro que queda del movimiento y tiene que leerse.
 *
 * Así que se transcribe: se separan las tildes de su letra y se descartan, el
 * punto medio pasa a guion, y lo que quede fuera de ASCII se cae. «Se dañó en
 * góndola» queda «Se dano en gondola» — sin tilde, pero legible, que es más de
 * lo que se puede decir de «Se daÃ±Ã³».
 *
 * No se toca `iden`: ese valor es de la lista del ERP y viaja como él lo dio.
 */
function soloAscii(s: string): string {
  return String(s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")   // saca las tildes
    // Los signos que SÍ tienen equivalente se traducen en vez de desaparecer:
    // un guion largo borrado deja dos palabras pegadas y cambia la frase.
    .replace(/[·•]/g, "-")
    .replace(/[—–]/g, "-")
    .replace(/[«»“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function leerConsulta(cuerpo: string): Consulta {
  let j: Record<string, unknown>;
  try { j = JSON.parse(cuerpo); } catch {
    return { ok: false, msg: `Respuesta ilegible del ERP: ${cuerpo.slice(0, 160)}`,
             presentaciones: [], costo: "", precio: "", unidad: "", stock: null, perecedero: false };
  }
  // fin del parseo defensivo
  // `ingreso_inventario.php` contesta con typeinfo; el descargo también. Si no
  // viene, la respuesta igual sirve mientras traiga el producto.
  const tipo = String(j.typeinfo ?? "").toLowerCase();
  const ok   = tipo ? tipo === "success" : Boolean(j.id_p);
  const sel  = String(j.select ?? "");
  return {
    ok,
    msg: String(j.msg ?? ""),
    presentaciones: [...sel.matchAll(/<option value='(\d+)'>([^<]*)</g)]
      .map((m) => ({ id: m[1], etiqueta: norm(m[2]) })),
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
      return json({ ok: false, error: "No tienes permiso para aprobar solicitudes." }, 403);

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
    // Todo el concepto se transcribe a ASCII: el separador, los nombres y la
    // causa, que la escribe una persona y en español lleva tildes. Se recorta
    // DESPUÉS de transcribir, porque la transcripción cambia el largo.
    // Cada pieza se transcribe SOLA y se une después. `soloAscii` recorta los
    // extremos, así que armar la firma con su espacio adentro se lo comía y
    // quedaba «...en gondola- Solicita:» pegado.
    const firma = ` - Solicita: ${soloAscii(solicitante?.name ?? "-") || "-"}`
                + ` - Aprueba: ${soloAscii(aprobador.name) || "-"}`;
    const cabeza = soloAscii(esCarga ? "CARGA" : String(meta.subtipo ?? "DESCARTE"));
    const causaAscii = soloAscii(causa);
    const espacio = CONCEPTO_MAX - cabeza.length - firma.length - 3;
    const causaCorta = causaAscii.length > espacio
        ? causaAscii.slice(0, Math.max(0, espacio - 3)) + "..."
        : causaAscii;
    const concepto = `${cabeza} - ${causaCorta}${firma}`;
    const conceptoRecortado = causaCorta !== causaAscii;

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

      // La presentación se resuelve por su SIGNIFICADO contra lo que el ERP
      // ofrece ahora. Si el producto dejó de tener esa presentación, se corta:
      // aplicar contra otra sería mover una cantidad distinta de la pedida.
      const buscada = norm(`${l.presentacion_tipo} (${l.factor})`);
      const elegida = c.presentaciones.find((p) => p.etiqueta === buscada);
      if (!elegida)
        return json({
          ok: false, codigo: "PRESENTACION_NO_EXISTE",
          error: `${l.descripcion ?? l.erp_product_id} ya no tiene la presentación `
               + `${l.presentacion_tipo} (${l.factor}). Ofrece: `
               + `${c.presentaciones.map((p) => p.etiqueta).join(", ") || "ninguna"}.`,
        }, 409);

      // Un perecedero cargado sin fecha de vencimiento queda sin control de
      // caducidad, que es justo lo que el módulo existe para vigilar.
      if (esCarga && c.perecedero && !l.vence)
        return json({
          ok: false,
          error: `${l.descripcion ?? l.erp_product_id} necesita fecha de vencimiento.`,
        }, 422);

      // ── El costo, el precio y el FACTOR son de la presentación elegida ────
      // `consultar_stock` los devuelve de la presentación POR DEFECTO, no de la
      // que se eligió. Medido en el producto 2215 el 2026-08-06: contesta
      // costo 6.2076 y unidad 100 —la CAJA— aunque se vaya a mover una UNIDAD,
      // que vale 0.0621 y trae factor 1. Usar esos valores habría hecho que un
      // descarte de "1 unidad" sacara CIEN. La pantalla del ERP no tiene el
      // problema porque al cambiar el <select> vuelve a pedir `getpresentacion`;
      // acá hay que hacer lo mismo.
      const p = await pedir(cookie, pagina, new URLSearchParams({
        process: "getpresentacion", id_presentacion: elegida.id,
      }), { extra: { Referer: pagina } });
      let costo = c.costo, precio = c.precio, unidad = c.unidad;
      try {
        const jp = JSON.parse(p);
        if (jp?.unidad) { costo = String(jp.costo); precio = String(jp.precio); unidad = String(jp.unidad); }
        else throw new Error("sin unidad");
      } catch {
        return json({
          ok: false,
          error: `El sistema no devolvió el detalle de la presentación `
               + `${l.presentacion_tipo} (${l.factor}) de ${l.descripcion ?? l.erp_product_id}.`,
        }, 502);
      }

      // Coherencia final: el factor que dice el ERP tiene que ser el que se
      // aprobó. Si no coincide, la presentación cambió de significado entre
      // pedir y aplicar y la cantidad ya no quiere decir lo mismo.
      if (Number(unidad) !== Number(l.factor))
        return json({
          ok: false, codigo: "FACTOR_CAMBIO",
          error: `${l.descripcion ?? l.erp_product_id}: se aprobó `
               + `${l.presentacion_tipo} de ${l.factor}, y hoy trae ${unidad}.`,
        }, 409);

      // El descarte no puede sacar más de lo que hay. Va DESPUÉS de resolver el
      // factor porque las dos cifras están en unidades distintas: el ERP informa
      // el stock en unidades base —1,891 para un producto con 18 cajas de 100—
      // y la cantidad pedida está en la presentación elegida. Compararlas crudas
      // dejaría pasar un descarte de 100 cajas contra 1,891 unidades.
      //
      // Se relee ACÁ y no al crear la solicitud: entre pedirla y aprobarla se
      // vendió, se trasladó o alguien más descartó. El ERP es el que sabe.
      if (!esCarga && c.stock !== null) {
        const pedidoEnUnidades = Number(l.cantidad) * Number(unidad);
        if (pedidoEnUnidades > c.stock)
          return json({
            ok: false, codigo: "SIN_EXISTENCIA",
            error: `De ${l.descripcion ?? l.erp_product_id} quedan ${c.stock} unidades, `
                 + `y se pidieron ${l.cantidad} × ${unidad} = ${pedidoEnUnidades}.`,
          }, 409);
      }

      const vence = esCarga ? (c.perecedero ? String(l.vence) : "NULL") : "";
      const cola  = esCarga ? String(l.numero_lote ?? "") : String(l.id_lote ?? 0);
      partes.push([
        l.erp_product_id, costo, precio, l.cantidad, unidad, vence, elegida.id, cola,
      ].join("|"));

      total    += Number(costo || 0) * Number(l.cantidad);
      unidades += Number(l.cantidad);
      detalle.push({
        erp_product_id: l.erp_product_id, descripcion: l.descripcion,
        presentacion: `${l.presentacion_tipo} (${l.factor})`,
        id_presentacion_erp: elegida.id,       // el que se usó, para poder auditarlo
        cantidad: l.cantidad, unidad,
        costo, precio, stock_previo: c.stock,
      });
    }

    // Un tope que no se anuncia es un truncamiento silencioso: si el
    // presupuesto cortó, no se manda NADA y se dice dónde quedó. Media
    // solicitud aplicada es peor que ninguna.
    if (cortadoEn >= 0)
      return json({
        ok: false, codigo: "SIN_TIEMPO",
        error: `No alcanzó el tiempo: se alcanzaron a verificar ${cortadoEn} de ${lineas.length} productos. `
             + `Divide la solicitud en tandas más chicas.`,
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
      // El texto íntegro y CON tildes queda acá: la solicitud es el registro de
      // verdad, y el concepto del ERP es apenas su eco en el idioma que acepta.
      causa_original: causa,
      concepto_completo: conceptoRecortado ? `${cabeza} - ${causaAscii}${firma}` : undefined,
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
