SET lock_timeout = '5s';

/* ── Los dos crones de las cuentas por cobrar ──────────────────────────────
 *
 * El secreto sale de Vault dentro del `command` y NO va escrito acá: un cron
 * con la credencial en texto queda en `cron.job`, que se lee desde el panel.
 *
 * ── Cada hora, y no cada 30 segundos ──────────────────────────────────────
 * Son 6 peticiones al sistema de origen por corrida —una por sala, en serie
 * porque la sucursal vive en su sesión—, o sea **144 al día**. Más seguido no
 * compra nada: lo único que cambia entre corridas son los abonos hechos POR
 * FUERA del portal; los del portal ya quedan registrados al hacerlos.
 *
 * ── El aviso, a las 8 de la mañana de El Salvador ─────────────────────────
 * 14:00 UTC. Un aviso de cobranza a las 3 de la mañana lo lee nadie, y para
 * cuando la sala abre ya está enterrado bajo lo del día. Va DESPUÉS de la
 * corrida de las 13:00 UTC, así que la lista que mira es de hace menos de una
 * hora — al revés avisaría sobre créditos que alguien ya pagó ayer.
 */
SELECT cron.schedule(
  'creditos-cada-hora',
  '0 * * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/sync-creditos',
    body    := '{}'::jsonb,
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='admin_invoke_secret'),
                 'x-invoke-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='admin_invoke_secret')),
    timeout_milliseconds := 150000
  );
  $cron$
);

SELECT cron.schedule(
  'creditos-vencidos-0800-sv',
  '0 14 * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/avisar-creditos-vencidos',
    body    := '{}'::jsonb,
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='admin_invoke_secret'),
                 'x-invoke-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='admin_invoke_secret')),
    timeout_milliseconds := 60000
  );
  $cron$
);
