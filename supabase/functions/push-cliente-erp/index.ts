import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireInvokeSecret } from "../_shared/security.ts";
import { BASE, login, pedir, parsearFicha, type Ficha } from "../_shared/erp-clientes.ts";

// Empuja al ERP, EN EL MOMENTO, la edición que se acaba de guardar en el portal.
//
// Antes esto lo hacía `scripts/migracion-clientes/empujar_al_erp.py` a mano: la
// edición quedaba protegida y en cola, pero el ERP no se enteraba hasta que
// alguien corriera el script. Para quien usa el portal eso es indistinguible de
// que no funcione.
//
// La cola sigue siendo la misma —`customers_changelog` con `erp_synced_at IS
// NULL` y `descartado_at IS NULL`— así que esta función no reemplaza al script:
// lo adelanta. Si esta llamada falla, la entrada QUEDA pendiente y el script (o
// el próximo guardado) la recoge. Nunca se marca como sincronizado algo que no
// llegó, y lo que el espejo ya descartó no se reintenta para siempre: eso se
// anota con `descartado_at` y sale de la cola.
//
// ── Lo que no se puede olvidar del ERP ─────────────────────────────────────
//  1. Un POST parcial BORRA lo que no se manda. Se lee la ficha entera, se le
//     aplican los campos cambiados y se reenvían los 21 (incidente 6317).
//  2. Los valores viajan CRUDOS, sin recortar espacios: el control de
//     duplicados del ERP compara el nombre tal cual y hay fichas cuya única
//     diferencia es un espacio inicial.
//  3. Hay que LEER la respuesta: contesta 200 con {"typeinfo":"Error"} cuando
//     rechaza. Un rechazo silencioso se ve igual que un éxito.
//
// ── Dos maneras de entrar ──────────────────────────────────────────────────
//   { customer_id: N }  el formulario, apenas guarda. Usa el JWT de la persona,
//                       así los RPC aplican su permiso de módulo.
//   {}  + admin secret  el cron, que DRENA la cola. Es la garantía: sin él, un
//                       envío fallido se queda pendiente para siempre si nadie
//                       vuelve a editar esa ficha. El empuje inmediato es la
//                       optimización; esto es la red.
//
// OJO AL REDESPLEGAR: esta función va con `--no-verify-jwt` porque el cron manda
// el `admin_invoke_secret` como Bearer, que no es un JWT. Un redeploy sin el
// flag la resetea a verify_jwt=true y el cron empieza a fallar con 401 ANTES de
// ejecutar una línea — ya pasó dos veces en este proyecto con otras funciones.

// El trato con la ficha del ERP —login, pedir, parsearFicha— vive en
// `_shared/erp-clientes.ts`. Estaba duplicado acá y en
// `sincronizar-fichas-clientes`; unificado el 2026-08-07. Lo que queda en este
// archivo es lo suyo propio: el mapeo portal→ERP y el empuje de la cola.

// ── Portal → ERP ────────────────────────────────────────────────────────────
const A_TEXTO: Record<string, string> = {
  name: "nombre", nit: "nit", dui: "dui", nrc: "nrc", phone: "telefono1",
  telefono2: "telefono2", email: "correo", direccion: "direccion",
  pasaporte: "pasaporte",
};
const A_SELECT: Record<string, string> = {
  departamento: "departamento", municipio: "municipio", distrito: "distrito",
  categoria: "categoria", giro: "sel_giro", retencion_pct: "porcentaje",
};
const SOLO_PORTAL = new Set(["notes"]);

