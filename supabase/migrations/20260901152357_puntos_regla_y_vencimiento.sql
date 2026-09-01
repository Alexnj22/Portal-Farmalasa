-- Las dos piezas de LECTURA del programa de puntos. No escriben nada.
--
--   · `puntos_vence_el`  — cuándo vence un punto ganado tal día
--   · `ventas_elegibles_puntos` — qué ventas acumulan, sin mirar ninguna bitácora
--
-- Plan: docs/PLAN-PUNTOS-EN-SUPABASE-2026-09-01.md
SET lock_timeout = '5s';

-- ── Cuándo vence ────────────────────────────────────────────────────────────
-- Doce meses desde la compra… SALVO lo ganado antes del 1 de octubre de 2026.
-- El reglamento (régimen de transición) le prometió a todo eso el 1 de octubre
-- de 2027, y un punto ganado el 15 de septiembre de 2026 vencería el 15 de
-- septiembre de 2027 — ANTES de lo prometido. La regla vive en UNA función y no
-- repetida en cada llamador justamente por eso: es una excepción con fecha, del
-- tipo que se olvida, y el error no se ve hasta dentro de un año.
CREATE OR REPLACE FUNCTION public.puntos_vence_el(p_ganado_el date)
RETURNS date
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_ganado_el <= DATE '2026-09-30' THEN DATE '2027-10-01'
    ELSE (p_ganado_el + INTERVAL '12 months')::date
  END;
$$;
COMMENT ON FUNCTION public.puntos_vence_el(date) IS
  'La fecha de vencimiento de un lote. Sin cláusula SET a propósito: es IMMUTABLE y sin parámetros que cambien el plan, así que se puede inlinear y usar en un índice.';

-- ── Qué ventas acumulan ─────────────────────────────────────────────────────
-- Es la MISMA regla que `ventas_para_puntos`, con dos diferencias deliberadas:
--
--   1. NO excluye lo que ya está en `puntos_enviados`. Esa función mezcla la
--      regla con la exclusión del circuito viejo; separarlas es lo que permite
--      correr los dos motores sobre el mismo día y RESTAR sus resultados, que
--      es la única prueba de que el nuevo hace lo mismo que el viejo. Cada
--      llamador aplica su propia exclusión.
--   2. Devuelve `customer_id` y los puntos ya calculados. El circuito nuevo liga
--      por FICHA y nunca por el nombre escrito en la factura — medido sobre 68
--      duplicados reales, normalizar acentos evita 0 de ellos.
--
-- plpgsql y no `LANGUAGE sql`: una función `sql` CON cláusula `SET` se planifica
-- una sola vez con los argumentos como Params y nunca ve un valor — nace con el
-- plan genérico y no hay plan personalizado que pedir (medido en
-- `get_conteo_products_count`: 2,606 ms contra 56 ms). Con plpgsql sí entra al
-- caché de planes, y ahí `force_custom_plan` tiene sobre qué actuar.
CREATE OR REPLACE FUNCTION public.ventas_elegibles_puntos(
  p_desde date,
  p_hasta date,
  p_margen numeric DEFAULT 0.02,
  p_tope integer DEFAULT 100000
) RETURNS json
LANGUAGE plpgsql STABLE
SET search_path = public, extensions
SET plan_cache_mode TO 'force_custom_plan'
AS $$
DECLARE v json;
BEGIN
  SELECT coalesce(json_agg(to_json(t)), '[]'::json) INTO v FROM (
    WITH inv AS (
      SELECT si.id, b.codigo_puntos AS sucursal, si.erp_invoice_id, si.correlativo,
             si.customer_id, si.cod_vendedor::int AS cod_vendedor, si.total, si.fecha
      FROM public.sales_invoices si
      JOIN public.branches b
        ON b.id = si.branch_id AND b.codigo_puntos IS NOT NULL
      LEFT JOIN public.customers cu ON cu.id = si.customer_id
      WHERE si.fecha BETWEEN p_desde AND p_hasta
        AND si.estado = 'FINALIZADA'
        AND si.total > 1
        AND si.cod_vendedor ~ '^[0-9]{1,9}$'
        AND coalesce(cu.acumula_puntos, true)
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
             upper(regexp_replace(coalesce(ii.presentacion,''), '\s+', ' ', 'g')) AS pkey,
             coalesce(lab.acumula_puntos, true) AS acumula
      FROM public.sales_invoice_items ii
      JOIN inv ON inv.id = ii.invoice_id
      LEFT JOIN public.products      prd ON prd.id = ii.erp_product_id
      LEFT JOIN public.laboratorios  lab ON lab.id = prd.laboratorio_id
    ),
    ok AS (
      SELECT lin.invoice_id, lin.acumula,
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
      SELECT invoice_id,
             bool_and(ok)      AS todas,
             bool_or(acumula)  AS lleva_producto
      FROM ok GROUP BY 1
    )
    SELECT inv.id AS invoice_id, inv.sucursal, inv.erp_invoice_id, inv.correlativo,
           inv.customer_id, inv.cod_vendedor, inv.total, inv.fecha,
           -- «Por cada US$1.00 se otorga 1 punto. Las fracciones no acumulan.»
           floor(inv.total)::int AS puntos
    FROM inv
    JOIN agg ON agg.invoice_id = inv.id
    WHERE agg.todas AND agg.lleva_producto
    ORDER BY inv.fecha, inv.id
    LIMIT p_tope
  ) t;

  RETURN v;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.puntos_vence_el(date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.puntos_vence_el(date) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.ventas_elegibles_puntos(date,date,numeric,integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ventas_elegibles_puntos(date,date,numeric,integer) TO authenticated, service_role;
