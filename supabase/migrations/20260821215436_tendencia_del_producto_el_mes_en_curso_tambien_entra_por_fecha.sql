-- Remate de la migración anterior. Sacar los dos meses cerrados del agregado
-- bajó lo que había que leer, pero el mes en curso seguía entrando por el
-- producto: 42,824 páginas medidas DESPUÉS del cambio, o sea que el trabajo
-- estaba entero ahí.
--
-- Ahora el mes en curso también entra por fecha: las facturas del mes salen del
-- índice (fecha, estado, sucursal, id) sin tocar la tabla, y el tipo de
-- documento —que ningún índice cubre junto con el id— se busca sólo para los
-- ~400 renglones que sobreviven al cruce, no para los 8,604 de la historia.
-- Medido: 42,824 → 7,959 páginas.
--
-- Verificado idéntico a la versión anterior en 7 combinaciones de producto,
-- sucursal y período: mismos meses, mismo neto a 6 decimales, misma cantidad.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_product_trend(
    p_erp_product_id integer,
    p_branch_id      integer DEFAULT NULL::integer,
    p_fini           date    DEFAULT NULL::date,
    p_ffin           date    DEFAULT NULL::date)
RETURNS TABLE(month date, neto numeric, cantidad numeric)
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path TO ''
AS $function$
    -- Tres meses que TERMINAN en el mes del período elegido, no en el de hoy.
    WITH v AS (
        SELECT DATE_TRUNC('month', COALESCE(p_ffin, CURRENT_DATE))::date AS mes_fin,
               DATE_TRUNC('month', CURRENT_DATE)::date                   AS mes_actual
    ),
    ventana AS (
        SELECT (v.mes_fin - INTERVAL '2 months')::date AS desde,
               (v.mes_fin + INTERVAL '1 month')::date  AS hasta,
               v.mes_actual
        FROM v
    ),
    -- Meses ya cerrados: salen sumados del agregado mensual.
    cerrados AS (
        SELECT ((a.year_month || '-01')::date) AS month,
               SUM(a.neto)::numeric            AS neto,
               SUM(a.cantidad)::numeric        AS cantidad
        FROM public.product_sales_monthly_agg a CROSS JOIN ventana w
        WHERE a.erp_product_id = p_erp_product_id
          AND (p_branch_id IS NULL OR a.branch_id = p_branch_id)
          AND a.year_month >= to_char(w.desde, 'YYYY-MM')
          AND a.year_month <  to_char(w.mes_actual, 'YYYY-MM')
          AND a.year_month <  to_char(w.hasta, 'YYYY-MM')
        GROUP BY 1
    ),
    -- Mes en curso: en vivo, que es donde el dato todavía se mueve. Cuando el
    -- período elegido es viejo el rango queda vacío y no se lee nada.
    inv AS MATERIALIZED (
        SELECT si.id, si.fecha
        FROM public.sales_invoices si CROSS JOIN ventana w
        WHERE si.fecha >= GREATEST(w.desde, w.mes_actual)
          AND si.fecha <  w.hasta
          AND si.estado NOT IN ('NULA','DTE INVALIDADO EN MH')
          AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
    ),
    en_curso AS (
        SELECT DATE_TRUNC('month', inv.fecha)::date AS month,
               SUM(CASE WHEN si2.tipo_documento='CCF' THEN sii.total_linea ELSE sii.total_linea/1.13 END)::numeric AS neto,
               SUM(sii.cantidad)::numeric AS cantidad
        FROM inv
        JOIN public.sales_invoice_items sii ON sii.invoice_id = inv.id
        JOIN public.sales_invoices si2      ON si2.id = inv.id
        WHERE sii.erp_product_id = p_erp_product_id
        GROUP BY 1
    )
    SELECT u.month, SUM(u.neto)::numeric, SUM(u.cantidad)::numeric
    FROM (SELECT * FROM cerrados UNION ALL SELECT * FROM en_curso) u
    GROUP BY u.month
    ORDER BY u.month;
$function$;
