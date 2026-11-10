SET lock_timeout = '5s';

-- docs/PLAN-MEMORIA-DE-LA-BASE-2026-11-10.md, fase 2a, paso 2.
-- Apagar las siete filas hace que las corra `cron_tick_minuto()` (cron
-- `tick-minuto`) con su mismo comando y su mismo horario, en un solo proceso.
-- Deshacer: reactivarlas — el despachador vuelve a saltarlas solo.
-- Guarda «sólo si existe»: en una base sin estas filas no hace nada.
SELECT cron.alter_job(j.jobid, active := false)
  FROM cron.job j
 WHERE j.jobname IN ('sync-dte-inv-all-1min', 'puntos-motor-1min', 'refresh-inv-mv-2min',
                     'conteo-caja-cada-minuto', 'continuar-traslados-pedido',
                     'avisos-clientes-minuto', 'wallet-pases-minuto')
   AND j.active
   AND EXISTS (SELECT 1 FROM cron.job t WHERE t.jobname = 'tick-minuto' AND t.active);
