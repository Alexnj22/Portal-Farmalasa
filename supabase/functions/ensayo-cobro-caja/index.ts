import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders, requireInvokeSecret } from "../_shared/security.ts";
import { getCortesCreds } from "../_shared/creditos.ts";
import { listaDeLaCaja, prepararCobroEnLaCaja, sesionDeCaja } from "../_shared/preventaCaja.ts";
import { leerCajaAbierta } from "../../../src/utils/cobroDeCaja.js";

// ═══════════════════════════════════════════════════════════════════════════
// ENSAYO DEL COBRO EN PARALELO (2026-11-18) — etapa 1 del cobro desde el kiosco.
//
// El usuario: «¿cómo hacemos el 8 sin afectar nada, siempre usando el ERP?».
// Antes de que el kiosco cobre de verdad, se demuestra que lo que mandaría es
// lo MISMO que la caja guarda cuando la cajera cobra a mano. Esta función:
//   1. lee la lista de preventas vivas de la caja (`get_referencias`);
//   2. a cada preventa nueva, o cuyo total cambió, le arma el cobro que haría
//      el kiosco (`prepararCobroEnLaCaja`: `cargar_data` + `mostrar_datos_cliente`,
//      sólo lecturas) y lo guarda en `cobro_caja_ensayos`;
//   3. llama a `cobro_caja_ensayo_comparar()`, que enfrenta cada ensayo con la
//      factura que la caja terminó guardando (el número de la preventa queda
//      como número de la factura: medido con la 415591).
// NO escribe nada en la caja: ni guarda ni finaliza ni borra. La cajera no
// hace nada distinto.
//
// Sucursales del ensayo (el usuario, 2026-11-18): Salud 4, donde está el
// kiosco piloto, y Salud 1, la que más vende (150 ventas al día): más casos
// raros (promociones, lotes, exentos) en menos días.
//
// Vuelve el 2026-11-18 (se había quitado una hora antes): el usuario aclaró
// que Salud 4 NO usa el kiosco todavía y que el ensayo tenía que seguir como en
// Salud 1, leyendo las preventas que se hacen en la caja. Viven segundos, así
// que se escapan muchas, pero en la primera media hora vio 5 en Salud 1 y la
// única que se cobró cuadró. Convive con el ensayo al enviar de `preventa-caja`
// (las del portal): las dos escriben la misma fila por preventa.
//
// La llama un cron (secreto del circuito «sync»): va con --no-verify-jwt.
// ═══════════════════════════════════════════════════════════════════════════

// Salud 2 en lugar de Salud 4 (usuario, 2026-11-18): en Salud 4 la preventa se
// cobra en menos de un minuto y la lista siempre salía vacía (0 en todo el día,
// con 53 ventas). Salud 4 sigue siendo la sala del primer cobro real.
const SUCURSALES = [25, 4];
/** Tope de preventas que se leen enteras por sucursal y corrida (cada una son 2 peticiones). */
const TOPE_POR_CORRIDA = 12;

// La sesión de cada sala vive entre corridas mientras el trabajador siga
// caliente (como `SESIONES_VIVAS` de sync-dte-sales): sin esto, cada minuto
// eran login + sesión de la sala + la lista, tres peticiones por sala; así es
// una. Se rehace si la lista falla con la guardada, y a los 20 minutos.
type Sesion = Awaited<ReturnType<typeof sesionDeCaja>>;
const SESIONES = new Map<number, { http: Sesion; desde: number }>();
const VIDA_MS = 20 * 60_000;

async function listaConSesion(username: string, password: string, branch: number, erp: number) {
  const viva = SESIONES.get(branch);
  if (viva && Date.now() - viva.desde < VIDA_MS) {
    try { return { http: viva.http, lista: await listaDeLaCaja(viva.http), reusada: true }; }
    catch { SESIONES.delete(branch); }
  }
  const http = await sesionDeCaja(username, password, erp);
  SESIONES.set(branch, { http, desde: Date.now() });
  return { http, lista: await listaDeLaCaja(http), reusada: false };
}

const json = (b: unknown, s = 200, h: HeadersInit = {}) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", ...h } });

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!requireInvokeSecret(req, "sync")) return json({ ok: false, error: "No autorizado." }, 401, cors);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { username, password } = getCortesCreds();
  const resumen: Record<string, unknown>[] = [];

  for (const branch of SUCURSALES) {
    const r: Record<string, unknown> = { branch, leidas: 0, ensayadas: 0, fallas: 0 };
    resumen.push(r);
    try {
      const { data: mapa, error: eMapa } = await admin.from("erp_sucursal_map")
        .select("erp_sucursal_id").eq("branch_id", branch).eq("es_bodega", false).maybeSingle();
      if (eMapa || !mapa) { r.error = "Sin sala en la caja."; continue; }

      const { http, lista, reusada } = await listaConSesion(username, password, branch, Number(mapa.erp_sucursal_id));
      r.leidas = lista.length;
      r.sesion = reusada ? "reusada" : "nueva";
      if (!lista.length) continue;

      const { data: previos, error: ePrev } = await admin.from("cobro_caja_ensayos")
        .select("externo_id, total_caja, veces").eq("branch_id", branch).in("externo_id", lista.map((p) => p.id));
      if (ePrev) { r.error = "No se pudo leer los ensayos."; continue; }
      const antes = new Map((previos ?? []).map((x) => [String(x.externo_id), x]));
      // Nueva, o cambió su total en la caja (la cajera la corrigió): se vuelve a ensayar.
      const porEnsayar = lista.filter((p) => {
        const a = antes.get(String(p.id));
        return !a || Math.abs(Number(a.total_caja) - Number(p.total)) >= 0.005;
      }).slice(0, TOPE_POR_CORRIDA);
      if (!porEnsayar.length) continue;

      const caja = leerCajaAbierta(await http.get("venta.php"));
      if (!caja) { r.error = "La caja no tiene turno abierto."; continue; }

      for (const p of porEnsayar) {
        let plan: Record<string, unknown>;
        try {
          plan = await prepararCobroEnLaCaja(http, String(p.id), { total: null, efectivo: 1e9 }, caja);
        } catch (e) {
          r.fallas = Number(r.fallas) + 1;
          plan = { error: (e as Error).message };
        }
        const { error: eUp } = await admin.from("cobro_caja_ensayos").upsert({
          branch_id: branch, externo_id: String(p.id), referencia: p.referencia, total_caja: p.total,
          plan, captado_at: new Date().toISOString(), veces: Number(antes.get(String(p.id))?.veces ?? 0) + 1,
          comparado_at: null, cuadra: null, diferencias: null,
        }, { onConflict: "branch_id,externo_id" });
        if (eUp) { r.fallas = Number(r.fallas) + 1; r.error = eUp.message; } else r.ensayadas = Number(r.ensayadas) + 1;
      }
    } catch (e) {
      SESIONES.delete(branch);
      r.error = (e as Error).message;
    }
  }

  const { data: comp, error: eComp } = await admin.rpc("cobro_caja_ensayo_comparar");
  return json({ ok: !eComp, sucursales: resumen, comparadas: comp ?? null, error: eComp?.message }, eComp ? 500 : 200, cors);
});
