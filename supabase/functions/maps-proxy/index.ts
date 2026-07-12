import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { requireActiveEmployeeUser, getCorsHeaders } from '../_shared/security.ts';

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
