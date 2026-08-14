SET lock_timeout = '5s';

-- Lo que hay en sala, junto a lo que se vende. Pedido del usuario el
-- 2026-08-14: un MIN·MAX se propone mirando las dos cosas, y hasta ahora la
-- pantalla mostraba sólo la venta — «no se venden» sin saber si hay 200
-- unidades paradas en el estante es media respuesta.
ALTER TABLE public.minmax_change_requests
  ADD COLUMN IF NOT EXISTS current_existencia numeric;

COMMENT ON COLUMN public.minmax_change_requests.current_existencia IS
  'Unidades vivas (sin vencidos) en esa sala, al momento de crear la solicitud.';

-- La cuenta de unidades es la MISMA que hace `get_pedido_preview` en `_inv_agg`
-- —factor de `mv_product_factor` por nombre de presentación, con el «x N» del
-- detalle de reserva y 1 como último recurso—, y no una fórmula nueva. Si la
-- existencia que se muestra acá no se midiera igual que la que decide el
-- pedido, la pantalla y el pedido dirían números distintos del mismo estante.
--
-- Los vencidos van aparte y no restados: son unidades que están físicamente ahí
-- y no se pueden vender. Sumarlas mentiría sobre lo disponible; esconderlas
-- mentiría sobre por qué el estante se ve lleno.
CREATE OR REPLACE FUNCTION public.get_minmax_contexto_producto(
  p_erp_product_id  integer,
  p_erp_sucursal_id integer
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
  WITH sala AS (
    SELECT branch_id FROM public.erp_sucursal_map
    WHERE erp_sucursal_id = p_erp_sucursal_id AND NOT es_bodega
  ),
  mes AS (
    SELECT COALESCE(SUM(sii.cantidad::numeric * sii.factor_unidades), 0) AS unidades,
           MAX(si.fecha) AS ultima
    FROM public.sales_invoice_items sii
    JOIN public.sales_invoices si ON si.id = sii.invoice_id
    WHERE sii.erp_product_id = p_erp_product_id
      AND si.branch_id = (SELECT branch_id FROM sala)
      AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
      AND si.fecha >= date_trunc('month', CURRENT_DATE)::date
  ),
  cerrados AS (
    SELECT MAX(COALESCE(a.ultima_venta,
                        ((a.year_month || '-01')::date + INTERVAL '1 month' - INTERVAL '1 day')::date)) AS ultima
    FROM public.product_sales_monthly_agg a
    WHERE a.erp_product_id = p_erp_product_id
      AND a.branch_id = (SELECT branch_id FROM sala)
  ),
  estante AS (
    SELECT
      COALESCE(SUM(i.cantidad::numeric * COALESCE(vf.factor,
                 NULLIF(split_part(LOWER(COALESCE(i.detalle, '')), 'x', 2), '')::numeric, 1))
               FILTER (WHERE NOT i.is_vencidos), 0) AS vivas,
      COALESCE(SUM(i.cantidad::numeric * COALESCE(vf.factor,
                 NULLIF(split_part(LOWER(COALESCE(i.detalle, '')), 'x', 2), '')::numeric, 1))
               FILTER (WHERE i.is_vencidos), 0)     AS vencidas
    FROM public.inventory i
    LEFT JOIN public.mv_product_factor vf
           ON vf.product_id = i.erp_product_id
          AND vf.pres_key   = UPPER(TRIM(i.presentacion))
    WHERE i.erp_product_id  = p_erp_product_id
      AND i.erp_sucursal_id = p_erp_sucursal_id
  )
  SELECT json_build_object(
    'unidades_mes', mes.unidades,
    -- GREATEST ignora los NULL: si nunca vendió, los dos son NULL y el
    -- resultado también — «sin ventas», no una fecha inventada.
    'ultima_venta', GREATEST(mes.ultima, cerrados.ultima),
    'existencia',          estante.vivas,
    'existencia_vencida',  estante.vencidas
  )
  FROM mes, cerrados, estante;
$function$;

COMMENT ON FUNCTION public.get_minmax_contexto_producto(integer, integer) IS
  'Unidades vendidas en el mes en curso, fecha de la última venta y existencia (vivas y vencidas) de un producto en una sala. Alimenta el formulario de ajuste de MIN/MAX.';
