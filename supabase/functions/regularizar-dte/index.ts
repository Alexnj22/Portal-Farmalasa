import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireActiveEmployeeUser, requireInvokeSecret } from "../_shared/security.ts";
// `anular_factura.php` NO se usa acá a propósito: estas facturas ya están
// anuladas en el ERP —eso es lo que las puso en la bolsa— y lo único que
// falta es el trámite ante Hacienda.
import { login, formatearDui, enviarDteAlMH, RechazoMH } from "../_shared/erp-dte.ts";

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

// Una Edge Function vive 150 s. Cada documento son cuatro viajes al ERP
// (~0.3 s cada uno, medido) más la llamada a Hacienda, que es la lenta y la
// que no controlamos. El presupuesto se corta MUY por debajo del límite para
// que siempre alcance a escribir el registro y disparar el re-sync: una
// corrida que muere a mitad no deja rastro, y esa es la peor forma de fallar.
const PRESUPUESTO_MS = 110_000;

// Techo duro por si el reloj miente. No es el límite esperado: el que manda es
// el presupuesto de tiempo.
const MAX_POR_CORRIDA = 60;

// Respiro entre documentos. Hacienda es un servicio del Estado y no publica
// sus límites de tasa; mandarle 300 documentos tan rápido como el bucle pueda
// es pedir que nos empiece a rechazar por volumen. 400 ms no cambia nada
// cuando son diez y evita el ráfaga cuando son cientos.
const PAUSA_ENTRE_ENVIOS_MS = 400;

// El sello de recepción son 40 caracteres. Se compara por la FORMA del dato y
// no por "no es null": `recibido_mh` es text y llegó a tener 'undefined' y ''
// guardados, que `IS NOT NULL` daba por buenos (CLAUDE.md, "el tipo de la
// columna manda"). Mismo criterio que `SELLO_MH_LIKE` en src/data/facturacion.js.
const SELLO_MH_LIKE = "_".repeat(40);

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

/**
 * Deja constancia del envío en `dte_mh_intentos`, salga bien o mal.
 *
 * Hasta acá la respuesta del MH vivía en tres lugares y ninguno servía para
 * actuar: el ERP (`save_response_mh`), la respuesta HTTP —que se pierde al
 * cerrar la pestaña— y el JSON de `audit_logs`. Una factura sellada CON
 * observaciones se veía idéntica a una limpia.
 *
 * NUNCA tumba la corrida: si el insert falla, se anota en el log y se sigue.
 * El trabajo real es el envío a Hacienda, y perder el registro de un intento es
 * malo, pero abortar el barrido por eso es peor.
 */
