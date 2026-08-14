SET lock_timeout = '5s';

-- `product_sales_monthly_agg` sólo se puede buscar por su PK, y su primera
-- columna es `year_month`. Preguntarle «¿cuándo vendió este producto esta sala
-- por última vez?» obliga a un salto por todos los meses del índice: medido el
-- 2026-08-14 sobre CIPRO DENK en Salud 2 → **1.230 ms en frío** (1.343 bloques
-- leídos de disco) y 10 ms en caliente. Un formulario que se abre por producto
-- no puede pagar eso, y el que abre uno que nadie miró hoy paga siempre el frío
-- (`feedback_el_primero_del_lote_paga_el_cache_frio`).
--
-- El índice invierte el orden y se lleva adentro las dos columnas que hacen
-- falta, así que la consulta se resuelve sin tocar la tabla. También lo
-- aprovecha `get_product_sales_agg`, que hace la misma pregunta para todos los
-- candidatos de una búsqueda de Ventas.
--
-- Medido después: 1.5 ms en frío, 7 bloques, `Heap Fetches: 0`.
--
-- Sin CONCURRENTLY a propósito: `apply_migration` corre en una transacción y
-- CONCURRENTLY no puede. El único escritor es el cron
-- `refresh-product-sales-monthly-agg` (minuto 7 de cada hora, 12-23 y 0-5 UTC);
-- esto entra fuera de ese minuto y con `lock_timeout` puesto — si choca, no
-- congela nada, falla y se reintenta.
CREATE INDEX IF NOT EXISTS idx_psma_producto_sucursal
  ON public.product_sales_monthly_agg (erp_product_id, branch_id)
  INCLUDE (ultima_venta, year_month);
