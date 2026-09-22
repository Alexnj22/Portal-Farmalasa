-- BORRADOR — NO APLICADO. F6 del plan. Aplicar el 2026-09-23 entre 06:00 y
-- 11:59 UTC (crons de sync inactivos), con `apply_migration`, y archivarlo con la
-- versión que devuelva el servidor. Antes: confirmar que no hay escritores
-- vivos sobre `sales_invoices` (pg_stat_activity). Después: el EXPLAIN de abajo
-- tiene que entrar por `idx_si_sin_sello_valido`, y agregar ese chequeo a la
-- sección C de `gate:perf` (`exigido: 'idx_si_sin_sello_valido'`).
--
-- F6 · Pendiente MH: la cola de facturas sin sello válido deja de recorrer la
-- tabla entera.
--
-- `get_pending_mh_invoices` busca `length(recibido_mh) IS DISTINCT FROM 40 AND
-- estado <> 'NULA'` sobre `sales_invoices`. Sin un índice que responda eso,
-- entra por `idx_si_branch_fecha_full` y filtra las 373,856 facturas una por
-- una. Medido el 2026-09-22 con la cola VACÍA (0 pendientes): 104k bloques
-- (812 MB) y 915 ms para no devolver nada. El planificador además estima que
-- casi todas cumplen (371,953 filas), porque no sabe estimar un `length() IS
-- DISTINCT FROM`.
--
-- Índice parcial con el MISMO predicado: sólo contiene las facturas pendientes,
-- que casi siempre son ninguna o unas pocas, y ya viene en el orden del
-- `ORDER BY`. No cambia ningún resultado.
--
-- Sin CONCURRENTLY a propósito, como `20260814155232`: `apply_migration` corre
-- en una transacción y CONCURRENTLY no puede. El lock es SHARE: NO frena
-- lecturas, sólo escrituras mientras se construye (la tabla son 137 MB), y por
-- eso va en la ventana sin syncs. Si choca con un escritor, `lock_timeout` lo
-- corta sin congelar nada: reintentar.
--
-- Costo que se acepta: una actualización de `recibido_mh` o `estado` deja de
-- poder ser HOT. Medido: hoy el 4.9% de los updates de la tabla son HOT (31 de
-- 639), así que no se pierde casi nada.
--
-- Probado en staging (qvctarsqvlhbzgvwbbbt) con execute_sql el 2026-09-22: crea
-- sin error; el branch no tiene facturas, así que el plan se verifica en prod.
--
-- Verificar antes/después con:
--   EXPLAIN (ANALYZE, BUFFERS, TIMING OFF) SELECT si.id FROM public.sales_invoices si
--    WHERE length(si.recibido_mh) IS DISTINCT FROM 40 AND si.estado <> 'NULA'
--    ORDER BY si.branch_id, si.fecha, si.hora;
SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS idx_si_sin_sello_valido
    ON public.sales_invoices (branch_id, fecha, hora)
 WHERE length(recibido_mh) IS DISTINCT FROM 40 AND estado <> 'NULA';
