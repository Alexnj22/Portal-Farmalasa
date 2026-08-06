import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { checkCronSecret, getCorsHeaders } from '../_shared/security.ts';

// Alertas de fallo/staleness por dominio de sync.
//
// dte e inventory se agregaron el 2026-07-29. Antes quedaban fuera "porque ya
// tenían lo suyo", pero ese razonamiento no se sostuvo al revisarlo:
//   - dte tenía check-sales-alerts, que alerta de NEGOCIO (ventas sin confirmar
//     por Hacienda). Si el sync deja de correr, no entran ventas nuevas, no hay
//     nada pendiente que detectar y la alerta se queda MUDA.
//   - inventory tenía useSyncMonitor, que es un toast en el navegador: solo
//     salta si alguien tiene el portal abierto, no queda registrado, y depende
//     de que se escriba una fila con success=false.
// En ambos casos el modo de falla real — el cron no consigue conexión y la
// función NUNCA se ejecuta — no escribe ninguna fila, así que no dispara nada.
// Eso pasó 375 veces en dos semanas sin que nadie se enterara (ver
// PLAN-SUPABASE-CIERRE.md §C4).
//
// Destinatario: rol "Sistema — Alertas Técnicas" (id nuevo), como role_id
// primario O secondary_role_id — mismo criterio que ya usa RolesView.jsx
// para listar quién pertenece a un rol.
const SYSTEM_ALERT_ROLE_NAME = 'Sistema — Alertas Técnicas';

// Umbral de "stale" por dominio, en minutos — 3x la cadencia esperada del
// cron real (products/purchases corren cada 10min; minmax es mensual día 1;
// backup es semanal domingo; dte/inventory cada minuto).
const STALE_THRESHOLD_MIN: Record<string, number> = {
  products:  30,
  minmax:    50_400, // 35 días
  purchases: 30,
  backup:    11_520, // 8 días
  dte:       15,     // corre cada minuto → 15 corridas perdidas
  inventory: 15,
};

const DOMAINS = Object.keys(STALE_THRESHOLD_MIN);

// ── Dominios de alta frecuencia (cron '* 12-23,0-5 * * *') ──────────────────
// Corren cada minuto PERO duermen 06:00–11:59 UTC. Verificado en v_sync_health:
// las horas 6..11 tienen exactamente CERO filas; el resto ~480/hora.
// Medir staleness con reloj de pared les daría 6h de antigüedad a las 12:00 y
// una falsa alarma TODAS las mañanas, así que se cuentan minutos "activos".
const WINDOWED = new Set(['dte', 'inventory']);
const INACTIVE_START_H = 6;   // 06:00 UTC inclusive
const INACTIVE_END_H   = 12;  // 12:00 UTC exclusive

/** Minutos transcurridos entre dos instantes, descontando la ventana nocturna. */
function activeMinutesBetween(fromMs: number, toMs: number): number {
  if (toMs <= fromMs) return 0;
  const totalMin = (toMs - fromMs) / 60_000;

  let inactiveMin = 0;
  const cursor = new Date(fromMs);
  cursor.setUTCHours(0, 0, 0, 0);
  // Una iteración por día cubierto: el hueco es contiguo dentro de cada día UTC.
  for (let t = cursor.getTime(); t <= toMs; t += 86_400_000) {
    const gapStart = t + INACTIVE_START_H * 3_600_000;
    const gapEnd   = t + INACTIVE_END_H   * 3_600_000;
    const overlap  = Math.min(toMs, gapEnd) - Math.max(fromMs, gapStart);
    if (overlap > 0) inactiveMin += overlap / 60_000;
  }
  return Math.max(0, totalMin - inactiveMin);
}

