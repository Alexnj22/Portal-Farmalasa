-- Corrige (auditoría 2026-08-03 de /ventas?tab=productos):
--   1. Costo: usar el costo de la PRESENTACIÓN vendida (mismo match por nombre
--      que ya resolvía el factor), con best_cost de fallback. La versión
--      anterior aplicaba MIN(costo) del producto (= costo de la unidad) a
--      ventas de cajas: julio 2026 mostraba $16,509.75 menos de costo
--      (margen 32.9% en pantalla vs 25.2% real, 438 líneas afectadas).
--   2. pres_partial: bordes parciales como rangos de fecha explícitos. La
--      versión anterior escaneaba TODO el rango de facturas y descartaba cada
--      fila con to_char() cuando el rango eran meses completos (el caso normal
--      del picker): 2,567ms para julio, de los cuales ~2,000ms eran ese
--      escaneo muerto. Medido después: 427ms.
--   3. ultima_venta: restringida a los productos candidatos en vez de agrupar
--      las 137k filas del agregado completo en cada llamada.
--   4. get_product_sales_total: deriva del agregado mensual + bordes en vivo
--      (14ms medidos) en vez de re-ejecutar todo get_product_sales_agg
--      (~850-915ms por visita al tab, medido en pg_stat_statements).
--   5. Nueva get_product_drill_summary: totales EXACTOS del drill-down para el
--      pie de tabla y el gráfico por sucursal — get_product_drill_lines corta
--      en 300 líneas y el frontend sumaba solo esas (8 productos de julio no
--      cuadraban contra su fila de resumen; ej. producto 3856: $882.25
--      truncado vs $1,968.25 real).
--
-- Equivalencia verificada ANTES de aplicar (funciones pg_temp vs las vivas,
-- 10 rangos incl. bordes parciales, mes en curso, sucursal y búsqueda):
-- cantidad/neto/ultima_venta/presentaciones idénticos en TODAS las filas;
-- el total del período, idéntico a 20 decimales en 7 rangos.

SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1+2+3) get_product_sales_agg
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_product_sales_agg(p_fini date, p_ffin date, p_branch_id integer DEFAULT NULL::integer, p_search text DEFAULT NULL::text)
 RETURNS TABLE(erp_product_id integer, descripcion text, cantidad numeric, neto numeric, costo_total numeric, presentaciones jsonb, ultima_venta date, ultima_venta_por_suc jsonb, laboratorio_id integer, laboratorio_nombre text, oculto_en_ventas boolean, oculto_por_first_names text, oculto_por_last_names text, oculto_at timestamp with time zone)
 LANGUAGE sql
 STABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
WITH
branch_to_erp(bid, esid) AS (
  VALUES (4::integer,1),(25::integer,2),(27::integer,3),
         (28::integer,4),(2::integer,5),(29::integer,7)
),
branch_esid AS (
  SELECT esid FROM branch_to_erp WHERE bid = p_branch_id
),

bounds AS (
  SELECT
    date_trunc('month', CURRENT_DATE)::date AS curr_month,
    LEAST(p_ffin, date_trunc('month', CURRENT_DATE)::date - 1) AS past_to
),
-- Ventana de meses COMPLETOS (va al agregado mensual) + borde parcial
-- IZQUIERDO como rango de fechas. Un rango degenerado (from > to o NULL)
-- no devuelve filas — así los meses completos no se escanean en vivo.
bounds2 AS (
  SELECT curr_month, past_to,
    CASE WHEN p_fini = date_trunc('month', p_fini)::date
         THEN to_char(p_fini, 'YYYY-MM')
         ELSE to_char((date_trunc('month', p_fini) + interval '1 month')::date, 'YYYY-MM') END AS ym_full_from,
    CASE WHEN past_to = (date_trunc('month', past_to) + interval '1 month' - interval '1 day')::date
         THEN to_char(past_to, 'YYYY-MM')
         ELSE to_char((date_trunc('month', past_to) - interval '1 month')::date, 'YYYY-MM') END AS ym_full_to,
    CASE WHEN p_fini < curr_month AND p_fini <> date_trunc('month', p_fini)::date
         THEN p_fini END AS pl_from,
    CASE WHEN p_fini < curr_month AND p_fini <> date_trunc('month', p_fini)::date
         THEN LEAST(past_to, (date_trunc('month', p_fini) + interval '1 month' - interval '1 day')::date) END AS pl_to
  FROM bounds
),
-- Borde parcial DERECHO. GREATEST con pl_to+1 evita contar dos veces cuando
-- ambos bordes caen en el mismo mes; con p_fini cubre el caso p_fini=inicio
-- de mes con past_to a medio mismo mes (ahí el borde izquierdo no existe).
bounds3 AS (
  SELECT b.*,
    CASE WHEN p_fini < b.curr_month
              AND b.past_to <> (date_trunc('month', b.past_to) + interval '1 month' - interval '1 day')::date
         THEN GREATEST(date_trunc('month', b.past_to)::date, p_fini, COALESCE(b.pl_to + 1, p_fini)) END AS pr_from,
    CASE WHEN p_fini < b.curr_month
              AND b.past_to <> (date_trunc('month', b.past_to) + interval '1 month' - interval '1 day')::date
         THEN b.past_to END AS pr_to
  FROM bounds2 b
),

