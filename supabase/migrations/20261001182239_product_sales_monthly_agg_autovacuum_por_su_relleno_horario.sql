-- `product_sales_monthly_agg` la rehace cada hora el cron
-- refresh-product-sales-monthly-agg, y cada relleno deja filas muertas y
-- borra las marcas del mapa de visibilidad. Con el umbral por defecto (50 +
-- 20% de ~137 mil filas ≈ 27 mil cambios) el autovacuum casi nunca corría: en
-- `pg_stat_user_tables` figuraba con 0 vacuums.
--
-- Consecuencia medida el 2026-10-01 en get_pedido_generar_dashboard (308
-- llamadas en la ventana del gate): su parte de «ventas de 6 meses» entra por
-- un índice que ya tiene todas las columnas (`idx_psma_covering`), pero con el
-- mapa viejo hacía `Heap Fetches: 18,703` —ir a la tabla fila por fila— y leía
-- 11,624 bloques, más que la tabla entera (3,425 páginas). Un VACUUM a mano
-- bajó la función de 23,085 a 12,693 bloques por llamada (−45%).
--
-- Esto lo mantiene así: limpiar cada ~2,000 cambios, que es del orden de lo
-- que mueve un relleno. Es un parámetro de mantenimiento: no toca datos, y
-- `ALTER TABLE … SET (…)` toma SHARE UPDATE EXCLUSIVE, que no bloquea ni
-- lecturas ni escrituras.
SET lock_timeout = '5s';
ALTER TABLE public.product_sales_monthly_agg SET (
    autovacuum_vacuum_scale_factor        = 0,
    autovacuum_vacuum_threshold           = 2000,
    autovacuum_vacuum_insert_scale_factor = 0,
    autovacuum_vacuum_insert_threshold    = 2000,
    autovacuum_analyze_scale_factor       = 0,
    autovacuum_analyze_threshold          = 2000
);