// Los fallos de dte/inventory vienen en RÁFAGAS, no dispersos: en 24h medidas,
// los 47 de dte cayeron en 1 sola hora y los 72 de inventory en 2 (0.7% y 0.85%
// de las corridas). Un blip suelto se cura en la corrida del minuto siguiente,
// asi que exigir 2 fallos seguidos evita despertar a alguien por nada sin
// perder el caso real, que siempre es sostenido.
const MIN_FALLOS_SEGUIDOS = 2;

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
    // Un error acá NO puede tragarse: deja la lista de destinatarios vacía y la
    // alerta "se envía" a nadie sin que nada falle. El silencio no es éxito.
    const { data: roleRow, error: roleErr } = await supabase
      .from('roles').select('id').eq('name', SYSTEM_ALERT_ROLE_NAME).maybeSingle();
    if (roleErr) throw new Error(`roles(${SYSTEM_ALERT_ROLE_NAME}): ${roleErr.message}`);
    const systemRoleId = roleRow?.id ?? null;

    let recipientIds: string[] = [];
    if (systemRoleId != null) {
      const { data: recipients, error: recipErr } = await supabase
        .from('employees')
        .select('id')
        .or(`role_id.eq.${systemRoleId},secondary_role_id.eq.${systemRoleId}`)
        .eq('status', 'ACTIVO');
      if (recipErr) throw new Error(`employees del rol de alertas: ${recipErr.message}`);
      recipientIds = (recipients ?? []).map((e: { id: string }) => e.id);
    }

    // UNA CONSULTA POR DOMINIO, a propósito. Antes era un solo select con
    // .in(DOMAINS).limit(1000), y los dominios ruidosos ahogaban a los
    // tranquilos: products/purchases escriben cada 10 min, asi que las 7 filas
    // de minmax (última: 17-jul) caían fuera del corte de 1000 y el bloque de
    // "ningún registro" concluía "minmax nunca ha corrido" — una falsa alarma
    // DIARIA desde el 16-jul, 12 de minmax y 14 de backup en sync_alert_log.
    // Con dte/inventory sumados (13 filas por MINUTO) esas 1000 filas cubrirían
    // 77 minutos y products/purchases habrían empezado a fallar igual.
    const perDomain = await Promise.all(DOMAINS.map(async (domain) => {
      const { data, error } = await supabase
        .from('v_sync_health')
        .select('domain, source, branch_id, erp_sucursal_id, checked_at, success, error_msg')
        .eq('domain', domain)
        .order('checked_at', { ascending: false })
        .limit(WINDOWED.has(domain) ? 400 : 100);
      if (error) throw error;
      return data ?? [];
    }));
    const rows = perDomain.flat();

    const scopeOf = (row: { erp_sucursal_id: number | null; branch_id: number | null }) =>
      row.erp_sucursal_id != null ? `erp:${row.erp_sucursal_id}`
      : row.branch_id != null     ? `branch:${row.branch_id}`
      : 'global';

    // Más reciente por (dominio, scope) + cuántos fallos seguidos arrastra.
    const latestByScope = new Map<string, typeof rows[number]>();
    const fallosSeguidos = new Map<string, number>();
    const rachaCerrada  = new Set<string>();

    for (const row of rows) {
      const key = `${row.domain}|${scopeOf(row)}`;
      if (!latestByScope.has(key)) latestByScope.set(key, row);
      // rows viene ordenado del más nuevo al más viejo dentro de cada dominio,
      // asi que la racha se corta en el primer éxito que aparece.
      if (!rachaCerrada.has(key)) {
        if (row.success === false) fallosSeguidos.set(key, (fallosSeguidos.get(key) ?? 0) + 1);
        else rachaCerrada.add(key);
      }
    }

    const now = Date.now();
    const alerts: Array<{ domain: string; scopeKey: string; alertKey: string; title: string; message: string }> = [];

    for (const [key, row] of latestByScope) {
      const [domain, scopeKey] = key.split('|');
      const checkedMs = new Date(row.checked_at).getTime();
      const ageMin = WINDOWED.has(domain)
        ? activeMinutesBetween(checkedMs, now)
        : (now - checkedMs) / 60_000;
      const thresholdMin = STALE_THRESHOLD_MIN[domain] ?? 60;

      // Un blip suelto en dte/inventory no alerta: se cura al minuto siguiente.
      const minFallos = WINDOWED.has(domain) ? MIN_FALLOS_SEGUIDOS : 1;

      if (row.success === false && (fallosSeguidos.get(key) ?? 0) >= minFallos) {
        const racha = fallosSeguidos.get(key) ?? 1;
        alerts.push({
          domain, scopeKey,
          alertKey: `fail-${row.checked_at}`,
          title: `Sync ${domain} falló`,
          message: `[${scopeKey}]${racha > 1 ? ` ${racha} seguidos —` : ''} ${row.error_msg ?? 'sin detalle'}`.slice(0, 300),
        });
      } else if (ageMin > thresholdMin) {
        // dte/inventory usan umbrales de minutos: redondear a horas mostraba "0h".
        const fmt = (min: number) => min < 90
          ? `${Math.round(min)} min`
          : `${Math.round(min / 60)}h`;
        const dayBucket = new Date().toISOString().slice(0, 10);
        alerts.push({
          domain, scopeKey,
          alertKey: `stale-${dayBucket}`,
          title: `Sync ${domain} sin correr`,
          message: `[${scopeKey}] última corrida hace ${fmt(ageMin)}`
            + `${WINDOWED.has(domain) ? ' de actividad' : ''}`
            + ` (esperado cada ≤${fmt(thresholdMin)})`,
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