pres_partial AS (
  SELECT
    s.erp_product_id,
    MAX(s.descripcion) AS descripcion,
    s.presentacion,
    SUM(s.cantidad)    AS cantidad,
    SUM(s.neto)        AS neto
  FROM (
    SELECT
      sii.erp_product_id, sii.descripcion, sii.presentacion,
      sii.cantidad::numeric AS cantidad,
      CASE WHEN si.tipo_documento = 'CCF'
           THEN sii.total_linea::numeric
           ELSE sii.total_linea::numeric / 1.13
      END AS neto
    FROM public.sales_invoice_items sii
    JOIN public.sales_invoices si ON si.id = sii.invoice_id
    CROSS JOIN bounds3 b
    WHERE si.fecha BETWEEN b.pl_from AND b.pl_to
      AND sii.erp_product_id IS NOT NULL
      AND sii.erp_product_id != 0
      AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
      AND (p_search IS NULL OR p_search = '' OR public.norm_search(sii.descripcion) LIKE ALL (
            ARRAY(SELECT '%'||tok||'%' FROM unnest(string_to_array(public.norm_search(p_search), ' ')) tok WHERE tok <> '')
          ))
    UNION ALL
    SELECT
      sii.erp_product_id, sii.descripcion, sii.presentacion,
      sii.cantidad::numeric AS cantidad,
      CASE WHEN si.tipo_documento = 'CCF'
           THEN sii.total_linea::numeric
           ELSE sii.total_linea::numeric / 1.13
      END AS neto
    FROM public.sales_invoice_items sii
    JOIN public.sales_invoices si ON si.id = sii.invoice_id
    CROSS JOIN bounds3 b
    WHERE si.fecha BETWEEN b.pr_from AND b.pr_to
      AND sii.erp_product_id IS NOT NULL
      AND sii.erp_product_id != 0
      AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
      AND (p_search IS NULL OR p_search = '' OR public.norm_search(sii.descripcion) LIKE ALL (
            ARRAY(SELECT '%'||tok||'%' FROM unnest(string_to_array(public.norm_search(p_search), ' ')) tok WHERE tok <> '')
          ))
  ) s
  GROUP BY s.erp_product_id, s.presentacion
),

pres_past AS (
  SELECT
    a.erp_product_id,
    MAX(a.descripcion) AS descripcion,
    a.presentacion,
    SUM(a.cantidad)    AS cantidad,
    SUM(a.neto)        AS neto
  FROM public.product_sales_monthly_agg a
  CROSS JOIN bounds3 b
  WHERE p_fini < b.curr_month
    AND a.year_month >= b.ym_full_from
    AND a.year_month <= b.ym_full_to
    AND a.year_month <  to_char(b.curr_month, 'YYYY-MM')
    AND (p_branch_id IS NULL OR a.branch_id = p_branch_id)
    AND (p_search IS NULL OR p_search = '' OR public.norm_search(a.descripcion) LIKE ALL (
          ARRAY(SELECT '%'||tok||'%' FROM unnest(string_to_array(public.norm_search(p_search), ' ')) tok WHERE tok <> '')
        ))
  GROUP BY a.erp_product_id, a.presentacion
),

pres_live AS (
  SELECT
    sii.erp_product_id,
    MAX(sii.descripcion)       AS descripcion,
    sii.presentacion,
    SUM(sii.cantidad::numeric) AS cantidad,
    SUM(CASE WHEN si.tipo_documento = 'CCF'
             THEN sii.total_linea::numeric
             ELSE sii.total_linea::numeric / 1.13
        END)                   AS neto
  FROM public.sales_invoice_items sii
  JOIN public.sales_invoices si ON si.id = sii.invoice_id
  WHERE sii.erp_product_id IS NOT NULL
    AND sii.erp_product_id != 0
    AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    AND si.fecha BETWEEN GREATEST(p_fini, date_trunc('month', CURRENT_DATE)::date) AND p_ffin
    AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
    AND (p_search IS NULL OR p_search = '' OR public.norm_search(sii.descripcion) LIKE ALL (
          ARRAY(SELECT '%'||tok||'%' FROM unnest(string_to_array(public.norm_search(p_search), ' ')) tok WHERE tok <> '')
        ))
  GROUP BY sii.erp_product_id, sii.presentacion
),

