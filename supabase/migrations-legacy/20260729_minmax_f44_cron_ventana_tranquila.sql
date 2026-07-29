-- F4.4 — El recalculo mensual disparaba a las 15:00 UTC, con los syncs por
-- minuto en pleno funcionamiento.
--
-- `auto-calculate-minmax-monthly` estaba en `0 15 1 * *` (9am de El Salvador).
-- Los crons de sync corren `12-23,0-5`, o sea que las 15:00 UTC caen justo en
-- medio: el recalculo escanea 180 dias de sales_invoice_items y escribe miles de
-- filas de product_stock_params mientras seis syncs de DTE y siete de inventario
-- escriben en las mismas tablas cada minuto.
--
-- Se mueve a `0 9 1 * *` — 09:00 UTC, dentro de la ventana 06:00-11:59 en la que
-- los syncs estan quietos (es la regla de CLAUDE.md para escrituras grandes) y
-- despues del refresh del rollup de ventas (06:30), asi que el calculo arranca
-- con las unidades ya reconciliadas.
--
-- 09:00 UTC son 3am de El Salvador. Antes corria a las 9am justamente para que
-- alguien lo estuviera viendo, pero el aviso que manda la edge function
-- (notificacion a los Supervisores de Ventas + minmax_sync_log) no depende de
-- que nadie este mirando, y el estado que se quiere evitar — un recalculo que se
-- pisa con los syncs — es peor que revisar el aviso al llegar.
--
-- NOTA sobre el otro pendiente de F4.4: el recalculo lleva 6 semanas sin correr
-- en 4 de 6 sucursales (Salud 1 = 13-jun, Salud 4 y 5 = 14-jun, La Popular =
-- 17-jun; solo Salud 2 y 3 en 17-jul). La causa (sucursales saltadas por
-- borradores pendientes) ya esta arreglada y hoy hay 1 solo borrador pendiente
-- en todo el sistema. El recalculo manual NO se dispara en esta migracion: mueve
-- el MIN/MAX de 4 sucursales enteras, ahora tambien con el divisor data_days de
-- F2.3, y eso se corre mirando el resultado, no dentro de un DDL.

SET lock_timeout = '5s';

SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'auto-calculate-minmax-monthly'),
  schedule => '0 9 1 * *'
);
