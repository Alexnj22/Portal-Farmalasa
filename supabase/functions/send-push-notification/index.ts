import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { checkCronSecret, getCorsHeaders } from '../_shared/security.ts';
import { tarjetaParaTelefono, type AvisoTelefono } from './tarjeta.ts';

// La app del teléfono: por el servicio de Expo, que entrega a APNs (iPhone) y
// a FCM (Android). Hasta 100 por petición. Un token que el servicio da por
// muerto (`DeviceNotRegistered`: la app se borró) se quita, igual que un 410
// del navegador. Devuelve cuántos aceptó el servicio.
// deno-lint-ignore no-explicit-any
async function enviarATelefonos(supabase: any, tokens: string[], a: AvisoTelefono) {
  let aceptados = 0;
  for (let i = 0; i < tokens.length; i += 100) {
    const tanda = tokens.slice(i, i + 100);
    // Con plazo: un servicio colgado no puede llevarse los avisos del navegador.
    let r: Response;
    try {
      r = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify(tanda.map((to) => ({
        to,
        title: a.title,
        ...(a.subtitle ? { subtitle: a.subtitle } : {}),
        body: a.message,
        // `tema` agrupa en iOS (la extensión lo pone como hilo); `mutableContent`
        // despierta a esa extensión, que baja la foto de quien lo origina.
        data: { ...(a.data ?? { url: a.url }), tema: a.threadId ?? 'otros' },
        mutableContent: true,
        ...(a.categoryId ? { categoryId: a.categoryId } : {}),
        sound: 'default',
        priority: a.urgent ? 'high' : 'default',
        interruptionLevel: a.urgent ? 'time-sensitive' : 'active',
      }))),
      });
    } catch (e) { console.error('expo push', String(e)); continue; }
    if (!r.ok) { console.error('expo push', r.status, await r.text()); continue; }
    const { data } = await r.json();
    const muertos: string[] = [];
    (data || []).forEach((d: { status: string; details?: { error?: string } }, k: number) => {
      if (d.status === 'ok') aceptados += 1;
      else if (d.details?.error === 'DeviceNotRegistered') muertos.push(tanda[k]);
    });
    if (muertos.length) {
      const { error } = await supabase.from('push_dispositivos').delete().in('token', muertos);
      if (error) console.error('push_dispositivos delete', error.message);
    }
  }
  return aceptados;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
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

    // A quién: los mismos destinatarios para los dos canales. `null` = GLOBAL.
    let destinatarios: string[] | null = null;
    if (target_type === 'EMPLOYEE' && Array.isArray(target_value) && target_value.length > 0) {
      destinatarios = target_value;
    } else if (target_type === 'BRANCH' && Array.isArray(target_value) && target_value.length > 0) {
      // Sin este chequeo, un error acá devuelve `sent: 0` con cara de éxito:
      // la sucursal entera se queda sin push y nadie se entera.
      const { data: emps, error: empsErr } = await supabase
        .from('employees')
        .select('id')
        .in('branch_id', target_value);
      if (empsErr) throw new Error(`employees por sucursal: ${empsErr.message}`);
      destinatarios = (emps || []).map((e: { id: string }) => e.id);
      if (destinatarios.length === 0) return new Response(JSON.stringify({ sent: 0 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    // GLOBAL: no filter — all subscriptions

    // Dos canales (2026-09-29): el navegador (web push) y la app del teléfono
    // (token de Expo → APNs/FCM). Mismo filtro, mismo horario, mismo texto.
    let qWeb = supabase.from('push_subscriptions').select('endpoint, p256dh, auth, employee_id');
    let qApp = supabase.from('push_dispositivos').select('token, employee_id');
    if (destinatarios) { qWeb = qWeb.in('employee_id', destinatarios); qApp = qApp.in('employee_id', destinatarios); }
    const [{ data: subs, error }, { data: telefonos, error: telErr }] = await Promise.all([qWeb, qApp]);
    if (error) throw error;
    if (telErr) throw new Error(`push_dispositivos: ${telErr.message}`);
    if (!subs?.length && !telefonos?.length) {
      return new Response(JSON.stringify({ sent: 0 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Horario laboral (2026-09-25): ningún teléfono suena fuera de la ventana
    // de su dueño. `avisos_filtrar_push` devuelve quién está en horario y deja
    // el envío en cola para el resto; se entrega al abrir su ventana. Si la
    // pregunta falla NO se manda: la regla es una prohibición, no un deseo.
    // Se le pregunta UNA vez por persona con los dos canales juntos: dos
    // preguntas encolarían el diferido dos veces.
    const empleados = [...new Set([...(subs || []), ...(telefonos || [])].map((s: { employee_id: string }) => s.employee_id))];
    const { data: enHorario, error: horarioErr } = await supabase
      .rpc('avisos_filtrar_push', { p_ids: empleados, p_payload: body });
    if (horarioErr) throw new Error(`avisos_filtrar_push: ${horarioErr.message}`);
    const permitidos = new Set<string>(enHorario ?? []);
    const aEnviar = (subs || []).filter((s: { employee_id: string }) => permitidos.has(s.employee_id));
    const aTelefonos = (telefonos || []).filter((s: { employee_id: string }) => permitidos.has(s.employee_id));
    if (aEnviar.length === 0 && aTelefonos.length === 0) {
      return new Response(JSON.stringify({ sent: 0, diferidos: empleados.length }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // `tag` agrupa: dos avisos con el mismo tag se reemplazan en el aparato.
    // Antes salía `ann-undefined` para todo lo que no era un comunicado, así que
    // cada aviso de solicitudes, traslados o caja BORRABA al anterior.
    const tag = announcement_id ? `ann-${announcement_id}` : undefined;
    const payload = JSON.stringify({ title, body: message, url, urgent, tag });

    const results = await Promise.allSettled(
      aEnviar.map(async (sub: { endpoint: string; p256dh: string; auth: string; employee_id: string }) => {
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

    const enviadosApp = aTelefonos.length
      ? await enviarATelefonos(supabase, aTelefonos.map((t: { token: string }) => t.token),
          await tarjetaParaTelefono(supabase, { title, message, url, urgent }))
      : 0;

    const sent = results.filter(r => r.status === 'fulfilled').length;
    return new Response(JSON.stringify({ sent, total: aEnviar.length, app: enviadosApp, telefonos: aTelefonos.length, diferidos: empleados.length - permitidos.size }), {
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
