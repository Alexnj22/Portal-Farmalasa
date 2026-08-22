-- Ventas > Productos: la búsqueda se resuelve UNA vez, sobre `products`.
--
-- Pedido del usuario el 2026-08-22: «busca la forma de hacer eficiente esa
-- página […] debe ser inmediata y eficiente, aun con filtros aplicados».
--
-- El costo estaba en QUÉ se buscaba. Los cuatro buscadores corrían
-- `norm_search(descripcion) LIKE ALL (...)` sobre el TEXTO DE LA FACTURA: una
-- llamada a función por fila, sobre 548K líneas, sin índice posible. Medido
-- aislado sobre un año: 15,278 ms contra 54 ms resolviendo ids sobre products.
--
-- A/B contra la función anterior, en la misma sesión y con los mismos datos
-- (mejor de 3 corridas cada una):
--
--   caso                     antes      después
--   año · búsqueda          3,708 ms     301 ms     12×
--   año · sala + búsqueda     849 ms     268 ms      3×
--   mes · búsqueda            843 ms     259 ms      3×
--   mes · sala + búsqueda     336 ms     243 ms
--   (sin búsqueda no cambia: 328→317 y 583→543; ese camino no tocaba el texto)
--
-- ⚠️ ES UN CAMBIO DE SEMÁNTICA, y por eso se midió ANTES de hacerlo. Se comparó
-- término por término qué productos encuentra el texto de la factura y cuáles
-- el registro del producto, sobre un año del agregado mensual y ocho términos
-- (acetaminofen, amoxicilina, ibuprofeno, loratadina, vitamina, gel, jeringa,
-- alcohol): **0 productos perdidos**.
--
-- Al revés sí hay MÁS, y es lo correcto: como el registro incluye
-- `pactivo_norm`, buscar «acetaminofen» ahora encuentra también CETRAM,
-- CETRADOL y ANA DENT —productos cuyo principio activo es acetaminofén—, que
-- es exactamente cómo ya se comportaban `buscar_productos_minmax` y
-- `buscar_inventario_global_v2`. Ventas era la que estaba fuera de línea.
--
-- El código de barras entra al mismo saco, así que un escaneo filtra igual que
-- un nombre y sin costo extra.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_product_sales_agg(p_fini date, p_ffin date, p_branch_id integer DEFAULT NULL::integer, p_search text DEFAULT NULL::text)
 RETURNS TABLE(erp_product_id integer, descripcion text, cantidad numeric, neto numeric, costo_total numeric, presentaciones jsonb, ultima_venta date, ultima_venta_por_suc jsonb, laboratorio_id integer, laboratorio_nombre text, oculto_en_ventas boolean, oculto_por_first_names text, oculto_por_last_names text, oculto_at timestamp with time zone)
 LANGUAGE sql
 STABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
