-- 1. `por_vendedor` dice de qué sala.
--    El reparto por vendedor no decía de dónde salía cada venta, y la tarjeta
--    pintaba un color por POSICIÓN — o sea un color que no significaba nada.
--    Ahora trae la sucursal, y con eso el color puede ser el de la sala: el
--    mismo que ya usa «Ventas por sucursal» para esa fila.
--    Medido en agosto sobre los 13,821 pares (producto, vendedor): **99.6% vende
--    ese producto en UNA sola sala** y sólo 53 pares (0.4%) en dos. Por eso se
--    manda UNA sucursal —la de más venta— más el conteo, en vez de un arreglo:
--    el arreglo pesaría en las 13,768 filas donde siempre tiene un elemento.
--
-- 2. El agregado de productos deja de mandar `precio_unitario_avg`.
--    Está dentro de cada presentación, es un flotante de 18 dígitos, y **el
--    portal no lo lee en ningún lado** (verificado: cero referencias en `src/`).
--    Con el `neto` redondeado a 6 decimales —error acumulado bajo un milésimo
--    de centavo sobre 2,376 productos— el payload de la pestaña baja de
--    1,734 kB a 1,653 kB. No es lo que la hace lenta (eso es la cola por una
--    conexión de PostgREST, que tiene 20 y las comparte todo el portal), pero
--    son 81 kB menos de conexión ocupada por cada persona que entre.
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
-- Paso intermedio por (vendedor, sala) para poder elegir la sala donde MÁS
-- vendió, y de paso saber si vendió en más de una.
por_vend_suc AS (
  SELECT cod_vendedor, branch_id,
         SUM(cantidad_base) AS cantidad_base, SUM(neto) AS neto, count(*) AS ventas
  FROM con_factor GROUP BY cod_vendedor, branch_id
),
por_vend AS (
  SELECT cod_vendedor,
         SUM(cantidad_base) AS cantidad_base,
         SUM(neto)          AS neto,
         SUM(ventas)        AS ventas,
         count(*)           AS sucursales,
         (array_agg(branch_id ORDER BY neto DESC, branch_id))[1] AS branch_id
  FROM por_vend_suc GROUP BY cod_vendedor
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
                             'ventas',        pv.ventas,
                             'branch_id',     pv.branch_id,
                             'sucursales',    pv.sucursales
                           ) ORDER BY pv.neto DESC, pv.cod_vendedor) FROM por_vend pv), '[]'::json)
);
$function$
;

CREATE OR REPLACE FUNCTION public.get_product_sales_agg_jsonb(p_fini date, p_ffin date, p_branch_id integer DEFAULT NULL::integer, p_search text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(json_build_object(
    'erp_product_id',       t.erp_product_id,
    'descripcion',          t.descripcion,
    'cantidad',             t.cantidad,
    'neto',                 round(t.neto, 6),
    'costo_total',          t.costo_total,
    -- Sin `precio_unitario_avg`: 18 dígitos por presentación que el portal no
    -- lee en ningún lado. El `neto` a 6 decimales — el error acumulado sobre
    -- 2,376 productos queda bajo un milésimo de centavo.
    'presentaciones',       COALESCE((SELECT json_agg(json_build_object(
                                'presentacion', e->>'presentacion',
                                'cantidad',     (e->>'cantidad')::numeric,
                                'neto',         round((e->>'neto')::numeric, 6),
                                'factor',       (e->>'factor')::int))
                              FROM jsonb_array_elements(t.presentaciones) e), '[]'::json),
    'ultima_venta',         t.ultima_venta,
    'ultima_venta_por_suc', t.ultima_venta_por_suc,
    'laboratorio_id',       t.laboratorio_id,
    'laboratorio_nombre',   t.laboratorio_nombre,
    'oculto_en_ventas',     t.oculto_en_ventas,
    'oculto_por_first_names', t.oculto_por_first_names,
    'oculto_por_last_names',  t.oculto_por_last_names,
    'oculto_at',            t.oculto_at
  )), '[]'::json)
  FROM public.get_product_sales_agg(p_fini, p_ffin, p_branch_id, p_search) t;
$function$
;