-- El match por nombre presentación→product_precios resuelve factor Y costo de
-- la MISMA fila. El factor conserva su semántica aunque el costo de esa fila
-- esté sucio (costo > viñeta): la sanidad del costo se decide afuera.
pres AS (
  SELECT
    u2.erp_product_id,
    u2.descripcion,
    u2.presentacion,
    u2.cantidad,
    u2.neto,
    u2.precio_unitario_avg,
    COALESCE(m.factor, 1) AS factor,
    CASE WHEN m.costo IS NOT NULL AND (m.vineta = 0 OR m.costo <= m.vineta)
         THEN m.costo END AS costo_pres
  FROM (
    SELECT
      erp_product_id,
      MAX(descripcion) AS descripcion,
      presentacion,
      SUM(cantidad)    AS cantidad,
      SUM(neto)        AS neto,
      SUM(neto) / NULLIF(SUM(cantidad), 0) AS precio_unitario_avg
    FROM (
      SELECT erp_product_id, descripcion, presentacion, cantidad, neto FROM pres_partial
      UNION ALL
      SELECT erp_product_id, descripcion, presentacion, cantidad, neto FROM pres_past
      UNION ALL
      SELECT erp_product_id, descripcion, presentacion, cantidad, neto FROM pres_live
    ) u
    GROUP BY erp_product_id, presentacion
  ) u2
  LEFT JOIN LATERAL (
    SELECT pp.factor, pp.costo, pp.vineta
    FROM public.product_precios pp
    JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
    WHERE pp.product_id = u2.erp_product_id
      AND pp.activo = true
      AND UPPER(u2.presentacion) LIKE UPPER(pr.tipo) || ' %'
    ORDER BY length(pr.tipo) DESC
    LIMIT 1
  ) m ON true
),

best_cost AS (
  SELECT
    product_id,
    COALESCE(
      MIN(costo) FILTER (WHERE vineta = 0 OR costo <= vineta),
      MIN(costo)
    ) AS costo
  FROM public.product_precios
  WHERE activo = true AND product_id IN (SELECT pres.erp_product_id FROM pres)
  GROUP BY product_id
),

prod_with_sales AS (
  SELECT
    p.erp_product_id,
    MAX(p.descripcion)  AS descripcion,
    SUM(p.cantidad)     AS cantidad,
    SUM(p.neto)         AS neto,
    -- Costo por la presentación VENDIDA; best_cost (mínimo sano del producto)
    -- solo de fallback cuando el nombre no matchea o la fila está sucia.
    CASE WHEN COUNT(COALESCE(p.costo_pres, bc.costo)) = 0 THEN NULL
         ELSE ROUND(SUM(COALESCE(p.costo_pres, bc.costo) * p.cantidad), 2) END AS costo_total,
    jsonb_agg(jsonb_build_object(
      'presentacion',        p.presentacion,
      'cantidad',            p.cantidad,
      'neto',                p.neto,
      'precio_unitario_avg', p.precio_unitario_avg,
      'factor',              COALESCE(p.factor, 1)
    )) AS presentaciones
  FROM pres p
  LEFT JOIN best_cost bc ON bc.product_id = p.erp_product_id
  GROUP BY p.erp_product_id
),

zero_sale_cands AS (
  SELECT pr.id AS erp_product_id, pr.nombre AS descripcion
  FROM public.products pr
  CROSS JOIN branch_esid be
  WHERE pr.activo = true
    AND (p_search IS NULL OR p_search = '' OR public.norm_search(pr.nombre) LIKE ALL (
          ARRAY(SELECT '%'||tok||'%' FROM unnest(string_to_array(public.norm_search(p_search), ' ')) tok WHERE tok <> '')
        ))
    AND NOT EXISTS (SELECT 1 FROM prod_with_sales pws WHERE pws.erp_product_id = pr.id)
    AND (
      EXISTS (
        SELECT 1 FROM public.product_stock_params psp
        WHERE psp.erp_product_id = pr.id AND psp.erp_sucursal_id = be.esid
          AND COALESCE(psp.manual_max, psp.max_units, 0) > 0
      )
      OR EXISTS (
        SELECT 1 FROM public.inventory inv
        WHERE inv.erp_product_id = pr.id AND inv.erp_sucursal_id = be.esid
          AND inv.is_vencidos = false AND inv.cantidad > 0
      )
    )
),

