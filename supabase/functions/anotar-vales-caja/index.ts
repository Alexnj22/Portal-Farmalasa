import { createClient } from "npm:@supabase/supabase-js@2";
import {
  getCorsHeaders, requireInvokeSecret, getErpBranchMap,
  permisoDeModulo, requireActiveEmployeeUser,
} from "../_shared/security.ts";

// ═══════════════════════════════════════════════════════════════════════════
// El vale que el portal le anota a la caja por las salidas de bolsa.
//
// EL DEFECTO QUE CIERRA
// El corte cuenta, por día, todo lo que entró a la caja desde el Z anterior, y
// meter el dinero en una bolsa no le avisa nada: la plata de las bolsas DE HOY
// sigue siendo caja hasta el Z de la noche. Cuando una remesa se paga con esa
// plata, la caja sigue esperando dinero que ya salió. Medido: de 29 salidas, 6
// tomaron de una bolsa del mismo día ($2,200) y sólo UNA estaba anotada —
// REM-1028 hizo que dos cortes seguidos de Salud 1 marcaran −$425 y −$400.
//
// QUÉ ESCRIBE, Y QUÉ NO
// Sólo lo que salió de una bolsa del día que la caja TIENE ABIERTO, que sale de
// `caja_vales_pendientes()`. Lo que salió de una bolsa de un día ya cerrado no
// se toca: la caja no lo cuenta y anotarlo inventaría un sobrante — el error
// espejo del 22-ago, +$454.00 tapados con un ingreso falso.
//
// UN VALE POR TRAMO
// Se abre uno al primer movimiento y se le va SUMANDO mientras no haya corte
// nuevo. Cuando aparece un corte, ese vale se cierra y la próxima salida abre
// otro: editar un movimiento que un corte ya contó es justo lo que la auditoría
// de v2.838.0 marca como hallazgo, y sería el portal generando la señal que el
// portal vigila.
//
// LOS TRES FRENOS
//   1. Nunca escribe dos veces: antes de crear, busca su propio concepto en los
//      movimientos del día. Un reintento tras un timeout es el escenario obvio,
//      y duplicar un vale de $500 es peor que no ponerlo.
//   2. Sólo edita o borra lo que escribió el portal, identificado por el id que
//      guardó — nunca por monto ni por posición.
//   3. Si el vale no entra, la salida ya está guardada y el pendiente sigue
//      visible. La salida es el hecho; el vale es su consecuencia.
//
// `{"simular": true}` dice qué haría sin escribir una línea. La primera corrida
// real de cada sala conviene mirarla así.
//
// ENDPOINTS (de `js/funciones/funciones_caja_chica.js`, no se adivinan):
//   POST agregar_salida_caja.php   process=salida&id_apertura=&id_empleado=&turno=
//                                  &monto=&concepto=&id_tipo=…
//   POST editar_movimiento_caja.php process=editar&id_movimiento=&monto=&concepto=…
// Probados de punta a punta el 28-ago con un movimiento de $0.01 (43260),
// creado y borrado: el servidor toma la apertura y el empleado del FORMULARIO,
// no de la sesión, así que no hacen falta credenciales por caja.
// ═══════════════════════════════════════════════════════════════════════════

const BASE       = "https://clientesdte3.oss.com.sv/farma_salud/";
const LOGIN_URL  = `${BASE}login.php`;
const SESION_URL = `${BASE}cambio_sesion.php`;
const CORTE_URL  = `${BASE}admin_corte.php`;
const MOV_URL    = `${BASE}admin_movimiento_caja_dt.php`;
const CREAR_URL  = `${BASE}agregar_salida_caja.php`;
const EDITAR_URL = `${BASE}editar_movimiento_caja.php`;

// El tipo de movimiento. `1` es el único valor ejercido de verdad (28-ago,
// movimiento 43260: entró y salió como SALIDA). El catálogo completo NO se pudo
// leer —esa pantalla sólo se abre para el usuario que tiene la caja vigente, y
// la cuenta del portal no lo es en ninguna sala—, y para las salidas no hace
// falta: el tiquete tiene UNA sola línea de vales. Para los INGRESOS sí haría
// falta, porque un cobro de crédito tiene línea propia; por eso esta función
// escribe salidas y nada más.
const ID_TIPO_SALIDA = "1";

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
  // Escribir en la sala equivocada es el peor final posible de esta función:
  // un vale en la caja de otra sala corre DOS cortes, el que no debía y el que
  // sí. Si no se pudo fijar, esta sala no se toca.
  if (!fijada) throw new Error(`no se pudo abrir la sala ${erpId}`);
}

