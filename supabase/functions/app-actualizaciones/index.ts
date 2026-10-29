// supabase/functions/app-actualizaciones/index.ts
// Actualizaciones por aire de la app de clientes (2026-10-29): el servidor del
// protocolo de expo-updates (versión 1), en vez del de Expo (EAS Update).
//
// La app pregunta al abrir, con `expo-platform` y `expo-runtime-version` (la
// huella de su código nativo). Se le contesta el paquete activo más reciente
// publicado para esa plataforma y esa huella (`app_actualizaciones`, lo sube
// `npm run app:actualizar`), con URLs firmadas del bucket privado
// `app-actualizaciones`. Sin paquete, o si ya corre ése: 204, que en el
// protocolo 1 significa «no hay nada nuevo».
//
// La app nunca baja a uno más viejo que el que trae instalado (compara la
// fecha), así que no hace falta decidirlo acá.
//
// Pública a propósito (deploy con --no-verify-jwt): la llama expo-updates
// antes de que haya sesión, sin llave. Sólo entrega código de la app, que ya
// viaja dentro de cada instalación.
import { createClient } from "npm:@supabase/supabase-js@2";

const BUCKET = "app-actualizaciones";
const FIRMA_SEG = 24 * 60 * 60;
const nada = () => new Response(null, { status: 204, headers: { "expo-protocol-version": "1", "expo-sfv-version": "0", "cache-control": "private, max-age=0" } });
const mal = (mensaje: string, status = 400) => new Response(mensaje, { status });

type Archivo = { path: string; hash: string; key: string; contentType: string; fileExtension: string };
type Manifiesto = { launchAsset: Archivo; assets: Archivo[] };

Deno.serve(async (req) => {
  if (req.method !== "GET") return mal("Método no permitido", 405);
  const plataforma = req.headers.get("expo-platform") ?? new URL(req.url).searchParams.get("platform");
  const runtime = req.headers.get("expo-runtime-version") ?? new URL(req.url).searchParams.get("runtime-version");
  if (plataforma !== "ios" && plataforma !== "android") return mal("expo-platform no válido");
  if (!runtime) return mal("Falta expo-runtime-version");
  if (req.headers.get("expo-protocol-version") === "0") return mal("Sólo el protocolo 1");

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: fila, error } = await admin.from("app_actualizaciones")
    .select("id, created_at, runtime_version, manifiesto")
    .eq("app", "clientes").eq("plataforma", plataforma).eq("runtime_version", runtime).eq("activa", true)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) { console.error("app-actualizaciones:", error.message); return mal("No se pudo consultar", 500); }
  if (!fila || req.headers.get("expo-current-update-id") === fila.id) return nada();

  const m = fila.manifiesto as Manifiesto;
  const archivos = [m.launchAsset, ...(m.assets ?? [])];
  const { data: firmas, error: eF } = await admin.storage.from(BUCKET).createSignedUrls(archivos.map((a) => a.path), FIRMA_SEG);
  if (eF || !firmas || firmas.some((f) => !f.signedUrl)) {
    console.error("app-actualizaciones: sin firma", eF?.message ?? firmas?.find((f) => !f.signedUrl)?.error);
    return mal("No se pudieron firmar los archivos", 500);
  }
  const url = new Map(firmas.map((f) => [f.path, f.signedUrl]));
  const conUrl = ({ path, ...a }: Archivo) => ({ ...a, url: url.get(path) });

  const manifiesto = {
    id: fila.id,
    createdAt: new Date(fila.created_at).toISOString(),
    runtimeVersion: fila.runtime_version,
    launchAsset: conUrl(m.launchAsset),
    assets: (m.assets ?? []).map(conUrl),
    metadata: {},
    extra: {},
  };
  const limite = `actualizacion-${crypto.randomUUID()}`;
  const parte = (nombre: string, cuerpo: unknown) =>
    `--${limite}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Disposition: form-data; name="${nombre}"\r\n\r\n${JSON.stringify(cuerpo)}\r\n`;
  const cuerpo = parte("manifest", manifiesto) + parte("extensions", { assetRequestHeaders: {} }) + `--${limite}--\r\n`;
  return new Response(cuerpo, {
    headers: {
      "expo-protocol-version": "1",
      "expo-sfv-version": "0",
      "cache-control": "private, max-age=0",
      "content-type": `multipart/mixed; boundary=${limite}`,
    },
  });
});