all_cands AS (
  SELECT pws.erp_product_id, pws.descripcion FROM prod_with_sales pws
  UNION ALL
  SELECT z.erp_product_id, z.descripcion FROM zero_sale_cands z
),

-- Restringido a los candidatos: la versión anterior agrupaba las 137k filas
-- del agregado completo (~460ms) para luego tirar el 80% en el join final.
last_sale_hist AS (
  SELECT
    a.erp_product_id AS prod_id, a.branch_id,
    ((MAX(a.year_month) || '-01')::date + INTERVAL '1 month' - INTERVAL '1 day')::date AS last_date
  FROM public.product_sales_monthly_agg a
  WHERE a.erp_product_id IN (SELECT ac.erp_product_id FROM all_cands ac)
  GROUP BY a.erp_product_id, a.branch_id
),

last_sale_live AS (
  SELECT sii.erp_product_id AS prod_id, si.branch_id, MAX(si.fecha) AS last_date
  FROM public.sales_invoice_items sii
  JOIN public.sales_invoices si ON si.id = sii.invoice_id
  WHERE sii.erp_product_id IS NOT NULL
    AND sii.erp_product_id IN (SELECT ac.erp_product_id FROM all_cands ac)
    AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    AND si.fecha >= date_trunc('month', CURRENT_DATE)::date
  GROUP BY sii.erp_product_id, si.branch_id
),

