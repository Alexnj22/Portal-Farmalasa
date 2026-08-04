-- El factor 0 existe en product_precios (ej. RECARGA SALDO TIGO, id 3856, cuya
-- presentación UNIDAD 1X1 tiene factor=0) y el frontend siempre lo coerció a 1
-- con `p.factor || 1` en JS. get_product_drill_summary (recién creada en
-- 20260804004950) multiplicaba por el 0 literal: el drill mostraba
-- "0 unidades" en el resumen y en el reparto por sucursal. NULLIF lo alinea
-- con la semántica del cliente: factor 0 o NULL = 1.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_product_drill_summary(p_erp_product_id integer, p_fini date, p_ffin date, p_branch_id integer DEFAULT NULL::integer)
 RETURNS json
 LANGUAGE sql
 STABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
WITH lines AS (
  SELECT si.branch_id, sii.presentacion,
         sii.cantidad::numeric   AS cantidad,
         sii.total_linea::numeric AS total_linea,
         CASE WHEN si.tipo_documento = 'CCF'
              THEN sii.total_linea::numeric
              ELSE sii.total_linea::numeric / 1.13
         END AS neto
  FROM public.sales_invoice_items sii
  JOIN public.sales_invoices si ON si.id = sii.invoice_id
  WHERE sii.erp_product_id = p_erp_product_id
    AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    AND si.fecha BETWEEN p_fini AND p_ffin
    AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
),
-- factor por presentación: mismo heurístico que get_product_sales_agg, y
-- factor 0 = 1 (igual que el `|| 1` del cliente)
fac AS (
  SELECT d.presentacion,
    COALESCE(NULLIF((
      SELECT pp.factor
      FROM public.product_precios pp
      JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
      WHERE pp.product_id = p_erp_product_id
        AND pp.activo = true
        AND UPPER(d.presentacion) LIKE UPPER(pr.tipo) || ' %'
      ORDER BY length(pr.tipo) DESC
      LIMIT 1
    ), 0), 1) AS factor
  FROM (SELECT DISTINCT presentacion FROM lines) d
),
por_suc AS (
  SELECT l.branch_id,
         SUM(l.cantidad * f.factor) AS cantidad_base,
         SUM(l.neto)                AS neto
  FROM lines l
  JOIN fac f ON f.presentacion IS NOT DISTINCT FROM l.presentacion
  GROUP BY l.branch_id
)
SELECT json_build_object(
  'total_count',         (SELECT count(*) FROM lines),
  'total_cantidad_base', COALESCE((SELECT SUM(cantidad_base) FROM por_suc), 0),
  'total_display',       COALESCE((SELECT SUM(total_linea) FROM lines), 0),
  'por_sucursal',        COALESCE((SELECT json_agg(json_build_object(
                             'branch_id', ps.branch_id,
                             'cantidad_base', ps.cantidad_base,
                             'neto', ps.neto
                           ) ORDER BY ps.neto DESC) FROM por_suc ps), '[]'::json)
);
$function$;
