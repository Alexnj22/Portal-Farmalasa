SET lock_timeout = '5s';

-- Bloque 4.3: product_stock_params concentraba 1,271,562 de ~1,274,010
-- writes acumulados (99.8%) entre las 11 tablas de supabase_realtime —
-- el decode de WAL para replicación lógica de esta tabla sola representaba
-- ~25% del CPU total de la DB. Su única suscripción real (TabMinMax.jsx,
-- canal bodega-params-watch) se reemplazó por polling con el mismo parche
-- quirúrgico por fila (ver commit del frontend). Verificado: ningún otro
-- archivo del proyecto se conecta a postgres_changes de esta tabla.
ALTER PUBLICATION supabase_realtime DROP TABLE public.product_stock_params;
