SET lock_timeout = '5s';

-- El código del vendedor viaja como INT al otro sistema, y `^[0-9]+$` no alcanza
-- para garantizar que quepa: hay 21 facturas (de 358,263) con un código de 13 a
-- 17 dígitos — códigos de BARRA escaneados en el campo del vendedor. Todos son
-- números, todos pasan el regex, y `::int` revienta con
-- «value out of range for type integer» — que no falla una fila: **falla la
-- consulta entera**, o sea que una venta mal digitada de abril deja sin puntos a
-- todo un mes. Es candidato serio a por qué el circuito de la hoja de cálculo
-- venía fallando: allá el mismo dato llega a `pstmt.setInt(5, ...)`.
--
-- El tope se escribe en el REGEX y no como un `<=` aparte, para que el `::int`
-- no pueda ejecutarse nunca sobre un valor que no quepa, sin depender de en qué
-- orden el planificador evalúe el filtro y la proyección. Nueve dígitos
-- (999,999,999) contra el techo de 2,147,483,647: cabe siempre. Los códigos
-- reales son de 1 a 5 dígitos — hay 232 distintos y todos coinciden con
-- `employees.code`.
CREATE OR REPLACE FUNCTION public.ventas_para_puntos(
  p_desde  date,
  p_hasta  date,
  p_margen numeric DEFAULT 0.02,
  p_tope   integer DEFAULT 2000
) RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan'
AS $fn$
DECLARE
  v json;
BEGIN
  SELECT coalesce(json_agg(to_json(t)), '[]'::json) INTO v FROM (
    WITH inv AS (
      SELECT si.id, b.codigo_puntos AS sucursal, si.erp_invoice_id, si.correlativo,
             si.cliente, si.cod_vendedor::int AS cod_vendedor, si.total, si.fecha
      FROM public.sales_invoices si
      JOIN public.branches b
        ON b.id = si.branch_id AND b.codigo_puntos IS NOT NULL
      LEFT JOIN public.puntos_enviados pe ON pe.invoice_id = si.id
      WHERE si.fecha BETWEEN p_desde AND p_hasta
        AND si.estado = 'FINALIZADA'
        AND si.total > 1
        AND si.cod_vendedor ~ '^[0-9]{1,9}$'
        AND pe.invoice_id IS NULL
    ),
    pv AS (
      SELECT p.product_id, p.id_presentacion,
             upper(regexp_replace(coalesce(pr.tipo,'') || ' ' || coalesce(p.descripcion,''),
                                  '\s+', ' ', 'g')) AS pkey,
             p.vineta, p.descuento_1, p.vip
      FROM public.product_precios p
      LEFT JOIN public.presentaciones pr ON pr.id = p.id_presentacion
      WHERE p.activo
    ),
    lin AS (
      SELECT ii.invoice_id, ii.precio_unitario, ii.erp_product_id, inv.fecha,
             upper(regexp_replace(coalesce(ii.presentacion,''), '\s+', ' ', 'g')) AS pkey
      FROM public.sales_invoice_items ii
      JOIN inv ON inv.id = ii.invoice_id
    ),
    ok AS (
      SELECT lin.invoice_id,
             EXISTS (
               SELECT 1
               FROM pv
               CROSS JOIN LATERAL (
                 SELECT coalesce(h.vineta,      pv.vineta)      AS p1,
                        coalesce(h.descuento_1, pv.descuento_1) AS p2,
                        coalesce(h.vip,         pv.vip)         AS p3
                 FROM (SELECT 1) z
                 LEFT JOIN LATERAL (
                   SELECT h2.vineta, h2.descuento_1, h2.vip
                   FROM public.product_precios_history h2
                   WHERE h2.product_id      = pv.product_id
                     AND h2.id_presentacion = pv.id_presentacion
                     AND h2.valid_from  <  (lin.fecha + 1)::timestamptz
                     AND (h2.valid_until IS NULL OR h2.valid_until >= lin.fecha::timestamptz)
                   ORDER BY h2.valid_from DESC
                   LIMIT 1
                 ) h ON true
               ) e
               WHERE pv.product_id = lin.erp_product_id
                 AND pv.pkey       = lin.pkey
                 AND coalesce(nullif(e.p3,0), nullif(e.p2,0), nullif(e.p1,0)) IS NOT NULL
                 AND lin.precio_unitario >=
                     coalesce(nullif(e.p3,0), nullif(e.p2,0), nullif(e.p1,0)) * (1 - p_margen)
             ) AS ok
      FROM lin
    ),
    agg AS (
      SELECT invoice_id, bool_and(ok) AS todas FROM ok GROUP BY 1
    )
    SELECT inv.id AS invoice_id, inv.sucursal, inv.erp_invoice_id, inv.correlativo,
           inv.cliente, inv.cod_vendedor, inv.total, inv.fecha
    FROM inv
    JOIN agg ON agg.invoice_id = inv.id
    WHERE agg.todas
    ORDER BY inv.fecha, inv.id
    LIMIT p_tope
  ) t;

  RETURN v;
END;
$fn$;

-- Mismo desborde, misma corrección: acá el `regexp_replace(...,'\D','')` era
-- todavía peor, porque limpiaba las letras y ENTONCES casteaba — o sea que un
-- código con letras y catorce dígitos también llegaba al `::int`.
CREATE OR REPLACE FUNCTION public.puntos_marcar_enviadas(p_invoice_ids bigint[])
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $fn$
DECLARE
  n integer;
BEGIN
  INSERT INTO public.puntos_enviados
    (invoice_id, sucursal, erp_invoice_id, correlativo, cliente, cod_vendedor, total, fecha)
  SELECT si.id, b.codigo_puntos, si.erp_invoice_id, si.correlativo, si.cliente,
         CASE WHEN si.cod_vendedor ~ '^[0-9]{1,9}$' THEN si.cod_vendedor::int END,
         si.total, si.fecha
  FROM public.sales_invoices si
  JOIN public.branches b ON b.id = si.branch_id AND b.codigo_puntos IS NOT NULL
  WHERE si.id = ANY(p_invoice_ids)
  ON CONFLICT (invoice_id) DO NOTHING;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$fn$;