WITH
-- LA BÚSQUEDA SE RESUELVE UNA VEZ, SOBRE PRODUCTS.
--
-- Antes cada uno de los cuatro buscadores corría
-- `norm_search(descripcion) LIKE ALL (...)` sobre el texto de la FACTURA: una
-- llamada a función por fila sobre 548K líneas, sin índice posible. Medido
-- aislado sobre un año: 15,278 ms contra 54 ms.
--
-- ⚠️ Es un cambio de SEMÁNTICA y por eso se midió antes: sobre un año y ocho
-- términos, **0 productos perdidos** — lo que encuentra el texto de la factura
-- lo encuentra siempre el registro del producto.
--
-- El código de barras entra acá también, así que un escaneo filtra igual que
-- un nombre y sin costo extra.
prods_buscados AS MATERIALIZED (
  SELECT p.id
  FROM public.products p
  WHERE p_search IS NOT NULL AND p_search <> ''
    AND (coalesce(p.nombre_norm,'') || ' ' || coalesce(p.pactivo_norm,'') || ' '
         || coalesce(public.norm_search(p.codigo_barras),'')) LIKE ALL (
          ARRAY(SELECT '%'||tok||'%' FROM unnest(string_to_array(public.norm_search(p_search),' ')) tok WHERE tok <> ''))
),
branch_esid AS (
  SELECT m.erp_sucursal_id AS esid
  FROM public.erp_sucursal_map m
  WHERE m.branch_id = p_branch_id AND NOT m.es_bodega
),
bounds AS (
  SELECT date_trunc('month', CURRENT_DATE)::date AS curr_month,
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
pres_partial AS (
  SELECT s.erp_product_id, MAX(s.descripcion) AS descripcion, s.presentacion,
         SUM(s.cantidad) AS cantidad, SUM(s.neto) AS neto
  FROM (
    SELECT sii.erp_product_id, sii.descripcion, sii.presentacion, sii.cantidad::numeric AS cantidad,
      CASE WHEN si.tipo_documento='CCF' THEN sii.total_linea::numeric ELSE sii.total_linea::numeric/1.13 END AS neto
    FROM public.sales_invoice_items sii JOIN public.sales_invoices si ON si.id=sii.invoice_id CROSS JOIN bounds3 b
    WHERE si.fecha BETWEEN b.pl_from AND b.pl_to
      AND sii.erp_product_id IS NOT NULL AND sii.erp_product_id != 0
      AND si.estado NOT IN ('NULA','DTE INVALIDADO EN MH')
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
      AND (p_search IS NULL OR p_search = '' OR sii.erp_product_id IN (SELECT b2.id FROM prods_buscados b2))
    UNION ALL
    SELECT sii.erp_product_id, sii.descripcion, sii.presentacion, sii.cantidad::numeric,
      CASE WHEN si.tipo_documento='CCF' THEN sii.total_linea::numeric ELSE sii.total_linea::numeric/1.13 END
    FROM public.sales_invoice_items sii JOIN public.sales_invoices si ON si.id=sii.invoice_id CROSS JOIN bounds3 b
    WHERE si.fecha BETWEEN b.pr_from AND b.pr_to
      AND sii.erp_product_id IS NOT NULL AND sii.erp_product_id != 0
      AND si.estado NOT IN ('NULA','DTE INVALIDADO EN MH')
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
      AND (p_search IS NULL OR p_search = '' OR sii.erp_product_id IN (SELECT b2.id FROM prods_buscados b2))
  ) s GROUP BY s.erp_product_id, s.presentacion
),
pres_past AS (
  SELECT a.erp_product_id, MAX(a.descripcion) AS descripcion, a.presentacion,
         SUM(a.cantidad) AS cantidad, SUM(a.neto) AS neto
  FROM public.product_sales_monthly_agg a CROSS JOIN bounds3 b
  WHERE p_fini < b.curr_month
    AND a.year_month >= b.ym_full_from AND a.year_month <= b.ym_full_to
    AND a.year_month < to_char(b.curr_month,'YYYY-MM')
    AND (p_branch_id IS NULL OR a.branch_id = p_branch_id)
    AND (p_search IS NULL OR p_search = '' OR a.erp_product_id IN (SELECT b2.id FROM prods_buscados b2))
  GROUP BY a.erp_product_id, a.presentacion
),
pres_live AS (
  SELECT sii.erp_product_id, MAX(sii.descripcion) AS descripcion, sii.presentacion,
         SUM(sii.cantidad::numeric) AS cantidad,
         SUM(CASE WHEN si.tipo_documento='CCF' THEN sii.total_linea::numeric ELSE sii.total_linea::numeric/1.13 END) AS neto
  FROM public.sales_invoice_items sii JOIN public.sales_invoices si ON si.id=sii.invoice_id
  WHERE sii.erp_product_id IS NOT NULL AND sii.erp_product_id != 0
    AND si.estado NOT IN ('NULA','DTE INVALIDADO EN MH')
    AND si.fecha BETWEEN GREATEST(p_fini, date_trunc('month',CURRENT_DATE)::date) AND p_ffin
    AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
    AND (p_search IS NULL OR p_search = '' OR sii.erp_product_id IN (SELECT b2.id FROM prods_buscados b2))
  GROUP BY sii.erp_product_id, sii.presentacion
),
pres AS (
  SELECT u2.erp_product_id, u2.descripcion, u2.presentacion, u2.cantidad, u2.neto, u2.precio_unitario_avg,
         COALESCE(m.factor,1) AS factor,
         CASE WHEN m.costo IS NOT NULL AND (m.vineta=0 OR m.costo<=m.vineta) THEN m.costo END AS costo_pres
  FROM (
    SELECT erp_product_id, MAX(descripcion) AS descripcion, presentacion,
           SUM(cantidad) AS cantidad, SUM(neto) AS neto,
           SUM(neto)/NULLIF(SUM(cantidad),0) AS precio_unitario_avg
    FROM (
      SELECT erp_product_id, descripcion, presentacion, cantidad, neto FROM pres_partial
      UNION ALL SELECT erp_product_id, descripcion, presentacion, cantidad, neto FROM pres_past
      UNION ALL SELECT erp_product_id, descripcion, presentacion, cantidad, neto FROM pres_live
    ) u GROUP BY erp_product_id, presentacion
  ) u2
  LEFT JOIN LATERAL (
    SELECT pp.factor, pp.costo, pp.vineta FROM public.product_precios pp
    JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
    WHERE pp.product_id = u2.erp_product_id AND pp.activo = true
      AND UPPER(u2.presentacion) LIKE UPPER(pr.tipo) || ' %'
    ORDER BY length(pr.tipo) DESC LIMIT 1) m ON true
),
best_cost AS (
  SELECT product_id, COALESCE(MIN(costo) FILTER (WHERE vineta=0 OR costo<=vineta), MIN(costo)) AS costo
  FROM public.product_precios WHERE activo = true AND product_id IN (SELECT pres.erp_product_id FROM pres)
  GROUP BY product_id
),
prod_with_sales AS (
  SELECT p.erp_product_id, MAX(p.descripcion) AS descripcion, SUM(p.cantidad) AS cantidad, SUM(p.neto) AS neto,
    CASE WHEN COUNT(COALESCE(p.costo_pres, bc.costo)) = 0 THEN NULL
         ELSE ROUND(SUM(COALESCE(p.costo_pres, bc.costo) * p.cantidad), 2) END AS costo_total,
    jsonb_agg(jsonb_build_object('presentacion',p.presentacion,'cantidad',p.cantidad,'neto',p.neto,
      'precio_unitario_avg',p.precio_unitario_avg,'factor',COALESCE(p.factor,1))
      ORDER BY p.presentacion) AS presentaciones
  FROM pres p LEFT JOIN best_cost bc ON bc.product_id = p.erp_product_id
  GROUP BY p.erp_product_id
),
zero_sale_cands AS (
  SELECT pr.id AS erp_product_id, pr.nombre AS descripcion
  FROM public.products pr CROSS JOIN branch_esid be
  WHERE pr.activo = true
    AND (p_search IS NULL OR p_search = '' OR pr.id IN (SELECT b2.id FROM prods_buscados b2))
    AND NOT EXISTS (SELECT 1 FROM prod_with_sales pws WHERE pws.erp_product_id = pr.id)
    AND (EXISTS (SELECT 1 FROM public.product_stock_params psp
                 WHERE psp.erp_product_id = pr.id AND psp.erp_sucursal_id = be.esid
                   AND COALESCE(psp.manual_max, psp.max_units, 0) > 0)
      OR EXISTS (SELECT 1 FROM public.inventory inv
                 WHERE inv.erp_product_id = pr.id AND inv.erp_sucursal_id = be.esid
                   AND inv.is_vencidos = false AND inv.cantidad > 0))
),
all_cands AS (
  SELECT pws.erp_product_id, pws.descripcion FROM prod_with_sales pws
  UNION ALL SELECT z.erp_product_id, z.descripcion FROM zero_sale_cands z
),
last_sale_hist AS (
  SELECT a.erp_product_id AS prod_id, a.branch_id,
         MAX(COALESCE(a.ultima_venta, ((a.year_month||'-01')::date + INTERVAL '1 month' - INTERVAL '1 day')::date)) AS last_date
  FROM public.product_sales_monthly_agg a
  WHERE a.erp_product_id IN (SELECT ac.erp_product_id FROM all_cands ac)
  GROUP BY a.erp_product_id, a.branch_id
),
-- ⬇ CAMBIO: sin el `IN (SELECT all_cands)`. Todo producto vendido este mes YA es
-- candidato, así que el semi-join no descartaba ninguna fila y costaba 155 ms;
-- las filas de más las descarta sola el LEFT JOIN final.
last_sale_live AS (
  SELECT sii.erp_product_id AS prod_id, si.branch_id, MAX(si.fecha) AS last_date
  FROM public.sales_invoice_items sii JOIN public.sales_invoices si ON si.id=sii.invoice_id
  WHERE sii.erp_product_id IS NOT NULL AND sii.erp_product_id != 0
    AND si.estado NOT IN ('NULA','DTE INVALIDADO EN MH')
    AND si.fecha >= date_trunc('month', CURRENT_DATE)::date
  GROUP BY sii.erp_product_id, si.branch_id
),
ultima_venta_agg AS MATERIALIZED (
  SELECT pb.prod_id, MAX(pb.last_date) AS ultima_venta_global,
    MAX(pb.last_date) FILTER (WHERE pb.branch_id = p_branch_id) AS ultima_venta_branch,
    COALESCE(jsonb_agg(jsonb_build_object('branch_id',pb.branch_id,'fecha',pb.last_date)
      ORDER BY pb.last_date DESC NULLS LAST, pb.branch_id) FILTER (WHERE pb.last_date IS NOT NULL), '[]'::jsonb) AS ultima_venta_por_suc
  FROM (
    SELECT prod_id, branch_id, MAX(last_date) AS last_date
    FROM (SELECT prod_id, branch_id, last_date FROM last_sale_hist
          UNION ALL SELECT prod_id, branch_id, last_date FROM last_sale_live) u
    GROUP BY prod_id, branch_id) pb
  GROUP BY pb.prod_id
)
SELECT
  ac.erp_product_id,
  COALESCE(pws.descripcion, ac.descripcion)::text AS descripcion,
  COALESCE(pws.cantidad, 0::numeric) AS cantidad,
  COALESCE(pws.neto, 0::numeric) AS neto,
  pws.costo_total,
  COALESCE(pws.presentaciones, '[]'::jsonb) AS presentaciones,
  CASE WHEN p_branch_id IS NULL THEN uva.ultima_venta_global ELSE uva.ultima_venta_branch END AS ultima_venta,
  COALESCE(uva.ultima_venta_por_suc, '[]'::jsonb) AS ultima_venta_por_suc,
  p2.laboratorio_id, l2.nombre AS laboratorio_nombre,
  COALESCE(p2.oculto_en_ventas, false) AS oculto_en_ventas,
  emp.first_names AS oculto_por_first_names, emp.last_names AS oculto_por_last_names, p2.oculto_at
FROM all_cands ac
LEFT JOIN prod_with_sales pws ON pws.erp_product_id = ac.erp_product_id
LEFT JOIN ultima_venta_agg uva ON uva.prod_id = ac.erp_product_id
LEFT JOIN public.products p2 ON p2.id = ac.erp_product_id
LEFT JOIN public.laboratorios l2 ON l2.id = p2.laboratorio_id
LEFT JOIN public.employees emp ON emp.id = p2.oculto_por
ORDER BY (pws.erp_product_id IS NULL) ASC, COALESCE(pws.neto,0) DESC,
  CASE WHEN p_branch_id IS NULL THEN uva.ultima_venta_global ELSE uva.ultima_venta_branch END DESC NULLS LAST;
$function$
;
