-- ═══════════════════════════════════════════════════════════════════════════
-- 45 · Retención: el registro de envíos de facturas por correo se conserva
--      UN AÑO (aviso de privacidad v2, cláusula 10, «Facturas por correo»)
--
-- QUÉ CAMBIA: cron diario `purge-app-cliente-correo-envios` (09:50 UTC) que
--   borra las filas de `app_cliente_correo_envios` con más de un año. Hoy hay
--   3 filas (la primera del 2026-10-12): no borra nada hasta oct-2027.
--   Lo que se borra es la bitácora del ENVÍO (a qué correo, qué facturas, si
--   salió); los correos que el cliente guardó para reusar viven en otra tabla y
--   los borra él o «Borrar mi cuenta».
--
-- GUARDA: el cron se crea sólo si no existe (`WHERE NOT EXISTS`), para que el
--   replay de un branch nuevo no muera ni lo duplique; y la función sólo borra
--   por fecha, nunca por cliente.
--
-- AL APLICAR EN PRODUCCIÓN, en el mismo commit, declarar en `scripts/eficiencia-gate.mjs`
--   (CRONS; antes de aplicar, el gate lo rechaza por «declarado y NO activo»):
--     { job: 'purge-app-cliente-correo-envios', slug: null, cadencia: '50 9 * * *',
--       corridasDia: 1, sistema: 0, motivo: 'Retención de un año de los envíos de facturas por
--       correo (aviso de privacidad v2, cláusula 10). SQL puro sobre la propia base.' },
--
-- VERIFICADO en staging: fila fabricada de hace 400 días → se borra; de hace
--   300 → se queda.
-- ═══════════════════════════════════════════════════════════════════════════
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.app_cliente_correo_envios_purgar()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v integer;
BEGIN
  DELETE FROM public.app_cliente_correo_envios WHERE created_at < now() - interval '1 year';
  GET DIAGNOSTICS v = ROW_COUNT;
  RETURN v;
END $function$;

REVOKE EXECUTE ON FUNCTION public.app_cliente_correo_envios_purgar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_cliente_correo_envios_purgar() TO service_role;

SELECT cron.schedule('purge-app-cliente-correo-envios', '50 9 * * *', 'SELECT public.app_cliente_correo_envios_purgar()')
 WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-app-cliente-correo-envios');
