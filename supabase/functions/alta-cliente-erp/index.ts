import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireInvokeSecret } from "../_shared/security.ts";
import {
  login, leerFicha, buscarEnCaja, armarAlta, darDeAlta, ponerUbicacion, sinTildes,
  type FichaPortal, type FilaCaja,
} from "../_shared/erp-clientes.ts";

// Da de alta en la caja (el sistema donde se factura) un cliente que nació en
// el portal, y guarda en la ficha del portal el número que la caja le dio.
// Plan: docs/PLAN-CLIENTES-SOLO-DESDE-EL-PORTAL-2026-11-15.md, paso 4.
//
// ── Dos maneras de entrar ──────────────────────────────────────────────────
//   { customer_id: N }  la pantalla, apenas crea la ficha (o «Reintentar»). Usa
//                       el JWT de la persona: `clientes_alta_erp_tomar` exige
//                       crear o editar Clientes.
//   {}  + secreto       el cron, cada 10 min: lo que falló y las fichas que ya
//                       existían sin número (34 el 2026-11-15).
//
// OJO AL REDESPLEGAR: va con `--no-verify-jwt`, como `push-cliente-erp`: el cron
// manda el secreto del circuito fiscal como Bearer, que no es un JWT. La función
// valida a los dos por su cuenta.
//
// ── Lo que no se puede olvidar ─────────────────────────────────────────────
//  1. ANTES de crear se BUSCA. Es lo que evita duplicar cuando un alta anterior
//     entró en la caja pero la respuesta se perdió (o la ficha ya existía allá
//     y el portal no la tenía emparejada). Por DUI, por NIT y por nombre.
//  2. Ante la duda NO se adivina: dos candidatos, o un DUI a nombre de otra
//     persona → `revisar`, y lo decide alguien.
//  3. Se LEE la respuesta: la caja contesta 200 con {"typeinfo":"Error"}.
//  4. Se VERIFICA releyendo la ficha creada antes de anotar el número.
//  5. El candado (`tomado_hasta`) lo pone la base: si el guardado y el cron
//     llegan a la vez, sólo uno toma la ficha.

const TOPE_MS = 110_000;   // una edge function vive ~150 s; se deja margen

type Resultado =
  | { ok: true; erp_id: string; como: "creada" | "vinculada"; sin_resolver?: string[]; aviso?: string }
  | { ok: false; error: string; revisar?: boolean };

const digitos = (s: string | null | undefined) => String(s ?? "").replace(/\D/g, "");
const palabras = (s: string) => new Set(sinTildes(s).split(" ").filter(w => w.length > 2));
function seParecen(a: string, b: string): boolean {
  if (sinTildes(a) === sinTildes(b)) return true;
  const pa = palabras(a), pb = palabras(b);
  let comunes = 0;
  for (const w of pa) if (pb.has(w)) comunes++;
  return comunes >= 2;
}

async function buscarExistente(cookie: string, f: FichaPortal):
  Promise<{ vincular?: FilaCaja; revisar?: string }> {
  // Por documento: un DUI o NIT identifican a la persona.
  const porDoc = new Map<string, FilaCaja>();
  if (f.dui) for (const r of await buscarEnCaja(cookie, f.dui)) if (r.dui === f.dui) porDoc.set(r.id, r);
  const nit = digitos(f.nit);
  if (nit) for (const r of await buscarEnCaja(cookie, f.nit!)) if (digitos(r.nit) === nit) porDoc.set(r.id, r);
  if (porDoc.size > 1)
    return { revisar: `En la caja hay ${porDoc.size} fichas con ese documento (${[...porDoc.keys()].join(", ")}).` };
  if (porDoc.size === 1) {
    const r = [...porDoc.values()][0];
    return seParecen(r.nombre, f.name)
      ? { vincular: r }
      : { revisar: `En la caja ese documento es de «${r.nombre}» (ficha ${r.id}).` };
  }

  // Por nombre, sin tildes ni espacios de más.
  const mismos = (await buscarEnCaja(cookie, f.name)).filter(r => sinTildes(r.nombre) === sinTildes(f.name));
  if (!mismos.length) return {};
  if (f.dui && mismos.some(r => r.dui && r.dui !== f.dui))
    return { revisar: `En la caja ya hay otro cliente llamado «${mismos[0].nombre}» con otro DUI (ficha ${mismos[0].id}).` };
  if (mismos.length > 1)
    return { revisar: `En la caja hay ${mismos.length} fichas con ese nombre (${mismos.map(r => r.id).join(", ")}).` };
  return { vincular: mismos[0] };
}

