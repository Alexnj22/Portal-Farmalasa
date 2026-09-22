-- F6 · Pendiente MH: la cola de facturas sin sello válido deja de recorrer la
-- tabla entera.
--
-- `get_pending_mh_invoices` busca `length(recibido_mh) IS DISTINCT FROM 40 AND
-- estado <> 'NULA'` sobre `sales_invoices`. Sin un índice que responda eso,
-- entra por `idx_si_branch_fecha_full` y filtra las 373,856 facturas una por
-- una. Medido el 2026-09-22 con la cola VACÍA (0 pendientes): **104k bloques
-- (812 MB) y 915 ms para no devolver nada**. El planificador además estima que
-- casi todas cumplen (371,953 filas), porque no sabe estimar un `length() IS
-- DISTINCT FROM`.
--
-- Índice parcial con el MISMO predicado: sólo contiene las facturas pendientes
-- —casi siempre ninguna o unas pocas— y ya viene en el orden del `ORDER BY`. No
-- cambia ningún resultado.
--
-- Sin CONCURRENTLY, como `20260814155232`: `apply_migration` corre en una
-- transacción y CONCURRENTLY no puede. El lock es SHARE, o sea que **no frena
-- ninguna lectura**, sólo las escrituras mientras se construye (137 MB de
-- tabla, segundos), y `lock_timeout` corta si choca con un sync en vuelo — eso
-- es un reintento, no un freeze. El outage del 2026-07-08 fue por locks ACCESS
-- EXCLUSIVE (policies/ALTER), que son los que encolan lecturas.
--
-- Costo que se acepta: una actualización de `recibido_mh` o `estado` deja de
-- poder ser HOT. Medido: hoy el 4.9% de los updates de la tabla son HOT (31 de
-- 639), así que no se pierde casi nada.
--
-- Probado en staging (qvctarsqvlhbzgvwbbbt) con execute_sql el 2026-09-22.
-- Medido después, en producción: **103,906 → 3 bloques, 915 → 0.15 ms**, y las
-- 79 llamadas de edge functions de esa ventana todas en 200.
SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS idx_si_sin_sello_valido
    ON public.sales_invoices (branch_id, fecha, hora)
 WHERE length(recibido_mh) IS DISTINCT FROM 40 AND estado <> 'NULA';
