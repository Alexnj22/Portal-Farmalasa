import { requireAuthUser, getCorsHeaders } from "../_shared/security.ts";

const SRS_BASE = "https://apiconsulta.srs.gob.sv/public/productos";

Deno.serve(async (req: Request) => {
  const CORS = { ...getCorsHeaders(req), "Access-Control-Allow-Methods": "GET, OPTIONS" };
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const user = await requireAuthUser(req);
  if (!user) return new Response("Unauthorized", { status: 401, headers: CORS });

  try {
    const { searchParams } = new URL(req.url);
    const q       = searchParams.get("q") ?? "";
    const page    = searchParams.get("page") ?? "1";
    const pageMax = searchParams.get("page-max") ?? "15";

    if (!q.trim()) {
      return new Response(JSON.stringify({ data: [], total: 0, current_page: 1, last_page: 1 }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const url = `${SRS_BASE}?page=${page}&page-max=${pageMax}&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: { "Accept": "application/json", "User-Agent": "PortalFarmalasa/1.0" },
    });

    if (!res.ok) throw new Error(`SRS API responded ${res.status}`);

    const data = await res.json();
    return new Response(JSON.stringify(data), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
