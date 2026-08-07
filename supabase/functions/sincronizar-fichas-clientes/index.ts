import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireActiveEmployeeUser, requireInvokeSecret } from "../_shared/security.ts";
import {
  login, leerFicha, idClienteDeFactura, escribirCampo, filaPortal,
} from "../_shared/erp-clientes.ts";
import { elegirDistrito, ubicacionDe, norm } from "../_shared/distrito.ts";

// La corrida diaria de fichas de clientes, del lado del servidor.
//
// Antes esto era `scripts/migracion-clientes/resolver_observaciones.py` con un
// launchd en una Mac — y una laptop no es un servidor: si estaba apagada a las
// 21:30, ese día no corría. Ahora la dispara `pg_cron` y no depende de nadie.
//
// ── Qué hace, en orden ──────────────────────────────────────────────────────
//   1. Fusiona las fichas sueltas que en realidad son duplicados.
//   2. Las que no se parecen lo suficiente van a «Por revisar».
//   3. Completa el distrito de las fichas que no lo tienen.
//   4. Copia los datos del ERP al portal.
//
// El orden importa: una ficha suelta que es duplicado NO se puede emparejar
// —su número ya tiene dueño y la base rechaza el insert— así que fusionar va
// antes que copiar.
//
// ── Sobre el paso 3 ─────────────────────────────────────────────────────────
// `elegirDistrito` es una TRADUCCIÓN de `elegir_distrito` de `bloque.py`,
// verificada contra las 25,946 decisiones del original con
// `scripts/migracion-clientes/comparar_matcher.mjs`: 25,946 iguales, 0
// distintas. No es código nuevo — es la misma función, demostrada sobre los
// mismos casos. Cualquier cambio en `_shared/distrito.ts` tiene que volver a
// pasar esa comparación.
//
// ⚠️ OJO AL REDESPLEGAR: va con `--no-verify-jwt`. El cron manda el
// `admin_invoke_secret` como Bearer y eso NO es un JWT, así que con
// `verify_jwt=true` la plataforma contesta 401 antes de ejecutar una línea.
//
//     supabase functions deploy sincronizar-fichas-clientes --no-verify-jwt \
//       --project-ref sacecdkdmsdvgqnrsett
//
// ── Presupuesto ─────────────────────────────────────────────────────────────
// Una Edge Function vive 150 s y cada ficha son 1-3 viajes al ERP. Se corta
// MUY por debajo para que siempre alcance a escribir el registro: lo que no
// entra hoy entra mañana, porque todo el proceso es reanudable.
const PRESUPUESTO_MS = 110_000;
const MAX_FICHAS = 120;

interface Candidato {
  id: number;
  name: string;
  erp_id: string | null;
  categoria: string | null;
  direccion: string | null;
  departamento: string | null;
  municipio: string | null;
}

/**
 * ¿Los dos nombres son la misma persona escrita distinto?
 *
 * No es un juicio de identidad —eso lo afirma el número del ERP— es un freno:
 * si no se parecen en nada, el vínculo puede venir de una factura emitida al
 * cliente equivocado, y fusionar mezclaría dos historiales sin vuelta atrás.
 *
 * Apartó 4 de 72 en la corrida del 2026-08-06, incluida una cuya contraparte se
 * llama literalmente «NO APARECE».
 */
