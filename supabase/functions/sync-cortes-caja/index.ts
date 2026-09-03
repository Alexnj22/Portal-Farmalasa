import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders, requireInvokeSecret, getErpBranchMap } from "../_shared/security.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Captura los cortes de caja y los movimientos de caja de cada sala.
//
// LOS DOS ENDPOINTS, ANOTADOS PORQUE NO SE ADIVINAN
// Ninguno está en el HTML de la pantalla: los handlers viven en
// `js/funciones/funciones_corte_caja.js` y `js/funciones/funciones_caja_chica.js`.
//
//   POST admin_corte.php                process=ok&fecha1=&fecha2=
//        → fragmento HTML con las filas: N°, fecha, hora, empleado, turno,
//          tipo (C|Z), total, diferencia, y el id_corte en los enlaces.
//   POST corte_caja_diario.php          process=imprimir&id_corte=&id_sucursal_dom=
//        → JSON; el ticket entero viene en la clave `movimiento`.
//   GET  admin_movimiento_caja_dt.php   ?fechai=&fechaf=&draw=1&start=0&length=N
//        → JSON de DataTables: [id, concepto, fecha, monto, tipo, acciones].
//
// Pedir `admin_corte.php` sin `process=ok` devuelve la pantalla entera con el
// rango por omisión (mes corriente), no un error — o sea que un chequeo de
// status no atrapa el filtro mal armado.
//
// LA SUCURSAL ES ESTADO DE SESIÓN, no un parámetro: sin `cambio_sesion.php`
// se trae la del usuario y se guarda como si fuera la pedida. Mismo cuidado
// que en sync-corte-z.
//
// QUÉ SE GUARDA Y POR QUÉ (el detalle largo está en la migración
// 20260814041419_cortes_de_caja_captura.sql): la diferencia del origen se
// calcula en el NAVEGADOR del dependiente y se manda como parámetro, así que
// no se le puede creer sola. Se guardan los dos números tal cual y el
// `esperado` sale de restarlos — ese sí es del momento del corte y no deriva.
//
// INSERT-ONLY sobre `cortes_caja`: un corte ya guardado NO se vuelve a tocar.
// La tabla lleva el estado que puso una persona (CONFIRMADO / DESCARTADO) y
// una corrida que "refresque" lo pisaría sin dejar rastro.
//
// CORRE CADA MINUTO, y es a propósito: apenas cortan, lo primero que hacen en
// la sala es verificar que todo esté bien, así que el corte tiene que estar en
// el portal enseguida. De paso mantiene `desfase_seg` chico, que es lo único
// que vuelve creíbles los campos `tk_*` del ticket.
//
// Dos corridas encimadas no hacen daño: cada una hace su propio login (sesión
// propia, sin cruce de sucursal) y el INSERT va con `ignoreDuplicates`. Por eso
// no lleva candado — el del Apps Script existía por los límites de Apps Script,
// no por el origen.
// ═══════════════════════════════════════════════════════════════════════════

const BASE       = "https://clientesdte3.oss.com.sv/farma_salud/";
const LOGIN_URL  = `${BASE}login.php`;
const SESION_URL = `${BASE}cambio_sesion.php`;
const CORTE_URL  = `${BASE}admin_corte.php`;
const TICKET_URL = `${BASE}corte_caja_diario.php`;
const MOV_URL    = `${BASE}admin_movimiento_caja_dt.php`;

/** Bodega no tiene caja: no emite cortes. */
const ERP_BODEGA = 6;

function getCortesCreds(): { username: string; password: string } {
  const raw = Deno.env.get("ERP_CORTES_CREDS");
  if (!raw) throw new Error("ERP_CORTES_CREDS secret no configurado.");
  return JSON.parse(raw);
}

async function getSessionCookie(username: string, password: string): Promise<string> {
  const res = await fetch(LOGIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, m: "1" }).toString(),
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("login sin cookie de sesión");
  return cookie;
}

