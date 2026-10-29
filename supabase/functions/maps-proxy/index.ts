import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { requireActiveEmployeeUser, getCorsHeaders } from '../_shared/security.ts';
import { coordenadasDeEnlace, esDominioDeMapa, lugarDeEnlace } from '../_shared/enlaceDeMapa.ts';

// ── `ubicar` (2026-10-29): el enlace de Maps o un punto → coordenadas + dirección ──
// Pedido del usuario: «que a partir del enlace de google se ponga lo demás», y
// elegir el punto en un mapa. Dos cosas que el navegador no puede hacer solo:
//
// 1. Abrir `maps.app.goo.gl/…`: es una redirección y el enlace corto no trae
//    ninguna coordenada. Se sigue a mano (`redirect: 'manual'`) y sólo hacia
//    dominios de Google: si no, esto sería un proxy abierto a cualquier URL.
// 2. La dirección del punto. Sale de OpenStreetMap (Nominatim) y no de Google:
//    la llave de Maps del portal está restringida por referer y la API de
//    geocodificación la rechaza desde un servidor (medido: REQUEST_DENIED).
//    Nominatim además devuelve los nombres de la reforma de 2024 —«Chalatenango
//    Centro» como municipio, «Agua Caliente» como distrito—, que son los del
//    catálogo. Su política pide un User-Agent que identifique la aplicación,
//    y el navegador no lo puede fijar: otra razón para hacerlo acá.
const UA = 'PortalFarmaSalud/1.0 (portal.farmasalud.lat)';

async function abrirEnlace(enlace: string): Promise<string> {
  let actual = enlace.trim();
  for (let salto = 0; salto < 6; salto++) {
    const u = new URL(actual);
    if (u.protocol !== 'https:' || !esDominioDeMapa(u.hostname)) throw new Error('DOMINIO_NO_PERMITIDO');
    if (coordenadasDeEnlace(actual)?.precision === 'pin') return actual;
    const res = await fetch(actual, {
      redirect: 'manual', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000),
    });
    await res.body?.cancel();
    const destino = res.headers.get('location');
    if (!destino || res.status < 300 || res.status >= 400) return actual;
    actual = new URL(destino, actual).toString();
  }
  return actual;
}

async function direccionDe(lat: number, lng: number) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18` +
    `&accept-language=es&lat=${lat}&lon=${lng}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.address ? { address: data.address, nombre: data.name || null } : null;
}

async function ubicar(params: { enlace?: string; lat?: number; lng?: number }) {
  let lat = Number(params?.lat), lng = Number(params?.lng);
  let precision: string = 'pin', enlaceFinal: string | null = null, lugar: string | null = null;
  if (params?.enlace) {
    let u: URL;
    try { u = new URL(params.enlace.trim()); } catch { return { error: 'ENLACE_INVALIDO' }; }
    if (u.protocol !== 'https:' || !esDominioDeMapa(u.hostname)) return { error: 'NO_ES_DE_MAPS' };
    enlaceFinal = await abrirEnlace(params.enlace);
    const c = coordenadasDeEnlace(enlaceFinal);
    if (!c) return { error: 'SIN_COORDENADAS' };
    ({ lat, lng, precision } = c);
    lugar = lugarDeEnlace(enlaceFinal);
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { error: 'SIN_COORDENADAS' };
  const dir = await direccionDe(lat, lng).catch(() => null);
  return { lat, lng, precision, lugar, address: dir?.address ?? null };
}

serve(async (req: Request) => {
  const CORS = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // Auditoría 2026-07: gate obligatorio — antes cualquiera con la anon key
  // pública podía quemar cuota de Google Maps sin ninguna sesión real.
  // Ver AUDITORIA-2026-07.md, sección Remediado.
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const employee = await requireActiveEmployeeUser(req, admin);
  if (!employee) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
      status: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { type, params, key } = await req.json();

    // No usa la llave de Google: va antes de exigirla.
    if (type === 'ubicar') {
      const out = await ubicar(params ?? {});
      // 200 también con `error`: `functions.invoke` convierte un 4xx en una
      // excepción sin cuerpo, y la pantalla necesita el código para explicarlo.
      return new Response(JSON.stringify(out), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY') ?? key ?? '';

    if (!apiKey) return new Response(
      JSON.stringify({ error: 'No API key' }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );

    let url: string;
    if (type === 'distancematrix') {
      url = `https://maps.googleapis.com/maps/api/distancematrix/json` +
            `?origins=${params.origins}&destinations=${params.destinations}&key=${apiKey}`;
    } else if (type === 'directions') {
      url = `https://maps.googleapis.com/maps/api/directions/json` +
            `?origin=${params.origin}&destination=${params.destination}&key=${apiKey}`;
      if (params.waypoints) url += `&waypoints=${params.waypoints}`;
    } else {
      return new Response(
        JSON.stringify({ error: 'Unknown type' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } },
      );
    }

    const res  = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const data = await res.json();
    return new Response(JSON.stringify(data), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
