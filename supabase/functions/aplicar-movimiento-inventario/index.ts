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
  // El lote viaja por su SIGNIFICADO, igual que la presentación: número y
  // fecha. Nunca por el id del sistema de origen, que el portal no tiene — y
  // nunca por el número solo: GLIMEPIRIDA tiene DOS lotes «L31800» con
  // vencimientos distintos y son existencias separadas.
  numero_lote?: string;
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
  // Solo los productos regulados llevan control de lotes. Para el resto el
  // sistema deshabilita el selector y lo deja vacío: no es que el lote sea
  // opcional, es que no existe. Medido en 52 productos — y NO se puede deducir
  // del portal: `es_antibiotico` acertó 49 y la señal de "tiene lote real" 50.
  // Glimepirida, prednisona y ciprofibrato son regulados sin ser antibióticos.
  //
  // ⚠️ SÓLO LO CONTESTA LA PANTALLA DE DESCARGOS, y sólo si el producto tiene
  // existencia en esa ubicación. En una CARGA este campo vale siempre `false`
  // porque `ingreso_inventario.php` no devuelve `lotes_select` — ver el
  // comentario de `esRegulado()`. No usarlo para decidir nada de una carga.
  regulado: boolean;
  lotes: { id: string; numero: string; vence: string; stock: number }[];
}

