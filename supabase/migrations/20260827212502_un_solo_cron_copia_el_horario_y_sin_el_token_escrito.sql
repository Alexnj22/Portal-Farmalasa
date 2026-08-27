-- Un solo cron copia el horario, y sin el token escrito adentro
--
-- Había DOS crons sobre la misma edge function:
--
--   | cron                             | UTC       | hora SV    | qué hacía de verdad        |
--   |----------------------------------|-----------|------------|----------------------------|
--   | `auto-copy-roster-saturday` (146)| 0 6 * * 6 | sáb 00:00  | copiaba                    |
--   | `roster-missing-alert-saturday`  | 0 15 * * 6| sáb 09:00  | NO podía avisar nunca      |
--   | `auto-copy-weekly-roster` (144)  | 0 16 * * 6| sáb 10:00  | no tocaba nada             |
--
-- El de medianoche ganaba siempre: copiaba, y el de las 10:00 encontraba todo
-- hecho y salía con «All employees already have next-week rosters». O sea que
-- **ninguna corrección hecha el sábado se propagaba a la semana siguiente**.
--
-- Y peor: `notify_missing_roster` pregunta si hay filas para la semana
-- entrante. Con la copia de las 06:00 ya hecha, el contador nunca era cero, así
-- que **la alarma de «faltan horarios» no podía sonar NUNCA**. El orden que el
-- diseño quería era alarma → copia, y el cron de más lo había invertido.
--
-- Queda el de las 16:00, que es el que corre DESPUÉS de la alarma.
--
-- Además el comando llevaba el JWT de servicio escrito en texto plano dentro de
-- `cron.job.command`, mientras `consolidate-timesheets-daily`, al lado, no
-- lleva ninguno. La función se redesplegó con `--no-verify-jwt` —se valida sola
-- con `x-cron-secret`, que sí sale de Vault—, así que el encabezado
-- `Authorization` ya no hace falta. Es la regla escrita: cron o Postgres →
-- `--no-verify-jwt`; navegador → JWT.

SET lock_timeout = '5s';

-- El duplicado de medianoche se va.
--
-- Las dos van con guarda porque `cron.unschedule` y `cron.alter_job` LANZAN si
-- el trabajo no existe: en una base recién creada abortarían esta migración y
-- todas las que vienen detrás, y el historial dejaría de poder reproducirse.
SELECT cron.unschedule('auto-copy-roster-saturday')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-copy-roster-saturday');

-- Y el que queda pierde el token.
SELECT cron.alter_job(
  job_id  := (SELECT jobid FROM cron.job WHERE jobname = 'auto-copy-weekly-roster'),
  command := $cmd$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/auto-copy-weekly-roster',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_invoke_secret')
               ),
    body    := '{}'::jsonb
  ) AS request_id;
  $cmd$
) WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-copy-weekly-roster');
