SET lock_timeout = '5s';

-- Primera venta HISTORICA por (sucursal, producto). Es un dato casi inmutable:
-- solo cambia el dia que un producto se vende por PRIMERA vez en una sucursal.
-- Vivia como CTE dentro de calculate_stock_params, sin filtro de fecha a
-- proposito (F2.3), lo que obligaba a escanear las 578K filas de
-- sales_invoice_items en CADA una de las 6 llamadas del cron mensual. Ese scan
-- en frio es lo que mato a La Popular (primera de la lista) el 2026-08-01.
CREATE MATERIALIZED VIEW public.mv_primera_venta_producto AS
SELECT m.erp_sucursal_id,
       ii.erp_product_id,
       MIN(inv.fecha) AS primera
FROM public.sales_invoice_items ii
JOIN public.sales_invoices   inv ON inv.id = ii.invoice_id
JOIN public.erp_sucursal_map m   ON m.branch_id = inv.branch_id
                                AND m.es_bodega = false
WHERE inv.estado        <> 'ANULADA'
  AND ii.erp_product_id IS NOT NULL
  AND ii.cantidad        > 0
GROUP BY m.erp_sucursal_id, ii.erp_product_id;

-- UNIQUE porque lo exige REFRESH ... CONCURRENTLY (y es la clave natural).
CREATE UNIQUE INDEX mv_primera_venta_producto_pk
  ON public.mv_primera_venta_producto (erp_sucursal_id, erp_product_id);

-- Regla 6 de CLAUDE.md: una MV no se expone a la API. La lee unicamente
-- calculate_stock_params, que es SECURITY DEFINER.
REVOKE ALL ON public.mv_primera_venta_producto FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.refresh_primera_venta_producto()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_primera_venta_producto;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.refresh_primera_venta_producto() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.refresh_primera_venta_producto() TO authenticated, service_role;

-- 06:55 UTC: ventana muerta (los crons de sync corren 12-23,0-5) y sin choque
-- con los diarios de 06:10/06:20/06:30/06:45 — cada job es una conexion.
SELECT cron.schedule(
  'refresh-primera-venta-daily',
  '55 6 * * *',
  $cron$SELECT public.refresh_primera_venta_producto()$cron$
);
