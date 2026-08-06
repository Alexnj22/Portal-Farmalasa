import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireActiveEmployeeUser, requireInvokeSecret } from "../_shared/security.ts";
// `anular_factura.php` NO se usa acá a propósito: estas facturas ya están
// anuladas en el ERP —eso es lo que las puso en la bolsa— y lo único que
// falta es el trámite ante Hacienda.
import { login, formatearDui, enviarDteAlMH } from "../_shared/erp-dte.ts";

// Termina lo que quedó a medias entre el ERP y Hacienda.
//
// Son dos bolsas distintas y las dos son el MISMO trámite inconcluso: un
// documento que el ERP ya tiene y el Ministerio todavía no.
//
//   · `anuladas`  — anulada en el ERP, sin invalidar ante el MH
//                   (`estado = 'NULA'`; al invalidarse pasa a
//                   'DTE INVALIDADO EN MH'). Le falta el paso 2.
//   · `sin_sello` — emitida y sin sello de recepción (`recibido_mh IS NULL`).
//                   Nunca llegó a Hacienda.
//
// Ninguna se arregla sola: el sync las trae tal como están y las dos quedan
// esperando a que alguien entre al ERP factura por factura. Medido el
// 2026-08-06 había 14 y 15, repartidas en cinco sucursales, con casos de mayo
// de 2025 — o sea más de un año sin que nadie las cerrara.
//
// ── Dos maneras de entrar ────────────────────────────────────────────────
//   { alcance:'una', invoice_id }        el botón de una fila
//   { alcance:'sucursal', branch_id }    el botón "corregir todas" de la vista
//   { alcance:'todas' }                  el cron de las 22:30
//
// Con JWT se exige `facturacion.can_edit`; el cron entra con el secreto.
//
// ⚠️ OJO AL REDESPLEGAR: va con `--no-verify-jwt`. El cron manda el
// `admin_invoke_secret` como Bearer y eso NO es un JWT, así que con
// `verify_jwt=true` la plataforma contesta 401 ANTES de ejecutar una línea de
// acá — comprobado en el primer intento del 2026-08-06. Un redeploy sin el
// flag la resetea y el barrido deja de correr en silencio; ya pasó dos veces
// en este proyecto con otras funciones. El control de acceso está adentro:
// secreto para el cron, JWT + `facturacion.can_edit` para las personas.
//
//     supabase functions deploy regularizar-dte --no-verify-jwt \
//       --project-ref sacecdkdmsdvgqnrsett
//
// ── Por qué no se paraleliza ─────────────────────────────────────────────
// Una sola sesión PHP y un solo token de Hacienda, compartidos. Mandar cinco
// documentos a la vez por la misma sesión es pedirle al ERP que se pise a sí
// mismo, y el volumen no lo justifica: son decenas, no miles.

const MAX_POR_CORRIDA = 40;   // techo de seguridad, no un límite esperado

interface Pendiente {
  id: number;
  erp_invoice_id: string;
  correlativo: string;
  tipo_documento: string;
  branch_id: number;
  estado: string;
  fecha: string;
  bolsa: "anuladas" | "sin_sello";
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

