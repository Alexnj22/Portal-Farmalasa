import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireActiveEmployeeUser } from "../_shared/security.ts";
import {
  BASE, ANULAR, login, pedir, leerRespuesta, formatearDui, estaAnulada, enviarDteAlMH,
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

      // El endpoint destructivo solo se llama si hace falta. Si la factura ya
      // está anulada en el ERP, lo que falta es el paso ante Hacienda.
      let anuladaAhora = false;
      if (!estaAnulada(factura.estado)) {
        const r = leerRespuesta(await pedir(cookie, ANULAR, new URLSearchParams({
          process: "deleted", id_factura: erpId,
        })));
        if (!r.ok) return json({ ok: false, error: `No se pudo anular la factura: ${r.msg}` }, 502);
        anuladaAhora = true;
      }

      const mh = await enviarDteAlMH(cookie, erpId, String(factura.tipo_documento ?? ""), {
        anula: true, nombreResp: resp.name, duiResp: dui,
      });

      const aplicadoAnu = {
        at: new Date().toISOString(),
        by: aprobador.id, by_name: aprobador.name,
        erp_invoice_id: erpId, correlativo: factura.correlativo,
        campo: "anulacion",
        anulada_en_erp_ahora: anuladaAhora,
        hacienda: { sello: mh.sello, descripcion: mh.descripcion, codigo: mh.codigo, fh: mh.fh },
        responsable: { nombre: resp.name, dui },
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
