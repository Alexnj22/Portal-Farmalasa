import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireActiveEmployeeUser, requireInvokeSecret } from "../_shared/security.ts";
import {
  login, leerFicha, idClienteDeFactura, escribirCampo, escribirCampos,
  ponerUbicacion, duiValido, filaPortal,
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
//   3. Corrige la ficha DEL ERP —que es la que viaja a Hacienda— según la
//      tabla de decisión de abajo.
//   4. Copia los datos del ERP al portal.
//
// El orden importa: una ficha suelta que es duplicado NO se puede emparejar
// —su número ya tiene dueño y la base rechaza el insert— así que fusionar va
// antes que copiar.
//
// ── El paso 3, y por qué la lista de trabajo cambió ─────────────────────────
// Hasta v2.541.x la lista salía del ESPEJO (`customers.distrito IS NULL`) y la
// corrección se escribía en el ERP. Cuando las dos copias divergen, el proceso
// mira la copia equivocada: una ficha con CHALATENANGO en el portal y el
// distrito VACÍO en el ERP no era candidata… y era justo la que Hacienda
// rechazaba. Invisible para el proceso hecho para arreglarla.
//
// Ahora la lista la da `fichas_para_corregir_dte()`, que suma la señal que no
// depende del espejo —a quién rechazó Hacienda— a la preventiva de siempre.
//
// ── La tabla de decisión, sobre la ficha DEL ERP ────────────────────────────
//   sin municipio ................... el triple por defecto
//   con municipio, sin distrito ..... el matcher
//   rechazada por distrito .......... el triple por defecto
//   DUI que no cumple el algoritmo .. borrarlo
//   rechazo no accionable (fecEmi) .. nada, es informativo
//
// Las tres primeras y la cuarta son las reglas ① y ③ de `bloque.py`, que la
// primera versión de esta función no se trajo: se portó el matcher —lo difícil,
// lo verificado— y quedaron afuera las dos fáciles. Por eso «bloque procesó
// 25,946 fichas sin problemas» y esto sí los tenía.
//
// ── Alcance: quién se toca y quién sólo se copia ────────────────────────────
// En el ERP se escriben SÓLO consumidores (decisión del usuario, 2026-08-09).
// A los contribuyentes se los espeja al portal y nada más — sus CCF pueden
// seguir trabándose y eso está aceptado.
//
// ── El freno ────────────────────────────────────────────────────────────────
// Si el campo ya se corrigió ANTES de este rechazo, la corrección no alcanzó:
// la ficha va a «Por revisar» con motivo `rechazo_persistente` en vez de
// reintentar lo mismo cada noche.
//
// ── Sobre el matcher ────────────────────────────────────────────────────────
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
  customer_id: number;
  name: string;
  erp_id: string | null;
  categoria: string | null;
  origen: "rechazo" | "sin_distrito";
  campo: string;                 // distrito | municipio | departamento | dui
  motivo_mh: string | null;
  puede_escribir: boolean;       // false = contribuyente: sólo espejo
  ya_corregido: boolean;         // ya se intentó y Hacienda volvió a rechazar
}

