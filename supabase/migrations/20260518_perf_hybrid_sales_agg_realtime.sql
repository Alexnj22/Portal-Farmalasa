-- Hybrid product sales aggregation: past months pre-aggregated (max 15 min stale),
-- current month always from raw tables (real-time).
--
-- Architecture:
--   product_sales_monthly_agg — stores one row per (year_month, branch_id, product, presentacion)
--   refresh_product_sales_monthly_agg() — called by pg_cron every 15 min, rebuilds last 3 past months
--   get_product_sales_agg() — UNION ALL: agg table for past months + raw scan for current month only
--
-- Result: 6-month query goes from timeout → ~300ms
--         pg_cron keeps past months at most 15 min stale; current month is always live

-- ── Pre-aggregation table ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.product_sales_monthly_agg (
    year_month      text        NOT NULL,  -- 'YYYY-MM'
    branch_id       bigint      NOT NULL,
    erp_product_id  integer     NOT NULL,
    presentacion    text        NOT NULL DEFAULT '',
    descripcion     text,
    cantidad        numeric     NOT NULL DEFAULT 0,
    neto            numeric     NOT NULL DEFAULT 0,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (year_month, branch_id, erp_product_id, presentacion)
);

CREATE INDEX IF NOT EXISTS idx_psma_ym_bid
    ON public.product_sales_monthly_agg (year_month, branch_id);

-- RLS: authenticated users can read, no direct writes
ALTER TABLE public.product_sales_monthly_agg ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read" ON public.product_sales_monthly_agg
    FOR SELECT TO authenticated USING (true);

-- ── Refresh function (pg_cron target) ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.refresh_product_sales_monthly_agg(
    p_months_back integer DEFAULT 3
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_curr_month date;
    v_from_date  date;
    v_inserted   integer;
BEGIN
    v_curr_month := date_trunc('month', CURRENT_DATE)::date;
    v_from_date  := (v_curr_month - (p_months_back || ' months')::interval)::date;

    DELETE FROM public.product_sales_monthly_agg
    WHERE year_month >= to_char(v_from_date, 'YYYY-MM')
      AND year_month <  to_char(v_curr_month, 'YYYY-MM');

    INSERT INTO public.product_sales_monthly_agg
        (year_month, branch_id, erp_product_id, presentacion, descripcion, cantidad, neto)
    SELECT
        to_char(si.fecha, 'YYYY-MM'),
        si.branch_id,
        sii.erp_product_id,
        COALESCE(sii.presentacion, ''),
        MAX(sii.descripcion),
        SUM(sii.cantidad::numeric),
        SUM(CASE WHEN si.tipo_documento = 'CCF'
                 THEN sii.total_linea::numeric
                 ELSE sii.total_linea::numeric / 1.13
            END)
    FROM public.sales_invoice_items sii
    JOIN public.sales_invoices si ON si.id = sii.invoice_id
    WHERE sii.erp_product_id IS NOT NULL
      AND sii.erp_product_id != 0
      AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
      AND si.fecha >= v_from_date
      AND si.fecha <  v_curr_month
    GROUP BY 1, 2, 3, 4;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    RETURN v_inserted;
END;
$function$;

-- Grant execute to postgres role so pg_cron can call it
GRANT EXECUTE ON FUNCTION public.refresh_product_sales_monthly_agg(integer) TO postgres;

-- ── pg_cron: refresh every 15 minutes ────────────────────────────────────────

SELECT cron.schedule(
    'refresh-product-sales-monthly-agg',
    '*/15 * * * *',
    'SELECT public.refresh_product_sales_monthly_agg(3)'
);

-- ── Hybrid get_product_sales_agg ─────────────────────────────────────────────
-- pres_past  → product_sales_monthly_agg (no invoice scan, instant)
-- pres_live  → raw sales_invoice_items + sales_invoices, current month only
-- Cost match → single bulk scan of product_precios with ROW_NUMBER() ranking
--              (replaces the ~5,928 correlated subqueries that caused timeouts)

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
-- Single bulk scan of product_precios (partial index: activo=true)
all_costs AS (
    SELECT product_id, costo, vineta,
           (vineta = 0 OR costo <= vineta) AS is_primary
    FROM public.product_precios
    WHERE activo = true
      AND product_id IN (SELECT erp_product_id FROM pres)
),
best_cost AS (
    SELECT
        p.erp_product_id,
        p.presentacion,
        pc.costo,
        ROW_NUMBER() OVER (
            PARTITION BY p.erp_product_id, p.presentacion
            ORDER BY
                CASE WHEN pc.is_primary THEN 0 ELSE 1 END,
                ABS(pc.vineta - p.precio_unitario_avg) NULLS LAST
        ) AS rn
    FROM pres p
    JOIN all_costs pc ON pc.product_id = p.erp_product_id
),
pres_costed AS (
    SELECT p.*, bc.costo AS costo_matched
    FROM pres p
    LEFT JOIN best_cost bc
           ON bc.erp_product_id = p.erp_product_id
          AND bc.presentacion   = p.presentacion
          AND bc.rn = 1
)
SELECT
    erp_product_id,
    MAX(descripcion),
    SUM(cantidad),
    SUM(neto),
    CASE WHEN COUNT(costo_matched) = 0 THEN NULL
         ELSE SUM(costo_matched * cantidad)
    END,
    jsonb_agg(
        jsonb_build_object(
            'presentacion',        presentacion,
            'cantidad',            cantidad,
            'neto',                neto,
            'precio_unitario_avg', precio_unitario_avg
        )
        ORDER BY neto DESC
    )
FROM pres_costed
GROUP BY erp_product_id
ORDER BY SUM(neto) DESC;
$function$;
