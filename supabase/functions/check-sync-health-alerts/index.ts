import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { checkCronSecret, getCorsHeaders } from '../_shared/security.ts';

// Extiende el patrón de check-sales-alerts a los dominios de sync que no
// tenían ninguna alerta de fallo/staleness: products, minmax, purchases,
// backup. dte e inventory quedan fuera a propósito — dte ya tiene
// check-sales-alerts (alertas de negocio), inventory ya tiene
// SyncHealthBanner/useSyncMonitor (realtime).
//
// Destinatario: rol "Sistema — Alertas Técnicas" (id nuevo), como role_id
// primario O secondary_role_id — mismo criterio que ya usa RolesView.jsx
// para listar quién pertenece a un rol.
const SYSTEM_ALERT_ROLE_NAME = 'Sistema — Alertas Técnicas';

// Umbral de "stale" por dominio, en minutos — 3x la cadencia esperada del
// cron real (products/purchases corren cada 10min; minmax es mensual día 1;
// backup es semanal domingo).
const STALE_THRESHOLD_MIN: Record<string, number> = {
  products:  30,
  minmax:    50_400, // 35 días
  purchases: 30,
  backup:    11_520, // 8 días
};

const DOMAINS = Object.keys(STALE_THRESHOLD_MIN);

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  if (!checkCronSecret(req)) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl    = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    // Destinatarios: role_id primario O secondary_role_id apuntando al rol de sistema.
    const { data: roleRow } = await supabase
      .from('roles').select('id').eq('name', SYSTEM_ALERT_ROLE_NAME).maybeSingle();
    const systemRoleId = roleRow?.id ?? null;

    let recipientIds: string[] = [];
    if (systemRoleId != null) {
      const { data: recipients } = await supabase
        .from('employees')
        .select('id')
        .or(`role_id.eq.${systemRoleId},secondary_role_id.eq.${systemRoleId}`)
        .eq('status', 'ACTIVO');
      recipientIds = (recipients ?? []).map((e: { id: string }) => e.id);
    }

    // Últimas ~300 filas de cada dominio relevante, ya viene ordenado por
    // checked_at desde v_sync_health en cada UNION branch — reordenar acá
    // por seguridad y quedarnos con la más reciente por (domain, scope).
    const { data: rows, error: viewErr } = await supabase
      .from('v_sync_health')
      .select('domain, source, branch_id, erp_sucursal_id, checked_at, success, error_msg')
      .in('domain', DOMAINS)
      .order('checked_at', { ascending: false })
      .limit(1000);
    if (viewErr) throw viewErr;

    const latestByScope = new Map<string, typeof rows[number]>();
    for (const row of (rows ?? [])) {
      const scopeKey = row.erp_sucursal_id != null
        ? `erp:${row.erp_sucursal_id}`
        : row.branch_id != null
        ? `branch:${row.branch_id}`
        : 'global';
      const key = `${row.domain}|${scopeKey}`;
      if (!latestByScope.has(key)) latestByScope.set(key, row);
    }

    const now = Date.now();
    const alerts: Array<{ domain: string; scopeKey: string; alertKey: string; title: string; message: string }> = [];

    for (const [key, row] of latestByScope) {
      const [domain, scopeKey] = key.split('|');
      const ageMin = (now - new Date(row.checked_at).getTime()) / 60_000;
      const thresholdMin = STALE_THRESHOLD_MIN[domain] ?? 60;

      if (row.success === false) {
        alerts.push({
          domain, scopeKey,
          alertKey: `fail-${row.checked_at}`,
          title: `Sync ${domain} falló`,
          message: `[${scopeKey}] ${row.error_msg ?? 'sin detalle'}`.slice(0, 300),
        });
      } else if (ageMin > thresholdMin) {
        const dayBucket = new Date().toISOString().slice(0, 10);
        alerts.push({
          domain, scopeKey,
          alertKey: `stale-${dayBucket}`,
          title: `Sync ${domain} sin correr`,
          message: `[${scopeKey}] última corrida hace ${Math.round(ageMin / 60)}h (esperado cada ≤${Math.round(thresholdMin / 60) || 1}h)`,
        });
      }
    }

    // Dominios sin NINGUNA fila (cron nunca escribió nada aún) — staleness
    // real desde el "principio de los tiempos", mismo alertKey por día.
    for (const domain of DOMAINS) {
      const hasAny = [...latestByScope.keys()].some((k) => k.startsWith(`${domain}|`));
      if (!hasAny) {
        const dayBucket = new Date().toISOString().slice(0, 10);
        alerts.push({
          domain, scopeKey: 'global',
          alertKey: `never-ran-${dayBucket}`,
          title: `Sync ${domain} nunca ha corrido`,
          message: `No hay ningún registro en ${domain}_sync_log todavía.`,
        });
      }
    }

    if (alerts.length === 0) {
      return new Response(JSON.stringify({ ok: true, alerts: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let sent = 0;
    for (const alert of alerts) {
      // Upsert idempotente PRIMERO — solo se envía push si la fila fue
      // realmente nueva (select() tras ignoreDuplicates devuelve vacío si
      // ya existía, evitando reenviar el mismo push en cada corrida del cron).
      const { data: inserted, error: logErr } = await supabase
        .from('sync_alert_log')
        .upsert(
          { domain: alert.domain, scope_key: alert.scopeKey, alert_key: alert.alertKey },
          { onConflict: 'domain,scope_key,alert_key', ignoreDuplicates: true },
        )
        .select('id');
      if (logErr) { console.error('log error:', logErr); continue; }
      if (!inserted || inserted.length === 0) continue; // ya alertado, no reenviar

      if (recipientIds.length === 0) { sent++; continue; } // logueado igual, sin push si no hay destinatarios

      const pushRes = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('ADMIN_INVOKE_SECRET') ?? ''}`,
          'x-cron-secret': Deno.env.get('CRON_INVOKE_SECRET') ?? '',
        },
        body: JSON.stringify({
          title: alert.title,
          message: alert.message,
          url: '/permissions',
          urgent: false,
          target_type: 'EMPLOYEE',
          target_value: recipientIds,
          announcement_id: `sync-health-${alert.domain}-${alert.scopeKey}-${alert.alertKey}`,
        }),
      });
      if (pushRes.ok) sent++;
      else console.error('push error:', alert.domain, await pushRes.text());
    }

    return new Response(JSON.stringify({ ok: true, alerts: alerts.length, sent }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('check-sync-health-alerts error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
