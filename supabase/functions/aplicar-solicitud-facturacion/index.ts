import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireActiveEmployeeUser } from "../_shared/security.ts";
import {
  BASE, ANULAR, login, pedir, leerRespuesta, formatearDui, estaAnulada, enviarDteAlMH,
  RechazoMH,
} from "../_shared/erp-dte.ts";

// Aplica en el ERP la solicitud que el supervisor acaba de aprobar.
//
// Hasta ahora aprobar una solicitud de facturación no hacía NADA fuera del
// portal: `_runFinalApproval` marcaba APPROVED, notificaba y terminaba. Alguien
// tenía que ir al ERP a repetir el cambio a mano, y nada garantizaba que lo
// hiciera ni que lo hiciera igual.
//
// ── Por qué acá y no en el navegador ───────────────────────────────────────
// El ERP se maneja con usuario/contraseña y cookie de sesión PHP. Esas
// credenciales viven en un secreto de Supabase y no pueden viajar al
// navegador — quien tiene la sesión del ERP puede anular cualquier factura de
// cualquier sucursal, no solo la de su solicitud.
//
// ── El orden importa: primero el ERP, después APPROVED ─────────────────────
// Si se marcara APPROVED antes y el ERP fallara, quedaría una solicitud que
// dice "aplicada" sobre una factura intacta — y nadie volvería a mirarla. Acá
// el ERP manda: si no entra, la solicitud sigue PENDING y el supervisor ve el
// error. APPROVED significa siempre "ya está hecho en el ERP".
//
// ── Lo que no se puede olvidar del ERP (ver push-cliente-erp) ──────────────
//  1. Contesta HTTP 200 con {"typeinfo":"Error"} cuando rechaza. Un rechazo
//     silencioso se ve igual que un éxito si no se lee el cuerpo.
//  2. `cambiar_cod` y `cambiar` devuelven el MISMO texto ("Numero
//     actualizado"), así que el mensaje no distingue qué se cambió. Por eso el
//     resultado NO se da por bueno hasta releer la ficha y comparar.
//  3. Se cae solo a veces y el mismo payload entra al reintentarlo.
//
// ── El id que va al ERP no es el id del portal ─────────────────────────────
// `metadata.invoice_id` es `sales_invoices.id` (ej. 6661083). El ERP espera su
// propio id (`erp_invoice_id`, ej. 345608). Mandar el del portal apuntaría a
// OTRA factura existente, no daría error. La traducción es obligatoria.

const REIMPRIMIR = `${BASE}/reimprimir_factura.php`;
const SESION     = `${BASE}/cambio_sesion.php`;

// El sello de recepción de Hacienda son exactamente 40 caracteres. La columna es
// `text` y llegó a guardar la cadena "undefined", así que `!!valor` da por buena
// cualquier basura — mismo criterio que `selloValido` en sync-dte-sales.
const selloValido = (v: unknown) => typeof v === "string" && v.length === 40;

/* No se puede invalidar ante Hacienda un documento que Hacienda nunca recibió, y
   el sistema lo dice de dos maneras: no entrega el token de la pantalla de
   anulación, o rechaza el armado con "Esta factura no ha sido validada por MH no
   se puede validar la anulacion".

   Ninguna de las dos es una falla: son la respuesta correcta para una venta que
   se anuló antes de transmitirse. Un rechazo de Hacienda SÍ es una falla —ahí
   contestó y dijo que no—, así que `RechazoMH` queda afuera a propósito. */
const esFaltaDeTramite = (e: unknown) => {
  if (e instanceof RechazoMH) return false;
  const m = (e instanceof Error ? e.message : String(e))
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return m.includes("no entrego el token")
      || m.includes("no ha sido validada")
      || m.includes("no se puede validar la anulacion");
};

const TIPOS_SOPORTADOS = new Set([
  "PAYMENT_CHANGE_REQUEST",
  "VENDOR_CHANGE_REQUEST",
  "CLIENT_CHANGE_REQUEST",
  "ANNULMENT_REQUEST",
]);