// El mismo triple que `DEFECTO` de bloque.py (4 / 36 / 7), pero por ETIQUETA:
// los códigos del ERP son por departamento y el 7 vale otro distrito en otro.
const UBICACION_DEFECTO = {
  departamento: "Chalatenango",
  municipio: "Chalatenango Sur",
  distrito: "CHALATENANGO",
};

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

    // `alcance`: «rechazos» procesa SOLO lo que Hacienda rechazó; «todo» suma
    // los preventivos. Existe para poder soltar el cambio por partes — la
    // primera corrida con reglas nuevas sobre 94 fichas a la vez es mucho de
    // una sola vez, y el rechazo es el conjunto chico y verificable.
    const cuerpo = await req.json().catch(() => ({}));
    const alcance: string = cuerpo?.alcance ?? "todo";

    const { data: candidatos, error: eCand } =
      await admin.rpc("fichas_para_corregir_dte");
    if (eCand) throw new Error(`fichas_para_corregir_dte: ${eCand.message}`);
    const lista: Candidato[] = (candidatos ?? [])
      .filter((c: Candidato) => alcance === "todo" || c.origen === "rechazo")
      .slice(0, MAX_FICHAS);
    if (!lista.length)
      return json({ ok: true, revisadas: 0, mensaje: "no hay fichas que corregir" });

    const cookie = await login();
    const res = {
      fusionadas: 0, facturas_movidas: 0, a_revisar: 0,
      distrito_escrito: 0, distrito_sin_evidencia: 0, espejadas: 0,
      ubicacion_por_defecto: 0, dui_borrado: 0, solo_espejo: 0, ya_estaban: 0,
      sin_numero_no_resuelto: 0, numero_resuelto: 0, filas_a_espejar: 0,
      espejo_rechazado: 0,
      frenadas: 0, fallidas: 0, cortada_por_tiempo: false,
    };
    const aRevisar: unknown[] = [];
    // El ERP tiene su propio control de duplicados y rechaza el guardado
    // completo —`escribirCampo` reenvía los 21 campos, así que cualquier
    // edición lo dispara—. No es un fallo técnico ni se arregla reintentando:
    // hay dos fichas que el ERP considera la misma persona y eso lo decide
    // alguien. Medido: 3 de 98 en la primera corrida completa.
    const esRechazoPorDuplicado = (m?: string) => !!m && /ya se registro un cliente/i.test(m);
    const aRevisarDuplicado = (c: Candidato, erpId: string, motivo?: string) => {
      aRevisar.push({
        erp_id: erpId, name: c.name, motivo: "erp_rechaza_duplicado",
        detalle: `El sistema de origen no deja guardar la ficha de «${c.name}»: ` +
                 `«${motivo ?? "sin motivo"}». Ya existe otra ficha que considera ` +
                 `la misma persona — hay que unirlas o distinguirlas a mano.`,
        datos: { customer_id: c.customer_id, erp_id: erpId, motivo },
      });
      res.a_revisar++;
    };
    const aEspejar: Record<string, unknown>[] = [];
    const correcciones: Record<string, unknown>[] = [];
    const detalle: unknown[] = [];

    for (const c of lista) {
      if (!queda()) { res.cortada_por_tiempo = true; break; }
      try {
        let erpId = c.erp_id;

        // ── 1 · Resolver el número, leyendo una factura suya ──────────
        if (!erpId) {
          const { data: fac } = await admin.from("sales_invoices")
            .select("erp_invoice_id").eq("customer_id", c.customer_id)
            .not("erp_invoice_id", "is", null).order("fecha", { ascending: false })
            .limit(1).maybeSingle();
          if (!fac?.erp_invoice_id) {
            // Sin número del ERP y sin una sola factura: no hay documento del
            // cual deducir a qué cliente pertenece, así que no se resuelve
            // sola nunca. Antes era un `continue` mudo —sin contador y sin
            // destino— y por eso la corrida decía «92 candidatos, 0 acciones»
            // y parecía no hacer nada. El silencio se lee igual que el éxito.
            aRevisar.push({
              erp_id: null, name: c.name, motivo: "sin_numero_erp",
              detalle: `«${c.name}» no tiene número interno ni ninguna factura ` +
                       `de la cual deducirlo. Es una ficha suelta del portal: ` +
                       `hay que ligarla a mano o darla de baja.`,
              datos: { customer_id: c.customer_id },
            });
            res.a_revisar++;
            continue;
          }
          erpId = await idClienteDeFactura(cookie, String(fac.erp_invoice_id));
          if (!erpId) {
            // Tiene factura pero el ERP no dice a qué cliente pertenece. Puede
            // resolverse mañana con otra factura, así que NO va a revisar — pero
            // se cuenta, para que la corrida no mienta con un cero.
            res.sin_numero_no_resuelto++;
            continue;
          }
          res.numero_resuelto++;

          // ¿Ese número ya tiene ficha? Entonces ésta es un duplicado.
          const { data: dueño } = await admin.from("customers")
            .select("id, name").eq("erp_id", erpId).maybeSingle();
          if (dueño && dueño.id !== c.customer_id) {
            if (parecidos(c.name, dueño.name)) {
              const { data: r, error } = await admin.rpc("fusionar_cliente_duplicado",
                { p_huerfana: c.customer_id, p_erp_id: erpId });
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
                datos: { ficha_suelta_id: c.customer_id, ficha_suelta_nombre: c.name,
                         ficha_destino_id: dueño.id, ficha_destino_nombre: dueño.name },
              });
              res.a_revisar++;
            }
            continue;                                // fusionada o apartada: listo
          }
        }

        // ── 2 · La tabla de decisión, sobre la ficha DEL ERP ──────────
        const ficha = await leerFicha(cookie, erpId);

        // Una ficha SIN NINGÚN campo es un `erp_id` que el ERP no reconoce:
        // `editar_cliente.php` devuelve el formulario vacío. No hay nada que
        // corregir y reintentarlo cada noche sólo suma ruido — verificado a
        // mano sobre erp 23771, cero campos. Son enlaces huérfanos de la
        // migración de abril.
        if (!Object.keys(ficha.campos).length) {
          aRevisar.push({
            erp_id: erpId, name: c.name, motivo: "erp_id_inexistente",
            detalle: `El número interno ${erpId} no existe en el sistema de ` +
                     `origen: su ficha vuelve vacía. Hay que averiguar cuál es ` +
                     `el número correcto de «${c.name}» o dar de baja la ficha.`,
            datos: { customer_id: c.customer_id, erp_id: erpId },
          });
          res.a_revisar++;
          continue;                       // sin ficha no hay nada que espejar
        }

        // El freno: ya se corrigió y Hacienda volvió a rechazar lo mismo.
        // Reintentarlo cada noche no lo arregla y esconde el caso.
        if (c.ya_corregido) {
          aRevisar.push({
            erp_id: erpId, name: c.name, motivo: "rechazo_persistente",
            detalle: `Ya se corrigió ${c.campo} en la ficha y Hacienda la volvió ` +
                     `a rechazar: «${c.motivo_mh ?? "sin motivo"}». La corrección ` +
                     `no alcanza — hay que mirarlo a mano.`,
            datos: { customer_id: c.customer_id, campo: c.campo, motivo_mh: c.motivo_mh },
          });
          res.a_revisar++;
        } else if (!c.puede_escribir) {
          // Contribuyentes: no se tocan en el ERP, sólo se espejan.
          res.solo_espejo++;
        } else if (c.campo === "dui" || duiValido(ficha.campos.dui) === false) {
          // Regla ③ de bloque: un DUI que no cumple el algoritmo se borra. La
          // ficha queda limpia y el dato sigue disponible para corregirlo.
          const antes = ficha.campos.dui ?? "";
          if (antes) {
            const w = await escribirCampos(cookie, erpId, { dui: "" });
            if (w.ok) {
              res.dui_borrado++;
              // El espejo NO propaga borrados: `aplicar_espejo_erp` usa
              // `coalesce`, que protege contra una lectura fallida del ERP
              // blanqueando datos buenos. Correcto en general, pero deja al
              // portal mostrando un DUI que en el ERP ya no está — la misma
              // divergencia que causó todo esto. Como el borrado lo decidimos
              // nosotros, lo propagamos nosotros, sin aflojar la guarda global.
              await admin.from("customers").update({ dui: null }).eq("id", c.customer_id);
              correcciones.push({ erp_id: erpId, customer_id: c.customer_id, campo: "dui",
                                  antes, despues: "", motivo: "dui_invalido" });
              detalle.push({ ficha: c.name, accion: "dui borrado", antes });
            } else if (esRechazoPorDuplicado(w.motivo)) { aRevisarDuplicado(c, erpId, w.motivo); }
            else { res.fallidas++; detalle.push({ ficha: c.name, accion: "dui", error: w.motivo }); }
          }
        } else if (!ficha.campos.municipio || c.origen === "rechazo") {
          // Regla ① de bloque: sin municipio no hay de dónde deducir el
          // distrito. Y si Hacienda rechazó la ubicación, el default también —
          // decisión del usuario: no se diagnostica, se pone el de siempre.
          const u = await ponerUbicacion(cookie, erpId, UBICACION_DEFECTO);
          if (u.ok && u.cambios > 0) {
            res.ubicacion_por_defecto++;
            correcciones.push({ erp_id: erpId, customer_id: c.customer_id, campo: "ubicacion",
                                antes: u.antes, despues: u.despues,
                                motivo: c.origen === "rechazo" ? "rechazo_distrito" : "sin_municipio" });
            detalle.push({ ficha: c.name, accion: "ubicación por defecto", pasos: u.pasos });
          } else if (u.ok) {
            // Ya estaba en el destino: no se escribe ni se anota. Una corrección
            // que no ocurrió ensucia el freno — mañana parecería que se intentó.
            res.ya_estaban++;
          } else if (esRechazoPorDuplicado(u.motivo)) { aRevisarDuplicado(c, erpId, u.motivo); }
          else { res.fallidas++; detalle.push({ ficha: c.name, accion: "ubicación", error: u.motivo }); }
        } else if (!ficha.campos.distrito) {
          // Regla ② — el matcher, verificado contra las 25,946 decisiones.
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
              correcciones.push({ erp_id: erpId, customer_id: c.customer_id, campo: "distrito",
                                  antes: "", despues: eleccion.value, motivo: "sin_distrito" });
              detalle.push({ ficha: c.name, accion: "distrito", motivo: eleccion.motivo });
            } else if (esRechazoPorDuplicado(w.motivo)) { aRevisarDuplicado(c, erpId, w.motivo); }
            else {
              res.fallidas++;
              detalle.push({ ficha: c.name, accion: "distrito", error: w.motivo });
            }
          } else {
            res.distrito_sin_evidencia++;
          }
        }

        // ── 3 · Copiar al portal ──────────────────────────────────────
        aEspejar.push(filaPortal(c.customer_id, erpId, await leerFicha(cookie, erpId)));
      } catch (e) {
        res.fallidas++;
        detalle.push({ ficha: c.name, error: e instanceof Error ? e.message : String(e) });
      }
    }

    if (aRevisar.length) {
      const { error } = await admin.rpc("upsert_clientes_por_revisar", { p_filas: aRevisar });
      if (error) console.error("upsert_clientes_por_revisar:", error.message);
    }
    // Lo corregido se anota SIEMPRE, y antes que nada: es lo que hace de freno
    // la próxima vez. Sin este registro, un rechazo que vuelve mañana se lee
    // como nuevo y se reintenta lo mismo para siempre.
    if (correcciones.length) {
      const { error } = await admin.from("dte_correcciones_ficha").insert(correcciones);
      if (error) console.error("dte_correcciones_ficha:", error.message);
    }
    res.filas_a_espejar = aEspejar.length;
    if (aEspejar.length) {
      // De a 250: el RPC hace un UPDATE masivo y **una** violación de
      // constraint aborta la sentencia entera. Eso no era teoría — medido el
      // 2026-08-09: un lote de 70 filas devolvió 0 actualizadas mientras la
      // misma fila sola actualizaba bien. Un `erp_id` en conflicto (dos fichas
      // sueltas que resuelven al mismo cliente, o uno que ya tiene dueño) se
      // llevaba puestas a las 69 buenas.
      //
      // Y el error iba sólo a `console.error`, así que la corrida informaba
      // «espejadas: 0» sin decir por qué. Ahora, si el lote falla, se reintenta
      // FILA POR FILA: las buenas entran y las que chocan quedan nombradas.
      for (let i = 0; i < aEspejar.length; i += 250) {
        const lote = aEspejar.slice(i, i + 250);
        const { data, error } = await admin.rpc("aplicar_espejo_erp", { p_filas: lote });
        if (!error) {
          res.espejadas += (data as { actualizadas?: number })?.actualizadas ?? 0;
          continue;
        }
        detalle.push({ accion: "espejo por lote", error: error.message, filas: lote.length });
        for (const fila of lote) {
          const { data: d1, error: e1 } = await admin.rpc("aplicar_espejo_erp", { p_filas: [fila] });
          if (e1) {
            res.espejo_rechazado++;
            detalle.push({ ficha: fila.match_name, accion: "espejo", error: e1.message });
          } else {
            res.espejadas += (d1 as { actualizadas?: number })?.actualizadas ?? 0;
          }
        }
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
