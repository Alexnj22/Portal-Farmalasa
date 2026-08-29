SET lock_timeout = '5s';

-- ── Una fila «sin enviar» no puede ser una condena ───────────────────────────
-- `ventas_para_puntos` descartaba TODA venta que ya tuviera fila en la bitácora
-- (`pe.invoice_id IS NULL`). Eso era correcto cuando la fila sólo existía para
-- lo enviado. Dejó de serlo al sembrar una fila por CADA venta: desde entonces,
-- una marcada «sin enviar» quedaba excluida para siempre aunque cumpliera las
-- tres reglas.
--
-- No es hipotético: quedaron **613 ventas** FINALIZADA, de más de $1 y con
-- vendedor usable, que la hoja de cálculo nunca mandó —su marca de agua avanzaba
-- por número de correlativo y se saltaba las que entraban tarde, el defecto que
-- este circuito vino a corregir— y que con la condición vieja no se iban a
-- mandar nunca. El arreglo del código de La Popular las dejó a la vista: eran
-- 33,419 y al resolver ése quedaron 613. Se recuperaron 235; las 378 restantes
-- no cumplen la regla del precio, que es lo correcto.
--
-- Ahora la bitácora no decide: deciden las REGLAS. Una fila «sin enviar» vuelve
-- a ser candidata, y si sigue sin cumplir, la propia función la descarta igual
-- que antes. Lo que NO vuelve a ser candidata es una ya enviada, retirada,
-- devuelta o pendiente — ésas ya tienen su lugar del otro lado.

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
        AND (pe.invoice_id IS NULL OR pe.estado_puntos = 'sin_enviar')
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

REVOKE EXECUTE ON FUNCTION public.ventas_para_puntos(date, date, numeric, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ventas_para_puntos(date, date, numeric, integer) TO service_role;


-- Y `puntos_marcar_enviadas` tiene que poder REESCRIBIR una fila «sin enviar»:
-- con `DO NOTHING` la venta se mandaba del otro lado pero la bitácora seguía
-- diciendo «sin enviar», y la corrida siguiente la volvería a mandar. Un bucle
-- silencioso: nada falla, y la misma venta viaja cada minuto para siempre.
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
    (invoice_id, sucursal, erp_invoice_id, correlativo, cliente, cod_vendedor,
     total, fecha, aplicado, visto_at)
  SELECT si.id, b.codigo_puntos, si.erp_invoice_id, si.correlativo, si.cliente,
         CASE WHEN si.cod_vendedor ~ '^[0-9]{1,9}$' THEN si.cod_vendedor::int END,
         si.total, si.fecha, 0, now()
  FROM public.sales_invoices si
  JOIN public.branches b ON b.id = si.branch_id AND b.codigo_puntos IS NOT NULL
  WHERE si.id = ANY(p_invoice_ids)
  ON CONFLICT (invoice_id) DO UPDATE
     SET aplicado = 0, visto_at = now(), enviado_at = now()
     WHERE public.puntos_enviados.aplicado IS NULL;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.puntos_marcar_enviadas(bigint[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_marcar_enviadas(bigint[]) TO service_role;
