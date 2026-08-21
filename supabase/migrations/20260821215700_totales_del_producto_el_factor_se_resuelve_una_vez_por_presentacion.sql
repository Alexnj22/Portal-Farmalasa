-- El factor de cada presentación se estaba resolviendo UNA VEZ POR RENGLÓN.
--
-- `fac` existe justamente para calcularlo una sola vez por presentación
-- distinta —son 4 en ACETAMINOFEN contra 396 renglones—, pero como CTE simple
-- el planificador la aplana y empuja la subconsulta correlacionada adentro del
-- cruce: 396 ejecuciones, 7,131 páginas, y el `Memoize` que debía salvarlo con
-- **0 aciertos y 1,580 desalojos** (la clave de caché es la presentación de
-- product_precios, que cambia en cada vuelta, así que nunca acierta).
-- Marcándola MATERIALIZED se ejecuta 4 veces: 7,131 → 75 páginas.
--
-- Lo mismo con `lines`, que la referencian cuatro veces (el conteo, el total,
-- las presentaciones distintas y el cruce con el factor) y se recalculaba.
--
-- Medido sobre el producto de más movimiento (ACETAMINOFEN, 8,604 renglones de
-- historia, 396 en el mes): 25,746 → 11,365 páginas. Es deuda vieja: la misma
-- forma estaba en la versión anterior de esta función.
--
-- El resultado es idéntico — las CTE materializadas no cambian qué se calcula,
-- sólo cuántas veces.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_product_drill_summary(p_erp_product_id integer, p_fini date, p_ffin date, p_branch_id integer DEFAULT NULL::integer)
 RETURNS json
 LANGUAGE sql
 STABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
WITH inv AS MATERIALIZED (
  SELECT si.id, si.branch_id, si.cod_vendedor, si.tipo_documento
  FROM public.sales_invoices si
  WHERE si.fecha BETWEEN p_fini AND p_ffin
    AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
),
lines AS MATERIALIZED (
  SELECT inv.branch_id, inv.cod_vendedor, sii.presentacion,
         sii.cantidad::numeric    AS cantidad,
         sii.total_linea::numeric AS total_linea,
         CASE WHEN inv.tipo_documento = 'CCF'
              THEN sii.total_linea::numeric
              ELSE sii.total_linea::numeric / 1.13
         END AS neto
  FROM inv
  JOIN public.sales_invoice_items sii ON sii.invoice_id = inv.id
  WHERE sii.erp_product_id = p_erp_product_id
),
-- factor por presentación: mismo heurístico que get_product_sales_agg, y
-- factor 0 = 1 (igual que el `|| 1` del cliente).
-- MATERIALIZED: sin eso se resuelve una vez por renglón, no por presentación.
fac AS MATERIALIZED (
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
con_factor AS MATERIALIZED (
  SELECT l.branch_id, l.cod_vendedor, l.cantidad * f.factor AS cantidad_base, l.neto, l.total_linea
  FROM lines l
  JOIN fac f ON f.presentacion IS NOT DISTINCT FROM l.presentacion
),
por_suc AS (
  SELECT branch_id, SUM(cantidad_base) AS cantidad_base, SUM(neto) AS neto
  FROM con_factor GROUP BY branch_id
),
por_vend AS (
  SELECT cod_vendedor, SUM(cantidad_base) AS cantidad_base, SUM(neto) AS neto, count(*) AS ventas
  FROM con_factor GROUP BY cod_vendedor
)
SELECT json_build_object(
  'total_count',         (SELECT count(*) FROM lines),
  'total_cantidad_base', COALESCE((SELECT SUM(cantidad_base) FROM por_suc), 0),
  'total_display',       COALESCE((SELECT SUM(total_linea) FROM lines), 0),
  'por_sucursal',        COALESCE((SELECT json_agg(json_build_object(
                             'branch_id',     ps.branch_id,
                             'cantidad_base', ps.cantidad_base,
                             'neto',          ps.neto
                           ) ORDER BY ps.neto DESC, ps.branch_id) FROM por_suc ps), '[]'::json),
  'por_vendedor',        COALESCE((SELECT json_agg(json_build_object(
                             'cod_vendedor',  pv.cod_vendedor,
                             'cantidad_base', pv.cantidad_base,
                             'neto',          pv.neto,
                             'ventas',        pv.ventas
                           ) ORDER BY pv.neto DESC, pv.cod_vendedor) FROM por_vend pv), '[]'::json)
);
$function$
;
