import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { checkCronSecret } from '../_shared/security.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Auditoría 2026-07: gate obligatorio — los 3 callers internos
  // (notify-new-products-daily, check-sales-alerts, auto-calculate-minmax)
  // ya envían x-cron-secret, confirmado. Ver AUDITORIA-2026-07.md.
  if (!checkCronSecret(req)) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY')!;
    const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!;
    const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@farmalasa.com';

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

    const body = await req.json();
    // body: { announcement_id, title, message, url, urgent, target_type, target_value }
    const { title, message, url = '/my-announcements', urgent, target_type, target_value, announcement_id } = body;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Fetch matching subscriptions
    let query = supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth, employee_id');

    if (target_type === 'EMPLOYEE' && Array.isArray(target_value) && target_value.length > 0) {
      query = query.in('employee_id', target_value);
    } else if (target_type === 'BRANCH' && Array.isArray(target_value) && target_value.length > 0) {
      // Join through employees table to filter by branch
      const { data: emps } = await supabase
        .from('employees')
        .select('id')
        .in('branch_id', target_value);
      const empIds = (emps || []).map((e: { id: string }) => e.id);
      if (empIds.length === 0) return new Response(JSON.stringify({ sent: 0 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      query = query.in('employee_id', empIds);
    }
    // GLOBAL: no filter — all subscriptions

    const { data: subs, error } = await query;
    if (error) throw error;
    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const payload = JSON.stringify({ title, body: message, url, urgent, tag: `ann-${announcement_id}` });

    const results = await Promise.allSettled(
      subs.map(async (sub: { endpoint: string; p256dh: string; auth: string; employee_id: string }) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload
          );
        } catch (err: unknown) {
          const status = (err as { statusCode?: number }).statusCode;
          // 410 Gone or 404 = expired subscription → remove it
          if (status === 410 || status === 404) {
            await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
          }
          throw err;
        }
      })
    );

    const sent = results.filter(r => r.status === 'fulfilled').length;
    return new Response(JSON.stringify({ sent, total: subs.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('send-push-notification error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
