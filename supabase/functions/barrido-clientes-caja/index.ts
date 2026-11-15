import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireInvokeSecret } from "../_shared/security.ts";
import { login, pedir, leerFicha, filaPortal, sinTildes, BASE } from "../_shared/erp-clientes.ts";
import { ACTIVIDADES_MH } from "../_shared/actividadesMH.ts";

// El barrido completo de clientes: la caja contra el portal (2026-11-15).
//
// El portal pasa a ser la base de los clientes. Hasta hoy una ficha llegaba al
// portal sólo si compraba (`sync-dte-sales`) o si la corrida nocturna la tocaba
// para corregirla; una creada o editada en la caja y que no volvía a comprar
// no llegaba nunca. Este barrido recorre la lista ENTERA de la caja y la cruza
// por número de ficha:
//
//   modo "contar"  una página de la lista (hasta 1000), sin escribir: cuántas
//                  faltan en el portal y cuántas difieren en DUI, NIT, NRC,
//                  teléfono o categoría, con sus números.
//   modo "copiar"  para los números dados (hasta 40 por llamada): lee la ficha
//                  completa de la caja y la trae. Las que el portal ya tiene van
//                  por `aplicar_espejo_erp`, que NO pisa un cambio del portal
//                  que todavía no llegó a la caja. Las que faltan entran por
//                  `clientes_importar_de_caja`, que no duplica a nadie.
//
// Sólo lee de la caja. Lo llama `scripts/` a mano o el cron diario (mientras la
// caja siga dejando crear y editar). Se protege con el secreto fiscal.

const TAM = 1000;
const TOPE_COPIA = 40;

interface FilaLista { id: string; nombre: string; dui: string; categoria: string; nit: string; nrc: string; telefono: string }

const dig = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const txt = (s: unknown) => sinTildes(String(s ?? "")).trim();
const desescapar = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/<[^>]*>/g, "").trim();