/**
 * Una sesión POR SALA, viva entre corridas.
 *
 * ── Por qué ──────────────────────────────────────────────────────────────
 * Esta función corre cada 30 segundos de 7 a 23 SV —la ventana la aplica
 * `HORA_DESDE`/`HORA_HASTA` más abajo, porque el cron no puede—, porque quien corta la caja
 * quiere verlo en el momento: si hubo diferencia tiene que poder revisarla y
 * rehacer el corte ahí mismo, no media hora después. Esa cadencia no se toca.
 *
 * Lo que sí se puede bajar es lo que cuesta CADA corrida. Antes eran 13
 * peticiones al sistema: un ingreso + un cambio de sala y un listado por cada
 * una de las 6 salas. Pero la sala es estado de la sesión y la sesión sobrevive
 * a la corrida, así que teniendo una cookie ya parada en cada sala, la corrida
 * es solamente los 6 listados. Medido el 2026-08-20: ingresar cuesta 488 ms,
 * cambiarse de sala 263 y el listado 83-152. O sea que se va más de la mitad
 * del trabajo en preparar la sesión, no en preguntar.
 *
 * ── La trampa, y cómo se detecta ─────────────────────────────────────────
 * Una sesión vencida NO da error: `admin_corte.php` devuelve la pantalla
 * entera en vez del fragmento, y eso ya se detectaba (mezclar esa respuesta con
 * el listado real guardaría cortes de otro rango). Acá esa misma señal sirve
 * para rehacer la sesión y volver a preguntar UNA vez. Si la segunda también
 * viene entera, es otra cosa y se reporta como antes.
 *
 * Se probó primero si el listado podía traer las 6 salas de una: no. Con
 * `id_sucursal_dom` de cualquier valor devuelve 146 bytes y cero filas, y sin
 * acotar por sala el listado de traslados —el mismo patrón— tardó más de 60
 * segundos intentando devolver 30.255 filas. El bucle por sala lo impone el
 * sistema, no el portal.
 */
const sesiones = new Map<number, string>();

async function sesionDeSala(erpId: number, username: string, password: string): Promise<string> {
  const guardada = sesiones.get(erpId);
  if (guardada) return guardada;
  const cookie = await getSessionCookie(username, password);
  // ⚠️ El cambio de sala se COMPRUEBA antes de guardar la sesión.
  //
  // Antes no se miraba, y con la sesión de un solo uso el daño de que fallara
  // era de una corrida. Guardada, una cookie parada en la sala equivocada
  // devolvería los cortes de OTRA sala en cada corrida siguiente, y se
  // guardarían con el `branch_id` de ésta. Eso es peor que no ver un corte: es
  // verlo mal. Si no se pudo fijar, la sesión no se guarda y esta sala reporta
  // su error como cualquier otro fallo.
  const r = await fetch(SESION_URL, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ process: "set_sucursal", id_sucursal: String(erpId) }).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  let fijada = false;
  try {
    fijada = Boolean(JSON.parse(await r.text())?.success);
  } catch {
    fijada = false;
  }
  if (!fijada) throw new Error(`no se pudo abrir la sala ${erpId} en el sistema`);
  sesiones.set(erpId, cookie);
  return cookie;
}

async function listarCortes(cookie: string, fecha1: string, fecha2: string): Promise<string> {
  const res = await fetch(CORTE_URL, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: new URLSearchParams({ process: "ok", fecha1, fecha2 }).toString(),
    signal: AbortSignal.timeout(60_000),
  });
  return await res.text();
}

/**
 * "$ 1,590.29" → 1590.29 · "+     3.39" → 3.39 · "-621.17" → -621.17
 * Devuelve null cuando no hay número, para no confundir "no vino" con cero:
 * un cero inventado en una diferencia es exactamente el error que este módulo
 * existe para atrapar.
 */
