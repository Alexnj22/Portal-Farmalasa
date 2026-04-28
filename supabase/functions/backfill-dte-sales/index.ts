import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYNC_URL = 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/sync-dte-sales';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

function monthRange(year: number, month: number): { fini: string; ffin: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const fini = `${year}-${pad(month)}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const ffin = `${year}-${pad(month)}-${pad(lastDay)}`;
  return { fini, ffin };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const fromYear  = body.fromYear  ?? 2025;
    const fromMonth = body.fromMonth ?? 5;

    const hoy = new Date(Date.now() - 6 * 3600_000);
    const toYear  = body.toYear  ?? hoy.getFullYear();
    const toMonth = body.toMonth ?? (hoy.getMonth() + 1);
    const onlyBranch = body.branchId ?? null;

    const months: { fini: string; ffin: string }[] = [];
    let y = fromYear, m = fromMonth;
    while (y < toYear || (y === toYear && m <= toMonth)) {
      months.push(monthRange(y, m));
      m++;
      if (m > 12) { m = 1; y++; }
    }

    const summary: any[] = [];
    let totalNew = 0;
    let totalChanges = 0;

    for (const { fini, ffin } of months) {
      const payload: any = { fini, ffin };
      if (onlyBranch) payload.branchId = onlyBranch;

      const res = await fetch(SYNC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120_000),
      });

      const data = await res.json();
      const monthNew     = (data.results ?? []).reduce((s: number, r: any) => s + (r.new ?? 0), 0);
      const monthChanges = (data.results ?? []).reduce((s: number, r: any) => s + (r.changes ?? 0), 0);
      totalNew     += monthNew;
      totalChanges += monthChanges;
      summary.push({ period: `${fini}/${ffin}`, new: monthNew, changes: monthChanges });

      await new Promise(r => setTimeout(r, 500));
    }

    return new Response(
      JSON.stringify({ success: true, months: months.length, totalNew, totalChanges, summary }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