const sinTildes = (s: string) => (s ?? "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();

// El ERP TRUNCA los nombres de distrito para que entren en su campo, así que
// ninguna normalización saca "SN MIG MERCEDES" de "San Miguel de Mercedes".
// Es el reverso de la tabla de `src/data/elSalvadorGeo.js`; está duplicada
// porque son dos runtimes distintos y no hay bundling entre ellos. Si se agrega
// una fila allá, agregarla acá.
const ABREVIATURAS_ERP: Record<string, string> = {
  "DULCE NOMBRE DE MARIA": "DULCE NOM MARIA",
  "NUEVA CONCEPCION": "NVA CONCEPCION",
  "SAN ANTONIO DE LA CRUZ": "SAN ANT LA CRUZ",
  "SAN ANTONIO LOS RANCHOS": "SAN ANT RANCHOS",
  "SAN ISIDRO LABRADOR": "SAN I LABRADOR",
  "SAN JOSE CANCASQUE": "SAN J CANCASQUE",
  "LAS FLORES": "SAN JOSE FLORES",
  "SAN LUIS DEL CARMEN": "SAN LUIS CARMEN",
  "SAN PABLO TACACHICO": "SAN P TACACHICO",
  "SAN MIGUEL DE MERCEDES": "SN MIG MERCEDES",
};

/** Etiqueta del portal → value del ERP. `null` = no se pudo resolver, y
 *  entonces el campo NO viaja: inventar un distrito en una ficha fiscal es
 *  exactamente lo que este proyecto tiene prohibido. */
function valorDeSelect(opciones: Ficha["opciones"], campo: string, etiqueta: string): string | null {
  const lista = opciones[campo] ?? [];
  const objetivo = sinTildes(etiqueta);
  if (!objetivo) return "";                              // vaciar es una intención válida
  for (const [value, texto] of lista) if (sinTildes(texto) === objetivo) return value;
  const abrev = ABREVIATURAS_ERP[objetivo];
  if (abrev) for (const [value, texto] of lista) if (sinTildes(texto) === abrev) return value;
  // `porcentaje` rotula '10%' y el portal guarda 10.
  for (const [value, texto] of lista) if (texto.replace(/\D/g, "") === objetivo) return value;
  return null;
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const { customer_id } = await req.json().catch(() => ({}));
    const esCron = requireInvokeSecret(req);

    // El formulario usa el JWT de la persona: así los RPC aplican su permiso de
    // módulo y esta función no es una puerta trasera para escribir en el ERP.
    // El cron no tiene usuario, así que va con service_role — y por eso
    // `marcar_empujado_al_erp` lo acepta explícitamente.
    const auth = req.headers.get("Authorization") ?? "";
    if (!esCron && !auth) return json({ error: "Sin credenciales" }, 401);
    const sb = esCron
      ? createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)
      : createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
                     { global: { headers: { Authorization: auth } } });

    const { data: cola, error: eCola } = await sb.rpc("cola_espejo_portal_erp", { p_limite: null });
    if (eCola) throw eCola;
    const pendientes: any[] = cola?.cola ?? [];

    // Sin customer_id se drena la cola entera, de a poco: el ERP tarda ~3
    // peticiones por ficha y una edge function tiene techo de tiempo. Lo que no
    // entre en esta pasada lo levanta la siguiente — la cola normalmente está
    // vacía, así que el tope no es una limitación real.
    const objetivo = customer_id
      ? pendientes.filter(f => String(f.customer_id) === String(customer_id))
      : pendientes.slice(0, 5);

    if (!objetivo.length) {
      return json({ empujado: false, motivo: customer_id
        ? "sin cambios pendientes para este cliente" : "la cola está vacía",
        en_cola: pendientes.length });
    }
    if (!customer_id) {
      // Modo drenaje: se procesa cada una y se informa el conjunto.
      const resultados = [];
      for (const f of objetivo) resultados.push(await empujarFicha(sb, f));
      return json({ drenaje: true, procesadas: resultados.length,
                    quedan: Math.max(0, pendientes.length - resultados.length),
                    resultados });
    }
    const ficha = objetivo[0];

    return json(await empujarFicha(sb, ficha));
  } catch (e) {
    // La entrada queda PENDIENTE: se reintenta en el próximo guardado o en la
    // próxima pasada del cron. Nunca se marca como sincronizado algo que no
    // llegó.
    return json({ empujado: false, error: String((e as any)?.message ?? e) }, 200);
  }
});