function money(s: unknown): number | null {
  if (s === null || s === undefined) return null;
  const limpio = String(s).replace(/[^0-9.+-]/g, "").replace(/^\+/, "");
  if (!limpio || !/\d/.test(limpio)) return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

const texto = (html: string) =>
  html.replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
      .replace(/&oacute;/g, "ó").replace(/&eacute;/g, "é")
      .replace(/\s+/g, " ").trim();

/** "13-08-2026" → "2026-08-13" */
function fechaISO(dmy: string): string | null {
  const m = dmy.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

interface FilaCorte {
  erpCorteId: number;
  fecha: string;
  hora: string;
  turno: number | null;
  tipo: string;
  total: number | null;
  diferencia: number | null;
}

function parsearListado(html: string): FilaCorte[] {
  const filas: FilaCorte[] = [];
  for (const [, tr] of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => texto(m[1]));
    if (tds.length < 8) continue;
    const id = tr.match(/id_corte=(\d+)/);
    const fecha = fechaISO(tds[1]);
    if (!id || !fecha) continue;
    const tipo = tds[5].toUpperCase();
    /* La X entra desde el 31-ago. Es una LECTURA de ventas —no cuenta el
     * efectivo— y no suma en ninguna cuenta del portal, que ya filtra por
     * `tipo === 'C'`. Se guarda porque un documento que existe del otro lado y
     * no acá es invisible por construcción: el corte 14318 de Salud 3 salió X
     * por el default del formulario, y no aparecía en ninguna pantalla.
     *
     * Sigue siendo una lista blanca y no un `else`: un tipo que nadie conoció
     * se descarta, que es la falla segura. */
    if (!["C", "Z", "X"].includes(tipo)) continue;
    filas.push({
      erpCorteId: Number(id[1]),
      fecha,
      hora: tds[2],
      turno: Number(tds[4]) || null,
      tipo,
      total: money(tds[6]),
      diferencia: money(tds[7]),
    });
  }
  return filas;
}

const linea = (rx: RegExp, mov: string) => money(mov.match(rx)?.[1]);

function parsearTicket(mov: string) {
  return {
    empleado_texto: mov.match(/EMPLEADO:\s*([^\n]+)/i)?.[1]?.trim() || null,
    // Anclado a TURNO a propósito: `CAJA\s*:\s*(\d+)` a secas también calza
    // con la línea `CORTE DE CAJA  : 13783` que va más arriba, y guardaría el
    // número del corte como si fuera el de la caja.
    caja_erp: Number(mov.match(/\bCAJA\s*:\s*(\d+)\s*TURNO/i)?.[1]) || null,
    tk_saldo_inicial:    linea(/SALDO\s+INICIAL\s*\$:\s*([^\n]+)/i, mov),
    tk_saldo_caja_chica: linea(/SALDO\s+CAJA\s+CHICA\s*\$:\s*([^\n]+)/i, mov),
    tk_ingresos:         linea(/\(\+\)\s*INGRESOS\s*\$:\s*([^\n]+)/i, mov),
    tk_venta:            linea(/\(\+\)\s*VENTA\s*\$:\s*([^\n]+)/i, mov),
    tk_subtotal:         linea(/SUBTOTAL\s*\$:\s*([^\n]+)/i, mov),
    tk_vales:            linea(/\(-\)\s*VALES\s*\$:\s*([^\n]+)/i, mov),
    // El AppScript viejo NO leía esta línea, y entra en el TOTAL CAJA.
    tk_cobros_credito:   linea(/\(\+\)\s*COBROS\s+CREDITO\s*\$:\s*([^\n]+)/i, mov),
    tk_total_caja:       linea(/TOTAL\s+CAJA\s*\$:\s*([^\n]+)/i, mov),
    tk_retencion:        linea(/\(-\)\s*RETENCION\s*\$:\s*([^\n]+)/i, mov),
    tk_devoluciones:     linea(/\(-\)\s*DEVOLUCIONES\s*\$:\s*([^\n]+)/i, mov),
    // Ojo: la línea EFECTIVO es efectivo+tarjeta+cheque, no dinero contado.
    tk_efectivo:         linea(/\bEFECTIVO\s*\$:\s*([^\n]+)/i, mov),
    tk_tarjeta:          linea(/PAGOS\s+CON\s+TARJETA[\s\S]*?TOTAL\s+([^\n]+)/i, mov),
    tk_credito:          linea(/VENTAS\s+AL\s+CREDITO[\s\S]*?TOTAL\s+([^\n]+)/i, mov),
  };
}

/** Hora SV = UTC-6, sin horario de verano. */
function hoySV(): string {
  return new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
}

/**
 * La hora SV, 0-23.
 *
 * Se deriva del mismo desplazamiento que `hoySV` a propósito: si un día El
 * Salvador adoptara horario de verano, las dos tienen que moverse juntas o la
 * ventana de abajo dejaría de coincidir con el día que se sincroniza.
 */
function horaSV(): number {
  return new Date(Date.now() - 6 * 3600_000).getUTCHours();
}

/**
 * La ventana en la que hay cortes que sincronizar.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 * El cron dispara cada 30 segundos y **no tiene ventana horaria**: `pg_cron` con
 * un intervalo (`30 seconds`) no admite un rango de horas como sí lo admite una
 * expresión cron. Así que la función corría 2.880 veces al día mientras el
 * manifiesto de `gate:eficiencia` declaraba 1.920 —«cada 30 s de 7 a 22 SV»— y
 * el encabezado de arriba decía lo mismo. Las tres cosas se contradecían y nadie
 * lo miraba: son **6 peticiones por corrida**, o sea ~5.760 diarias al sistema
 * de origen entre las 23:00 y las 07:00, con las salas cerradas.
 *
 * ── De dónde sale el rango ────────────────────────────────────────────────
 * De los cortes reales, no del horario nominal. Medido sobre 60 días: el primero
 * es a las **9** y el último a las **22** —hay 24 cortes en esa hora—, así que la
 * ventana llega hasta las 23:00 y no hasta las 22:00. Cortar a las 22 en punto
 * habría dejado sin sincronizar hasta la mañana siguiente justamente los cortes
 * de cierre, que son los que más se miran.
 *
 * 16 horas × 120 corridas = 1.920 al día, que es exactamente lo que el
 * manifiesto ya declaraba.
 *
 * ── Lo que NO frena ───────────────────────────────────────────────────────
 * Una llamada con fechas explícitas es un backfill hecho a mano, y ésa tiene que
 * poder correr a cualquier hora: quien la ejecuta ya decidió qué quiere.
 */
const HORA_DESDE = 7;
const HORA_HASTA = 23;   // exclusivo: la última corrida es a las 22:59:30

/**
 * Cada cuánto se releen los movimientos cuando NO apareció un corte nuevo.
 *
 * ── El agujero que cierra ─────────────────────────────────────────────────
 * Hasta hoy los movimientos sólo se pedían al aparecer un corte. El razonamiento
 * era de volumen y era correcto —hasta 1000 filas por sala, 120 veces por hora,
 * casi siempre para nada—, pero deja la lista de movimientos **vacía toda la
 * mañana**: medido el 3-sep a las 11:00 SV, cero movimientos del día en las seis
 * salas, porque el primer corte es a la una. Quien entra a «Movimientos» a ver
 * qué pasó hoy no ve nada, y un vale hecho a las nueve no existe para el portal
 * hasta la tarde.
 *
 * Y no es sólo mirar: lo que la captura no vio todavía tampoco puede
 * emparejarse con el cobro que lo produjo.
 *
 * ── Por qué cinco minutos y no cada corrida ───────────────────────────────
 * Cada corrida son 6 salas × 1 petición = 6 más. Cada 30 segundos serían ~11.500
 * peticiones diarias de más al sistema de origen, que es el orden de magnitud
 * que ya obligó a poner la ventana horaria de arriba. Cada 5 minutos son
 * 6 × 12 × 16 h = **1.152 al día**, y una lista de movimientos con cinco minutos
 * de atraso contesta la pregunta igual de bien.
 *
 * El reloj sale de la BASE y no de una variable del proceso: un isolate se
 * recicla sin avisar y con una variable en memoria la cuenta arrancaría de cero
 * cada vez, o sea que volvería a pedir siempre. `visto_at` es la marca que la
 * captura ya escribe en cada fila que encuentra — no hace falta ninguna columna
 * nueva.
 */
const MINUTOS_ENTRE_REPASOS = 5;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!requireInvokeSecret(req)) {
    return new Response(JSON.stringify({ ok: false, error: "UNAUTHORIZED" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));

    // Fuera de la ventana no hay cortes que traer: se contesta sin gastar una
    // sola petición. `ok: true` porque no es un fallo — es que no había trabajo,
    // y un `false` acá ensuciaría la tasa de error del cron.
    const conFechas = /^\d{4}-\d{2}-\d{2}$/.test(String(body.desde ?? ""));
    const h = horaSV();
    if (!conFechas && (h < HORA_DESDE || h >= HORA_HASTA)) {
      return new Response(
        JSON.stringify({ ok: true, omitido: "fuera de horario", hora_sv: h }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const fecha1: string = conFechas ? body.desde : hoySV();
    const fecha2: string = /^\d{4}-\d{2}-\d{2}$/.test(String(body.hasta ?? "")) ? body.hasta : fecha1;
    const onlyBranch = body.branchId != null ? Number(body.branchId) : null;

    const { username, password } = getCortesCreds();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const objetivo = getErpBranchMap()
      .map((b) => ({ branchId: b.branchId, erpId: b.erpId }))
      .filter((b) => b.erpId !== ERP_BODEGA)
      .filter((b) => !onlyBranch || b.branchId === onlyBranch);

    const resultados: unknown[] = [];

    // Secuencial a propósito: el origen sirve estos reportes desde archivos
    // temporales de ruta fija y dos peticiones a la vez chocan (medido el
    // 2026-08-03 en sync-corte-z: HTTP 200 con warnings de PHP adentro).
    for (const { branchId, erpId } of objetivo) {
      try {
        // ── Cortes ──────────────────────────────────────────────────────────
        let cookie = await sesionDeSala(erpId, username, password);
        let htmlLista = await listarCortes(cookie, fecha1, fecha2);

        // La pantalla completa en vez del fragmento significa que el filtro no
        // se aplicó (sesión caída o sin permiso). Guardar eso mezclaría cortes
        // de otro rango con los de hoy.
        //
        // Con la sesión guardada entre corridas, la causa normal es que se
        // venció: se rehace y se pregunta UNA vez más. Si vuelve entera, es
        // otra cosa y se reporta igual que antes — nunca se sigue con esa
        // respuesta.
        if (/<html/i.test(htmlLista)) {
          sesiones.delete(erpId);
          cookie = await sesionDeSala(erpId, username, password);
          htmlLista = await listarCortes(cookie, fecha1, fecha2);
        }
        if (/<html/i.test(htmlLista)) {
          resultados.push({ branchId, error: `respuesta no es el fragmento (${htmlLista.length}b)` });
          continue;
        }

        const filas = parsearListado(htmlLista);

        const { data: yaEstan, error: errLee } = await supabase
          .from("cortes_caja")
          .select("erp_corte_id")
          .eq("branch_id", branchId)
          .gte("fecha", fecha1).lte("fecha", fecha2);
        if (errLee) throw new Error(`leyendo cortes guardados: ${errLee.message}`);
        const conocidos = new Set((yaEstan ?? []).map((r) => r.erp_corte_id));

        const nuevos = filas.filter((f) => !conocidos.has(f.erpCorteId));
        const aInsertar: Record<string, unknown>[] = [];

        for (const f of nuevos) {
          if (f.total === null || f.diferencia === null) {
            resultados.push({ branchId, corte: f.erpCorteId, error: "listado sin total o sin diferencia" });
            continue;
          }

          let ticket: string | null = null;
          try {
            const r = await fetch(TICKET_URL, {
              method: "POST",
              headers: {
                Cookie: cookie,
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-Requested-With": "XMLHttpRequest",
              },
              body: new URLSearchParams({
                process: "imprimir",
                id_corte: String(f.erpCorteId),
                id_sucursal_dom: String(erpId),
              }).toString(),
              signal: AbortSignal.timeout(45_000),
            });
            const txt = await r.text();
            const mov = JSON.parse(txt)?.movimiento ?? null;
            // El cuerpo tiene que ser el corte PEDIDO: el origen contesta 200
            // con un ticket vacío cuando el corte es de otra sala.
            if (mov && new RegExp(`:\\s*${f.erpCorteId}\\b`).test(mov)) ticket = mov;
          } catch { /* sin ticket: se guarda igual, el listado ya trae lo esencial */ }

          const delTicket = ticket ? parsearTicket(ticket) : {};
          const cuando = Date.parse(`${f.fecha}T${f.hora}-06:00`);

          aInsertar.push({
            branch_id: branchId,
            erp_corte_id: f.erpCorteId,
            tipo: f.tipo,
            fecha: f.fecha,
            hora: f.hora,
            turno: f.turno,
            total_declarado: f.total,
            diferencia_erp: f.diferencia,
            ticket,
            capturado_at: new Date().toISOString(),
            desfase_seg: Number.isFinite(cuando)
              ? Math.round((Date.now() - cuando) / 1000)
              : null,
            ...delTicket,
          });
        }

        if (aInsertar.length) {
          // ignoreDuplicates: otra corrida en paralelo pudo insertarlo entre el
          // SELECT y el INSERT. Duplicar sería un error; pisar, peor.
          const { error } = await supabase.from("cortes_caja")
            .upsert(aInsertar, { onConflict: "branch_id,erp_corte_id", ignoreDuplicates: true });
          if (error) throw new Error(`guardando cortes: ${error.message}`);
        }

        // ── Movimientos de caja (vales e ingresos) ──────────────────────────
        // Se piden en tres casos, y cada uno tapa lo que el otro no ve:
        //
        //   · apareció un CORTE NUEVO — es justo cuando hacen falta, y el
        //     último corte del día se lleva el estado final;
        //   · pasaron `MINUTOS_ENTRE_REPASOS` desde la última vez que se vio
        //     alguno — sin esto la lista del día está vacía hasta el primer
        //     corte, que es a la una de la tarde (ver la constante);
        //   · `movimientos: true`, que es el repaso a mano.
        //
        // Lo que NO se hace es pedirlos en cada corrida: son hasta 1000 filas
        // por sala, 120 veces por hora, casi siempre para nada.
        let movsGuardados = 0;
        let movsDesaparecidos = 0;
        let movs: {
          branch_id: number; erp_movimiento_id: number;
          concepto: string | null; fecha: string | null;
          monto: number | null; tipo: string;
        }[] = [];

        /* Cuándo se MIRÓ por última vez la lista de esta sala.
         *
         * Sale de `cortes_caja_vistazos` y no del `visto_at` de las filas: esa
         * columna no existe cuando no hay movimientos, así que «todavía no miré
         * hoy» y «miré y no había nada» se leerían igual — y una sala cerrada un
         * domingo pediría su lista en las 1.920 corridas de la ventana.
         *
         * ⚠️ Un error acá NO se convierte en «hay que repasar». Si la base no
         * contesta, dar por vencido el plazo haría que TODAS las corridas
         * pidieran los movimientos, que es exactamente el gasto que la cadencia
         * viene a evitar. Sin respuesta se deja pasar el turno; la siguiente
         * corrida vuelve a preguntar en 30 segundos.
         *
         * Un backfill con fechas explícitas no consulta el reloj ni lo escribe:
         * mira otro rango, y dejar su marca haría que el día de hoy se creyera
         * recién mirado. */
        let tocaRepasar = false;
        if (!aInsertar.length && body.movimientos !== true && !conFechas) {
          const { data: reloj, error: errReloj } = await supabase
            .from("cortes_caja_vistazos")
            .select("mirado_el")
            .eq("branch_id", branchId)
            .maybeSingle();
          if (errReloj) {
            console.error(`sync-cortes-caja: sala ${branchId}, no se pudo leer el reloj:`, errReloj.message);
          } else {
            // Sin fila, nunca se miró: ése es el arranque, y es el caso que más
            // hay que atender.
            const desde = reloj?.mirado_el ? Date.parse(reloj.mirado_el) : NaN;
            tocaRepasar = !Number.isFinite(desde)
              || (Date.now() - desde) >= MINUTOS_ENTRE_REPASOS * 60_000;
          }
        }

        if (aInsertar.length || body.movimientos === true || tocaRepasar) {
          const resMov = await fetch(
            `${MOV_URL}?fechai=${fecha1}&fechaf=${fecha2}&draw=1&start=0&length=1000`,
            {
              headers: { Cookie: cookie, "X-Requested-With": "XMLHttpRequest" },
              signal: AbortSignal.timeout(60_000),
            },
          );
          // ⚠️ Una respuesta que no se pudo leer NO es "cero movimientos".
          //
          // Antes daba lo mismo: `?? []` hacía que un fallo se viera igual que
          // un día sin movimientos, y como sólo se insertaba, no pasaba nada.
          // Desde que además se marca lo que DESAPARECIÓ, confundir las dos
          // cosas borraría el día entero de una sala por un timeout. Y el modo
          // de falla que hay que atrapar no da error: con la sesión vencida
          // esta pantalla devuelve HTML en vez de JSON.
          const jsonMov = await resMov.json().catch(() => null);
          const listaValida = resMov.ok && Array.isArray(jsonMov?.data);
          const dataMov: string[][] = listaValida ? jsonMov.data : [];

          movs = dataMov.map((r) => ({
            branch_id: branchId,
            erp_movimiento_id: Number(r[0]),
            concepto: texto(String(r[1] ?? "")) || null,
            fecha: fechaISO(texto(String(r[2] ?? ""))),
            monto: money(r[3]),
            tipo: texto(String(r[4] ?? "")).toUpperCase(),
          })).filter((m) =>
            Number.isFinite(m.erp_movimiento_id) && m.fecha &&
            m.monto !== null && (m.tipo === "ENTRADA" || m.tipo === "SALIDA")
          );

          if (listaValida) {
            // Los movimientos SÍ se pueden editar y borrar en el origen, así
            // que acá sí corresponde actualizar. Pero sólo lo que cambió:
            // reescribir las filas del día en cada corte es el churn de WAL
            // que ya costó caro en `inventory`.
            //
            // Y como el origen NO guarda historia, lo que se observa se anota:
            // un movimiento borrado allá no deja ni el número, y por ese hueco
            // pasó el ingreso de $454.00 del 22-ago que tapó un sobrante falso.
            const { data: previos, error: errPrev } = await supabase
              .from("cortes_caja_movimientos")
              .select("erp_movimiento_id, concepto, monto, tipo, fecha, desaparecido_at")
              .eq("branch_id", branchId)
              .gte("fecha", fecha1).lte("fecha", fecha2);
            if (errPrev) throw new Error(`leyendo movimientos: ${errPrev.message}`);

            // El corte vigente al momento de observar el cambio. Lo que importa
            // no es que un movimiento cambie: es que cambie DESPUÉS de un corte.
            // Reconstruirlo a posteriori es adivinar.
            const { data: ultimoCorte, error: errCorte } = await supabase
              .from("cortes_caja")
              .select("id")
              .eq("branch_id", branchId)
              .order("fecha", { ascending: false })
              .order("hora", { ascending: false })
              .limit(1);
            if (errCorte) throw new Error(`leyendo el último corte: ${errCorte.message}`);
            const corteId = ultimoCorte?.[0]?.id ?? null;

            const ahora = new Date().toISOString();
            const antes = new Map((previos ?? []).map((p) => [p.erp_movimiento_id, p]));
            const vistos = new Set(movs.map((m) => m.erp_movimiento_id));
            const historial: Record<string, unknown>[] = [];
            const cambiados: typeof movs = [];

            for (const m of movs) {
              const p = antes.get(m.erp_movimiento_id);
              const base = {
                branch_id: branchId, erp_movimiento_id: m.erp_movimiento_id,
                fecha: m.fecha, corte_id: corteId, observado_at: ahora,
              };
              if (!p) {
                cambiados.push(m);
                historial.push({
                  ...base, cambio: "APARECIO",
                  concepto_despues: m.concepto, monto_despues: m.monto, tipo_despues: m.tipo,
                });
                continue;
              }
              const editado = p.concepto !== m.concepto ||
                Number(p.monto) !== m.monto || p.tipo !== m.tipo;
              const volvio = Boolean(p.desaparecido_at);
              if (!editado && !volvio) continue;
              cambiados.push(m);
              historial.push({
                ...base, cambio: editado ? "EDITADO" : "REAPARECIO",
                concepto_antes: p.concepto, monto_antes: p.monto, tipo_antes: p.tipo,
                concepto_despues: m.concepto, monto_despues: m.monto, tipo_despues: m.tipo,
              });
            }

            // ⚠️ Sólo se puede afirmar que algo falta si la lista vino ENTERA.
            // El listado se pide con `length=1000`: si volviera lleno, lo que
            // no salió está cortado, no borrado — y marcarlo como desaparecido
            // sería inventar un hallazgo. Es la misma regla del techo de las
            // 1000 filas de PostgREST, del otro lado.
            const desaparecidos = dataMov.length < 1000
              ? (previos ?? []).filter((p) => !vistos.has(p.erp_movimiento_id) && !p.desaparecido_at)
              : [];

            for (const p of desaparecidos) {
              historial.push({
                branch_id: branchId, erp_movimiento_id: p.erp_movimiento_id,
                fecha: p.fecha, corte_id: corteId, observado_at: ahora,
                cambio: "DESAPARECIO",
                concepto_antes: p.concepto, monto_antes: p.monto, tipo_antes: p.tipo,
              });
            }

            if (cambiados.length) {
              const { error } = await supabase.from("cortes_caja_movimientos")
                .upsert(
                  cambiados.map((m) => ({
                    ...m, updated_at: ahora, visto_at: ahora, desaparecido_at: null,
                  })),
                  { onConflict: "branch_id,erp_movimiento_id" },
                );
              if (error) throw new Error(`guardando movimientos: ${error.message}`);
              movsGuardados = cambiados.length;
            }

            if (desaparecidos.length) {
              const { error } = await supabase.from("cortes_caja_movimientos")
                .update({ desaparecido_at: ahora, updated_at: ahora })
                .eq("branch_id", branchId)
                .in("erp_movimiento_id", desaparecidos.map((p) => p.erp_movimiento_id));
              if (error) throw new Error(`marcando desaparecidos: ${error.message}`);
              movsDesaparecidos = desaparecidos.length;
            }

            // `visto_at` de los que siguen igual. Sin esto la columna diría la
            // fecha en que se guardaron y no la última vez que se los confirmó,
            // que es justo lo que hace falta para creerle a un `desaparecido_at`.
            // Va por tandas porque los ids viajan en la URL del `.in()`.
            const sinCambio = movs
              .filter((m) => antes.has(m.erp_movimiento_id) &&
                !cambiados.some((c) => c.erp_movimiento_id === m.erp_movimiento_id))
              .map((m) => m.erp_movimiento_id);
            for (let i = 0; i < sinCambio.length; i += 200) {
              const { error } = await supabase.from("cortes_caja_movimientos")
                .update({ visto_at: ahora })
                .eq("branch_id", branchId)
                .in("erp_movimiento_id", sinCambio.slice(i, i + 200));
              if (error) throw new Error(`marcando vistos: ${error.message}`);
            }

            if (historial.length) {
              const { error } = await supabase
                .from("cortes_caja_movimientos_historial").insert(historial);
              if (error) throw new Error(`guardando el historial: ${error.message}`);
            }

            /* El reloj se pone SÓLO con la lista válida. Un vistazo que no se
             * pudo leer no es un vistazo: marcarlo dejaría la sala cinco
             * minutos sin volver a intentar, y el modo de falla que importa
             * —sesión vencida, que devuelve HTML con 200— duraría más que el
             * problema. Sin marca, la corrida de dentro de 30 segundos
             * reintenta.
             *
             * `encontrados` no se usa para decidir nada: está para que un cero
             * se pueda leer como «se miró y no había», que es justo lo que las
             * filas no pueden decir. */
            const { error: errReloj } = await supabase.from("cortes_caja_vistazos")
              .upsert({ branch_id: branchId, mirado_el: ahora, encontrados: movs.length },
                { onConflict: "branch_id" });
            if (errReloj) throw new Error(`marcando el vistazo: ${errReloj.message}`);
          }
        }

        resultados.push({
          branchId,
          enListado: filas.length,
          cortesNuevos: aInsertar.length,
          movimientosVistos: movs.length,
          movimientosEscritos: movsGuardados,
          movimientosDesaparecidos: movsDesaparecidos,
        });
      } catch (e) {
        resultados.push({ branchId, error: (e as Error)?.message ?? String(e) });
      }
    }

    return new Response(JSON.stringify({ ok: true, fecha1, fecha2, resultados }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("sync-cortes-caja:", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error)?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
