import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

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

    const res  = await fetch(url);
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