/** Los lotes que el sistema ofrece, con su número y su fecha. */
function leerLotes(html: string) {
  return [...html.matchAll(
    /<option([^>]*)>([^<]*)</g,
  )].map((m) => {
    const attrs = m[1];
    const etiqueta = m[2].trim();
    return {
      id: attrs.match(/value='(\d+)'/)?.[1] ?? "",
      numero: etiqueta.split(" - ")[0].trim(),
      vence: attrs.match(/data-vencimiento='([^']*)'/)?.[1] ?? "",
      stock: Number(attrs.match(/data-stock='([^']*)'/)?.[1] ?? 0),
    };
  }).filter((l) => l.id);
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
             presentaciones: [], costo: "", precio: "", unidad: "", stock: null,
             perecedero: false, regulado: false, lotes: [] };
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
    regulado: /data-regulado='1'/.test(String(j.lotes_select ?? "")),
    lotes: leerLotes(String(j.lotes_select ?? "")),
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

  // El arriendo tomado, para poder soltarlo pase lo que pase. Vive afuera del
  // `try` porque el `finally` tiene que verlo.
  let reclamadaId: string | null = null;

  try {
    // `approver_note` es contenido, no identidad: se acepta del cliente. Quién
    // aprueba sale del JWT y no se recibe nunca por parámetro.
    const { request_id, approver_note, lineas_aceptadas } = await req.json().catch(() => ({}));
    if (!request_id) return json({ ok: false, error: "Falta request_id." }, 400);

    // ── Quién llama. Nunca del payload: del JWT. ──────────────────────────
    const aprobador = await requireActiveEmployeeUser(req, admin);
    if (!aprobador) return json({ ok: false, error: "Sesión inválida o empleado inactivo." }, 401);

    // ── Y si puede decidir ESTA familia. El cliente no opina sobre esto. ──
    //
    // `puede_aprobar_modulo` es la MISMA regla que aplica la policy: el cargo,
    // el secundario, y la delegación por ausencia del titular. Se llama en vez
    // de rearmarla acá porque una copia de una regla de permisos es una copia
    // que se queda vieja — y la que se queda vieja es siempre la que abre de
    // más.
    //
    // Y el módulo es `requests_inventario`, no `requests`: desde v2.576.0
    // aprobar se reparte por familia, y pedir el permiso viejo dejaría entrar a
    // quien la base va a rechazar después.
    const { data: puedeDecidir, error: permErr } = await admin
      .rpc("puede_aprobar_modulo", {
        p_employee_id: aprobador.id,
        p_module_key: "requests_inventario",
      });
    if (permErr) throw permErr;   // un error acá NO es un «no puede»
    if (!puedeDecidir)
      return json({
        ok: false,
        error: "No tenés permiso para decidir solicitudes de inventario.",
      }, 403);

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

    // ── El arriendo: de acá hasta el final, esta solicitud es de esta corrida ─
    // La comprobación de arriba mira el estado en un instante, y entre ese
    // instante y el movimiento de existencias pasan SEGUNDOS. Dos clics a la vez
    // —dos pestañas, o dos personas— pasaban los dos por ahí y las existencias
    // se movían dos veces; el `.eq(status,'PENDING')` del final frena la segunda
    // escritura del estado, no el segundo movimiento.
    const { data: tomada, error: reclamoErr } = await admin
      .rpc("reclamar_solicitud", { p_request_id: sol.id });
    if (reclamoErr) throw reclamoErr;
    if (!tomada)
      return json({
        ok: false,
        error: "Esta solicitud se está aplicando en este momento. Esperá a que termine.",
      }, 409);
    reclamadaId = String(sol.id);

    const meta = (typeof sol.metadata === "string" ? JSON.parse(sol.metadata) : sol.metadata) ?? {};
    const todas: Linea[] = Array.isArray(meta.items) ? meta.items : [];
    if (todas.length === 0)
      return json({ ok: false, error: "La solicitud no tiene ni un producto." }, 422);

    // ── Aprobación parcial: qué líneas entran y con cuánta cantidad ────────
    //
    // El cliente manda ÍNDICES con su cantidad, nunca las líneas. La diferencia
    // no es de estilo: con las líneas, el navegador elegiría qué producto se
    // mueve, y este endpoint tiene credenciales para mover inventario de
    // cualquier sala. Con índices, lo único que puede hacer es señalar cuáles de
    // las que YA se guardaron entran, y bajarles la cantidad.
    //
    // **Bajarla, nunca subirla.** Aprobar más de lo que alguien pidió no es
    // aprobar: es otra solicitud, sin el motivo ni la firma de quien la habría
    // pedido. Por eso el tope es siempre lo pedido, y se aplica acá — la
    // pantalla también lo topa, pero la pantalla es una sugerencia.
    //
    // Se acepta la forma vieja (un array de índices a secas) además de la nueva
    // (`{i, cantidad}`): son dos versiones del mismo cliente y durante un
    // despliegue conviven.
    //
    // Índices repetidos, fuera de rango o no enteros se descartan en silencio;
    // lo que no se puede es quedarse sin ninguna, porque «aprobar cero líneas»
    // no es aprobar — es rechazar con otro nombre, y el rechazo tiene su propio
    // camino con su motivo obligatorio.
    type Aceptada = { i: number; cantidad: number };
    let aceptadas: Aceptada[] = todas.map((l, i) => ({ i, cantidad: Number(l.cantidad) || 0 }));

    if (Array.isArray(lineas_aceptadas)) {
      const vistos = new Set<number>();
      aceptadas = [];
      for (const bruto of lineas_aceptadas) {
        const i = typeof bruto === "number" ? bruto : Number(bruto?.i);
        if (!Number.isInteger(i) || i < 0 || i >= todas.length || vistos.has(i)) continue;
        vistos.add(i);

        const pedida = Number(todas[i].cantidad) || 0;
        const pedidaCliente = typeof bruto === "number" ? pedida : Number(bruto?.cantidad);
        const cantidad = Number.isFinite(pedidaCliente)
          ? Math.min(pedida, Math.max(0, pedidaCliente))
          : pedida;
        if (cantidad <= 0) continue;   // cantidad cero = la línea no entra
        aceptadas.push({ i, cantidad });
      }
      aceptadas.sort((a, b) => a.i - b.i);

      if (aceptadas.length === 0)
        return json({
          ok: false,
          error: "No quedó ninguna línea para aplicar. Si no entra nada, rechazá la solicitud.",
        }, 422);
    }

    const entran = new Set(aceptadas.map((a) => a.i));
    const ajustes = aceptadas.filter((a) => a.cantidad !== (Number(todas[a.i].cantidad) || 0));
    const parcial = entran.size < todas.length || ajustes.length > 0;

    // Las líneas que de verdad se van a mover, con la cantidad decidida.
    const lineas: Linea[] = aceptadas.map((a) => ({ ...todas[a.i], cantidad: a.cantidad }));

    // El motivo es la nota del aprobador: es lo que acaba de escribir explicando
    // por qué no entra todo, y el formulario la exige justamente en ese caso.
    const motivoFuera = String(approver_note ?? "").trim() || "Sin motivo";
    const rechazadas = todas.map((_, i) => i).filter((i) => !entran.has(i))
      .map((i) => ({ i, motivo: motivoFuera }));
    const ajustadas = ajustes.map((a) => ({
      i: a.i,
      pedida: Number(todas[a.i].cantidad) || 0,
      aplicada: a.cantidad,
      motivo: motivoFuera,
    }));

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

    // ── Quién lleva control de lote, en una CARGA ─────────────────────────
    //
    // En un descargo lo contesta el propio sistema (`data-regulado` del selector
    // de lotes). En una carga NO HAY A QUIÉN PREGUNTARLE: medido el 2026-08-12,
    // `ingreso_inventario.php` no devuelve `lotes_select` para ningún producto,
    // y la pantalla de descargos sólo lo publica si el producto tiene existencia
    // en esa ubicación — que es justo lo que un producto por cargar no tiene.
    //
    // Ese hueco es el bug que esto corrige: la señal salía siempre `false`, así
    // que el lote viajaba vacío y el sistema rechazaba TODA carga de un producto
    // con control de lote. Ninguna llegó a aplicarse nunca; la única que entró
    // (IMIDALYN GEL, 11-ago) era de un producto sin lote y por eso pasó.
    //
    // Ahora sale de `products.regulado`, que el portal mantiene. Tres valores y
    // los tres significan algo distinto:
    //   true  → el lote es obligatorio y viaja
    //   false → va vacío A PROPÓSITO: mandarle un número le inventa un lote
    //   null  → no se sabe; se manda lo que la solicitud traiga y decide el
    //           sistema, que para eso es el que manda
    const reguladoPorProducto = new Map<number, boolean | null>();
    if (esCarga) {
      const ids = [...new Set(lineas.map((l) => Number(l.erp_product_id)))];
      const { data: prods, error: prodErr } = await admin
        .from("products").select("id, regulado").in("id", ids);
      if (prodErr) throw prodErr;
      for (const p of prods ?? []) reguladoPorProducto.set(Number(p.id), p.regulado);
    }

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

      // En una carga el control de lote lo dice el portal; en un descargo, el
      // sistema. Nunca al revés: ver `reguladoPorProducto` arriba.
      const llevaLote = esCarga
        ? reguladoPorProducto.get(Number(l.erp_product_id)) ?? null
        : c.regulado;

      // Un regulado cargado sin lote entra al inventario sin poder rastrearse,
      // que es exactamente lo contrario de por qué se lo regula. Se corta acá y
      // no en el envío para que el aviso nombre el producto: el sistema también
      // lo rechazaría, pero recién después de aceptar las otras líneas.
      if (esCarga && llevaLote === true && !String(l.numero_lote ?? "").trim())
        return json({
          ok: false, codigo: "FALTA_LOTE",
          error: `${l.descripcion ?? l.erp_product_id} lleva control de lote y necesita su número.`,
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

      // ── El lote ───────────────────────────────────────────────────────────
      // En un DESCARTE hay que apuntar a un lote que existe, y su identidad es
      // número + fecha: GLIMEPIRIDA tiene dos «L31800» con vencimientos
      // distintos, ids 27182 y 24626, y son existencias separadas. Se resuelve
      // acá contra lo que el sistema ofrece AHORA.
      //
      // Si el producto no es regulado no hay lotes que elegir —el selector
      // viene vacío y deshabilitado— y va 0. No es un error: es que ese
      // producto no lleva control de lote, y lo que el portal haya mostrado
      // era informativo.
      let idLote = "0";
      if (!esCarga && c.regulado) {
        if (!l.numero_lote)
          return json({
            ok: false, codigo: "FALTA_LOTE",
            error: `${l.descripcion ?? l.erp_product_id} lleva control de lote y la solicitud no dice cuál.`,
          }, 422);
        const buscadoNum = norm(l.numero_lote);
        const buscadoVen = String(l.vence ?? "").slice(0, 10);
        const lote = c.lotes.find((x) =>
          norm(x.numero) === buscadoNum && (!buscadoVen || x.vence.slice(0, 10) === buscadoVen));
        if (!lote)
          return json({
            ok: false, codigo: "LOTE_NO_EXISTE",
            error: `El lote ${l.numero_lote}${buscadoVen ? ` (vence ${buscadoVen})` : ""} de `
                 + `${l.descripcion ?? l.erp_product_id} ya no existe. Quedan: `
                 + `${c.lotes.map((x) => `${x.numero} ${x.vence}`).join(", ") || "ninguno"}.`,
          }, 409);
        // El tope de un descarte con lote es el stock DE ESE LOTE, no el del
        // producto: sacar 5 de un lote que tiene 1 es imposible aunque el
        // producto tenga 200 repartidas en otros.
        const enUnidades = Number(l.cantidad) * Number(unidad);
        if (enUnidades > lote.stock)
          return json({
            ok: false, codigo: "SIN_EXISTENCIA_EN_LOTE",
            error: `El lote ${lote.numero} de ${l.descripcion ?? l.erp_product_id} tiene `
                 + `${lote.stock} unidades, y se pidieron ${enUnidades}.`,
          }, 409);
        idLote = lote.id;
      }

      const vence = esCarga ? (c.perecedero ? String(l.vence) : "NULL") : "";
      // En una CARGA el lote viaja como texto. Mandar el mismo número con la
      // misma fecha SUMA al lote existente en vez de crear otro — verificado
      // el 2026-08-06: tres cargas de 1 unidad con lote «PRUEBA» y la misma
      // fecha quedaron como una sola línea de 3.
      //
      // Y si el producto NO es regulado va vacío a propósito: mandarle un
      // número le inventa un lote que no debería existir. Pasó en esa prueba.
      //
      // `null` —no se sabe si lleva lote— manda lo que la solicitud traiga: si
      // el producto lo lleva, es lo único que lo hace entrar; si no lo lleva, la
      // solicitud tampoco tendrá lote que mandar, porque el widget sólo lo pide
      // donde corresponde.
      const cola = esCarga
        ? (llevaLote === false ? "" : String(l.numero_lote ?? ""))
        : idLote;
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
        regulado: llevaLote,
        lote: l.numero_lote ?? null, vence: l.vence ?? null,
        id_lote_erp: idLote !== "0" ? idLote : null,
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
    if (!resp.ok) {
      // Un rechazo por falta de lote ES el dato que le falta al portal: el
      // sistema nombra el producto que lo exige. Se anota, así el próximo
      // intento lo pide en la pantalla en vez de volver a fallar acá. Es el
      // único camino para los productos que nunca tuvieron existencia, que son
      // los que ninguna consulta puede clasificar.
      const idFaltante = Number(/lote[\s\S]{0,120}?ID\s+(\d+)/i.exec(resp.msg)?.[1]);
      if (esCarga && idFaltante) {
        await admin.from("products").update({ regulado: true }).eq("id", idFaltante)
          .then(({ error }) => { if (error) console.error("marcar regulado:", error.message); });
      }
      return json({
        ok: false,
        error: `El sistema no aceptó el movimiento: ${resp.msg || "sin detalle"}`,
      }, 502);
    }

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
      // Cuántas de las que se pidieron entraron. Sin esto, una constancia de 2
      // líneas sobre una solicitud de 5 se lee como si se hubieran pedido 2.
      parcial,
      lineas_pedidas: todas.length,
      lineas_ajustadas: ajustadas.length,
    };

    const { error: updErr } = await admin
      .from("approval_requests")
      .update({
        // Sigue siendo APPROVED aunque haya entrado sólo una parte: la
        // solicitud se resolvió y se cerró. `status` admite cuatro valores y
        // agregarle un quinto obligaría a revisar cada consumidor que hoy
        // pregunta `=== 'APPROVED'`. Lo parcial es un matiz de esa aprobación,
        // y por eso vive en la metadata — de donde la pantalla saca su
        // insignia «Aprobada parcial».
        status: "APPROVED",
        approver_id: aprobador.id,
        approver_note: typeof approver_note === "string" && approver_note.trim()
          ? approver_note.trim() : null,
        metadata: {
          ...meta,
          erp_aplicado: aplicado,
          ...(rechazadas.length ? { lineas_rechazadas: rechazadas } : {}),
          ...(ajustadas.length ? { lineas_ajustadas: ajustadas } : {}),
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", sol.id)
      .eq("status", "PENDING");          // no pisar si otro la resolvió en el medio
    if (updErr) throw updErr;

    return json({ ok: true, aplicado,
                  lineas_rechazadas: rechazadas, lineas_ajustadas: ajustadas });

  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  } finally {
    /* Soltar el arriendo salga como salga.
     *
     * No hace falta preguntar si el movimiento entró: `liberar_solicitud` sólo
     * toca lo que sigue en PENDING, así que sobre una solicitud ya aprobada es
     * un no-op. Y si esta corrida muere sin llegar hasta acá, el arriendo vence
     * solo a los 3 minutos. */
    if (reclamadaId) {
      await admin.rpc("liberar_solicitud", { p_request_id: reclamadaId })
        .then(({ error }) => { if (error) console.error("liberar_solicitud:", error.message); });
    }
  }
});
