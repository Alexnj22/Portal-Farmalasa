import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders, requireInvokeSecret, getErpBranchMap, getErpCredsByBranch } from "../_shared/security.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Quién tiene la caja abierta en cada sala, a qué hora la abrió y cuánto
// espera el sistema. Sólo LECTURA — no escribe una línea del otro lado.
//
// POR QUÉ EXISTE
// Medido el 28-ago-2026: TRES de las seis salas cortan bajo una cuenta
// compartida («MI CAJA LA POPULAR», «MI CAJA LA SALUD 2», «MI CAJA LA SALUD 5»)
// —185 de los 452 cortes desde el 14-ago— y en los 452, sin excepción,
// `cortes_caja.employee_id` está en NULL. O sea que «¿quién cortó?» hoy no
// tiene respuesta, y no por falta de acceso: el dato no existe del lado de la
// caja. Esto es lo que permite verlo, y cruzarlo contra la marcación.
//
// LOS DOS ENDPOINTS, ANOTADOS PORQUE NO SE ADIVINAN
// Ninguno aparece en el HTML de la pantalla; salen de `funciones_corte_caja.js`.
//
//   GET  admin_corte.php                 → la pantalla, con las cajas de la
//        sala en `<option value='N'>Caja X</option>`.
//   POST admin_corte.php  process=caja&id_caja=N&id_empleado=M
//        → el panel de ESA caja: `id_apertura`, nombre de quien abrió, fecha,
//          hora, turno, monto de apertura y «Monto Registrado» (lo que el
//          sistema espera adentro en este momento).
//
// LA SUCURSAL ES ESTADO DE SESIÓN, no un parámetro — mismo cuidado que en
// `sync-cortes-caja` y `sync-corte-z`.
//
// CADENCIA: cada 30 minutos dentro de la ventana de la sala. La hora de
// APERTURA que se guarda es exacta —la da el propio panel—, así que mirar más
// seguido no la mejoraría; lo único que se pierde con media hora es precisión
// en el CIERRE, y por eso esa columna se llama `cerrada_at` con el comentario
// de que es cuándo se la VIO cerrada. La ventana la aplica esta función y no
// el cron, por el mismo motivo que la aplica `sync-cortes-caja`.
// ═══════════════════════════════════════════════════════════════════════════

const BASE       = "https://clientesdte3.oss.com.sv/farma_salud/";
const LOGIN_URL  = `${BASE}login.php`;
const SESION_URL = `${BASE}cambio_sesion.php`;
const CORTE_URL  = `${BASE}admin_corte.php`;

/** Bodega no tiene caja: no abre turno. */
const ERP_BODEGA = 6;

// La ventana de la sala en hora de El Salvador (UTC−6, sin horario de verano).
const HORA_DESDE = 6;
const HORA_HASTA = 23;

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

async function abrirSala(cookie: string, erpId: number): Promise<void> {
  const r = await fetch(SESION_URL, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ process: "set_sucursal", id_sucursal: String(erpId) }).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  let fijada = false;
  try { fijada = Boolean(JSON.parse(await r.text())?.success); } catch { fijada = false; }
  // Igual que en la captura de cortes: si no se pudo fijar la sala, NO se
  // sigue. Leer el panel de otra sala y guardarlo con este `branch_id` es peor
  // que no leerlo — sería un turno atribuido a quien no lo abrió.
  if (!fijada) throw new Error(`no se pudo abrir la sala ${erpId} en el sistema`);
}

const texto = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ")
  .replace(/\s+/g, " ").trim();