// El `credito` del ERP es un índice, no el nombre. Leído del <select> de
// reimprimir_factura.php el 2026-08-05.
const PAGO_A_ERP: Record<string, string> = {
  efectivo: "0", credito: "1", tarjeta: "2",
  cheque: "3", bitcoin: "4", transferencia: "5",
};
const ERP_A_PAGO: Record<string, string> = Object.fromEntries(
  Object.entries(PAGO_A_ERP).map(([k, v]) => [v, k]),
);

/** Estado de los tres campos editables, leído de la pantalla del ERP. */
type Ficha = { cliente: string | null; clienteNombre: string; credito: string | null; vendedor: string | null };

function parsearFicha(html: string): Ficha {
  const cli = html.match(/id="id_cliente"[\s\S]*?<option value='(\d+)'\s+selected>\s*([^<]*?)\s*<\/option>/);
  const selCred = html.match(/id="credito"([\s\S]*?)<\/select>/);
  const cred = selCred?.[1].match(/<option value="(\d)"\s+selected>/);
  const vend = html.match(/Cod\. Vendedor<\/label>[\s\S]*?<input[^>]*value="([^"]*)"/);
  return {
    cliente: cli?.[1] ?? null,
    clienteNombre: cli?.[2] ?? "",
    credito: cred?.[1] ?? null,
    vendedor: vend?.[1] ?? null,
  };
}