async function registrarIntento(
  admin: ReturnType<typeof createClient>,
  f: Pendiente,
  r: {
    ok: boolean;
    sello?: string | null;
    codigo_msg?: string | null;
    descripcion_msg?: string | null;
    observaciones?: string[];
    fh_procesamiento?: string | null;
    error?: string | null;
  },
) {
  const { error } = await admin.from("dte_mh_intentos").insert({
    invoice_id: f.id,
    erp_invoice_id: String(f.erp_invoice_id),
    correlativo: f.correlativo,
    branch_id: f.branch_id,
    bolsa: f.bolsa,
    ok: r.ok,
    sello: r.sello ?? null,
    codigo_msg: r.codigo_msg ?? null,
    descripcion_msg: r.descripcion_msg ?? null,
    observaciones: r.observaciones ?? [],
    fh_procesamiento: r.fh_procesamiento ?? null,
    error: r.error ?? null,
  });
  if (error) console.error(`dte_mh_intentos (factura ${f.id}):`, error.message);
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
    const { alcance = "todas", invoice_id, branch_id, bolsa, segundaVuelta = false } = cuerpo;

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

    // Lista negra: decisiones explícitas de "no lo intentes". Se aplica ANTES
    // de cualquier otro filtro y también al alcance 'una', que es un botón —
    // si alguien aprieta el de una factura excluida, tiene que enterarse de
    // por qué, no ver otro fallo igual al de todas las noches.
    const { data: exc } = await admin.from("dte_excluidas_del_barrido")
      .select("invoice_id, motivo");
    const excluidas = new Map<number, string>(
      (exc ?? []).map((e: { invoice_id: number; motivo: string }) => [e.invoice_id, e.motivo]));

    if (alcance === "una") {
      if (!invoice_id) return json({ ok: false, error: "Falta invoice_id." }, 400);
      const { data } = await admin.from("sales_invoices").select(cols).eq("id", invoice_id).maybeSingle();
      if (!data) return json({ ok: false, error: "Esa factura ya no está en el portal." }, 404);
      if (excluidas.has(Number(invoice_id)))
        return json({ ok: false, excluida: true,
                      error: `Esta factura está excluida del barrido: ${excluidas.get(Number(invoice_id))}` }, 409);
      pendientes.push({ ...data, bolsa: data.estado === "NULA" ? "anuladas" : "sin_sello" } as Pendiente);
    } else {
      // Las dos bolsas, salvo que se pida una.
      if (bolsa !== "sin_sello") {
        // SOLO las que Hacienda recibió alguna vez. No se puede invalidar ante
        // el MH un documento que el MH nunca tuvo, y el ERP lo dice sin
        // rodeos: "Esta factura no ha sido validada por MH no se puede validar
        // la anulacion".
        //
        // Medido el 2026-08-07: las 8 anuladas de la cola están las 8 sin
        // sello, y el barrido las reintentaba TODAS LAS NOCHES desde que
        // existe — 4 intentos registrados por cada una. Son CCF de arranque
        // (correlativos 1, 2, 4, 5) y errores anulados antes de transmitir.
        // Nunca van a entrar, así que dejan de intentarse y se cuentan aparte.
        let q = admin.from("sales_invoices").select(cols).eq("estado", "NULA")
          .like("recibido_mh", SELLO_MH_LIKE)
          .order("fecha", { ascending: true }).limit(MAX_POR_CORRIDA);
        if (alcance === "sucursal") q = q.eq("branch_id", Number(branch_id));
        const { data } = await q;
        for (const f of data ?? [])
          if (!excluidas.has(f.id)) pendientes.push({ ...f, bolsa: "anuladas" } as Pendiente);
      }
      if (bolsa !== "anuladas") {
        let q = admin.from("sales_invoices").select(cols)
          .is("recibido_mh", null)
          .not("estado", "in", '("NULA","DTE INVALIDADO EN MH")')
          .order("fecha", { ascending: true }).limit(MAX_POR_CORRIDA);
        if (alcance === "sucursal") q = q.eq("branch_id", Number(branch_id));
        const { data } = await q;
        for (const f of data ?? [])
          if (!excluidas.has(f.id)) pendientes.push({ ...f, bolsa: "sin_sello" } as Pendiente);
      }
    }

    // Cuántas hay DE VERDAD, más allá de las que entran en esta corrida. Sin
    // esto, un tope de 60 sobre un atraso de 300 reporta "60 revisadas" y se
    // lee como "ya está todo": el mismo defecto que el `.limit(500)` del
    // widget, que mostraba 500 de 4,000 como si fueran todas.
    const contar = async (bolsaCount: "anuladas" | "sin_sello") => {
      let q = admin.from("sales_invoices").select("id", { count: "exact", head: true });
      q = bolsaCount === "anuladas"
        // Mismo filtro que la selección: contar las que no se pueden invalidar
        // haría que `restantes` no llegue nunca a cero y el barrido pareciera
        // atrasado para siempre.
        ? q.eq("estado", "NULA").like("recibido_mh", SELLO_MH_LIKE)
        : q.is("recibido_mh", null).not("estado", "in", '("NULA","DTE INVALIDADO EN MH")');
      if (alcance === "sucursal") q = q.eq("branch_id", Number(branch_id));
      const { count } = await q;
      return count ?? 0;
    };

    // Las anuladas que nunca llegaron a Hacienda. No entran al barrido, pero se
    // informan: un documento que se deja de intentar en silencio es
    // indistinguible de uno que se resolvió.
    const contarSinTramite = async () => {
      let q = admin.from("sales_invoices")
        .select("id", { count: "exact", head: true })
        .eq("estado", "NULA")
        // `.not("recibido_mh","like",…)` NO alcanza: con la columna en NULL la
        // comparación da NULL, no true, y las filas no se cuentan. Las 8 reales
        // están todas en NULL, así que el contador daba 0 y las dejaba
        // invisibles — el mismo hueco que el `accionable` sin coalesce.
        .or(`recibido_mh.is.null,recibido_mh.not.like.${SELLO_MH_LIKE}`);
      if (alcance === "sucursal") q = q.eq("branch_id", Number(branch_id));
      const { count } = await q;
      return count ?? 0;
    };
    const anuladasSinTramite = alcance === "una" ? 0 : await contarSinTramite();
    const totalPendiente = alcance === "una"
      ? pendientes.length
      : (bolsa === "sin_sello" ? 0 : await contar("anuladas"))
        + (bolsa === "anuladas" ? 0 : await contar("sin_sello"));

    if (!pendientes.length)
      return json({ ok: true, revisadas: 0, resueltas: 0, fallidas: 0,
                    total_pendiente: totalPendiente, restantes: totalPendiente,
                    anuladas_sin_tramite: anuladasSinTramite,
                    excluidas: excluidas.size, detalle: [] });

    // Responsable de las invalidaciones: el mismo siempre, definido por la
    // empresa. No es quien aprieta el botón — es quien responde legalmente.
    const respRaw = Deno.env.get("DTE_RESPONSABLE_ANULACION");
    const respCfg = respRaw ? JSON.parse(respRaw) as { nombre?: string; dui?: string } : null;
    const respDui = formatearDui(respCfg?.dui ?? "");

    const cookie = await login();
    const detalle: unknown[] = [];
    const aResincronizar = new Set<string>();   // `branch_id|fecha`
    let resueltas = 0, fallidas = 0, conObservaciones = 0;

    const arranque = Date.now();
    let cortadaPorTiempo = false;
    let procesadas = 0;

    for (const f of pendientes) {
      // Se corta ANTES de empezar otro documento, no en el medio: un envío a
      // Hacienda no se puede dejar por la mitad.
      if (Date.now() - arranque > PRESUPUESTO_MS) { cortadaPorTiempo = true; break; }

      const base = {
        invoice_id: f.id, erp_invoice_id: f.erp_invoice_id,
        correlativo: f.correlativo, branch_id: f.branch_id, bolsa: f.bolsa,
      };
      try {
        // La lista se armó hace un rato y el re-sync horario pudo haber
        // resuelto ésta en el medio. Volver a mirar cuesta una lectura y evita
        // mandarle a Hacienda un documento que ya entró.
        const { data: ahora } = await admin.from("sales_invoices")
          .select("estado, recibido_mh").eq("id", f.id).maybeSingle();
        const yaResuelta = f.bolsa === "anuladas"
          ? ahora?.estado !== "NULA"
          : !!ahora?.recibido_mh;
        if (yaResuelta) { detalle.push({ ...base, ok: true, omitida: "ya estaba resuelta" }); continue; }

        if (f.bolsa === "anuladas" && (!respCfg?.nombre || !respDui))
          throw new Error("No está configurado el responsable de anulaciones ante Hacienda.");

        const mh = await enviarDteAlMH(cookie, String(f.erp_invoice_id), f.tipo_documento, {
          anula: f.bolsa === "anuladas",
          nombreResp: respCfg?.nombre,
          duiResp: respDui ?? undefined,
        });
        await registrarIntento(admin, f, {
          ok: true, sello: mh.sello, codigo_msg: mh.codigo,
          descripcion_msg: mh.descripcion, observaciones: mh.observaciones,
          fh_procesamiento: mh.fh,
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
        procesadas++;
        await new Promise(r => setTimeout(r, PAUSA_ENTRE_ENVIOS_MS));
      } catch (e) {
        fallidas++;
        const msg = e instanceof Error ? e.message : String(e);
        // Un rechazo DE Hacienda trae sus observaciones enteras; un fallo ANTES
        // de Hacienda (el ERP no armó el documento, la sesión se cayó) no tiene
        // ninguna. La bandeja los separa por eso, así que no se mezclan acá.
        const r = e instanceof RechazoMH ? e : null;
        await registrarIntento(admin, f, {
          ok: false, error: msg,
          observaciones: r?.observaciones ?? [],
          descripcion_msg: r?.descripcion ?? null,
          codigo_msg: r?.codigo ?? null,
          fh_procesamiento: r?.fh ?? null,
        });
        detalle.push({ ...base, ok: false, error: msg,
                       ...(r?.observaciones.length ? { observaciones: r.observaciones } : {}) });
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

    // ── La segunda vuelta: corregir y REENVIAR la misma noche ─────────────
    // Antes el ciclo tardaba un día: se enviaba a las 22:30, el rechazo
    // quedaba anotado, la corrida de fichas del día SIGUIENTE lo corregía a
    // las 21:30 y recién a las 22:30 se reintentaba. Una factura rechazada
    // pasaba 24 horas sin sello por un dato que se arregla solo.
    //
    // Ahora, si quedó algún rechazo accionable —de los que se corrigen tocando
    // la ficha— se llama a la corrida de fichas en alcance «rechazos» y se
    // vuelve a enviar, todo dentro de la misma noche.
    //
    // `segundaVuelta` es el freno de recursión: la llamada de vuelta lo trae
    // en true y ahí el bloque no se ejecuta. Sin eso, un rechazo que la
    // corrección no arregla haría rebotar las dos funciones sin fin.
    let segundaVueltaHecha = false;
    if (!segundaVuelta && esCron) {
      const { count } = await admin
        .from("dte_rechazos_vigentes")
        .select("invoice_id", { count: "exact", head: true })
        .eq("accionable", true);

      // Margen para las DOS llamadas encadenadas, no el resto del presupuesto:
      // arrancar la cadena sin tiempo de terminarla deja la corrección hecha
      // y el reenvío sin hacer, que es el peor de los dos mundos.
      const MARGEN_SEGUNDA_VUELTA_MS = 60_000;
      if ((count ?? 0) > 0 && Date.now() - arranque < PRESUPUESTO_MS - MARGEN_SEGUNDA_VUELTA_MS) {
        try {
          const cab = { "Content-Type": "application/json", Authorization: `Bearer ${secreto}` };
          await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/sincronizar-fichas-clientes`, {
            method: "POST", headers: cab,
            body: JSON.stringify({ alcance: "rechazos" }),
            signal: AbortSignal.timeout(120_000),
          });
          await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/regularizar-dte`, {
            method: "POST", headers: cab,
            body: JSON.stringify({ alcance: "todas", segundaVuelta: true }),
            signal: AbortSignal.timeout(120_000),
          });
          segundaVueltaHecha = true;
        } catch (e) {
          console.error("segunda vuelta:", e instanceof Error ? e.message : String(e));
        }
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
      severity:  (fallidas > 0 || conObservaciones > 0 || cortadaPorTiempo) ? "WARNING" : "INFO",
      branch_id: alcance === "sucursal" ? Number(branch_id) : null,
      details: {
        alcance, por: actorNombre,
        revisadas: procesadas, resueltas, fallidas,
        con_observaciones: conObservaciones,
        total_pendiente: totalPendiente,
        restantes: Math.max(0, totalPendiente - resueltas),
        // Anuladas que Hacienda nunca recibió: no hay nada que invalidar y no
        // se intentan. Se anotan para que no desaparezcan del radar.
        anuladas_sin_tramite: anuladasSinTramite,
        excluidas: excluidas.size,
        cortada_por_tiempo: cortadaPorTiempo,
        segunda_vuelta: segundaVueltaHecha,
        detalle,
      },
    });
    if (auditErr) console.error("audit_logs:", auditErr.message);

    return json({
      ok: true,
      revisadas: procesadas, resueltas, fallidas,
      con_observaciones: conObservaciones,
      // Lo que había y lo que queda. Un tope que no se anuncia se lee como
      // "ya está todo".
      total_pendiente: totalPendiente,
      restantes: Math.max(0, totalPendiente - resueltas),
      anuladas_sin_tramite: anuladasSinTramite,
      excluidas: excluidas.size,
      cortada_por_tiempo: cortadaPorTiempo,
      segunda_vuelta: segundaVueltaHecha,
      detalle,
    });

  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
