-- get_product_sales_agg v6: eliminates correlated subquery re-execution (root cause of timeout)
--
-- Root cause of v5 timeout:
--   last_sale_all was not MATERIALIZED → PostgreSQL 12+ inlines CTEs by default.
--   Each correlated subquery (×2 per candidate product, ~2000 candidates) re-ran
--   the 500K-row sales_invoice_items scan. Even with index lookups that's thousands
--   of individual join executions → statement timeout.
--
-- Fix:
--   1. Compute last_date from product_sales_monthly_agg AFTER MAX(year_month)
--      so date arithmetic runs once per group (~15K), not once per row (~109K).
--   2. MATERIALIZED ultima_venta_agg: computed once, stored as a hash table.
--   3. Final SELECT uses LEFT JOIN instead of correlated subqueries — single hash join pass.
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
branch_to_erp(bid, esid) AS (
  VALUES (4::integer,1),(25::integer,2),(27::integer,3),
         (28::integer,4),(2::integer,5),(29::integer,7)
),
-- Returns 0 rows when p_branch_id IS NULL → zero_sale_cands CROSS JOIN self-disables
branch_esid AS (
  SELECT esid FROM branch_to_erp WHERE bid = p_branch_id
),
-- Historical months from the pre-aggregated table
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
-- Current month from live invoices (small dataset by definition)
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
best_cost AS (
  SELECT
    product_id,
    COALESCE(
      MIN(costo) FILTER (WHERE vineta = 0 OR costo <= vineta),
      MIN(costo)
    ) AS costo
  FROM public.product_precios
  WHERE activo = true
    AND product_id IN (SELECT erp_product_id FROM pres)
  GROUP BY product_id
),
prod_with_sales AS (
  SELECT
    p.erp_product_id,
    MAX(p.descripcion)  AS descripcion,
    SUM(p.cantidad)     AS cantidad,
    SUM(p.neto)         AS neto,
    CASE WHEN COUNT(bc.costo) = 0 THEN NULL
         ELSE ROUND(SUM(bc.costo * p.cantidad), 2) END AS costo_total,
    jsonb_agg(jsonb_build_object(
      'presentacion',        p.presentacion,
      'cantidad',            p.cantidad,
      'neto',                p.neto,
      'precio_unitario_avg', p.precio_unitario_avg
    )) AS presentaciones
  FROM pres p
  LEFT JOIN best_cost bc ON bc.product_id = p.erp_product_id
  GROUP BY p.erp_product_id
),
-- 0-sale products with min/max or stock in the selected branch
zero_sale_cands AS (
  SELECT pr.id AS erp_product_id, pr.nombre AS descripcion
  FROM public.products pr
  CROSS JOIN branch_esid be
  WHERE pr.activo = true
    AND (p_search IS NULL OR pr.nombre ILIKE '%' || p_search || '%')
    AND NOT EXISTS (SELECT 1 FROM prod_with_sales pws WHERE pws.erp_product_id = pr.id)
    AND (
      EXISTS (SELECT 1 FROM public.erp_minmax mm
              WHERE mm.erp_product_id = pr.id AND mm.erp_sucursal_id = be.esid)
      OR EXISTS (SELECT 1 FROM public.inventory inv
                 WHERE inv.erp_product_id = pr.id AND inv.erp_sucursal_id = be.esid
                   AND inv.is_vencidos = false AND inv.cantidad > 0)
    )
),
all_cands AS (
  SELECT erp_product_id, descripcion FROM prod_with_sales
  UNION ALL
  SELECT erp_product_id, descripcion FROM zero_sale_cands
),
-- ── Key optimization ──────────────────────────────────────────────────────────
-- Compute MAX(year_month) per (product, branch) first, THEN convert to a date.
-- Date arithmetic runs on the ~15K grouped rows, not the ~109K raw rows.
-- This avoids the bottleneck that caused v3/v4 to be slow (date calc per-row).
last_sale_hist AS (
  SELECT
    a.erp_product_id AS prod_id,
    a.branch_id,
    ((MAX(a.year_month) || '-01')::date + INTERVAL '1 month' - INTERVAL '1 day')::date AS last_date
  FROM public.product_sales_monthly_agg a
  GROUP BY a.erp_product_id, a.branch_id
),
-- Current month from live invoices — always small
last_sale_live AS (
  SELECT sii.erp_product_id AS prod_id, si.branch_id, MAX(si.fecha) AS last_date
  FROM public.sales_invoice_items sii
  JOIN public.sales_invoices si ON si.id = sii.invoice_id
  WHERE sii.erp_product_id IS NOT NULL
    AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    AND si.fecha >= date_trunc('month', CURRENT_DATE)::date
  GROUP BY sii.erp_product_id, si.branch_id
),
-- MATERIALIZED: computed once as a hash table, not re-executed per candidate row.
-- Pre-aggregates ultima_venta_global, ultima_venta_branch, and ultima_venta_por_suc
-- so the final SELECT can use a hash JOIN instead of correlated subqueries.
ultima_venta_agg AS MATERIALIZED (
  SELECT
    pb.prod_id,
    MAX(pb.last_date)                                              AS ultima_venta_global,
    MAX(pb.last_date) FILTER (WHERE pb.branch_id = p_branch_id)   AS ultima_venta_branch,
    COALESCE(
      jsonb_agg(
        jsonb_build_object('branch_id', pb.branch_id, 'fecha', pb.last_date)
        ORDER BY pb.last_date DESC NULLS LAST
      ) FILTER (WHERE pb.last_date IS NOT NULL),
      '[]'::jsonb
    )                                                              AS ultima_venta_por_suc
  FROM (
    -- Combine hist + live, deduplicate per (product, branch) with MAX
    SELECT prod_id, branch_id, MAX(last_date) AS last_date
    FROM (
      SELECT prod_id, branch_id, last_date FROM last_sale_hist
      UNION ALL
      SELECT prod_id, branch_id, last_date FROM last_sale_live
    ) u
    GROUP BY prod_id, branch_id
  ) pb
  GROUP BY pb.prod_id
)
-- Single-pass hash join — no correlated subqueries
SELECT
  ac.erp_product_id,
  COALESCE(pws.descripcion, ac.descripcion)::text   AS descripcion,
  COALESCE(pws.cantidad,    0::numeric)             AS cantidad,
  COALESCE(pws.neto,        0::numeric)             AS neto,
  pws.costo_total,
  COALESCE(pws.presentaciones, '[]'::jsonb)         AS presentaciones,
  CASE WHEN p_branch_id IS NULL
       THEN uva.ultima_venta_global
       ELSE uva.ultima_venta_branch
  END                                                AS ultima_venta,
  COALESCE(uva.ultima_venta_por_suc, '[]'::jsonb)  AS ultima_venta_por_suc
FROM all_cands ac
LEFT JOIN prod_with_sales pws ON pws.erp_product_id = ac.erp_product_id
LEFT JOIN ultima_venta_agg uva ON uva.prod_id        = ac.erp_product_id
ORDER BY
  (pws.erp_product_id IS NULL) ASC,   -- products with sales first
  COALESCE(pws.neto, 0)        DESC,
  CASE WHEN p_branch_id IS NULL
       THEN uva.ultima_venta_global
       ELSE uva.ultima_venta_branch
  END                          DESC NULLS LAST;
$$;