function parecidos(a: string, b: string): boolean {
  const toks = (s: string) => norm(s).split(" ").filter(t => t.length >= 4);
  const ta = toks(a), tb = toks(b);
  if (!ta.length || !tb.length) return false;
  const [corto, largo] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const aUnCaracter = (x: string, y: string) => {
    if (Math.abs(x.length - y.length) > 1) return false;
    if (x.length === y.length)
      return [...x].filter((c, i) => c !== y[i]).length === 1;
    const [c, l] = x.length < y.length ? [x, y] : [y, x];
    for (let i = 0; i < l.length; i++)
      if (l.slice(0, i) + l.slice(i + 1) === c) return true;
    return false;
  };
  const coinciden = corto.filter(t => largo.some(o => t === o || aUnCaracter(t, o))).length;
  return coinciden >= Math.max(2, corto.length - 1) || coinciden === corto.length;
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
  const queda = () => Date.now() - arranque < PRESUPUESTO_MS;

  try {
    const esCron = requireInvokeSecret(req);
    let actor = "Corrida automática";
    if (!esCron) {
      const emp = await requireActiveEmployeeUser(req, admin);
      if (!emp) return json({ ok: false, error: "Sesión inválida o empleado inactivo." }, 401);
      const { data: e } = await admin.from("employees").select("role_id").eq("id", emp.id).maybeSingle();
      const { data: permiso } = await admin.from("role_permissions")
        .select("can_edit").eq("role_id", e?.role_id ?? -1)
        .eq("module_key", "clientes").maybeSingle();
      if (!permiso?.can_edit)
        return json({ ok: false, error: "No tenés permiso para editar clientes." }, 403);
      actor = emp.name;
    }

    const { data: candidatos, error: eCand } =
      await admin.rpc("clientes_sin_distrito_corregibles");
    if (eCand) throw new Error(`clientes_sin_distrito_corregibles: ${eCand.message}`);
    const lista: Candidato[] = (candidatos ?? []).slice(0, MAX_FICHAS);
    if (!lista.length)
      return json({ ok: true, revisadas: 0, mensaje: "no hay fichas que corregir" });

    const cookie = await login();
    const res = {
      fusionadas: 0, facturas_movidas: 0, a_revisar: 0,
      distrito_escrito: 0, distrito_sin_evidencia: 0, espejadas: 0,
      fallidas: 0, cortada_por_tiempo: false,
    };
    const aRevisar: unknown[] = [];
    const aEspejar: Record<string, unknown>[] = [];
    const detalle: unknown[] = [];

    for (const c of lista) {
      if (!queda()) { res.cortada_por_tiempo = true; break; }
      try {
        let erpId = c.erp_id;

        // ── 1 · Resolver el número, leyendo una factura suya ──────────
        if (!erpId) {
          const { data: fac } = await admin.from("sales_invoices")
            .select("erp_invoice_id").eq("customer_id", c.id)
            .not("erp_invoice_id", "is", null).order("fecha", { ascending: false })
            .limit(1).maybeSingle();
          if (!fac?.erp_invoice_id) continue;      // sin factura, nada que leer
          erpId = await idClienteDeFactura(cookie, String(fac.erp_invoice_id));
          if (!erpId) continue;

          // ¿Ese número ya tiene ficha? Entonces ésta es un duplicado.
          const { data: dueño } = await admin.from("customers")
            .select("id, name").eq("erp_id", erpId).maybeSingle();
          if (dueño && dueño.id !== c.id) {
            if (parecidos(c.name, dueño.name)) {
              const { data: r, error } = await admin.rpc("fusionar_cliente_duplicado",
                { p_huerfana: c.id, p_erp_id: erpId });
              if (error) throw new Error(`fusionar: ${error.message}`);
              res.fusionadas++;
              res.facturas_movidas += (r as { facturas_movidas?: number })?.facturas_movidas ?? 0;
              detalle.push({ ficha: c.name, accion: "fusionada", destino: dueño.name });
            } else {
              aRevisar.push({
                erp_id: erpId, name: c.name, motivo: "fusion_dudosa",
                detalle: `El número interno ${erpId} corresponde a «${dueño.name}», ` +
                         `pero esta ficha se llama «${c.name}». Podrían ser dos ` +
                         `personas distintas: no se unieron.`,
                datos: { ficha_suelta_id: c.id, ficha_suelta_nombre: c.name,
                         ficha_destino_id: dueño.id, ficha_destino_nombre: dueño.name },
              });
              res.a_revisar++;
            }
            continue;                                // fusionada o apartada: listo
          }
        }

        // ── 2 · El distrito, si le falta ──────────────────────────────
        const ficha = await leerFicha(cookie, erpId);
        if (!ficha.campos.distrito) {
          const eleccion = await elegirDistrito(
            `erp:${erpId}`,
            ficha.campos.direccion ?? "",
            ficha.opciones.distrito ?? [],
            ubicacionDe(
              Object.fromEntries(ficha.opciones.departamento ?? [])[ficha.campos.departamento ?? ""] ?? "",
              Object.fromEntries(ficha.opciones.municipio ?? [])[ficha.campos.municipio ?? ""] ?? "",
            ),
          );
          if (eleccion.value) {
            const w = await escribirCampo(cookie, erpId, "distrito", eleccion.value);
            if (w.ok) {
              res.distrito_escrito++;
              detalle.push({ ficha: c.name, accion: "distrito", motivo: eleccion.motivo });
            } else {
              res.fallidas++;
              detalle.push({ ficha: c.name, accion: "distrito", error: w.motivo });
            }
          } else {
            res.distrito_sin_evidencia++;
          }
        }

        // ── 3 · Copiar al portal ──────────────────────────────────────
        aEspejar.push(filaPortal(c.id, erpId, await leerFicha(cookie, erpId)));
      } catch (e) {
        res.fallidas++;
        detalle.push({ ficha: c.name, error: e instanceof Error ? e.message : String(e) });
      }
    }

    if (aRevisar.length) {
      const { error } = await admin.rpc("upsert_clientes_por_revisar", { p_filas: aRevisar });
      if (error) console.error("upsert_clientes_por_revisar:", error.message);
    }
    if (aEspejar.length) {
      // De a 250, igual que el script: el RPC hace un UPDATE masivo y una
      // violación de constraint aborta la sentencia entera.
      for (let i = 0; i < aEspejar.length; i += 250) {
        const { data, error } = await admin.rpc("aplicar_espejo_erp",
          { p_filas: aEspejar.slice(i, i + 250) });
        if (error) { console.error("aplicar_espejo_erp:", error.message); continue; }
        res.espejadas += (data as { actualizadas?: number })?.actualizadas ?? 0;
      }
    }

    // Queda registrado SIEMPRE: una corrida que no dejó rastro es
    // indistinguible de una que no corrió.
    const { error: auditErr } = await admin.from("audit_logs").insert({
      action: "FICHAS_CLIENTES_SINCRONIZADAS",
      target_id: "diaria",
      user_name: actor,
      source: esCron ? "SYSTEM" : "ADMIN_PANEL",
      severity: (res.fallidas > 0 || res.cortada_por_tiempo) ? "WARNING" : "INFO",
      details: { ...res, candidatos: lista.length, detalle },
    });
    if (auditErr) console.error("audit_logs:", auditErr.message);

    return json({ ok: true, candidatos: lista.length, ...res, detalle });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
