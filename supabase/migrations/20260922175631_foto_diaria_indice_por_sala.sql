-- La foto diaria del inventario se consulta POR SALA, y sólo tenía su clave
-- primaria `(fecha, erp_sucursal_id, erp_product_id)`: preguntar «qué días tuvo
-- existencia este producto en esta sala» recorría las 291,643 filas de todas
-- las salas. Medido el 2026-09-22: 39,535 bloques para una sala.
--
-- Índice por sala primero, que es como se pregunta. Va en la tabla PADRE, así
-- que Postgres lo crea en cada partición y en las que cree el mantenimiento
-- mensual. La tabla pesa 27 MB: se construye en un instante, y su único
-- escritor es el cron de las 01:45 SV.
SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS idx_inventory_daily_sala_producto_fecha
    ON public.inventory_daily (erp_sucursal_id, erp_product_id, fecha);
