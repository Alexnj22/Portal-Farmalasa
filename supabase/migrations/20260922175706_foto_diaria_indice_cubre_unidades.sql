-- El índice por sala de la migración anterior dejaba el filtro `unidades > 0`
-- fuera, así que la consulta saltaba al heap una vez por fila: 38,561 bloques
-- para una sala. Con `unidades` en el índice, la lectura es sólo índice.
--
-- (Hoy TODAS las filas tienen unidades > 0 —la foto sólo guarda lo que hay—,
-- pero la consulta no puede asumirlo: el día que el snapshot cambie y empiece a
-- escribir ceros, un filtro que se dio por cierto devolvería productos agotados
-- como si tuvieran existencia. El índice lo hace barato sin tener que asumirlo.)
SET lock_timeout = '5s';

DROP INDEX IF EXISTS public.idx_inventory_daily_sala_producto_fecha;

CREATE INDEX IF NOT EXISTS idx_inventory_daily_sala_producto_fecha
    ON public.inventory_daily (erp_sucursal_id, erp_product_id, fecha) INCLUDE (unidades);
