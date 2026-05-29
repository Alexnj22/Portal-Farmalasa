-- get_product_sales_agg v2: zero-sale candidates when branch filtered, ultima_venta columns
DROP FUNCTION IF EXISTS public.get_product_sales_agg(date, date, integer, text);

CREATE OR REPLACE FUNCTION public.get_product_sales_agg(
  p_fini      date,
  p_ffin      date,
  p_branch_id integer DEFAULT NULL,
  p_search    text    DEFAULT NULL
)
RETURNS TABLE(
  erp_product_id       integer,
  descripcion          text,
  cantidad             numeric,
  neto                 numeric,
  costo_total          numeric,
  presentaciones       jsonb,
  ultima_venta         date,
  ultima_venta_por_suc jsonb
)
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path TO ''
AS $$
WITH
-- Maps sales_invoices.branch_id → erp_sucursal_id (used by inventory/minmax tables)
branch_to_erp(bid, esid) AS (
  VALUES (4::integer,1),(25::integer,2),(27::integer,3),
         (28::integer,4),(2::integer,5),(29::integer,7)
),
pres_past AS (
  SELECT
    a.erp_product_id,
    MAX(a.descripcion)  AS descripcion,
    a.presentacion,
    SUM(a.cantidad)     AS cantidad,
    SUM(a.neto)         AS neto
  FROM public.product_sales_monthly_agg a
  WHERE a.year_month >= to_char(p_fini, 'YYYY-MM')
    AND a.year_month <  to_char(date_trunc('month', CURRENT_DATE)::date, 'YYYY-MM')
    AND p_fini        <  date_trunc('month', CURRENT_DATE)::date
    AND (p_branch_id IS NULL OR a.branch_id = p_branch_id)
    AND (p_search    IS NULL OR a.descripcion ILIKE '%' || p_search || '%')
  GROUP BY a.erp_product_id, a.presentacion
),
pres_live AS (
  SELECT
    sii.erp_product_id,
    MAX(sii.descripcion) AS descripcion,
    sii.presentacion,
    SUM(sii.cantidad::numeric) AS cantidad,
    SUM(CASE WHEN si.tipo_documento = 'CCF'
             THEN sii.total_linea::numeric
             ELSE sii.total_linea::numeric / 1.13
        END) AS neto
  FROM public.sales_invoice_items sii
  JOIN public.sales_invoices si ON si.id = sii.invoice_id
  WHERE sii.erp_product_id IS NOT NULL
    AND sii.erp_product_id != 0
    AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    AND si.fecha BETWEEN GREATEST(p_fini, date_trunc('month', CURRENT_DATE)::date) AND p_ffin
    AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
    AND (p_search    IS NULL OR sii.descripcion ILIKE '%' || p_search || '%')
  GROUP BY sii.erp_product_id, sii.presentacion
),
pres AS (
  SELECT
    erp_product_id,
    MAX(descripcion) AS descripcion,
    presentacion,
    SUM(cantidad)    AS cantidad,
    SUM(neto)        AS neto,
    SUM(neto) / NULLIF(SUM(cantidad), 0) AS precio_unitario_avg
  FROM (
    SELECT erp_product_id, descripcion, presentacion, cantidad, neto FROM pres_past
    UNION ALL
    SELECT erp_product_id, descripcion, presentacion, cantidad, neto FROM pres_live
  ) u
  GROUP BY erp_product_id, presentacion
),
prod_with_sales AS (
  SELECT
    p.erp_product_id,
    MAX(p.descripcion)  AS descripcion,
    SUM(p.cantidad)     AS cantidad,
    SUM(p.neto)         AS neto,
    jsonb_agg(jsonb_build_object(
      'presentacion',        p.presentacion,
      'cantidad',            p.cantidad,
      'neto',                p.neto,
      'precio_unitario_avg', p.precio_unitario_avg
    )) AS presentaciones
  FROM pres p
  GROUP BY p.erp_product_id
),
-- Products with 0 sales in the period but with min/max or active inventory in the selected branch
zero_sale_cands AS (
  SELECT pr.id AS erp_product_id, pr.nombre AS descripcion
  FROM public.products pr
  WHERE p_branch_id IS NOT NULL
    AND pr.activo = true
    AND (p_search IS NULL OR pr.nombre ILIKE '%' || p_search || '%')
    AND NOT EXISTS (
      SELECT 1 FROM prod_with_sales pws WHERE pws.erp_product_id = pr.id
    )
    AND (
      EXISTS (
        SELECT 1 FROM public.erp_minmax mm
        JOIN branch_to_erp bte ON bte.esid = mm.erp_sucursal_id
        WHERE mm.erp_product_id = pr.id AND bte.bid = p_branch_id
      )
      OR EXISTS (
        SELECT 1 FROM public.inventory inv
        JOIN branch_to_erp bte ON bte.esid = inv.erp_sucursal_id
        WHERE inv.erp_product_id = pr.id
          AND bte.bid = p_branch_id
          AND inv.is_vencidos = false
          AND inv.cantidad > 0
      )
    )
),
all_cands AS (
  SELECT erp_product_id, descripcion FROM prod_with_sales
  UNION ALL
  SELECT erp_product_id, descripcion FROM zero_sale_cands
),
best_cost AS (
  SELECT
    product_id,
    COALESCE(
      MIN(costo) FILTER (WHERE vineta = 0 OR costo <= vineta),
      MIN(costo)
    ) AS costo
  FROM public.product_precios
  WHERE activo = true
    AND product_id IN (SELECT erp_product_id FROM all_cands)
  GROUP BY product_id
),
-- Last sale per product per branch (all time — no period filter)
last_sale AS (
  SELECT sii.erp_product_id AS prod_id, si.branch_id, MAX(si.fecha) AS last_date
  FROM public.sales_invoice_items sii
  JOIN public.sales_invoices si ON si.id = sii.invoice_id
  WHERE sii.erp_product_id IN (SELECT erp_product_id FROM all_cands)
    AND sii.erp_product_id IS NOT NULL
    AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
  GROUP BY sii.erp_product_id, si.branch_id
)
SELECT
  ac.erp_product_id,
  COALESCE(pws.descripcion, ac.descripcion)::text         AS descripcion,
  COALESCE(pws.cantidad,    0::numeric)                   AS cantidad,
  COALESCE(pws.neto,        0::numeric)                   AS neto,
  CASE WHEN pws.erp_product_id IS NOT NULL AND bc.costo IS NOT NULL
       THEN ROUND(bc.costo * pws.cantidad, 2)
       ELSE NULL END                                       AS costo_total,
  COALESCE(pws.presentaciones, '[]'::jsonb)               AS presentaciones,
  ls_agg.ultima_venta,
  ls_agg.ultima_venta_por_suc
FROM all_cands ac
LEFT JOIN prod_with_sales pws ON pws.erp_product_id = ac.erp_product_id
LEFT JOIN best_cost        bc  ON bc.product_id      = ac.erp_product_id
LEFT JOIN LATERAL (
  SELECT
    MAX(ls.last_date) FILTER (WHERE p_branch_id IS NULL OR ls.branch_id = p_branch_id) AS ultima_venta,
    COALESCE(
      jsonb_agg(
        jsonb_build_object('branch_id', ls.branch_id, 'fecha', ls.last_date)
        ORDER BY ls.last_date DESC NULLS LAST
      ) FILTER (WHERE ls.last_date IS NOT NULL),
      '[]'::jsonb
    ) AS ultima_venta_por_suc
  FROM last_sale ls
  WHERE ls.prod_id = ac.erp_product_id
) ls_agg ON true
ORDER BY
  (pws.erp_product_id IS NULL) ASC,   -- products with sales first
  COALESCE(pws.neto, 0)        DESC,
  ls_agg.ultima_venta          DESC NULLS LAST;
$$;
