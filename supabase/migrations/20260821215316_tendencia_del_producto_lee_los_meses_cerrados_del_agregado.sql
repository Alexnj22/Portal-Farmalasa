-- La tendencia mensual del producto leía los tres meses en vivo, y por eso era
-- la llamada más cara de abrir un producto: 42,373 páginas.
--
-- Es el mismo defecto que se corrigió en el detalle unas horas antes, y por el
-- mismo motivo: `sales_invoice_items` no tiene fecha, así que filtrar por mes
-- obliga a traer TODA la historia del producto (8,604 renglones de ACETAMINOFEN)
-- y preguntarle a cada factura, una por una, en qué mes cayó. La ventana de tres
-- meses son 58,528 facturas y ahí no hay índice que cubra a la vez id, fecha,
-- estado y tipo de documento — o sea que entrar por fecha tampoco alcanzaba:
-- probado, quedaba peor (49,995 páginas).
--
-- La salida no es un plan mejor, es no leer lo que ya está sumado.
-- `product_sales_monthly_agg` guarda por mes cerrado, sucursal, producto y
-- presentación exactamente la misma resta de IVA y las mismas exclusiones —el
-- mismo agregado del que ya salen los meses cerrados de la tabla de productos—.
-- Así que los dos meses cerrados salen de ahí y sólo el mes en curso se lee en
-- vivo, que es donde el dato todavía se mueve.
--
-- Verificado idéntico contra la versión anterior en 6 combinaciones de producto,
-- sucursal y período (mismos meses, mismo neto a 6 decimales, misma cantidad),
-- y contra el conteo crudo de mayo, junio y julio de 2026 sobre 5 productos.
-- El agregado arranca en 2025-05 y la primera factura del portal es del
-- 2025-05-01: no hay historia anterior que se pueda perder.
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
    -- Mes en curso: en vivo, que es donde el dato todavía se mueve.
    en_curso AS (
        SELECT DATE_TRUNC('month', si.fecha)::date AS month,
               SUM(CASE WHEN si.tipo_documento='CCF' THEN sii.total_linea ELSE sii.total_linea/1.13 END)::numeric AS neto,
               SUM(sii.cantidad)::numeric AS cantidad
        FROM public.sales_invoice_items sii
        JOIN public.sales_invoices si ON si.id = sii.invoice_id
        CROSS JOIN ventana w
        WHERE sii.erp_product_id = p_erp_product_id
          AND si.estado NOT IN ('NULA','DTE INVALIDADO EN MH')
          AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
          AND si.fecha >= GREATEST(w.desde, w.mes_actual)
          AND si.fecha <  w.hasta
        GROUP BY 1
    )
    SELECT u.month, SUM(u.neto)::numeric, SUM(u.cantidad)::numeric
    FROM (SELECT * FROM cerrados UNION ALL SELECT * FROM en_curso) u
    GROUP BY u.month
    ORDER BY u.month;
$function$;