// ── El empuje de UNA ficha ──────────────────────────────────────────────────
async function empujarFicha(sb: any, ficha: any): Promise<any> {
  try {
    const cookie = await login();
    const { campos, opciones } = parsearFicha(
      await pedir(cookie, `${BASE}/editar_cliente.php?id_cliente=${ficha.erp_id}`));
    if (!Object.keys(campos).length) throw new Error("El ERP no devolvió la ficha (¿sesión caída?).");

    const nuevos: Record<string, string> = { ...campos };
    const aplicados: any[] = [];
    const sinResolver: any[] = [];
    for (const c of ficha.cambios) {
      if (SOLO_PORTAL.has(c.campo)) { sinResolver.push({ ...c, motivo: "solo existe en el portal" }); continue; }
      if (A_TEXTO[c.campo]) {
        nuevos[A_TEXTO[c.campo]] = c.valor ?? "";
        aplicados.push({ ...c, campo_erp: A_TEXTO[c.campo], envia: c.valor ?? "" });
      } else if (A_SELECT[c.campo]) {
        const v = valorDeSelect(opciones, A_SELECT[c.campo], c.valor ?? "");
        if (v === null) { sinResolver.push({ ...c, motivo: `'${c.valor}' no coincide con ninguna opción del ERP` }); continue; }
        nuevos[A_SELECT[c.campo]] = v;
        aplicados.push({ ...c, campo_erp: A_SELECT[c.campo], envia: v });
      } else sinResolver.push({ ...c, motivo: "sin equivalente en el ERP" });
    }
    if (!aplicados.length) return { empujado: false, erp_id: ficha.erp_id, motivo: "nada que el ERP pueda recibir", sin_resolver: sinResolver };

    const payload = new URLSearchParams({ ...nuevos, process: "edit", id_cliente: String(ficha.erp_id) });
    const cruda = await pedir(cookie, `${BASE}/procesos/clientes.php`, payload);
    let resp: any;
    try { resp = JSON.parse(cruda); } catch { resp = { typeinfo: "NO-JSON", msg: cruda.slice(0, 200) }; }
    if (resp.typeinfo !== "Success") return { empujado: false, erp_id: ficha.erp_id, rechazo: resp.msg ?? resp.typeinfo, sin_resolver: sinResolver };

    // Verificar releyendo: que se aplicó lo pedido y que no se perdió nada.
    const despues = parsearFicha(await pedir(cookie, `${BASE}/editar_cliente.php?id_cliente=${ficha.erp_id}`)).campos;
    const noQuedo = aplicados.filter(a => (despues[a.campo_erp] ?? "") !== (a.envia ?? ""));
    const perdidos = Object.keys(campos).filter(k =>
      campos[k] && !despues[k] && nuevos[k] !== "");
    if (noQuedo.length || perdidos.length) {
      return { empujado: false, erp_id: ficha.erp_id, motivo: "el ERP no dejó el dato como se envió",
               no_quedo: noQuedo.map((a: any) => a.campo_erp), perdidos };
    }

    // Recién ahora se salda, y solo lo que viajó.
    const ids = aplicados.flatMap(a => a.changelog_ids ?? []);
    const { data: marca, error: eMarca } = await sb.rpc("marcar_empujado_al_erp", { p_ids: ids });
    if (eMarca) throw eMarca;

    return { empujado: true, erp_id: ficha.erp_id,
             campos: aplicados.map((a: any) => a.campo), marcadas: marca?.marcadas ?? 0,
             sin_resolver: sinResolver };
  } catch (e) {
    return { empujado: false, erp_id: ficha.erp_id, error: String((e as any)?.message ?? e) };
  }
}
