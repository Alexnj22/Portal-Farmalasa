import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYNC_URL    = 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/sync-dte-sales';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
// sync-dte-sales valida requireInvokeSecret → hay que enviar ADMIN_INVOKE_SECRET,
// NO el service-role key (eso daba 401 y el healing no re-sincronizaba nada).
const INVOKE_SECRET = Deno.env.get('ADMIN_INVOKE_SECRET') ?? '';

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      SERVICE_KEY
    );

    const body = await req.json().catch(() => ({}));
    const lookbackDays: number = body.lookbackDays ?? 7;

    const hoy = new Date(Date.now() - 6 * 3600_000);
    const summary: any[] = [];

    // 1. Re-sincronizar fechas con errores previos registrados en sync_log
    const since = new Date(hoy);
    since.setDate(since.getDate() - lookbackDays);

    const { data: failedLogs } = await supabase
      .from('sync_log')
      .select('branch_id, fini, ffin')
      .eq('success', false)
      .gte('fini', fmt(since))
      .order('fini', { ascending: true });

    const failedSet = new Map<string, Set<number>>();
    for (const row of (failedLogs ?? [])) {
      // Expandir rango de fechas fallidas día por día
      const start = new Date(row.fini);
      const end   = new Date(row.ffin);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const key = fmt(new Date(d));
        if (!failedSet.has(key)) failedSet.set(key, new Set());
        failedSet.get(key)!.add(row.branch_id);
      }
    }

    // 2. Detectar huecos de IDs en los últimos N días — SOLO para reporte/visibilidad.
    //    NO se dispara re-sync por huecos: la secuencia de id_factura del ERP es global
    //    (incluye documentos fuera de nuestras sucursales), así que casi todos los huecos
    //    son falsos positivos — re-sincronizarlos siempre trae 0 facturas nuevas. Además
    //    el cron `dte-*-hora` ya re-baja todo el mes en curso cada hora, cubriendo
    //    cualquier pérdida real. El re-sync solo se dispara por fallos reales (paso 1).
    for (let i = 1; i <= lookbackDays; i++) {
      const d = new Date(hoy);
      d.setDate(d.getDate() - i);
      const dateStr = fmt(d);

      const { data: gaps } = await supabase.rpc('find_sync_gaps', { p_date: dateStr });
      if (gaps && gaps.length > 0) {
        const totalGaps = gaps.reduce((s: number, g: any) => s + g.gap_size, 0);
        summary.push({ date: dateStr, gaps: gaps.length, totalMissingIds: totalGaps, action: 'gap_detected_info_only' });
      }
    }

    if (failedSet.size === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No gaps or failed syncs found', summary }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Re-sincronizar cada fecha+sucursal afectada
    for (const [dateStr, branchIds] of failedSet.entries()) {
      for (const branchId of branchIds) {
        try {
          const res = await fetch(SYNC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${INVOKE_SECRET}` },
            body: JSON.stringify({ fini: dateStr, ffin: dateStr, branchId }),
            signal: AbortSignal.timeout(90_000),
          });
          const data = await res.json();
          const r = data.results?.[0] ?? {};
          summary.push({ date: dateStr, branchId, new: r.new ?? 0, error: r.error ?? null, action: 'healed' });
        } catch (e: any) {
          summary.push({ date: dateStr, branchId, error: e.message, action: 'heal_failed' });
        }
        await new Promise(r => setTimeout(r, 500));
      }
    }

    return new Response(
      JSON.stringify({ success: true, healed: failedSet.size, summary }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
