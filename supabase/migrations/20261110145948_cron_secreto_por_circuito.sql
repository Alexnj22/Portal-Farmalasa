-- Cada cron manda el secreto de SU circuito en vez de admin_invoke_secret.
-- Las funciones ya lo aceptan (v2.1500.11, desplegadas el 2026-11-10) y siguen
-- aceptando el viejo, así que si algo falla se revierte con el replace inverso.
-- cron.job no es tabla caliente; lock_timeout igual, por regla.
SET lock_timeout = '5s';

DO $$
DECLARE
  mapa jsonb := '{
    "sync": ["aplicar-conteo-caja","apply-scheduled-employee-events","auto-calculate-minmax","backup-critical-tables","barrer-traslados-recibidos","check-sales-reconciliation","leer-traslados-erp","puntos-motor","sync-aperturas-caja","sync-corte-z","sync-cortes-caja","sync-creditos","sync-dte-sales","sync-erp-purchases","sync-numero-control","sync-products"],
    "fiscal": ["cierre-automatico-caja","push-cliente-erp","regularizar-dte","sincronizar-fichas-clientes","trasladar-pedido-erp"],
    "avisos": ["avisar-bitacora-por-vencer","avisar-bultos-viejos","avisar-creditos-vencidos","notify-new-products-daily","resumen-diario-salas"],
    "cron": ["check-sales-alerts","check-sync-health-alerts","check-purchases-reconciliation"]
  }';
  c text; fn text; j record; n int := 0;
BEGIN
  -- Sin el secreto en el vault, el header saldría NULL y el cron quedaría en
  -- 401: mejor no tocar nada.
  --
  -- 2026-11-10: NO tocar nada es SALIR, no lanzar. El entorno de pruebas se arma
  -- repitiendo esta historia en una base sin esos secretos, y un RAISE acá lo
  -- dejaba en MIGRATIONS_FAILED (le cortó las 11 migraciones siguientes). En
  -- producción los cuatro existían y esta migración ya corrió: el cambio sólo
  -- afecta a una base que no los tiene. Regla en docs/reglas/entorno-de-pruebas.md
  -- y la vigila gate:migrations («falla-en-pruebas»).
  FOREACH c IN ARRAY ARRAY['sync','fiscal','avisos','cron'] LOOP
    IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = c || '_invoke_secret') THEN
      RAISE NOTICE 'falta % en el vault: no se cambia ningún cron', c || '_invoke_secret';
      RETURN;
    END IF;
  END LOOP;

  FOR c IN SELECT jsonb_object_keys(mapa) LOOP
    FOR fn IN SELECT jsonb_array_elements_text(mapa -> c) LOOP
      FOR j IN SELECT jobid, command FROM cron.job
               WHERE command LIKE '%/functions/v1/' || fn || '''%'
                 AND command LIKE '%admin_invoke_secret%' LOOP
        PERFORM cron.alter_job(j.jobid,
          command := replace(j.command, 'admin_invoke_secret', c || '_invoke_secret'));
        n := n + 1;
      END LOOP;
    END LOOP;
  END LOOP;

  IF EXISTS (SELECT 1 FROM cron.job WHERE command LIKE '%admin_invoke_secret%') THEN
    RAISE EXCEPTION 'quedaron crons con admin_invoke_secret (se cambiaron %)', n;
  END IF;
  RAISE NOTICE 'crons cambiados: %', n;

  -- puntos_encender vuelve a crear puntos-motor-1min si se corre otra vez: que
  -- lo cree con el secreto de su circuito. Se parte de la definición VIVA y se
  -- cambia sólo el nombre del secreto (CREATE OR REPLACE conserva los permisos).
  EXECUTE replace(pg_get_functiondef('public.puntos_encender(date,text,boolean)'::regprocedure),
                  'admin_invoke_secret', 'sync_invoke_secret');
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'puntos_encender' AND prosrc LIKE '%admin_invoke_secret%') THEN
    RAISE EXCEPTION 'puntos_encender sigue con admin_invoke_secret';
  END IF;
END $$;
