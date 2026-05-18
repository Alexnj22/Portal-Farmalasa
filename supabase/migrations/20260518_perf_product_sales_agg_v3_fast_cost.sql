-- Fix: get_product_sales_agg cost-matching temp spill → 16s timeout for 6-month range
--
-- Root cause: ROW_NUMBER() OVER PARTITION BY (erp_product_id, presentacion) with
-- ~76K input rows (5101 pres × ~15 prices/product) spills to temp at 4 MB work_mem.
-- Combined with ORDER BY inside jsonb_agg (per-group sort for 3,489 products):
-- total function time 16s for 6-month range.
--
-- Fix 1: Replace window function with GROUP BY + MIN — one cost per product,
--         no in-memory sort, no temp spill.
-- Fix 2: Remove ORDER BY from jsonb_agg (presentations are sorted client-side).
-- Fix 3: Add covering index on product_sales_monthly_agg so pres_past uses
--         Index Only Scan (Heap Fetches: 0) instead of Index Scan + heap fetch.

CREATE INDEX IF NOT EXISTS idx_psma_covering
    ON public.product_sales_monthly_agg (year_month, branch_id, erp_product_id, presentacion)
    INCLUDE (descripcion, cantidad, neto);

CREATE OR REPLACE FUNCTION public.get_product_sales_agg(
    p_fini      date,
    p_ffin      date,
    p_branch_id integer DEFAULT NULL::integer
)
RETURNS TABLE(
    erp_product_id integer,
    descripcion    text,
    cantidad       numeric,
    neto           numeric,
    costo_total    numeric,
    presentaciones jsonb
)
LANGUAGE sql
STABLE PARALLEL SAFE
SET search_path TO ''
AS $function$
WITH
-- Past complete months from pre-aggregated table (no invoice scan at all)
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
    GROUP BY a.erp_product_id, a.presentacion
),
-- Current month always from raw tables — real-time, never cached
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
    GROUP BY sii.erp_product_id, sii.presentacion
),
-- Merge past agg + live data
pres AS (
    SELECT
        erp_product_id,
        MAX(descripcion) AS descripcion,
        presentacion,
        SUM(cantidad) AS cantidad,
        SUM(neto) AS neto,
        SUM(neto) / NULLIF(SUM(cantidad), 0) AS precio_unitario_avg
    FROM (
        SELECT erp_product_id, descripcion, presentacion, cantidad, neto FROM pres_past
        UNION ALL
        SELECT erp_product_id, descripcion, presentacion, cantidad, neto FROM pres_live
    ) u
    GROUP BY erp_product_id, presentacion
),
-- One representative cost per product: primary price (vineta=0 or costo<=vineta),
-- fallback to any active price. GROUP BY + MIN avoids the window function temp spill
-- that killed performance at 6-month range with 4 MB work_mem.
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
)
SELECT
    p.erp_product_id,
    MAX(p.descripcion),
    SUM(p.cantidad),
    SUM(p.neto),
    CASE WHEN COUNT(bc.costo) = 0 THEN NULL
         ELSE SUM(bc.costo * p.cantidad)
    END,
    jsonb_agg(jsonb_build_object(
        'presentacion',        p.presentacion,
        'cantidad',            p.cantidad,
        'neto',                p.neto,
        'precio_unitario_avg', p.precio_unitario_avg
    ))
FROM pres p
LEFT JOIN best_cost bc ON bc.product_id = p.erp_product_id
GROUP BY p.erp_product_id
ORDER BY SUM(p.neto) DESC;
$function$;
