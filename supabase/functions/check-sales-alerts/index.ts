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

  // `inmediato` (el cron de cada 5 min) o `cierre_dia` (el de las 22:00 SV,
  // que además hace el del último día del mes). Se lee del cuerpo para que un
  // solo archivo cubra los dos ritmos: el mismo criterio de "qué es un CCF con
  // problema" vale para los dos, y tenerlo dos veces sería tenerlo distinto.
  const body = await req.json().catch(() => ({}));
  const modo = String((body as any)?.modo ?? 'inmediato');

  try {
    // ── Empleados supervisores con posibles push subscriptions ──────────────
    // Si esto falla en silencio, la lista de supervisores queda vacía y la
    // alerta de ventas no le llega a nadie, sin ningún error a la vista.
    const { data: supervisors, error: supErr } = await supabase
      .from('employees')
      .select('id')
      .in('role_id', SUPERVISOR_ROLE_IDS)
      .eq('status', 'ACTIVO');
    if (supErr) throw new Error(`employees supervisores: ${supErr.message}`);

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
      const que = row.tipo === 'ccf_null'       ? 'ANULADA sin completar ante Hacienda'
                : row.tipo === 'ccf_observacion' ? 'con una observación'
                :                                  'pendiente de recibir MH';
      allAlerts.push({
        alertType: row.tipo,
        alertKey:  row.correlativo,
        branchId:  row.branch_id,
        title:     '🚨 Alerta urgente — CCF',
        message:   `${row.branch_name}: CCF ${row.correlativo} está ${que}`,
        urgent:    true,
      });
    }

    // ── El repaso: 22:00 y último día del mes ────────────────────────────────
    //
    // Modo `cierre_dia` (lo dispara el cron de las 04:00 UTC = 22:00 SV): vuelve
    // sobre los CCF de HOY que sigan con problema. No es lo mismo que el aviso
    // inmediato y por eso usa otra clave: el inmediato anuncia que algo apareció
    // y suena una sola vez; el repaso recuerda que sigue ahí, y su `alert_key`
    // lleva la fecha para poder volver a sonar mañana si nadie lo cerró.
    //
    // Si NO hay nada, no se manda nada. Un aviso nocturno que dice "todo bien"
    // deja de mirarse, y entonces tampoco se ve el que sí importa.
    //
    // El último día del mes agrega el repaso del mes entero: es el momento en
    // que todavía se puede corregir. El único cron de cierre que existía corre
    // el día 1, o sea cuando ya no se puede.
    if (modo === 'cierre_dia') {
      const { data: esUltimo, error: eU } = await supabase.rpc('es_ultimo_dia_del_mes_sv');
      if (eU) throw eU;

      const modos = esUltimo ? ['cierre_dia', 'fin_de_mes'] : ['cierre_dia'];
      for (const m of modos) {
        const { data: repaso, error: eR } = await supabase.rpc('get_ccf_repaso', { p_modo: m });
        if (eR) throw eR;
        for (const row of (repaso ?? [])) {
          allAlerts.push({
            alertType: 'ccf_repaso',
            alertKey:  row.alert_key,
            branchId:  row.branch_id,
            title: m === 'fin_de_mes'
              ? '📅 Último día del mes — CCF sin corregir'
              : '🌙 Cierre del día — CCF sin corregir',
            message: `${row.branch_name}: CCF ${row.correlativo} del ${row.fecha} — ${(row.problemas ?? []).join(' · ')}`,
            urgent: m === 'fin_de_mes',
          });
        }
      }
    }

    if (allAlerts.length === 0) {
      return new Response(JSON.stringify({ ok: true, alerts: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let sent = 0;
    let fallidas = 0;
    for (const alert of allAlerts) {
      // ── La alerta DEJA RASTRO EN EL PORTAL, no sólo un push (2026-08-09) ──
      // Reportado: «hubo un error con un CCF y no me notificó en el momento».
      // Se había enviado —el destinatario era el correcto y tenía 8
      // suscripciones— pero la alerta existía ÚNICAMENTE como push: si no
      // llega, no queda absolutamente nada. Medido: `sales_alert_log` con la
      // entrada de las 15:25 y CERO filas de CCF en `notifications` en 4 días.
      //
      // Un aviso que sólo vive en un push es un aviso que desaparece sin dejar
      // huella. `notify_employees` crea la notificación en la campana Y manda
      // el push, así que la del portal queda aunque el push falle.
      const { error: notifErr } = await supabase.rpc('notify_employees', {
        p_recipients: supervisorIds,
        p_type: 'SALES_ALERT',
        p_title: alert.title,
        p_body: alert.message,
        p_link: '/facturacion',
        p_metadata: { alert_type: alert.alertType, alert_key: alert.alertKey, urgent: alert.urgent },
        p_push: true,
        p_branch_id: alert.branchId,
      });

      if (notifErr) {
        // ── El log va DESPUÉS, y sólo si se avisó (2026-08-09) ──────────────
        // Estaba antes «para evitar doble envío si la función falla a mitad»,
        // y esa preocupación es legítima — pero convertía un envío fallido en
        // silencio DEFINITIVO: el log decía «ya avisé» y ese correlativo no
        // volvía a sonar nunca. Un aviso que no salió tiene que reintentarse
        // en la próxima corrida; repetirlo una vez es barato, perderlo no.
        fallidas++;
        console.error('notify_employees:', alert.alertType, alert.alertKey, notifErr.message);
        continue;
      }

      const { error: logErr } = await supabase.from('sales_alert_log').upsert(
        { branch_id: alert.branchId, alert_type: alert.alertType, alert_key: alert.alertKey },
        { onConflict: 'branch_id,alert_type,alert_key', ignoreDuplicates: true },
      );
      if (logErr) console.error('log error:', logErr);
      sent++;
    }

    return new Response(JSON.stringify({ ok: true, alerts: allAlerts.length, sent, fallidas }), {
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