  try {
    const cuerpo = await req.json().catch(() => ({}));
    const { alcance = "todas", invoice_id, branch_id, bolsa } = cuerpo;

    // ── Quién llama ────────────────────────────────────────────────────
    const esCron = requireInvokeSecret(req);
    let actorId: string | null = null;
    let actorNombre = "Barrido automático";

    if (!esCron) {
      const emp = await requireActiveEmployeeUser(req, admin);
      if (!emp) return json({ ok: false, error: "Sesión inválida o empleado inactivo." }, 401);
      const { data: e } = await admin.from("employees").select("role_id").eq("id", emp.id).maybeSingle();
      const { data: permiso } = await admin.from("role_permissions")
        .select("can_edit").eq("role_id", e?.role_id ?? -1)
        .eq("module_key", "facturacion").maybeSingle();
      if (!permiso?.can_edit)
        return json({ ok: false, error: "No tenés permiso para regularizar facturas." }, 403);
      actorId = emp.id;
      actorNombre = emp.name;
    }

    // ── Qué corregir ───────────────────────────────────────────────────
    const cols = "id, erp_invoice_id, correlativo, tipo_documento, branch_id, estado, fecha";
    const pendientes: Pendiente[] = [];

    if (alcance === "una") {
      if (!invoice_id) return json({ ok: false, error: "Falta invoice_id." }, 400);
      const { data } = await admin.from("sales_invoices").select(cols).eq("id", invoice_id).maybeSingle();
      if (!data) return json({ ok: false, error: "Esa factura ya no está en el portal." }, 404);
      pendientes.push({ ...data, bolsa: data.estado === "NULA" ? "anuladas" : "sin_sello" } as Pendiente);
    } else {
      // Las dos bolsas, salvo que se pida una.
      if (bolsa !== "sin_sello") {
        let q = admin.from("sales_invoices").select(cols).eq("estado", "NULA")
          .order("fecha", { ascending: true }).limit(MAX_POR_CORRIDA);
        if (alcance === "sucursal") q = q.eq("branch_id", Number(branch_id));
        const { data } = await q;
        for (const f of data ?? []) pendientes.push({ ...f, bolsa: "anuladas" } as Pendiente);
      }
      if (bolsa !== "anuladas") {
        let q = admin.from("sales_invoices").select(cols)
          .is("recibido_mh", null)
          .not("estado", "in", '("NULA","DTE INVALIDADO EN MH")')
          .order("fecha", { ascending: true }).limit(MAX_POR_CORRIDA);
        if (alcance === "sucursal") q = q.eq("branch_id", Number(branch_id));
        const { data } = await q;
        for (const f of data ?? []) pendientes.push({ ...f, bolsa: "sin_sello" } as Pendiente);
      }
    }

    if (!pendientes.length)
      return json({ ok: true, revisadas: 0, resueltas: 0, fallidas: 0, detalle: [] });

    // Responsable de las invalidaciones: el mismo siempre, definido por la
    // empresa. No es quien aprieta el botón — es quien responde legalmente.
    const respRaw = Deno.env.get("DTE_RESPONSABLE_ANULACION");
    const respCfg = respRaw ? JSON.parse(respRaw) as { nombre?: string; dui?: string } : null;
    const respDui = formatearDui(respCfg?.dui ?? "");

    const cookie = await login();
    const detalle: unknown[] = [];
    const aResincronizar = new Set<string>();   // `branch_id|fecha`
    let resueltas = 0, fallidas = 0, conObservaciones = 0;

    for (const f of pendientes) {
      const base = {
        invoice_id: f.id, erp_invoice_id: f.erp_invoice_id,
        correlativo: f.correlativo, branch_id: f.branch_id, bolsa: f.bolsa,
      };
      try {
        if (f.bolsa === "anuladas" && (!respCfg?.nombre || !respDui))
          throw new Error("No está configurado el responsable de anulaciones ante Hacienda.");

        const mh = await enviarDteAlMH(cookie, String(f.erp_invoice_id), f.tipo_documento, {
          anula: f.bolsa === "anuladas",
          nombreResp: respCfg?.nombre,
          duiResp: respDui ?? undefined,
        });
        resueltas++;
        // Hacienda acepta con observaciones ("RECIBIDO CON OBSERVACIONES", visto
        // en la 344391 el 2026-08-06): hay sello, o sea que entró, pero el MH
        // tiene algo que decir. Tragárselas convertiría una advertencia real en
        // un éxito liso — se guardan y suben la severidad del registro.
        detalle.push({
          ...base, ok: true, sello: mh.sello, respuesta: mh.descripcion,
          ...(mh.observaciones.length ? { observaciones: mh.observaciones } : {}),
        });
        if (mh.observaciones.length) conObservaciones++;
        aResincronizar.add(`${f.branch_id}|${f.fecha}`);
      } catch (e) {
        fallidas++;
        detalle.push({ ...base, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }

    // Queda registrado SIEMPRE, incluso cuando no se resolvió nada: un barrido
    // que no dejó rastro es indistinguible de uno que no corrió.
    // ── Que el portal se entere YA ───────────────────────────────────
    // El sello lo pone Hacienda y llega por el sync, NUNCA lo escribe el
    // portal (CLAUDE.md: "el tipo de la columna manda" — ahí está la historia
    // del `recibido_mh = true` que pisaba el sello fiscal).
    //
    // `dte-resync-mes-hora` ya relee un mes cada hora, así que esto NO es lo
    // que evita que se pierda: es lo que evita esperar hasta una hora. Importa
    // por el botón —quien lo aprieta tiene que ver el resultado, no un "volvé
    // más tarde"— y porque sin él una corrida podría reintentar una factura
    // que ya se arregló hace diez minutos.
    //
    // Se le pide al sync que relea ESA fecha y ESA sucursal. El valor sigue
    // viniendo de donde tiene que venir.
    const secreto = Deno.env.get("ADMIN_INVOKE_SECRET");
    for (const clave of aResincronizar) {
      const [suc, fecha] = clave.split("|");
      try {
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/sync-dte-sales`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${secreto}` },
          body: JSON.stringify({ fini: fecha, ffin: fecha, branchId: Number(suc), skipDte: false }),
          signal: AbortSignal.timeout(120_000),
        });
      } catch (e) {
        console.error(`resync ${clave}:`, e instanceof Error ? e.message : String(e));
      }
    }

    const { error: auditErr } = await admin.from("audit_logs").insert({
      action:    "DTE_REGULARIZADO",
      target_id: alcance === "una" ? String(invoice_id) : alcance,
      user_id:   actorId,
      user_name: actorNombre,
      // El barrido de las 22:30 no lo dispara una persona: es del sistema, y
      // decir lo contrario ensuciaría la bitácora. Y un fallo es WARNING, no
      // INFO — si no, se pierde entre las corridas que salieron bien.
      source:    esCron ? "SYSTEM" : "ADMIN_PANEL",
      severity:  (fallidas > 0 || conObservaciones > 0) ? "WARNING" : "INFO",
      branch_id: alcance === "sucursal" ? Number(branch_id) : null,
      details: {
        alcance, por: actorNombre,
        revisadas: pendientes.length, resueltas, fallidas,
        con_observaciones: conObservaciones, detalle,
      },
    });
    if (auditErr) console.error("audit_logs:", auditErr.message);

    return json({
      ok: true, revisadas: pendientes.length, resueltas, fallidas,
      con_observaciones: conObservaciones, detalle,
    });

  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