ultima_venta_agg AS MATERIALIZED (
  SELECT
    pb.prod_id,
    MAX(pb.last_date)                                             AS ultima_venta_global,
    MAX(pb.last_date) FILTER (WHERE pb.branch_id = p_branch_id)  AS ultima_venta_branch,
    COALESCE(
      jsonb_agg(
        jsonb_build_object('branch_id', pb.branch_id, 'fecha', pb.last_date)
        ORDER BY pb.last_date DESC NULLS LAST
      ) FILTER (WHERE pb.last_date IS NOT NULL),
      '[]'::jsonb
    ) AS ultima_venta_por_suc
  FROM (
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

SELECT
  ac.erp_product_id,
  COALESCE(pws.descripcion, ac.descripcion)::text AS descripcion,
  COALESCE(pws.cantidad,    0::numeric)           AS cantidad,
  COALESCE(pws.neto,        0::numeric)           AS neto,
  pws.costo_total,
  COALESCE(pws.presentaciones, '[]'::jsonb)       AS presentaciones,
  CASE WHEN p_branch_id IS NULL
       THEN uva.ultima_venta_global
       ELSE uva.ultima_venta_branch
  END                                              AS ultima_venta,
  COALESCE(uva.ultima_venta_por_suc, '[]'::jsonb) AS ultima_venta_por_suc,
  p2.laboratorio_id,
  l2.nombre AS laboratorio_nombre,
  COALESCE(p2.oculto_en_ventas, false) AS oculto_en_ventas,
  emp.first_names AS oculto_por_first_names,
  emp.last_names  AS oculto_por_last_names,
  p2.oculto_at
FROM all_cands ac
LEFT JOIN prod_with_sales pws ON pws.erp_product_id = ac.erp_product_id
LEFT JOIN ultima_venta_agg uva ON uva.prod_id       = ac.erp_product_id
LEFT JOIN public.products p2 ON p2.id = ac.erp_product_id
LEFT JOIN public.laboratorios l2 ON l2.id = p2.laboratorio_id
LEFT JOIN public.employees emp ON emp.id = p2.oculto_por
ORDER BY
  (pws.erp_product_id IS NULL) ASC,
  COALESCE(pws.neto, 0)        DESC,
  CASE WHEN p_branch_id IS NULL
       THEN uva.ultima_venta_global
       ELSE uva.ultima_venta_branch
  END DESC NULLS LAST;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) get_product_sales_total — mismo número, sin re-ejecutar el agregado
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_product_sales_total(p_fini date, p_ffin date, p_branch_id integer DEFAULT NULL::integer)
 RETURNS numeric
 LANGUAGE sql
 STABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
WITH
bounds AS (
  SELECT
    date_trunc('month', CURRENT_DATE)::date AS curr_month,
    LEAST(p_ffin, date_trunc('month', CURRENT_DATE)::date - 1) AS past_to
),
bounds2 AS (
  SELECT curr_month, past_to,
    CASE WHEN p_fini = date_trunc('month', p_fini)::date
         THEN to_char(p_fini, 'YYYY-MM')
         ELSE to_char((date_trunc('month', p_fini) + interval '1 month')::date, 'YYYY-MM') END AS ym_full_from,
    CASE WHEN past_to = (date_trunc('month', past_to) + interval '1 month' - interval '1 day')::date
         THEN to_char(past_to, 'YYYY-MM')
         ELSE to_char((date_trunc('month', past_to) - interval '1 month')::date, 'YYYY-MM') END AS ym_full_to,
    CASE WHEN p_fini < curr_month AND p_fini <> date_trunc('month', p_fini)::date
         THEN p_fini END AS pl_from,
    CASE WHEN p_fini < curr_month AND p_fini <> date_trunc('month', p_fini)::date
         THEN LEAST(past_to, (date_trunc('month', p_fini) + interval '1 month' - interval '1 day')::date) END AS pl_to
  FROM bounds
),
bounds3 AS (
  SELECT b.*,
    CASE WHEN p_fini < b.curr_month
              AND b.past_to <> (date_trunc('month', b.past_to) + interval '1 month' - interval '1 day')::date
         THEN GREATEST(date_trunc('month', b.past_to)::date, p_fini, COALESCE(b.pl_to + 1, p_fini)) END AS pr_from,
    CASE WHEN p_fini < b.curr_month
              AND b.past_to <> (date_trunc('month', b.past_to) + interval '1 month' - interval '1 day')::date
         THEN b.past_to END AS pr_to
  FROM bounds2 b
),
src AS (
  -- meses completos, del agregado mensual (== ventas en vivo, verificado al centavo)
  SELECT a.erp_product_id, a.neto
  FROM public.product_sales_monthly_agg a
  CROSS JOIN bounds3 b
  WHERE p_fini < b.curr_month
    AND a.year_month >= b.ym_full_from
    AND a.year_month <= b.ym_full_to
    AND a.year_month <  to_char(b.curr_month, 'YYYY-MM')
    AND (p_branch_id IS NULL OR a.branch_id = p_branch_id)
  UNION ALL
  -- borde parcial izquierdo
  SELECT sii.erp_product_id,
         CASE WHEN si.tipo_documento = 'CCF' THEN sii.total_linea::numeric ELSE sii.total_linea::numeric / 1.13 END
  FROM public.sales_invoice_items sii
  JOIN public.sales_invoices si ON si.id = sii.invoice_id
  CROSS JOIN bounds3 b
  WHERE si.fecha BETWEEN b.pl_from AND b.pl_to
    AND sii.erp_product_id IS NOT NULL AND sii.erp_product_id != 0
    AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
  UNION ALL
  -- borde parcial derecho
  SELECT sii.erp_product_id,
         CASE WHEN si.tipo_documento = 'CCF' THEN sii.total_linea::numeric ELSE sii.total_linea::numeric / 1.13 END
  FROM public.sales_invoice_items sii
  JOIN public.sales_invoices si ON si.id = sii.invoice_id
  CROSS JOIN bounds3 b
  WHERE si.fecha BETWEEN b.pr_from AND b.pr_to
    AND sii.erp_product_id IS NOT NULL AND sii.erp_product_id != 0
    AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
  UNION ALL
  -- mes en curso, en vivo
  SELECT sii.erp_product_id,
         CASE WHEN si.tipo_documento = 'CCF' THEN sii.total_linea::numeric ELSE sii.total_linea::numeric / 1.13 END
  FROM public.sales_invoice_items sii
  JOIN public.sales_invoices si ON si.id = sii.invoice_id
  WHERE si.fecha BETWEEN GREATEST(p_fini, date_trunc('month', CURRENT_DATE)::date) AND p_ffin
    AND sii.erp_product_id IS NOT NULL AND sii.erp_product_id != 0
    AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
)
SELECT COALESCE(SUM(s.neto), 0)
FROM src s
LEFT JOIN public.products p ON p.id = s.erp_product_id
WHERE NOT COALESCE(p.oculto_en_ventas, false);
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) get_product_drill_summary — totales exactos del período para el drill-down
-- ─────────────────────────────────────────────────────────────────────────────
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
-- factor por presentación: mismo heurístico que get_product_sales_agg
fac AS (
  SELECT d.presentacion,
    COALESCE((
      SELECT pp.factor
      FROM public.product_precios pp
      JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
      WHERE pp.product_id = p_erp_product_id
        AND pp.activo = true
        AND UPPER(d.presentacion) LIKE UPPER(pr.tipo) || ' %'
      ORDER BY length(pr.tipo) DESC
      LIMIT 1
    ), 1) AS factor
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

REVOKE EXECUTE ON FUNCTION public.get_product_drill_summary(integer, date, date, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_product_drill_summary(integer, date, date, integer) TO authenticated, service_role;
