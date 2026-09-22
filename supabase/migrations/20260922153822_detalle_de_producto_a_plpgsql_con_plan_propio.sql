-- El detalle de producto de Ventas pasa a plpgsql con `force_custom_plan`.
--
-- Segunda mitad de ventas_busqueda_y_detalle_sin_rls_fila_por_fila. Esa
-- migración sacó el RLS del camino y la búsqueda bajó de 15 s a 31 ms, pero el
-- detalle NO bajó: remedido, leía lo mismo como `postgres` que como usuario.
-- La causa del detalle no era el RLS sino la trampa 4 de CLAUDE.md: era
-- `LANGUAGE sql` con `SET search_path`, así que nacía genérica y nunca veía las
-- fechas. Con el rango como parámetro el planificador estima pocas facturas y
-- elige recorrer los renglones factura por factura; con un año eso son 683,904
-- bloques (5.3 GB) por llamada, y era la función que más leía de toda la base
-- (617,313 bloques de promedio en producción, peor 11.7 s).
--
-- Cuerpo intacto salvo dos cosas, y medido con el MISMO resultado (md5) contra
-- la versión anterior en 14 casos, con una cuenta de alcance total y una de
-- Salud 1 (scope BRANCH):
--
--   · plpgsql + force_custom_plan (la receta de la trampa 4). Un año:
--       summary  683,904 → 73,262 bloques     lines  → 14,954 bloques
--   · el alcance de la policy (`alcance_de_ventas()`) se aplica en el cruce con
--     los renglones y NO en el CTE de facturas: un filtro más en `inv` le baja
--     la estimación y vuelve a empujar al planificador al recorrido factura por
--     factura.
--
-- Lo que no cambió: el mes en curso sigue en ~57,000 bloques (40–130 ms). Con
-- el plan propio el planificador lo elige igual porque lo estima más barato, y
-- el reloj le da la razón.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_product_drill_summary(p_erp_product_id integer, p_fini date, p_ffin date, p_branch_id integer DEFAULT NULL::integer)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
BEGIN
RETURN (
-- El alcance de la policy (ver `alcance_de_ventas`), aplicado en `lines`.
WITH alc AS MATERIALIZED (
  SELECT a.puede, a.sala FROM public.alcance_de_ventas() a
),
inv AS MATERIALIZED (
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
    AND (SELECT a.puede FROM alc a)
    AND ((SELECT a.sala FROM alc a) IS NULL OR inv.branch_id = (SELECT a.sala FROM alc a))
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
));
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_product_drill_lines(p_erp_product_id integer, p_fini date, p_ffin date, p_branch_id integer DEFAULT NULL::integer)
 RETURNS TABLE(item_id bigint, presentacion text, id_presentacion integer, cantidad numeric, precio_unitario numeric, neto numeric, invoice_id bigint, fecha date, erp_invoice_id text, correlativo text, cliente text, branch_id integer, tipo_documento text, cod_vendedor text, tipo_pago text, lote text, fecha_vencimiento date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
#variable_conflict use_column
BEGIN
  RETURN QUERY
    -- El alcance de la policy (ver `alcance_de_ventas`), aplicado en `top300`.
    WITH alc AS MATERIALIZED (
        SELECT a.puede, a.sala FROM public.alcance_de_ventas() a
    ),
    -- MATERIALIZED a propósito: sin eso el planificador vuelve a entrar por el
    -- producto y a preguntar por clave primaria factura por factura.
    inv AS MATERIALIZED (
        SELECT si.id, si.fecha, si.branch_id
        FROM public.sales_invoices si
        WHERE si.fecha BETWEEN p_fini AND p_ffin
          AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
          AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
    ),
    -- El recorte a 300 se hace con lo mínimo (id del renglón, id de la factura);
    -- las 17 columnas se buscan después, sólo para esas 300.
    top300 AS (
        SELECT sii.id AS item_id, inv.id AS inv_id
        FROM inv
        JOIN public.sales_invoice_items sii ON sii.invoice_id = inv.id
        WHERE sii.erp_product_id = p_erp_product_id
          AND (SELECT a.puede FROM alc a)
          AND ((SELECT a.sala FROM alc a) IS NULL OR inv.branch_id = (SELECT a.sala FROM alc a))
        ORDER BY inv.fecha DESC, inv.id DESC
        LIMIT 300
    )
    SELECT sii.id, sii.presentacion, sii.id_presentacion, sii.cantidad::numeric,
        CASE WHEN si.tipo_documento='CCF' THEN sii.precio_unitario::numeric ELSE sii.precio_unitario::numeric/1.13 END,
        CASE WHEN si.tipo_documento='CCF' THEN sii.total_linea::numeric     ELSE sii.total_linea::numeric/1.13 END,
        -- `::integer`: plpgsql no convierte solo como lo hacía la versión sql.
        si.id, si.fecha, si.erp_invoice_id, si.correlativo, si.cliente, si.branch_id::integer,
        si.tipo_documento, si.cod_vendedor, si.tipo_pago, sii.lote, sii.fecha_vencimiento
    FROM top300
    JOIN public.sales_invoice_items sii ON sii.id = top300.item_id
    JOIN public.sales_invoices si       ON si.id  = top300.inv_id
    ORDER BY si.fecha DESC, si.id DESC;
END;
$function$;