async function leerFicha(cookie: string, erpId: string): Promise<Ficha> {
  const html = await pedir(cookie, `${REIMPRIMIR}?id_factura=${encodeURIComponent(erpId)}`);
  const ficha = parsearFicha(html);
  if (ficha.cliente === null && ficha.credito === null && ficha.vendedor === null)
    throw new Error(`No se pudieron leer los datos de la factura ${erpId}.`);
  return ficha;
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

  // El arriendo tomado, para poder soltarlo pase lo que pase. Vive afuera del
  // `try` porque el `finally` tiene que verlo.
  let reclamadaId: string | null = null;

  try {
    // `approver_note` es contenido, no identidad: se acepta del cliente. Quién
    // aprueba sale del JWT y no se recibe nunca por parámetro.
    const { request_id, approver_note } = await req.json().catch(() => ({}));
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
    // Y el módulo es `requests_facturacion`, no `requests`: desde v2.576.0
    // aprobar se reparte por familia, y pedir el permiso viejo dejaría entrar a
    // quien la base va a rechazar dos líneas después.
    const { data: puedeDecidir, error: permErr } = await admin
      .rpc("puede_aprobar_modulo", {
        p_employee_id: aprobador.id,
        p_module_key: "requests_facturacion",
      });
    if (permErr) throw permErr;   // un error acá NO es un «no puede»
    if (!puedeDecidir)
      return json({
        ok: false,
        error: "No tenés permiso para decidir solicitudes de facturación.",
      }, 403);

    // ── La solicitud se relee de la BD, no se recibe ──────────────────────
    const { data: sol, error: solErr } = await admin
      .from("approval_requests")
      .select("id, type, status, employee_id, metadata")
      .eq("id", request_id)
      .maybeSingle();
    if (solErr) throw solErr;
    if (!sol) return json({ ok: false, error: "La solicitud no existe." }, 404);

    // Los cuatro tipos del widget de facturación. Cualquier otro (permisos,
    // vacaciones, incapacidades) sigue el flujo genérico de aprobación y no
    // tiene nada que hacer contra el ERP.
    if (!TIPOS_SOPORTADOS.has(sol.type))
      return json({
        ok: false,
        codigo: "TIPO_NO_AUTOMATIZADO",
        error: `El tipo ${sol.type} no se aplica desde acá.`,
      }, 422);
    if (sol.status !== "PENDING")
      return json({ ok: false, error: `La solicitud ya está ${sol.status}.` }, 409);

    // ── El arriendo: de acá hasta el final, esta solicitud es de esta corrida ─
    // La comprobación de arriba mira el estado en un instante, y entre ese
    // instante y la escritura al sistema de origen pasan SEGUNDOS. Dos clics a
    // la vez —dos pestañas, o dos personas— pasaban los dos por ahí y los dos
    // anulaban; el `.eq(status,'PENDING')` del final frena la segunda escritura
    // del estado, no la segunda anulación.
    //
    // El reclamo es un compare-and-set en una sola sentencia, que es lo único
    // atómico disponible desde acá.
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

    // ── id del portal → id del ERP ───────────────────────────────────────
    const { data: factura, error: facErr } = await admin
      .from("sales_invoices")
      .select("id, erp_invoice_id, correlativo, branch_id, estado, tipo_documento")
      .eq("id", meta.invoice_id)
      .maybeSingle();
    if (facErr) throw facErr;
    if (!factura) return json({ ok: false, error: "La factura de la solicitud ya no existe." }, 404);
    if (!factura.erp_invoice_id)
      return json({ ok: false, error: "La factura no tiene número interno: no se puede ubicar." }, 422);
    const esAnulacion = sol.type === "ANNULMENT_REQUEST";

    // Para los tres cambios de datos, una factura anulada es un callejón sin
    // salida. Para la anulación NO es un error: puede estar anulada en el ERP
    // y pendiente ante Hacienda, que es justo el caso que hay que terminar.
    if (estaAnulada(factura.estado) && !esAnulacion)
      return json({ ok: false, error: "La factura ya está anulada." }, 409);

    const erpId = String(factura.erp_invoice_id);

    // ── La sucursal de la SESIÓN, antes de tocar nada ─────────────────────
    // `anular_factura.php` está en la familia de facturación pero NO es un
    // endpoint de DTE: revierte la venta —existencias y caja de esa sala—, así
    // que sigue a la sucursal de la sesión y no al `id_factura` que recibe.
    //
    // La cuenta con la que entra el portal aterriza siempre en Salud 1. Por eso
    // la única anulación que había funcionado (2026-08-06) era de Salud 1 —la
    // sucursal por defecto— y la primera de otra sala falló: 0000068132_COF de
    // Salud 4, el 2026-08-11. Lo que estaba verificado entre sucursales eran
    // las LECTURAS; esto es una escritura y no lo es.
    //
    // Mismo paso que ya daban `aplicar-movimiento-inventario` y las otras ocho
    // funciones que escriben: esta era la única que lo salteaba.
    const { data: mapa, error: mapaErr } = await admin
      .from("erp_sucursal_map")
      .select("erp_sucursal_id, nombre")
      .eq("branch_id", factura.branch_id)
      .maybeSingle();
    if (mapaErr) throw mapaErr;
    if (!mapa?.erp_sucursal_id)
      return json({
        ok: false,
        error: "No se pudo ubicar la sucursal de la factura, así que no se toca.",
      }, 422);

    const cookie = await login();

    // Se falla antes de escribir, no después: sin esta sucursal abierta la
    // operación se pediría contra la sala equivocada.
    const rSesion = await pedir(cookie, SESION, new URLSearchParams({
      process: "set_sucursal", id_sucursal: String(mapa.erp_sucursal_id),
    }), { extra: { Referer: `${BASE}/dashboard.php` } });
    let sesionOk = false;
    try { sesionOk = Boolean(JSON.parse(rSesion)?.success); } catch { sesionOk = false; }
    if (!sesionOk)
      return json({
        ok: false,
        error: `No se pudo abrir la sucursal ${mapa.nombre ?? factura.branch_id} para aplicar el cambio.`,
      }, 502);

    // ── Anulación: ERP y después Hacienda ────────────────────────────────
    if (esAnulacion) {
      // Responsable de la anulación ante Hacienda: SIEMPRE la misma persona,
      // definida por la empresa — no quien apruebe esa vez. Es quien responde
      // legalmente por la invalidación, así que no puede depender de qué
      // supervisor estaba de turno ni llegar desde el cliente.
      //
      // Va en un secreto y no en el código porque el DUI es dato personal.
      const respRaw = Deno.env.get("DTE_RESPONSABLE_ANULACION");
      if (!respRaw)
        return json({
          ok: false,
          error: "No está configurado el responsable de anulaciones ante Hacienda.",
        }, 500);
      const respCfg = JSON.parse(respRaw) as { nombre?: string; dui?: string };
      const dui = formatearDui(respCfg.dui ?? "");
      if (!respCfg.nombre || !dui)
        return json({
          ok: false,
          error: "El responsable de anulaciones está mal configurado (falta nombre o DUI válido).",
        }, 500);
      const resp = { name: respCfg.nombre };

      // ── El estado de la factura decide qué falta hacer ─────────────────
      //
      // Una anulación son DOS pasos —anular en el sistema, invalidar ante
      // Hacienda— y la solicitud puede llegar acá con cualquiera de los dos ya
      // hecho. Aprobar no es "ejecutar los dos pasos": es dejar la factura en su
      // estado final, sea cual sea el trecho que falte.
      //
      // Lo destapó 0000061286_COF (La Popular, 21-ago-2026). Se aprobó 87
      // segundos después de facturarse: el sistema la anuló y el paso ante
      // Hacienda reventó, porque ese documento NUNCA llegó a transmitirse. La
      // excepción se llevaba por delante la marca de APPROVED, así que la
      // factura quedaba anulada y la solicitud PENDIENTE — y cada reintento
      // volvía a romperse en el mismo punto. Tres 500 seguidos por algo que ya
      // estaba terminado.
      const avisos: string[] = [];
      const yaInvalidada = String(factura.estado ?? "").toUpperCase() === "DTE INVALIDADO EN MH";

      // 1 · Anular en el sistema, sólo si sigue viva.
      let anuladaAhora = false;
      if (!estaAnulada(factura.estado)) {
        const r = leerRespuesta(await pedir(cookie, ANULAR, new URLSearchParams({
          process: "deleted", id_factura: erpId,
        })));
        if (!r.ok) return json({ ok: false, error: `No se pudo anular la factura: ${r.msg}` }, 502);
        anuladaAhora = true;
      }

      // 2 · Lo de Hacienda, sólo si falta y si hay algo que invalidar.
      //
      // La factura se RELEE antes de decidir: el espejo del portal lo escribe el
      // sync de cada minuto, así que el `factura` de más arriba puede tener un
      // minuto de atraso justo en las dos columnas que mandan acá. Sin
      // `codigo_generacion` no hubo documento; sin sello de 40, no hubo
      // recepción.
      //
      // El error del select NO se descarta: sin esta relectura no se puede
      // afirmar que no haya nada que invalidar, y dar por bueno un `null` que
      // en realidad es un fallo de lectura cerraría la solicitud sobre una
      // factura que sí necesitaba el trámite.
      const { data: fresca, error: frescaErr } = await admin
        .from("sales_invoices")
        .select("codigo_generacion, recibido_mh")
        .eq("id", factura.id)
        .maybeSingle();
      if (frescaErr) throw frescaErr;
      const llegoAHacienda = Boolean(fresca?.codigo_generacion) || selloValido(fresca?.recibido_mh);

      let mh: Awaited<ReturnType<typeof enviarDteAlMH>> | null = null;
      let interno: { motivo?: string; instruccion?: string } | null = null;
      if (yaInvalidada) {
        avisos.push("Ya estaba invalidada ante Hacienda: no se volvió a enviar.");
      } else {
        // Se INTENTA siempre, aunque el espejo diga que nunca se transmitió: el
        // que sabe es el sistema de origen, y saltarse una invalidación que sí
        // hacía falta deja una venta anulada acá y vigente ante Hacienda. Sólo
        // se cierra sin trámite cuando los DOS coinciden en que no hay nada que
        // invalidar.
        try {
          mh = await enviarDteAlMH(cookie, erpId, String(factura.tipo_documento ?? ""), {
            anula: true, nombreResp: resp.name, duiResp: dui,
          });
        } catch (e) {
          if (!esFaltaDeTramite(e)) throw e;

          // ── El crédito fiscal emitido a quien no es contribuyente ────────
          //
          // Acá el sistema de origen ACABA de decir que Hacienda nunca validó
          // este documento. Antes de dar el trámite por innecesario se le
          // pregunta a la base si éste es el caso decidido el 2026-08-23: un
          // CCF a un cliente sin NRC, que Hacienda rechaza SIEMPRE porque lo
          // que está mal es el TIPO de documento y no un dato de la ficha —
          // ninguno de los cinco campos que corrige `sincronizar-fichas-
          // clientes` lo arregla, así que rebota todas las noches para siempre.
          //
          // La regla vive entera en `marcar_solventado_internamente` y NO acá:
          // es la que decide, la que escribe y la que se niega si el caso no
          // encaja. Una copia en TypeScript sería una copia que se queda vieja,
          // y la que se queda vieja es siempre la que abre de más.
          //
          // Esto es lo único que faltaba para que la solicitud se pudiera
          // aprobar: antes la excepción se llevaba por delante el APPROVED, la
          // factura quedaba anulada y la solicitud PENDIENTE, y cada reintento
          // reventaba en el mismo punto.
          const { data: cerrado, error: intErr } = await admin
            .rpc("marcar_solventado_internamente", {
              p_invoice_id: factura.id,
              p_actor: aprobador.name,
            });

          if (!intErr && cerrado?.ok) {
            interno = cerrado;
            avisos.push(String(cerrado.motivo ?? ""));
          } else if (llegoAHacienda) {
            // No es el caso decidido y el documento sí llegó a armarse: se
            // falla como siempre, para que alguien lo mire. El motivo por el
            // que la base se negó viaja al log — sin él, un caso que debería
            // haber encajado se ve idéntico a uno que nunca aplicó.
            if (intErr) console.error("marcar_solventado_internamente:", intErr.message);
            throw e;
          } else {
            avisos.push("La venta nunca se transmitió a Hacienda, así que no hay nada que invalidar.");
          }
        }
      }

      const aplicadoAnu = {
        at: new Date().toISOString(),
        by: aprobador.id, by_name: aprobador.name,
        erp_invoice_id: erpId, correlativo: factura.correlativo,
        campo: "anulacion",
        anulada_en_erp_ahora: anuladaAhora,
        hacienda: mh ? { sello: mh.sello, descripcion: mh.descripcion, codigo: mh.codigo, fh: mh.fh } : null,
        sin_tramite_mh: !mh && !yaInvalidada,
        // Qué tiene que hacer AHORA quien pidió la anulación. Va aparte de los
        // avisos porque no es una nota al pie: sin volver a facturar, la venta
        // queda sin ningún documento tributario que la respalde.
        solventado_internamente: Boolean(interno),
        instruccion: interno?.instruccion ?? undefined,
        responsable: mh ? { nombre: resp.name, dui } : undefined,
        avisos: avisos.length ? avisos : undefined,
      };

      const { error: updAnuErr } = await admin
        .from("approval_requests")
        .update({
          status: "APPROVED",
          approver_id: aprobador.id,
          approver_note: typeof approver_note === "string" && approver_note.trim()
            ? approver_note.trim() : null,
          metadata: { ...meta, erp_aplicado: aplicadoAnu },
          updated_at: new Date().toISOString(),
        })
        .eq("id", sol.id)
        .eq("status", "PENDING");
      if (updAnuErr) throw updAnuErr;

      return json({ ok: true, aplicado: aplicadoAnu });
    }

    // ── Cambios de datos: leer, aplicar, releer ──────────────────────────
    const antes  = await leerFicha(cookie, erpId);

    let campo = "", de = "", a = "", cuerpo = "";

    if (sol.type === "CLIENT_CHANGE_REQUEST") {
      campo = "cliente";
      de = String(antes.cliente ?? "");
      // SIN fallback a `new_client_id` a propósito: ese es el id del portal y
      // el ERP lo aceptaría como si fuera suyo, cambiando la factura a OTRO
      // cliente sin devolver error. Es la misma trampa que el id de la factura.
      a  = String(meta.new_client_erp_id ?? "");
      if (!a) return json({
        ok: false,
        error: "El cliente elegido no tiene número interno, no se puede aplicar el cambio.",
      }, 422);
      // `cambiar_datos` manda cliente Y pago juntos: el que no cambia viaja con
      // su valor ACTUAL leído recién, no con el que traía la solicitud. Si no,
      // aplicar un cambio de cliente pisaría un cambio de pago hecho en el
      // medio por otra persona.
      cuerpo = await pedir(cookie, REIMPRIMIR, new URLSearchParams({
        process: "cambiar_datos", id_cliente: a,
        credito: String(antes.credito ?? "0"), id_factura: erpId,
      }));
    }

    if (sol.type === "PAYMENT_CHANGE_REQUEST") {
      campo = "tipo_pago";
      de = String(antes.credito ?? "");
      const destino = PAGO_A_ERP[String(meta.new_pago ?? "").toLowerCase()];
      if (!destino) return json({ ok: false, error: `Forma de pago desconocida: ${meta.new_pago}` }, 422);
      a = destino;
      cuerpo = await pedir(cookie, REIMPRIMIR, new URLSearchParams({
        process: "cambiar_datos", id_cliente: String(antes.cliente ?? ""),
        credito: destino, id_factura: erpId,
      }));
    }

    if (sol.type === "VENDOR_CHANGE_REQUEST") {
      campo = "cod_vendedor";
      de = String(antes.vendedor ?? "");
      a  = String(meta.new_vendor_code ?? "");
      if (!a) return json({ ok: false, error: "La solicitud no trae el vendedor destino." }, 422);
      // OJO: el parámetro se llama `numero_doc` aunque lleve el código de
      // vendedor. Es del ERP, no un error de acá.
      cuerpo = await pedir(cookie, REIMPRIMIR, new URLSearchParams({
        process: "cambiar_cod", numero_doc: a, id_factura: erpId,
      }));
    }

    const resp = leerRespuesta(cuerpo);
    if (!resp.ok) return json({ ok: false, error: `No se pudo aplicar el cambio: ${resp.msg}` }, 502);

    // El mensaje del ERP no distingue qué cambió — se comprueba releyendo.
    const despues = await leerFicha(cookie, erpId);
    const quedo = campo === "cliente" ? despues.cliente
                : campo === "tipo_pago" ? despues.credito
                : despues.vendedor;
    if (String(quedo) !== String(a))
      return json({
        ok: false,
        error: `Se pidió el cambio pero la factura quedó en «${quedo}», no en «${a}».`,
      }, 502);

    // ── Recién ahora la solicitud es APPROVED ────────────────────────────
    const aplicado = {
      at: new Date().toISOString(),
      by: aprobador.id, by_name: aprobador.name,
      erp_invoice_id: erpId, correlativo: factura.correlativo,
      campo,
      de: campo === "tipo_pago" ? (ERP_A_PAGO[de] ?? de) : de,
      a:  campo === "tipo_pago" ? (ERP_A_PAGO[a] ?? a) : a,
      cliente_nombre: campo === "cliente" ? despues.clienteNombre : undefined,
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
  } finally {
    /* Soltar el arriendo salga como salga.
     *
     * No hace falta preguntar si la aplicación entró: `liberar_solicitud` sólo
     * toca lo que sigue en PENDING, así que sobre una solicitud ya aprobada es
     * un no-op. Y si esta corrida muere sin llegar hasta acá —una Edge Function
     * se corta a los 150s—, el arriendo vence solo a los 3 minutos: nadie queda
     * trabado esperando a alguien que ya no existe. */
    if (reclamadaId) {
      await admin.rpc("liberar_solicitud", { p_request_id: reclamadaId })
        .then(({ error }) => { if (error) console.error("liberar_solicitud:", error.message); });
    }
  }
});