/** "28-08-2026" → "2026-08-28". Devuelve null si no tiene esa forma. */
function fechaISO(s: string): string | null {
  const m = s.match(/(\d{2})-(\d{2})-(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** "$757.25" · "757.25" · "$0" → 757.25 · 0. Null cuando no hay número. */
function money(s: unknown): number | null {
  if (s === null || s === undefined) return null;
  const limpio = String(s).replace(/[^0-9.-]/g, "");
  if (!limpio || limpio === "-" || limpio === ".") return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

/** Un nombre comparable: sin tildes, sin puntuación, en mayúsculas. */
const norm = (v: unknown) => String(v ?? "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

/**
 * La ficha de quien abrió la caja, o `null`.
 *
 * ── Por qué no alcanza comparar los nombres ────────────────────────────────
 * El sistema de la caja guarda el nombre LEGAL completo y el portal el de uso
 * diario. Medido el 28-ago, las tres salas que sí tienen una persona:
 *
 *   NATHALY MICHELLE ESTRADA    ←→  Nathaly Estrada
 *   AUDELIA ELIZABETH CALLEJAS  ←→  Elizabeth Callejas   (¡el SEGUNDO nombre!)
 *   RODRIGO EDUARDO MARQUEZ     ←→  Rodrigo Marquez
 *
 * Con coincidencia exacta —aun normalizando tildes— las tres fallan, y la tabla
 * diría «no se pudo resolver» sobre gente que sí está en la nómina. La regla que
 * funciona: **cada palabra del nombre del portal tiene que estar en el de la
 * caja**, y tiene que haber UNA sola ficha que cumpla.
 *
 * Las dos guardas son la regla «un rótulo no es una clave» de CLAUDE.md
 * aplicada acá: con dos candidatas no se elige ninguna —quedar en NULL es
 * visible, atribuirle el turno a la persona equivocada no—, y se exigen al
 * menos dos palabras para que un nombre de una sola no barra media nómina.
 * `MI CAJA LA POPULAR` no contiene ningún nombre y sigue en NULL: eso no es un
 * fallo del cruce, es el hallazgo.
 */
function resolverFicha(
  nombreCaja: string | null,
  nomina: { id: string; tokens: string[] }[],
): string | null {
  const enLaCaja = norm(nombreCaja).split(" ").filter(Boolean);
  if (enLaCaja.length < 2) return null;
  const candidatas = nomina.filter((e) =>
    e.tokens.length >= 2 && e.tokens.every((t) => enLaCaja.includes(t))
  );
  return candidatas.length === 1 ? candidatas[0].id : null;
}

type Panel = {
  erp_apertura_id: number;
  erp_empleado_id: number | null;
  empleado_texto: string | null;
  abierta_el: string | null;
  abierta_a: string | null;
  turno: number | null;
  monto_apertura: number | null;
  monto_registrado: number | null;
};

/**
 * El panel de una caja. `null` = no hay apertura vigente en esa caja.
 *
 * La hora viene como «06:55:49» y la fecha como «28-08-2026»; las dos son del
 * momento en que la persona abrió, no de ahora, así que el retraso de la
 * corrida no las toca.
 */
function leerPanel(html: string): Panel | null {
  const id = html.match(/id_apertura=(\d+)/)?.[1]
    ?? html.match(/id=["']id_apertura["'][^>]*value=["'](\d+)["']/)?.[1];
  if (!id) return null;
  const campo = (etiqueta: string) =>
    texto(html.match(new RegExp(`${etiqueta}:\\s*([^<]*)<`))?.[1] ?? "") || null;
  const hora = campo("Hora Apertura");
  return {
    erp_apertura_id: Number(id),
    // El número con el que la CAJA identifica a quien abrió; viene en el enlace
    // del cierre. No es la ficha del portal, y hace falta para que el portal
    // pueda abrir después con el mismo empleado que esa sala ya usa.
    erp_empleado_id: Number(html.match(/emp=(\d+)/)?.[1]) || null,
    empleado_texto: campo("Nombre"),
    abierta_el: fechaISO(campo("Fecha Apertura") ?? ""),
    abierta_a: hora && /^\d{2}:\d{2}/.test(hora) ? hora : null,
    turno: Number(campo("Turno")) || null,
    monto_apertura: money(campo("Monto Apertura")),
    monto_registrado: money(campo("Monto Registrado")),
  };
}

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

    // La ventana la aplica la función: `pg_cron` con un intervalo no admite un
    // rango de horas, y fuera de la ventana no hay ninguna caja que mirar.
    const horaSV = new Date(Date.now() - 6 * 3600_000).getUTCHours();
    if (!body.forzar && (horaSV < HORA_DESDE || horaSV >= HORA_HASTA)) {
      return new Response(JSON.stringify({ ok: true, fuera_de_ventana: horaSV }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Modo catálogo: qué tipos de movimiento ofrece la pantalla ────────────
    //
    // Sólo LECTURA y a pedido (`{"catalogo": <branchId>}`). Existe porque el
    // formulario de ingreso/salida sólo se puede ABRIR con un usuario que tenga
    // una caja vigente, y la cuenta con la que corren estos syncs no tiene
    // ninguna: pedirlo con ella devuelve «No se ha encontrado una apertura
    // vigente». Con las credenciales de la sala sí, porque en tres salas esa
    // cuenta ES la que abre la caja.
    //
    // Hace falta antes de que el portal escriba un vale: `id_tipo` es lo que
    // separa un ingreso común de un cobro de crédito, y ésos NO comparten línea
    // en el tiquete del corte.
    if (body.catalogo) {
      const creds = getErpCredsByBranch(Number(body.catalogo));
      if (!creds) throw new Error(`la sala ${body.catalogo} no está en el mapa`);
      const propia = await getSessionCookie(creds.username, creds.password);
      const salidas: Record<string, unknown> = {};
      for (const pantalla of ["agregar_salida_caja.php", "agregar_ingreso_caja.php", "apertura_caja.php"]) {
        const html = await (await fetch(BASE + pantalla, {
          headers: { Cookie: propia },
          signal: AbortSignal.timeout(30_000),
        })).text();
        salidas[pantalla] = {
          selects: [...html.matchAll(/<select[\s\S]{0,2000}?<\/select>/gi)].map((m) =>
            m[0].replace(/\s+/g, " ").slice(0, 1200)),
          aviso: /apertura vigente/i.test(html) ? texto(html).slice(0, 120) : null,
          largo: html.length,
        };
      }
      return new Response(JSON.stringify({ ok: true, catalogo: salidas }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // La nómina, una vez por corrida: son ~50 filas y sirve para resolver el
    // nombre que da la caja a una ficha del portal. Cuando no coincide, queda
    // en NULL — que NO es un error sino el hallazgo (`MI CAJA LA POPULAR` no es
    // una persona). Ver la regla «un rótulo no es una clave» de CLAUDE.md.
    const { data: nomina, error: errNomina } = await supabase
      .from("employees")
      .select("id, first_names, last_names")
      .eq("status", "ACTIVO");   // la columna es `status`, no `is_active`: verificado en prod
    if (errNomina) throw new Error(`leyendo la nómina: ${errNomina.message}`);
    const fichas = (nomina ?? []).map((e) => ({
      id: e.id as string,
      tokens: norm(`${e.first_names ?? ""} ${e.last_names ?? ""}`).split(" ").filter(Boolean),
    }));

    const { username, password } = getCortesCreds();
    const cookie = await getSessionCookie(username, password);
    const ahora = new Date().toISOString();
    const resultados: Record<string, unknown>[] = [];

    for (const { branchId, erpId } of getErpBranchMap()) {
      if (erpId === ERP_BODEGA) continue;
      try {
        await abrirSala(cookie, erpId);

        // Las cajas de la sala salen de la pantalla. Se leen en cada corrida y
        // no se cachean: una caja nueva tiene que aparecer sola, y el día que
        // una sala tenga dos, las dos se miran.
        const pagina = await (await fetch(CORTE_URL, {
          headers: { Cookie: cookie },
          signal: AbortSignal.timeout(30_000),
        })).text();
        // El rótulo tiene que decir «Caja»: la pantalla tiene otros desplegables
        // y un `<option>` suelto de cualquiera de ellos se leería como una caja
        // que no existe, y su panel vacío marcaría el turno como cerrado.
        const cajas = [...pagina.matchAll(/<option value='(\d+)'>\s*Caja[^<]*<\/option>/gi)]
          .map((m) => Number(m[1]))
          .filter((n) => Number.isFinite(n) && n > 0);
        // El empleado de la sesión, tal como lo pone la propia pantalla: el
        // handler del panel lo espera y la cuenta del portal no es la misma
        // que la de cualquier otra sesión.
        const idEmple = pagina.match(/id=["']id_emple["'][^>]*value=["'](\d+)["']/)?.[1] ?? "0";

        const vistas: number[] = [];
        for (const idCaja of cajas) {
          const panelHtml = await (await fetch(CORTE_URL, {
            method: "POST",
            headers: {
              Cookie: cookie,
              "Content-Type": "application/x-www-form-urlencoded",
              "X-Requested-With": "XMLHttpRequest",
            },
            body: new URLSearchParams({ process: "caja", id_caja: String(idCaja), id_empleado: idEmple }).toString(),
            signal: AbortSignal.timeout(30_000),
          })).text();

          const panel = leerPanel(panelHtml);
          if (!panel || !panel.abierta_el) continue;
          vistas.push(panel.erp_apertura_id);

          const { error } = await supabase.from("cortes_caja_aperturas").upsert({
            branch_id: branchId,
            erp_apertura_id: panel.erp_apertura_id,
            caja_erp: idCaja,
            turno: panel.turno,
            erp_empleado_id: panel.erp_empleado_id,
            empleado_texto: panel.empleado_texto,
            employee_id: resolverFicha(panel.empleado_texto, fichas),
            abierta_el: panel.abierta_el,
            abierta_a: panel.abierta_a,
            monto_apertura: panel.monto_apertura,
            monto_registrado: panel.monto_registrado,
            vista_at: ahora,
            cerrada_at: null,
            updated_at: ahora,
          }, { onConflict: "branch_id,erp_apertura_id" });
          if (error) throw new Error(`guardando la apertura: ${error.message}`);
        }

        // Lo que ya no está abierto se marca cerrado. Se hace sólo cuando la
        // sala CONTESTÓ —si `abrirSala` o la pantalla fallan, este bloque no se
        // alcanza—, porque «no pude preguntar» no es «cerró la caja».
        const { error: errCerrar } = await supabase.from("cortes_caja_aperturas")
          .update({ cerrada_at: ahora, updated_at: ahora })
          .eq("branch_id", branchId)
          .is("cerrada_at", null)
          .not("erp_apertura_id", "in", `(${vistas.length ? vistas.join(",") : "-1"})`);
        if (errCerrar) throw new Error(`cerrando aperturas: ${errCerrar.message}`);

        resultados.push({ branchId, cajas: cajas.length, abiertas: vistas.length });
      } catch (e) {
        resultados.push({ branchId, error: (e as Error)?.message ?? String(e) });
      }
    }

    return new Response(JSON.stringify({ ok: true, resultados }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("sync-aperturas-caja:", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error)?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
