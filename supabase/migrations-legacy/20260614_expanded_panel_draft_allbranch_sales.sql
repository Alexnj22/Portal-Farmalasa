-- ExpandedPanel enhancements:
-- 1. get_product_branch_summary: add draft_min, draft_max, draft_status to result
-- 2. get_product_last_sales: optional sucursal (NULL = all branches) + return erp_sucursal_id

-- ─── 1. get_product_branch_summary ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_product_branch_summary(integer);
CREATE FUNCTION public.get_product_branch_summary(p_erp_product_id integer)
RETURNS TABLE (
  erp_sucursal_id  integer,
  current_stock    bigint,
  effective_min    integer,
  effective_max    integer,
  alert_status     text,
  draft_min        integer,
  draft_max        integer,
  draft_status     text
)
LANGUAGE sql STABLE AS $function$
  WITH config AS (
    SELECT (1.0 + approaching_pct / 100.0) AS approaching_mult
    FROM stock_config LIMIT 1
  ),
  inv_agg AS (
    SELECT
      i.erp_sucursal_id,
      SUM(i.cantidad
        * COALESCE((regexp_match(i.presentacion, '[0-9]+[xX]([0-9]+)'))[1]::int, 1))::bigint AS total_units
    FROM inventory i
    WHERE i.erp_product_id = p_erp_product_id
      AND i.is_vencidos = false
    GROUP BY i.erp_sucursal_id
  )
  SELECT
    psp.erp_sucursal_id,
    COALESCE(inv.total_units, 0) AS current_stock,
    COALESCE(psp.manual_min, psp.min_units, psp.draft_min, 0)::int AS effective_min,
    COALESCE(psp.manual_max, psp.max_units, psp.draft_max, 0)::int AS effective_max,
    CASE
      WHEN COALESCE(inv.total_units, 0) = 0
        THEN 'out_of_stock'
      WHEN COALESCE(inv.total_units, 0)
           < COALESCE(psp.manual_min, psp.min_units, psp.draft_min, 0)
        THEN 'below_min'
      WHEN COALESCE(inv.total_units, 0)::numeric
           < COALESCE(psp.manual_min, psp.min_units, psp.draft_min, 0)::numeric
             * (SELECT approaching_mult FROM config)
        THEN 'approaching'
      WHEN COALESCE(inv.total_units, 0)
           > COALESCE(psp.manual_max, psp.max_units, psp.draft_max, 0)
           AND COALESCE(psp.manual_max, psp.max_units, psp.draft_max, 0) > 0
        THEN 'overstocked'
      ELSE 'ok'
    END AS alert_status,
    psp.draft_min::int  AS draft_min,
    psp.draft_max::int  AS draft_max,
    COALESCE(psp.draft_status, 'none') AS draft_status
  FROM product_stock_params psp
  LEFT JOIN inv_agg inv ON inv.erp_sucursal_id = psp.erp_sucursal_id
  WHERE psp.erp_product_id = p_erp_product_id;
$function$;
GRANT EXECUTE ON FUNCTION public.get_product_branch_summary(integer) TO authenticated, service_role;

-- ─── 2. get_product_last_sales ──────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_product_last_sales(integer, integer);
CREATE FUNCTION public.get_product_last_sales(
  p_erp_product_id  integer,
  p_erp_sucursal_id integer DEFAULT NULL
)
RETURNS TABLE (
  fecha           date,
  cantidad        numeric,
  total_linea     numeric,
  cliente         text,
  erp_sucursal_id integer
)
LANGUAGE sql STABLE AS $function$
  SELECT
    inv.fecha::date,
    (ii.cantidad::numeric
      * COALESCE((regexp_match(ii.presentacion, '[0-9]+[xX]([0-9]+)'))[1]::int, 1)) AS cantidad,
    ii.total_linea,
    inv.cliente,
    bm.erp_sucursal_id
  FROM sales_invoice_items ii
  JOIN sales_invoices inv  ON inv.id = ii.invoice_id
  JOIN erp_sucursal_map bm ON bm.branch_id = inv.branch_id
  WHERE ii.erp_product_id  = p_erp_product_id
    AND (p_erp_sucursal_id IS NULL OR bm.erp_sucursal_id = p_erp_sucursal_id)
    AND inv.estado          != 'ANULADA'
    AND ii.cantidad          > 0
  ORDER BY inv.fecha DESC, inv.id DESC
  LIMIT 6;
$function$;
GRANT EXECUTE ON FUNCTION public.get_product_last_sales(integer, integer) TO authenticated, service_role;