async function altaDeUna(cookie: string, f: FichaPortal & { puede_crear?: boolean }): Promise<Resultado> {
  const previa = await buscarExistente(cookie, f);
  if (previa.revisar) return { ok: false, error: previa.revisar, revisar: true };
  if (previa.vincular) return { ok: true, erp_id: previa.vincular.id, como: "vinculada" };

  // Sólo se CREA lo que nació en el portal (migración 20261115152532): una
  // ficha vieja que vino de una factura y ya no está en la caja probablemente
  // la borraron allá, y crearla la resucitaría.
  if (!f.puede_crear)
    return { ok: false, revisar: true,
             error: "No está en la caja con ese nombre ni con su documento. Puede que la hayan borrado allá: confirma que la persona existe antes de crearla." };

  const { payload, sinResolver } = await armarAlta(cookie, f);
  const alta = await darDeAlta(cookie, payload);
  if (!alta.ok) {
    // Un «ya existe» después de buscar y no encontrar es raro: que lo mire alguien.
    const repetido = /exist|duplic|registrad/i.test(alta.motivo ?? "");
    return { ok: false, error: `La caja no aceptó el alta: ${alta.motivo}`, revisar: repetido };
  }

  let id = alta.id;
  if (!id) {
    // Aceptó sin devolver el número: se busca, y sólo vale si hay uno exacto.
    const mismos = (await buscarEnCaja(cookie, f.name)).filter(r => sinTildes(r.nombre) === sinTildes(f.name));
    if (mismos.length !== 1)
      return { ok: false, revisar: true, error: `La caja aceptó el alta pero no devolvió el número, y por nombre aparecen ${mismos.length}.` };
    id = mismos[0].id;
  }

  // Verificar releyendo la ficha creada.
  const ficha = await leerFicha(cookie, id);
  if (sinTildes(ficha.campos.nombre ?? "") !== sinTildes(f.name))
    return { ok: false, revisar: true, error: `La ficha ${id} de la caja quedó como «${ficha.campos.nombre ?? ""}».` };
  if (f.dui && (ficha.campos.dui ?? "") !== f.dui)
    return { ok: true, erp_id: id, como: "creada", sin_resolver: sinResolver, aviso: `el DUI quedó «${ficha.campos.dui ?? ""}»` };

  // La ubicación, por etiqueta. Si el alta no la dejó, la cascada probada.
  let aviso: string | undefined;
  if (f.departamento && f.municipio && f.distrito) {
    const etiqueta = (c: string) => Object.fromEntries(ficha.opciones[c] ?? [])[ficha.campos[c] ?? ""] ?? "";
    const destino = { departamento: f.departamento, municipio: f.municipio, distrito: f.distrito };
    const quedo = (Object.keys(destino) as (keyof typeof destino)[]).every(c =>
      sinTildes(etiqueta(c)) === sinTildes(destino[c]));
    if (!quedo) {
      const u = await ponerUbicacion(cookie, id, { departamento: f.departamento, municipio: f.municipio, distrito: f.distrito });
      if (!u.ok) aviso = `ubicación: ${u.motivo}`;
    }
  }
  return { ok: true, erp_id: id, como: "creada", sin_resolver: sinResolver, aviso };
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  const inicio = Date.now();
  try {
    const { customer_id } = await req.json().catch(() => ({}));
    const esCron = requireInvokeSecret(req, "fiscal");
    const auth = req.headers.get("Authorization") ?? "";
    if (!esCron && (!auth || !customer_id)) return json({ error: "Sin credenciales o sin cliente" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // Tomar con la sesión de la persona: así la base decide si puede.
    const quienToma = esCron ? admin
      : createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });

    const { data: tomadas, error: eTomar } = await quienToma.rpc("clientes_alta_erp_tomar",
      esCron ? { p_customer_id: customer_id ?? null, p_limite: 5 } : { p_customer_id: customer_id });
    if (eTomar) throw eTomar;
    const fichas = (tomadas ?? []) as (FichaPortal & { customer_id: number; puede_crear?: boolean })[];
    if (!fichas.length) {
      return json({ hecho: false, motivo: customer_id
        ? "esa ficha no necesita alta o ya se está procesando" : "no hay fichas sin número" });
    }

    const cookie = await login();
    const resultados = [];
    for (const f of fichas) {
      if (Date.now() - inicio > TOPE_MS) break;   // lo que no entra, lo toma la próxima pasada
      let r: Resultado;
      try { r = await altaDeUna(cookie, f); }
      catch (e) { r = { ok: false, error: String((e as Error)?.message ?? e) }; }
      const { data: anotado, error: eAnotar } = await admin.rpc("clientes_alta_erp_resultado",
        { p_customer_id: f.customer_id, p_resultado: r });
      if (eAnotar) throw eAnotar;
      const final = (anotado as { ok?: boolean } | null)?.ok === false && r.ok
        ? { ok: false, error: "el número ya es de otra ficha del portal", revisar: true } : r;
      resultados.push({ customer_id: f.customer_id, ...final });
    }

    if (!esCron) return json({ hecho: resultados[0]?.ok ?? false, ...resultados[0] });
    return json({ procesadas: resultados.length, resultados });
  } catch (e) {
    // La ficha queda tomada 3 minutos y después vuelve a la cola: nada se pierde.
    return json({ hecho: false, error: String((e as Error)?.message ?? e) }, 200);
  }
});
