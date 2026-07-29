-- get_product_sales_agg: soporte de mes inicial parcial
--
-- Antes: el mes de inicio siempre se leía de product_sales_monthly_agg usando
--   year_month >= to_char(p_fini, 'YYYY-MM')
-- lo que incluía el mes completo aunque p_fini fuera, p.ej., 2025-12-07.
-- Resultado: 27 ventas de dic (desde el 7) en MinMax vs 29 en Ventas (mes completo).
--
-- Ahora:
--   • Si p_fini cae el primer día del mes → comportamiento idéntico al anterior.
--   • Si p_fini NO es el primer día → se agrega un CTE pres_start_partial que lee
--     sales_invoice_items solo para ese mes parcial (igual que ya hace pres_live
--     para el mes actual). Los meses completos intermedios siguen en monthly_agg.
--
-- Impacto de rendimiento: equivalente a añadir un pres_live más; los meses
-- completos siguen usando la tabla pre-agregada.

CREATE OR REPLACE FUNCTION public.get_product_sales_agg(
    p_fini      date,
    p_ffin      date,
    p_branch_id integer DEFAULT NULL::integer,
    p_search    text    DEFAULT NULL::text
)
RETURNS TABLE(
    erp_product_id      integer,
    descripcion         text,
    cantidad            numeric,
    neto                numeric,
    costo_total         numeric,
    presentaciones      jsonb,
    ultima_venta        date,
    ultima_venta_por_suc jsonb
)
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

-- ── Mes parcial de inicio (solo cuando p_fini NO es el día 1) ───────────────
-- Lee invoice_items en crudo para el tramo p_fini … fin del mes de inicio.
-- Cuando p_fini sí es el día 1 la condición del WHERE nunca es verdadera → 0 filas.
pres_start_partial AS (
  SELECT
    sii.erp_product_id,
    MAX(sii.descripcion)          AS descripcion,
    sii.presentacion,
    SUM(sii.cantidad::numeric)    AS cantidad,
    SUM(CASE WHEN si.tipo_documento = 'CCF'
             THEN sii.total_linea::numeric
             ELSE sii.total_linea::numeric / 1.13
        END)                      AS neto
  FROM public.sales_invoice_items sii
  JOIN public.sales_invoices si ON si.id = sii.invoice_id
  WHERE sii.erp_product_id IS NOT NULL
    AND sii.erp_product_id != 0
    AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    -- solo el mes parcial inicial, y solo si p_fini no es el primer día
    AND p_fini > date_trunc('month', p_fini)::date
    -- solo si el mes de inicio no es el mes actual (pres_live lo cubre)
    AND p_fini < date_trunc('month', CURRENT_DATE)::date
    AND si.fecha BETWEEN p_fini
                     AND (date_trunc('month', p_fini) + interval '1 month' - interval '1 day')::date
    AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
    AND (p_search    IS NULL OR sii.descripcion ILIKE '%' || p_search || '%')
  GROUP BY sii.erp_product_id, sii.presentacion
),

-- ── Meses completos históricos (monthly_agg) ─────────────────────────────────
-- Si p_fini es el día 1: incluye el mes de inicio desde agg (igual que antes).
-- Si p_fini no es el día 1: salta el mes de inicio (ya cubierto por pres_start_partial).
pres_past AS (
  SELECT
    a.erp_product_id,
    MAX(a.descripcion)  AS descripcion,
    a.presentacion,
    SUM(a.cantidad)     AS cantidad,
    SUM(a.neto)         AS neto
  FROM public.product_sales_monthly_agg a
  WHERE a.year_month >= CASE
      WHEN p_fini = date_trunc('month', p_fini)::date
        -- inicio exacto en día 1 → incluir desde ese mes
        THEN to_char(p_fini, 'YYYY-MM')
      ELSE
        -- inicio en día > 1 → saltar ese mes (cubierto por pres_start_partial)
        to_char((date_trunc('month', p_fini) + interval '1 month')::date, 'YYYY-MM')
    END
    AND a.year_month <  to_char(date_trunc('month', CURRENT_DATE)::date, 'YYYY-MM')
    AND p_fini        <  date_trunc('month', CURRENT_DATE)::date
    AND (p_branch_id IS NULL OR a.branch_id = p_branch_id)
    AND (p_search    IS NULL OR a.descripcion ILIKE '%' || p_search || '%')
  GROUP BY a.erp_product_id, a.presentacion
),

-- ── Mes actual en curso (siempre desde invoice_items) ───────────────────────
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
    SUM(neto) / NULLIF(SUM(cantidad), 0) AS precio_unitario_avg,
    COALESCE(
      (
        SELECT pp.factor
        FROM public.product_precios pp
        JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
        WHERE pp.product_id = u.erp_product_id
          AND pp.activo = true
          AND UPPER(u.presentacion) LIKE UPPER(pr.tipo) || ' %'
        ORDER BY length(pr.tipo) DESC
        LIMIT 1
      ),
      1
    ) AS factor
  FROM (
    SELECT erp_product_id, descripcion, presentacion, cantidad, neto FROM pres_start_partial
    UNION ALL
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

last_sale_hist AS (
  SELECT
    a.erp_product_id AS prod_id,
    a.branch_id,
    ((MAX(a.year_month) || '-01')::date + INTERVAL '1 month' - INTERVAL '1 day')::date AS last_date
  FROM public.product_sales_monthly_agg a
  GROUP BY a.erp_product_id, a.branch_id
),

last_sale_live AS (
  SELECT sii.erp_product_id AS prod_id, si.branch_id, MAX(si.fecha) AS last_date
  FROM public.sales_invoice_items sii
  JOIN public.sales_invoices si ON si.id = sii.invoice_id
  WHERE sii.erp_product_id IS NOT NULL
    AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    AND si.fecha >= date_trunc('month', CURRENT_DATE)::date
  GROUP BY sii.erp_product_id, si.branch_id
),

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
  COALESCE(pws.descripcion, ac.descripcion)::text  AS descripcion,
  COALESCE(pws.cantidad,    0::numeric)            AS cantidad,
  COALESCE(pws.neto,        0::numeric)            AS neto,
  pws.costo_total,
  COALESCE(pws.presentaciones, '[]'::jsonb)        AS presentaciones,
  CASE WHEN p_branch_id IS NULL
       THEN uva.ultima_venta_global
       ELSE uva.ultima_venta_branch
  END                                               AS ultima_venta,
  COALESCE(uva.ultima_venta_por_suc, '[]'::jsonb) AS ultima_venta_por_suc
FROM all_cands ac
LEFT JOIN prod_with_sales pws ON pws.erp_product_id = ac.erp_product_id
LEFT JOIN ultima_venta_agg uva ON uva.prod_id        = ac.erp_product_id
ORDER BY
  (pws.erp_product_id IS NULL) ASC,
  COALESCE(pws.neto, 0)        DESC,
  CASE WHEN p_branch_id IS NULL
       THEN uva.ultima_venta_global
       ELSE uva.ultima_venta_branch
  END DESC NULLS LAST;
$function$;