async function paginaDeLaCaja(cookie: string, pagina: number): Promise<{ filas: FilaLista[]; total: number }> {
  const q = new URLSearchParams({
    draw: "1", start: String(pagina * TAM), length: String(TAM), "search[value]": "", "search[regex]": "false",
    "order[0][column]": "0", "order[0][dir]": "asc",
  });
  for (let i = 0; i < 8; i++) {
    q.set(`columns[${i}][data]`, String(i));
    q.set(`columns[${i}][searchable]`, "true");
    q.set(`columns[${i}][orderable]`, "true");
    q.set(`columns[${i}][search][value]`, "");
  }
  const cruda = await pedir(cookie, `${BASE}/admin_cliente_dt.php`, q);
  let d: { data?: string[][]; recordsTotal?: number };
  try { d = JSON.parse(cruda); } catch { throw new Error(`la lista no devolvió JSON: ${cruda.slice(0, 120)}`); }
  const filas = (d.data ?? [])
    .filter(r => /^\d+$/.test(String(r[0] ?? "")) && Number(r[0]) > 0)
    .map(r => ({ id: String(r[0]), nombre: desescapar(String(r[1] ?? "")), dui: String(r[2] ?? ""),
                 categoria: desescapar(String(r[3] ?? "")), nit: String(r[4] ?? ""), nrc: String(r[5] ?? ""),
                 telefono: String(r[6] ?? "") }));
  return { filas, total: Number(d.recordsTotal ?? 0) };
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    if (!requireInvokeSecret(req, "fiscal")) return json({ error: "Sin credenciales" }, 401);
    const { modo = "contar", pagina = 0, ids = [] } = await req.json().catch(() => ({}));
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // El catálogo de giros de Hacienda a la base (no habla con la caja).
    if (modo === "sembrar_giros") {
      const filas = ACTIVIDADES_MH.map(([codigo, descripcion]) => ({ codigo, descripcion }));
      const { error } = await admin.from("actividades_economicas").upsert(filas, { onConflict: "codigo" });
      if (error) throw error;
      const { count, error: e2 } = await admin.from("actividades_economicas").select("codigo", { count: "exact", head: true });
      if (e2) throw e2;
      return json({ sembradas: filas.length, en_la_tabla: count });
    }

    const cookie = await login();

    if (modo === "contar") {
      const { filas, total } = await paginaDeLaCaja(cookie, Number(pagina));
      const numeros = filas.map(f => f.id);
      // erp_id es ÚNICO en customers (customers_erp_id_uniq): 1000 números
      // traen a lo sumo 1000 filas.
      const { data: enPortal, error } = numeros.length
        ? await admin.from("customers").select("id, erp_id, name, dui, nit, nrc, phone, telefono2, categoria").in("erp_id", numeros)
        : { data: [], error: null };
      if (error) throw error;
      const porNumero = new Map((enPortal ?? []).map(c => [String(c.erp_id), c]));
      const faltan: string[] = [], difieren: { id: string; campos: string[]; caja: unknown; portal: unknown }[] = [];
      let nombreDistinto = 0;
      for (const f of filas) {
        const c = porNumero.get(f.id);
        if (!c) { faltan.push(f.id); continue; }
        const campos: string[] = [];
        if (dig(f.dui) !== dig(c.dui)) campos.push("dui");
        if (dig(f.nit) !== dig(c.nit)) campos.push("nit");
        if (dig(f.nrc) !== dig(c.nrc)) campos.push("nrc");
        // La lista junta los dos teléfonos («7063-0708 | 7293-0487»); el portal
        // los guarda en `phone` y `telefono2`.
        const telsCaja = f.telefono.split("|").map(dig).filter(Boolean).join(",");
        const telsPortal = [c.phone, c.telefono2].map(dig).filter(Boolean).join(",");
        if (telsCaja !== telsPortal && telsCaja !== dig(c.phone)) campos.push("phone");
        if (txt(f.categoria) !== txt(c.categoria)) campos.push("categoria");
        if (txt(f.nombre).replace(/\s+/g, " ") !== txt(c.name).replace(/\s+/g, " ")) nombreDistinto++;
        if (campos.length) difieren.push({ id: f.id, campos,
          caja: Object.fromEntries(campos.map(k => [k, k === "phone" ? f.telefono : (f as unknown as Record<string, string>)[k]])),
          portal: Object.fromEntries(campos.map(k => [k, (c as Record<string, unknown>)[k] ?? null])) });
      }
      return json({ pagina, total_caja: total, leidas: filas.length, faltan, difieren, nombre_distinto: nombreDistinto,
        hay_mas: (Number(pagina) + 1) * TAM < total });
    }

    if (modo === "copiar") {
      const lista = (Array.isArray(ids) ? ids : []).map(String).filter(x => /^\d+$/.test(x)).slice(0, TOPE_COPIA);
      const { data: enPortal, error } = lista.length
        ? await admin.from("customers").select("id, erp_id").in("erp_id", lista)
        : { data: [], error: null };
      if (error) throw error;
      const dueño = new Map((enPortal ?? []).map(c => [String(c.erp_id), c.id as number]));
      const espejo: Record<string, unknown>[] = [], nuevas: Record<string, unknown>[] = [];
      const fallidas: { id: string; error: string; nit?: unknown; dui?: unknown }[] = [];
      const nitRepetido: { id: string; nit: unknown }[] = [];
      for (const id of lista) {
        try {
          const ficha = await leerFicha(cookie, id);
          if (!String(ficha.campos.nombre ?? "").trim()) { fallidas.push({ id, error: "la caja no tiene esa ficha" }); continue; }
          const fila = filaPortal(dueño.get(id) ?? null, id, ficha);
          if (dueño.has(id)) espejo.push(fila);
          else nuevas.push({ ...fila, name: String(ficha.campos.nombre).trim() });
        } catch (e) {
          fallidas.push({ id, error: e instanceof Error ? e.message : String(e) });
        }
      }
      // Un lote entero cae con UNA fila mala (una violación aborta la
      // sentencia): si pasa, se reintenta fila por fila y la mala queda
      // nombrada. La misma red que usa `sincronizar-fichas-clientes`.
      const porLote = async (rpc: string, filas: Record<string, unknown>[]) => {
        const resultados: unknown[] = [];
        const { data, error: e } = await admin.rpc(rpc, { p_filas: filas });
        if (!e) return [data];
        for (const fila of filas) {
          const { data: d1, error: e1 } = await admin.rpc(rpc, { p_filas: [fila] });
          if (!e1) { resultados.push(d1); continue; }
          // La caja repite un NIT en dos fichas (un cliente duplicado allá, o
          // unidades del ISSS que comparten el de la institución) y en el
          // portal es único (customers_nit_idx). La ficha entra SIN ese NIT y
          // queda nombrada: cuál de las dos lo lleva lo decide una persona.
          if (/customers_nit_idx/.test(e1.message) && fila.nit) {
            const { nit: _nit, ...sinNit } = fila;
            const { data: d2, error: e2 } = await admin.rpc(rpc, { p_filas: [sinNit] });
            if (!e2) { resultados.push(d2); nitRepetido.push({ id: String(fila.erp_id), nit: fila.nit }); continue; }
          }
          fallidas.push({ id: String(fila.erp_id), error: `${rpc}: ${e1.message}`, nit: fila.nit ?? null, dui: fila.dui ?? null });
        }
        return resultados;
      };
      const espejadas = espejo.length ? await porLote("aplicar_espejo_erp", espejo) : [];
      const importadas = nuevas.length ? await porLote("clientes_importar_de_caja", nuevas) : [];
      return json({ pedidas: lista.length, espejadas, importadas, nit_repetido: nitRepetido, fallidas });
    }

    return json({ error: `modo desconocido: ${modo}` }, 400);
  } catch (e) {
    console.error("barrido-clientes-caja:", e);
    const msg = e instanceof Error ? e.message
      : (e && typeof e === "object" && "message" in e) ? String((e as { message: unknown }).message) : String(e);
    return json({ error: msg }, 500);
  }
});
