import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/security.ts";
import { expirarObjetoGoogle, googleWalletListo } from "../_shared/paseGoogle.ts";

// Anonimiza a pedido del titular la ficha de una solicitud de cancelación ya
// resuelta (derecho de cancelación). La llama el NAVEGADOR de quien atiende
// datos personales: va con `verify_jwt: true` y NO está en la lista de las que
// llama un cron.
//
// ── Por qué hace falta una función y no basta la RPC ───────────────────────
// Todo lo de la base —borrar, resguardar, cerrar los puntos, dejar en cola la
// ficha de la caja— lo hace `datos_anonimizar_cliente` en UNA transacción, y
// la llama esta función CON LA SESIÓN DE QUIEN PIDE: el permiso
// (`datos_personales`) lo decide la base, no este archivo.
//
// Lo que la base no puede hacer es borrar archivos del almacenamiento (las
// fotos del chat y del perfil, las recetas que nunca valieron) ni vencer la
// tarjeta de Google Wallet. Eso se hace acá, con la llave del servidor, sobre
// la lista que la propia RPC devolvió — nunca sobre rutas que mande el
// navegador.
//
// ── Si un archivo no se borra ──────────────────────────────────────────────
// La anonimización ya quedó hecha; lo que falló se anota en
// `clientes_anonimizados.archivos_pendientes` y la pantalla ofrece reintentar
// (acción `archivos`). Un archivo que no se pudo borrar no puede deshacer lo
// que sí se hizo.

const BUCKET = "app-clientes-archivos";
const PAGINA = 1000;

// deno-lint-ignore no-explicit-any
async function borrarArchivos(admin: any, entradas: string[]): Promise<string[]> {
  const fallidos: string[] = [];
  for (const entrada of entradas) {
    if (!entrada || entrada.includes("..")) continue;
    const rutas: string[] = [];
    if (entrada.endsWith("/")) {
      const carpeta = entrada.slice(0, -1);
      let ok = true;
      for (let offset = 0; ; offset += PAGINA) {
        const { data, error } = await admin.storage.from(BUCKET).list(carpeta, { limit: PAGINA, offset });
        if (error) { console.error(`anonimizar-cliente: no se pudo listar ${carpeta}:`, error.message); ok = false; break; }
        // deno-lint-ignore no-explicit-any
        for (const f of data ?? []) if (f?.name && f.id) rutas.push(`${carpeta}/${f.name}`);
        if ((data ?? []).length < PAGINA) break;
      }
      if (!ok) { fallidos.push(entrada); continue; }
    } else {
      rutas.push(entrada);
    }
    let ok = true;
    for (let i = 0; i < rutas.length; i += 500) {
      const { error } = await admin.storage.from(BUCKET).remove(rutas.slice(i, i + 500));
      if (error) { console.error(`anonimizar-cliente: ${entrada} sin borrar:`, error.message); ok = false; }
    }
    if (!ok) fallidos.push(entrada);
  }
  return fallidos;
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Sin sesión" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    // La RPC corre con la sesión del que pide: el permiso lo decide la base.
    const usuario = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false },
    });
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

    const body = await req.json().catch(() => ({}));
    const accion = body?.accion ?? "anonimizar";

    let id: number;
    let fichas: number[];
    let archivos: string[];

    if (accion === "anonimizar") {
      const { data, error } = await usuario.rpc("datos_anonimizar_cliente", {
        p_solicitud: body?.solicitud,
        p_customer: Number(body?.customer),
        p_confirmacion: String(body?.confirmacion ?? ""),
        p_sin_documento_motivo: body?.sin_documento_motivo ?? null,
      });
      if (error) return json({ error: error.message }, error.code === "42501" ? 403 : 400);
      id = Number(data.anonimizacion_id);
      fichas = (data.fichas ?? []).map(Number);
      archivos = data.archivos ?? [];
    } else if (accion === "archivos") {
      // Reintento: la lista sale de la fila, con el mismo permiso.
      const { data, error } = await usuario.rpc("datos_anonimizacion_archivos", { p_id: Number(body?.id) });
      if (error) return json({ error: error.message }, error.code === "42501" ? 403 : 400);
      if (!data) return json({ error: "No existe esa anonimización" }, 404);
      id = Number(data.id);
      fichas = (data.fichas ?? []).map(Number);
      archivos = data.archivos ?? [];
    } else {
      return json({ error: "Acción desconocida" }, 400);
    }

    const fallidos = await borrarArchivos(admin, archivos);

    // La tarjeta guardada en Google pasa a VENCIDA. Si Google no contesta,
    // queda en el registro y no detiene nada: la tarjeta ya no tiene a quién
    // mostrar (la ficha es anónima y sus puntos están en cero).
    let wallet = 0;
    if (accion === "anonimizar" && googleWalletListo()) {
      for (const f of fichas) {
        try { if (await expirarObjetoGoogle(f)) wallet++; }
        catch (e) { console.error(`anonimizar-cliente: la tarjeta de Google de la ficha ${f} no se venció:`, (e as Error)?.message ?? e); }
      }
    }

    const { error: eH } = await admin.rpc("datos_anonimizacion_archivos_hechos", { p_id: id, p_fallidos: fallidos });
    if (eH) console.error("anonimizar-cliente: no se pudo anotar el resultado de los archivos:", eH.message);

    return json({ ok: true, anonimizacion_id: id, archivos_pendientes: fallidos.length, tarjetas_vencidas: wallet });
  } catch (e) {
    console.error("anonimizar-cliente:", e);
    return json({ error: (e as Error)?.message ?? "Error" }, 500);
  }
});
