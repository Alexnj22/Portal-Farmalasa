import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYNC_URL = 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/sync-dte-sales';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function buildRanges(
  fromYear: number, fromMonth: number,
  toYear: number,   toMonth: number,
  chunkDays: number | null,
): { fini: string; ffin: string }[] {
  const ranges: { fini: string; ffin: string }[] = [];

  if (chunkDays) {
    // Split entire span into chunkDays-day windows
    const end = new Date(toYear, toMonth - 1, new Date(toYear, toMonth, 0).getDate());
    let cur = new Date(fromYear, fromMonth - 1, 1);
    while (cur <= end) {
      const chunkEnd = new Date(cur);
      chunkEnd.setDate(chunkEnd.getDate() + chunkDays - 1);
      if (chunkEnd > end) chunkEnd.setTime(end.getTime());
      ranges.push({ fini: fmt(cur), ffin: fmt(chunkEnd) });
      cur.setDate(cur.getDate() + chunkDays);
    }
  } else {
    // Default: one range per calendar month
    let y = fromYear, m = fromMonth;
    while (y < toYear || (y === toYear && m <= toMonth)) {
      const lastDay = new Date(y, m, 0).getDate();
      ranges.push({ fini: `${y}-${pad(m)}-01`, ffin: `${y}-${pad(m)}-${pad(lastDay)}` });
      m++; if (m > 12) { m = 1; y++; }
    }
  }

  return ranges;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const fromYear  = body.fromYear  ?? 2025;
    const fromMonth = body.fromMonth ?? 5;

    const hoy = new Date(Date.now() - 6 * 3600_000);
    const toYear   = body.toYear   ?? hoy.getFullYear();
    const toMonth  = body.toMonth  ?? (hoy.getMonth() + 1);
    const onlyBranch = body.branchId  ?? null;
    const forceItems = body.forceItems ?? false;
    const chunkDays  = body.chunkDays  ?? null; // e.g. 7 for weekly chunks

    const ranges = buildRanges(fromYear, fromMonth, toYear, toMonth, chunkDays);

    const summary: any[] = [];
    let totalNew = 0;
    let totalChanges = 0;

    for (const { fini, ffin } of ranges) {
      const payload: any = { fini, ffin };
      if (onlyBranch)  payload.branchId   = onlyBranch;
      if (forceItems)  payload.forceItems  = true;

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
      const rangeNew     = (data.results ?? []).reduce((s: number, r: any) => s + (r.new     ?? 0), 0);
      const rangeChanges = (data.results ?? []).reduce((s: number, r: any) => s + (r.changes ?? 0), 0);
      totalNew     += rangeNew;
      totalChanges += rangeChanges;
      summary.push({ period: `${fini}/${ffin}`, new: rangeNew, changes: rangeChanges });

      await new Promise(r => setTimeout(r, 500));
    }

    return new Response(
      JSON.stringify({ success: true, chunks: ranges.length, totalNew, totalChanges, summary }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