/** La apertura vigente de la sala: `id_apertura`, empleado y turno. */
async function aperturaViva(cookie: string): Promise<{ aper: string; emp: string; turno: string } | null> {
  const pagina = await (await fetch(CORTE_URL, {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(30_000),
  })).text();
  const idEmple = pagina.match(/id=["']id_emple["'][^>]*value=["'](\d+)["']/)?.[1] ?? "0";
  const cajas = [...pagina.matchAll(/<option value='(\d+)'>\s*Caja[^<]*<\/option>/gi)]
    .map((m) => m[1]);
  for (const idCaja of cajas) {
    const panel = await (await fetch(CORTE_URL, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: new URLSearchParams({ process: "caja", id_caja: idCaja, id_empleado: idEmple }).toString(),
      signal: AbortSignal.timeout(30_000),
    })).text();
    const aper = panel.match(/id_apertura=(\d+)/)?.[1];
    const emp = panel.match(/emp=(\d+)/)?.[1];
    const turno = panel.match(/turno=(\d+)/)?.[1];
    if (aper && emp && turno) return { aper, emp, turno };
  }
  return null;
}

/** El concepto del vale. Corto a propósito: el campo trunca a 50 caracteres. */
const conceptoDe = (valeId: number, cuantas: number) =>
  `VALE DE CAJA ${valeId} (${cuantas} salida${cuantas === 1 ? "" : "s"})`;

/** ¿Ya existe en el día un movimiento con este concepto? Devuelve su id. */
async function yaEscrito(cookie: string, fecha: string, valeId: number): Promise<number | null> {
  const r = await fetch(
    `${MOV_URL}?fechai=${fecha}&fechaf=${fecha}&draw=1&start=0&length=1000`,
    { headers: { Cookie: cookie, "X-Requested-With": "XMLHttpRequest" }, signal: AbortSignal.timeout(60_000) },
  );
  const json = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(json?.data)) {
    // No poder mirar NO es «no está»: sin esta comprobación un reintento
    // duplicaría el vale, así que se aborta esta sala y se reintenta después.
    throw new Error("no se pudo revisar si el vale ya estaba escrito");
  }
  const marca = `VALE DE CAJA ${valeId} `;
  const fila = (json.data as string[][]).find((f) => String(f[1] ?? "").startsWith(marca));
  return fila ? Number(fila[0]) : null;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (cuerpo: unknown, status = 200) =>
    new Response(JSON.stringify(cuerpo), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const body = await req.json().catch(() => ({}));
    const simular = body.simular === true;
    const soloSala: number | null = body.sala ? Number(body.sala) : null;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Quién puede pedir esto ──────────────────────────────────────────────
    //
    // DOS caminos, y el de la persona NO es el mismo que el del sistema. El
    // secreto de invocación es para un cron (todavía no existe ninguno). Una
    // persona entra con su sesión y necesita el módulo `caja_vales`, que hoy
    // tiene un solo cargo: escribir en la caja corre lo que el corte espera, y
    // eso no puede viajar de arrastre con el permiso de guardar una bolsa.
    //
    // `can_view` alcanza para SIMULAR —ver qué falta anotar no toca nada— y
    // `can_edit` hace falta para escribir. Son dos permisos porque son dos
    // actos.
    let quienId: string | null = null;
    if (!requireInvokeSecret(req)) {
      const quien = await requireActiveEmployeeUser(req, supabase);
      if (!quien) return json({ ok: false, error: "Sesión inválida o empleado inactivo." }, 401);
      const permiso = await permisoDeModulo(
        supabase, quien.id, "caja_vales", simular ? "can_view" : "can_edit",
      );
      // `roto` es «no se pudo averiguar», que no es lo mismo que «no puede»:
      // contestar 403 a quien sí puede lo deja esperando un permiso que ya tiene.
      if (permiso.roto) return json({ ok: false, error: permiso.roto }, 503);
      if (!permiso.puede) {
        return json({
          ok: false,
          error: simular
            ? "No tienes permiso para ver los vales pendientes de la caja."
            : "No tienes permiso para anotar vales en la caja.",
        }, 403);
      }
      quienId = quien.id;
    }

    const { data: pendientes, error: errPend } = await supabase.rpc("caja_vales_pendientes");
    if (errPend) throw new Error(`leyendo pendientes: ${errPend.message}`);

    // Agrupadas por sala: un vale por sala y por tramo.
    const porSala = new Map<number, { dia: string; movs: number[]; folios: string[]; monto: number }>();
    for (const p of pendientes ?? []) {
      if (soloSala && Number(p.branch_id) !== soloSala) continue;
      const k = Number(p.branch_id);
      if (!porSala.has(k)) porSala.set(k, { dia: p.dia_abierto, movs: [], folios: [], monto: 0 });
      const g = porSala.get(k)!;
      g.movs.push(Number(p.movimiento_id));
      g.folios.push(p.folio);
      g.monto += Number(p.monto);
    }

    const mapa = getErpBranchMap();
    const resultados: Record<string, unknown>[] = [];
    let cookie: string | null = null;

    for (const [branchId, g] of porSala) {
      try {
        // El vale abierto de esta sala, si lo hay, y el corte más reciente.
        const { data: abiertos, error: errVale } = await supabase
          .from("caja_vales_portal")
          .select("id, erp_movimiento_id, monto, estado, corte_id_al_abrir, intentos, fecha")
          .eq("branch_id", branchId)
          .in("estado", ["PENDIENTE", "ANOTADO"])
          .limit(1);
        if (errVale) throw new Error(`leyendo el vale abierto: ${errVale.message}`);

        const { data: ultimoCorte, error: errCorte } = await supabase
          .from("cortes_caja")
          .select("id")
          .eq("branch_id", branchId)
          .order("fecha", { ascending: false })
          .order("hora", { ascending: false })
          .limit(1);
        if (errCorte) throw new Error(`leyendo el último corte: ${errCorte.message}`);
        const corteId = ultimoCorte?.[0]?.id ?? null;

        type ValeAbierto = {
          id: number; erp_movimiento_id: number | null; monto: number | string;
          estado: string; corte_id_al_abrir: number | null; intentos: number; fecha: string;
        };
        let vale: ValeAbierto | null = (abiertos?.[0] as ValeAbierto | undefined) ?? null;
        // Pasó un corte, o cambió el día: el vale viejo se cierra y se abre otro.
        if (vale && (vale.corte_id_al_abrir !== corteId || vale.fecha !== g.dia)) {
          if (!simular) {
            const { error } = await supabase.from("caja_vales_portal")
              .update({ estado: "CERRADO", cerrado_at: new Date().toISOString(), updated_at: new Date().toISOString() })
              .eq("id", vale.id);
            if (error) throw new Error(`cerrando el vale anterior: ${error.message}`);
          }
          vale = null;
        }

        const montoNuevo = Number((Number(vale?.monto ?? 0) + g.monto).toFixed(2));
        const accion = vale?.erp_movimiento_id ? "sumar" : "crear";

        if (simular) {
          resultados.push({
            branchId, accion, dia: g.dia, folios: g.folios,
            monto_de_ahora: Number(g.monto.toFixed(2)),
            monto_del_vale: montoNuevo,
            vale_existente: vale?.id ?? null,
            movimiento_en_caja: vale?.erp_movimiento_id ?? null,
          });
          continue;
        }

        // ── A partir de acá SÍ se escribe ───────────────────────────────────
        if (!vale) {
          const { data: creado, error } = await supabase.from("caja_vales_portal")
            .insert({ branch_id: branchId, fecha: g.dia, monto: 0, corte_id_al_abrir: corteId, anotado_por: quienId })
            .select("id, erp_movimiento_id, monto, intentos")
            .single();
          if (error) throw new Error(`abriendo el vale: ${error.message}`);
          vale = { ...creado, estado: "PENDIENTE", corte_id_al_abrir: corteId, fecha: g.dia } as ValeAbierto;
        }

        const entrada = mapa.find((e) => e.branchId === branchId);
        if (!entrada) throw new Error(`la sala ${branchId} no está en el mapa`);
        if (!cookie) {
          const { username, password } = getCortesCreds();
          cookie = await getSessionCookie(username, password);
        }
        await abrirSala(cookie, entrada.erpId);

        const viva = await aperturaViva(cookie);
        if (!viva) throw new Error("la sala no tiene una caja abierta ahora");

        // Cuántas salidas cubre EN TOTAL, no cuántas trae esta corrida. La
        // primera versión decía `nuevas + 1` cuando ya existía el vale, o sea
        // que un vale que cubría tres salidas se anunciaba como dos. El número
        // sale de contar las que están ligadas más las que se van a ligar.
        const { count: yaCubiertas, error: errCuenta } = await supabase
          .from("bolsas_movimientos")
          .select("id", { count: "exact", head: true })
          .eq("caja_vale_id", vale.id);
        if (errCuenta) throw new Error(`contando lo que ya cubre: ${errCuenta.message}`);
        const concepto = conceptoDe(vale.id, (yaCubiertas ?? 0) + g.movs.length);
        // Freno 1: ¿ya está escrito? Un reintento después de un timeout es el
        // escenario obvio, y duplicar el vale es peor que no ponerlo.
        const yaEsta = await yaEscrito(cookie, g.dia, vale.id);
        let idMov = vale.erp_movimiento_id ?? yaEsta;

        let resp: string;
        if (idMov) {
          resp = await (await fetch(EDITAR_URL, {
            method: "POST",
            headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" },
            body: new URLSearchParams({
              process: "editar", id_movimiento: String(idMov), id_apertura: viva.aper,
              id_empleado: viva.emp, turno: viva.turno,
              monto: montoNuevo.toFixed(2), concepto,
            }).toString(),
            signal: AbortSignal.timeout(45_000),
          })).text();
        } else {
          resp = await (await fetch(CREAR_URL, {
            method: "POST",
            headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" },
            body: new URLSearchParams({
              process: "salida", id_apertura: viva.aper, id_empleado: viva.emp, turno: viva.turno,
              monto: montoNuevo.toFixed(2), concepto, proveedor: "", tipo_doc: "", n_doc: "",
              recibe: "PORTAL", id_tipo: ID_TIPO_SALIDA,
            }).toString(),
            signal: AbortSignal.timeout(45_000),
          })).text();
          idMov = Number(JSON.parse(resp)?.id_mov) || null;
        }

        const ok = /"typeinfo"\s*:\s*"Success"/i.test(resp);
        if (!ok || !idMov) throw new Error(`el sistema no aceptó el vale: ${resp.slice(0, 160)}`);

        const ahora = new Date().toISOString();
        const { error: errUp } = await supabase.from("caja_vales_portal")
          .update({
            erp_movimiento_id: idMov, monto: montoNuevo, estado: "ANOTADO",
            anotado_at: ahora, updated_at: ahora, ultimo_error: null, anotado_por: quienId,
          })
          .eq("id", vale.id);
        if (errUp) throw new Error(`guardando el vale: ${errUp.message}`);

        // Los movimientos quedan marcados DESPUÉS de que el sistema aceptó: al
        // revés, un fallo los dejaría por cubiertos sin estarlo, y nadie los
        // volvería a mirar.
        const { error: errMarca } = await supabase.from("bolsas_movimientos")
          .update({ caja_vale_id: vale.id })
          .in("id", g.movs);
        if (errMarca) throw new Error(`marcando los movimientos: ${errMarca.message}`);

        resultados.push({ branchId, accion, monto: montoNuevo, movimiento_en_caja: idMov, folios: g.folios });
      } catch (e) {
        const msg = (e as Error)?.message ?? String(e);
        if (!simular) {
          // Se recoge el error y NO se lanza: estamos dentro de un `catch`, y
          // lanzar acá taparía el error original que se está intentando anotar.
          // Pero tampoco puede irse a ciegas — si este UPDATE falla (RLS, una
          // columna que cambió), `ultimo_error` queda vacío y el vale aparece
          // fallado sin decir por qué, que es justo lo que esta línea existe
          // para evitar.
          const { error: errAnotar } = await supabase.from("caja_vales_portal")
            .update({ ultimo_error: msg, updated_at: new Date().toISOString() })
            .eq("branch_id", branchId).in("estado", ["PENDIENTE", "ANOTADO"]);
          if (errAnotar) console.error(`no se pudo anotar el error del vale (${branchId}): ${errAnotar.message}`);
        }
        resultados.push({ branchId, error: msg });
      }
    }

    return json({ ok: true, simulado: simular, resultados });
  } catch (e) {
    console.error("anotar-vales-caja:", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error)?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
