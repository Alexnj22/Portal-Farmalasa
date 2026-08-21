-- Ventas > Productos: que abrir un producto no dependa de la suerte de la caché,
-- y que el reparto por vendedor exista.
--
-- 1. get_product_drill_lines / get_product_drill_summary — ENTRAN POR FECHA.
--    Las dos entraban por el producto: el índice (erp_product_id, invoice_id)
--    devolvía TODA la historia del producto —8,604 renglones para ACETAMINOFEN—
--    y recién después se preguntaba, factura por factura y por clave primaria,
--    si esa venta caía en el período. Son 34,417 páginas de acceso aleatorio
--    sobre una tabla de 341 MB: con la caché caliente son 36 ms y con la caché
--    fría fueron 27.5 s medidos. El plan no estaba mal elegido, estaba mal
--    planteado — el filtro que descarta el 96% de las filas se aplicaba último.
--    Materializando primero las facturas del período (recorrido de índice, 467
--    páginas) el trabajo baja a 8,765 páginas y deja de ser aleatorio.
--    Medido, mismas filas devueltas: 40,323 → 8,765 páginas.
--
-- 2. get_product_drill_summary gana `por_vendedor`, con la misma exactitud que
--    `por_sucursal`: sale del período COMPLETO, no de las 300 ventas que carga
--    la tabla de abajo. Verificado contra el conteo crudo en 6 combinaciones:
--    las unidades por vendedor cuadran al decimal con las unidades por sucursal.
--
-- 3. get_product_trend acepta el período. Hasta hoy no lo recibía: devolvía
--    siempre los 3 meses anteriores a HOY, así que al elegir «julio» la tarjeta
--    de al lado hablaba de julio y ésta seguía mostrando agosto, sin decirlo.
--    Los parámetros nuevos van con default NULL para que la pantalla vieja
--    —la que todavía llama con dos— siga funcionando hasta que se despliegue.

SET lock_timeout = '5s';

-- ── 1a · el detalle de ventas del producto ────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_product_drill_lines(
    p_erp_product_id integer, p_fini date, p_ffin date, p_branch_id integer DEFAULT NULL::integer)
RETURNS TABLE(item_id bigint, presentacion text, id_presentacion integer, cantidad numeric,
    precio_unitario numeric, neto numeric, invoice_id bigint, fecha date, erp_invoice_id text,
    correlativo text, cliente text, branch_id integer, tipo_documento text, cod_vendedor text,
    tipo_pago text, lote text, fecha_vencimiento date)
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path TO ''
AS $function$
    -- MATERIALIZED a propósito: sin eso el planificador vuelve a entrar por el
    -- producto y a preguntar por clave primaria factura por factura.
    WITH inv AS MATERIALIZED (
        SELECT si.id, si.fecha
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
        ORDER BY inv.fecha DESC, inv.id DESC
        LIMIT 300
    )
    SELECT sii.id, sii.presentacion, sii.id_presentacion, sii.cantidad::numeric,
        CASE WHEN si.tipo_documento='CCF' THEN sii.precio_unitario::numeric ELSE sii.precio_unitario::numeric/1.13 END,
        CASE WHEN si.tipo_documento='CCF' THEN sii.total_linea::numeric     ELSE sii.total_linea::numeric/1.13 END,
        si.id, si.fecha, si.erp_invoice_id, si.correlativo, si.cliente, si.branch_id,
        si.tipo_documento, si.cod_vendedor, si.tipo_pago, sii.lote, sii.fecha_vencimiento
    FROM top300
    JOIN public.sales_invoice_items sii ON sii.id = top300.item_id
    JOIN public.sales_invoices si       ON si.id  = top300.inv_id
    ORDER BY si.fecha DESC, si.id DESC;
$function$;

-- ── 1b/4 · los totales exactos del período, ahora también por vendedor ────
CREATE OR REPLACE FUNCTION public.get_product_drill_summary(
    p_erp_product_id integer, p_fini date, p_ffin date, p_branch_id integer DEFAULT NULL::integer)
RETURNS json
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path TO ''
AS $function$
WITH inv AS MATERIALIZED (
  SELECT si.id, si.branch_id, si.cod_vendedor, si.tipo_documento
  FROM public.sales_invoices si
  WHERE si.fecha BETWEEN p_fini AND p_ffin
    AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
),
lines AS (
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
con_factor AS (
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
$function$;

-- ── 5 · la tendencia mensual sigue al período elegido ─────────────────────
-- Se reemplaza la de dos parámetros: `CREATE OR REPLACE` no puede agregarlos.
-- Los nuevos van al final y con default NULL para que la llamada vieja
-- —`{p_erp_product_id, p_branch_id}`— siga resolviendo mientras la pantalla no
-- se haya desplegado todavía. Con NULL se comporta EXACTAMENTE como antes.
DROP FUNCTION IF EXISTS public.get_product_trend(integer, integer);

CREATE OR REPLACE FUNCTION public.get_product_trend(
    p_erp_product_id integer,
    p_branch_id      integer DEFAULT NULL::integer,
    p_fini           date    DEFAULT NULL::date,
    p_ffin           date    DEFAULT NULL::date)
RETURNS TABLE(month date, neto numeric, cantidad numeric)
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path TO ''
AS $function$
    -- Tres meses que TERMINAN en el mes del período elegido, no en el de hoy.
    WITH v AS (
        SELECT DATE_TRUNC('month', COALESCE(p_ffin, CURRENT_DATE))::date AS mes_fin
    )
    SELECT DATE_TRUNC('month', si.fecha)::date,
           SUM(CASE WHEN si.tipo_documento='CCF' THEN sii.total_linea ELSE sii.total_linea/1.13 END)::numeric,
           SUM(sii.cantidad)::numeric
    FROM public.sales_invoice_items sii
    JOIN public.sales_invoices si ON si.id = sii.invoice_id
    CROSS JOIN v
    WHERE sii.erp_product_id = p_erp_product_id
      AND si.estado NOT IN ('NULA','DTE INVALIDADO EN MH')
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
      AND si.fecha >= (v.mes_fin - INTERVAL '2 months')::date
      AND si.fecha <  (v.mes_fin + INTERVAL '1 month')::date
    GROUP BY DATE_TRUNC('month', si.fecha)
    ORDER BY 1;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_product_trend(integer, integer, date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_product_trend(integer, integer, date, date) TO authenticated, service_role;
