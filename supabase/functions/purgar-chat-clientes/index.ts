// supabase/functions/purgar-chat-clientes/index.ts
// Borra las conversaciones del chat de la app de clientes que llevan 12 meses
// sin un mensaje (PENDIENTES 29, decisión del usuario 2026-10-29), CON sus
// fotos y audios del bucket `app-clientes-archivos`.
//
// ── Por qué una función y no un cron de SQL ────────────────────────────────
// Los mensajes se borran en la base, pero sus archivos no: un DELETE sobre
// `storage.objects` quita la fila y deja el archivo en el almacenamiento. Sólo
// la API de Storage los borra de verdad, y para eso hace falta la llave del
// servidor.
//
// ── El orden importa ───────────────────────────────────────────────────────
// Primero los archivos, después las filas. Al revés, si el borrado de archivos
// fallara, la base ya no tendría las rutas y quedarían huérfanos para siempre.
// Si un archivo no se puede borrar, esa conversación NO se borra: vuelve a
// salir mañana.
//
// Cron `purgar-chat-clientes-diario` (x-cron-secret), deploy con --no-verify-jwt.
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkCronSecret } from "../_shared/security.ts";

const BUCKET = "app-clientes-archivos";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (!checkCronSecret(req)) return json({ ok: false, error: "UNAUTHORIZED" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: vencidas, error } = await admin.rpc("app_chat_por_purgar", { p_limite: 200 });
  if (error) return json({ ok: false, error: error.message }, 500);

  const listas: number[] = [];
  const fallidas: { id: number; error: string }[] = [];
  for (const c of (vencidas ?? []) as { id: number; archivos: string[] | null }[]) {
    const rutas = (c.archivos ?? []).filter((r) => r && !r.includes(".."));
    if (rutas.length) {
      const { error: e } = await admin.storage.from(BUCKET).remove(rutas);
      if (e) { fallidas.push({ id: c.id, error: e.message }); continue; }
    }
    listas.push(c.id);
  }

  let borradas = 0;
  if (listas.length) {
    const { data: n, error: e } = await admin.rpc("app_chat_purgar", { p_ids: listas });
    if (e) return json({ ok: false, error: e.message, archivos_borrados_de: listas.length }, 500);
    borradas = Number(n) || 0;
  }

  if (fallidas.length) console.error("[purgar-chat-clientes] archivos sin borrar:", JSON.stringify(fallidas));
  return json({ ok: fallidas.length === 0, conversaciones: borradas, pendientes: fallidas.length });
});
