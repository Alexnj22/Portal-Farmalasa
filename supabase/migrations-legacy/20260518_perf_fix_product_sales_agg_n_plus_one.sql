-- Fix: get_product_sales_agg N+1 correlated subqueries → single bulk join
-- Before: 2,964 pres rows × 2 correlated subqueries = ~5,928 separate lookups against
--         product_precios per call. ORDER BY ABS(vineta-avg) can't use any index.
--         Result: statement timeout on every filter change.
-- After:  1 partial index scan + 1 ROW_NUMBER() window function pass = ~42ms for costs.

-- Partial index: activo=true filter is essentially free (index-only, no heap fetch)
CREATE INDEX IF NOT EXISTS idx_pp_activo_product_vineta_costo
    ON public.product_precios (product_id, vineta, costo)
    WHERE activo = true;

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
WITH pres AS (
    SELECT
        sii.erp_product_id,
        MAX(sii.descripcion) AS descripcion,
        sii.presentacion,
        SUM(sii.cantidad::numeric) AS cantidad,
        SUM(CASE WHEN si.tipo_documento = 'CCF'
                 THEN sii.total_linea::numeric
                 ELSE sii.total_linea::numeric / 1.13
            END) AS neto,
        SUM(CASE WHEN si.tipo_documento = 'CCF'
                 THEN sii.total_linea::numeric
                 ELSE sii.total_linea::numeric / 1.13
            END) / NULLIF(SUM(sii.cantidad::numeric), 0) AS precio_unitario_avg
    FROM public.sales_invoice_items sii
    JOIN public.sales_invoices si ON si.id = sii.invoice_id
    WHERE sii.erp_product_id IS NOT NULL
      AND sii.erp_product_id != 0
      AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
      AND si.fecha BETWEEN p_fini AND p_ffin
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
    GROUP BY sii.erp_product_id, sii.presentacion
),
-- Single bulk scan of product_precios (replaces ~5,928 correlated subqueries)
all_costs AS (
    SELECT product_id, costo, vineta,
           (vineta = 0 OR costo <= vineta) AS is_primary
    FROM public.product_precios
    WHERE activo = true
      AND product_id IN (SELECT erp_product_id FROM pres)
),
-- Rank costs per (product, presentation): primary match first, then closest avg price
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
