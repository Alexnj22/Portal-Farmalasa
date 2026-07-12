import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { checkCronSecret, getCorsHeaders } from '../_shared/security.ts';

// Solo Supervisor/a de Ventas recibe alertas DTE
const SUPERVISOR_ROLE_IDS = [13];

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Auditoría 2026-07: gate obligatorio — cron.job (jobid 168) ya envía
  // x-cron-secret, confirmado. Ver AUDITORIA-2026-07.md.
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
    // ── Empleados supervisores con posibles push subscriptions ──────────────
    const { data: supervisors } = await supabase
      .from('employees')
      .select('id')
      .in('role_id', SUPERVISOR_ROLE_IDS)
      .eq('status', 'ACTIVO');

    const supervisorIds = (supervisors ?? []).map((e: { id: string }) => e.id);

    // ── Check 1: sucursales con ≥3 ventas consecutivas pendientes MH ────────
    const { data: consecAlerts, error: e1 } = await supabase.rpc('get_consecutive_mh_alerts');
    if (e1) throw e1;

    // ── Check 2: CCF pendientes MH o anuladas hoy ───────────────────────────
    const { data: ccfAlerts, error: e2 } = await supabase.rpc('get_ccf_alerts');
    if (e2) throw e2;

    const allAlerts: Array<{
      alertType: string;
      alertKey:  string;
      branchId:  number;
      title:     string;
      message:   string;
      urgent:    boolean;
    }> = [];

    for (const row of (consecAlerts ?? [])) {
      allAlerts.push({
        alertType: 'consecutive_mh',
        alertKey:  row.first_correlativo,
        branchId:  row.branch_id,
        title:     'Ventas pendientes MH consecutivas',
        message:   `${row.branch_name}: ${row.run_len} ventas seguidas sin confirmación del MH — posible error de transmisión`,
        urgent:    false,
      });
    }

    for (const row of (ccfAlerts ?? [])) {
      const isNull = row.tipo === 'ccf_null';
      allAlerts.push({
        alertType: row.tipo,
        alertKey:  row.correlativo,
        branchId:  row.branch_id,
        title:     '🚨 Alerta urgente — CCF',
        message:   `${row.branch_name}: CCF ${row.correlativo} está ${isNull ? 'ANULADA' : 'pendiente de recibir MH'}`,
        urgent:    true,
      });
    }

    if (allAlerts.length === 0) {
      return new Response(JSON.stringify({ ok: true, alerts: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let sent = 0;
    for (const alert of allAlerts) {
      // Loguear PRIMERO para evitar doble envío si la función falla a mitad
      const { error: logErr } = await supabase.from('sales_alert_log').upsert(
        { branch_id: alert.branchId, alert_type: alert.alertType, alert_key: alert.alertKey },
        { onConflict: 'branch_id,alert_type,alert_key', ignoreDuplicates: true },
      );
      if (logErr) console.error('log error:', logErr);

      // Enviar push a supervisores
      const pushRes = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('ADMIN_INVOKE_SECRET') ?? ''}`, 'x-cron-secret': Deno.env.get('CRON_INVOKE_SECRET') ?? '' },
        body: JSON.stringify({
          title:        alert.title,
          message:      alert.message,
          url:          '/facturacion',
          urgent:       alert.urgent,
          target_type:  supervisorIds.length > 0 ? 'EMPLOYEE' : undefined,
          target_value: supervisorIds.length > 0 ? supervisorIds : undefined,
          announcement_id: `sales-alert-${alert.alertType}-${alert.alertKey}`,
        }),
      });

      if (pushRes.ok) sent++;
      else console.error('push error:', alert.alertType, await pushRes.text());
    }

    return new Response(JSON.stringify({ ok: true, alerts: allAlerts.length, sent }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('check-sales-alerts error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
