// Quita el margen blanco de la foto de un producto (2026-11-09). En la app de
// clientes, el margen dentro del archivo hacía ver chico al producto.
//
// El portal ya recorta al subir (src/plataforma/imagenes.js, `fotoDeCatalogo`);
// esto es para la app de empleados, que no puede leer los píxeles de la foto.
// La misma regla en los dos lados: una fila o columna cuenta si tiene al menos
// 4 píxeles oscuros (luminancia < 238) en la imagen reducida a 400 px, y se
// deja un 2 % de aire.
//
// Escribe CON LA SESIÓN DE QUIEN LLAMA, no con service_role: sube al bucket y
// guarda la foto por `guardar_carga_producto`, igual que acaba de hacerlo
// él. Si no tiene permiso para eso, aquí tampoco.
import { createClient } from "npm:@supabase/supabase-js@2";
import { decode, Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import { getCorsHeaders } from "../_shared/security.ts";

const TOPE_BYTES = 8 * 1024 * 1024;
const BASE = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/product-photos/`;

function recuadro(img: Image) {
  const e = Math.min(1, 400 / Math.max(img.width, img.height));
  const p = img.clone().resize(Math.max(1, Math.round(img.width * e)), Math.max(1, Math.round(img.height * e)));
  const w = p.width, h = p.height, d = p.bitmap;
  const filas = new Array(h).fill(0), cols = new Array(w).fill(0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = d[i + 3] / 255; // transparente cuenta como blanco
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * a + 255 * (1 - a);
      if (lum < 238) { filas[y]++; cols[x]++; }
    }
  }
  const ok = (v: number) => v >= 4;
  const y0 = filas.findIndex(ok), x0 = cols.findIndex(ok);
  if (y0 < 0 || x0 < 0) return null;
  const y1 = filas.findLastIndex(ok) + 1, x1 = cols.findLastIndex(ok) + 1;
  const aire = 0.02 * Math.max(img.width, img.height);
  const x = Math.max(0, Math.floor(x0 / w * img.width - aire));
  const y = Math.max(0, Math.floor(y0 / h * img.height - aire));
  const ancho = Math.min(img.width, Math.ceil(x1 / w * img.width + aire)) - x;
  const alto = Math.min(img.height, Math.ceil(y1 / h * img.height + aire)) - y;
  return { x, y, ancho, alto, ocupa: Math.max((x1 - x0) / w, (y1 - y0) / h) };
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: u, error: eU } = await db.auth.getUser();
    if (eU || !u?.user) return json({ ok: false, mensaje: "Sesión no válida." }, 401);

    const id = Number((await req.json().catch(() => ({})))?.id);
    if (!Number.isInteger(id) || id <= 0) return json({ ok: false, mensaje: "Producto no válido." }, 400);
    const { data: p, error: eP } = await db.from("products").select("foto_url").eq("id", id).maybeSingle();
    if (eP) throw eP;
    const antes = p?.foto_url ?? "";
    // Sólo la foto recién subida a su lugar de siempre; una ya recortada no se toca.
    if (!antes.startsWith(`${BASE}${id}.jpg`)) return json({ ok: true, foto_url: antes || null, recortada: false });

    const r = await fetch(antes, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`no se pudo leer la foto (${r.status})`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length > TOPE_BYTES) return json({ ok: true, foto_url: antes, recortada: false });
    const img = await decode(bytes);
    if (!(img instanceof Image)) return json({ ok: true, foto_url: antes, recortada: false });
    const c = recuadro(img);
    if (!c || c.ocupa >= 0.97) return json({ ok: true, foto_url: antes, recortada: false });

    // Fondo blanco: un PNG transparente saldría negro en JPEG.
    const fondo = new Image(c.ancho, c.alto).fill(0xffffffff);
    fondo.composite(img.clone().crop(c.x, c.y, c.ancho, c.alto), 0, 0);
    const salida = await fondo.encodeJPEG(90);
    const { error: eS } = await db.storage.from("product-photos")
      .upload(`recortadas/${id}.jpg`, salida, { upsert: true, contentType: "image/jpeg" });
    if (eS) throw eS;

    // Si mientras tanto alguien puso otra foto, ésa gana.
    const { data: ahora, error: eA } = await db.from("products").select("foto_url").eq("id", id).maybeSingle();
    if (eA) throw eA;
    if (ahora?.foto_url !== antes) return json({ ok: true, foto_url: ahora?.foto_url ?? null, recortada: false });
    const nueva = `${BASE}recortadas/${id}.jpg?t=${Date.now()}`;
    const { error: eG } = await db.rpc("guardar_carga_producto", { p_product_id: id, p_foto_url: nueva, p_filas: null, p_texto: null });
    if (eG) throw eG;
    return json({ ok: true, foto_url: nueva, recortada: true });
  } catch (e) {
    console.error("recortar-foto-producto", e instanceof Error ? e.message : e);
    return json({ ok: false, mensaje: "No se pudo recortar la foto." }, 500);
  }
});
