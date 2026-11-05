SET lock_timeout = '5s';

-- «¿Cuáles de estos productos están bajo su mínimo?» — para el widget Top
-- productos del Inicio (2026-11-05). El mínimo es el oficial, el mismo que usa
-- `get_faltantes_con_stock_en_otra_sala`: manual > calculado > publicado. La
-- existencia excluye lo vencido.
--
-- INVOKER a propósito: `inventory` y `product_stock_params` se leen con el RLS
-- de quien pregunta. Quien no puede ver inventario recibe `[]` y el widget no
-- marca nada — no se le abre un dato que su cargo no ve.
--
-- `p_branch_id` NULL = toda la red: cuenta en cuántas salas está bajo el mínimo.
-- `RETURNS json`: una sola fila, sin el techo de las 1000.
CREATE OR REPLACE FUNCTION public.inicio_bajo_minimo(p_ids integer[], p_branch_id bigint DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql STABLE
SET search_path = public, extensions
AS $$
DECLARE
  r json;
BEGIN
  WITH salas AS (
    SELECT m.erp_sucursal_id, m.nombre
    FROM public.erp_sucursal_map m
    WHERE p_branch_id IS NULL OR m.branch_id = p_branch_id
  ),
  params AS (
    SELECT sp.erp_product_id, sp.erp_sucursal_id,
           coalesce(sp.manual_min, sp.calc_min, sp.min_units) AS minimo
    FROM public.product_stock_params sp
    JOIN salas s ON s.erp_sucursal_id = sp.erp_sucursal_id
    WHERE sp.erp_product_id = ANY (p_ids)
      AND coalesce(sp.manual_min, sp.calc_min, sp.min_units) > 0
  ),
  exist AS (
    SELECT i.erp_product_id, i.erp_sucursal_id, sum(i.cantidad) AS existencia
    FROM public.inventory i
    JOIN salas s ON s.erp_sucursal_id = i.erp_sucursal_id
    WHERE i.erp_product_id = ANY (p_ids)
      AND i.is_vencidos = false
    GROUP BY 1, 2
  ),
  cruce AS (
    SELECT p.erp_product_id, s.nombre, p.minimo, coalesce(e.existencia, 0) AS existencia
    FROM params p
    JOIN salas s ON s.erp_sucursal_id = p.erp_sucursal_id
    LEFT JOIN exist e ON e.erp_product_id = p.erp_product_id AND e.erp_sucursal_id = p.erp_sucursal_id
  )
  SELECT coalesce(json_agg(to_json(t)), '[]'::json) INTO r
  FROM (
    SELECT erp_product_id,
           count(*) FILTER (WHERE existencia < minimo)          AS salas_bajo,
           count(*)                                              AS salas_con_minimo,
           sum(existencia) FILTER (WHERE existencia < minimo)   AS existencia,
           sum(minimo)     FILTER (WHERE existencia < minimo)   AS minimo,
           array_agg(nombre ORDER BY nombre) FILTER (WHERE existencia < minimo) AS salas
    FROM cruce
    GROUP BY erp_product_id
    HAVING count(*) FILTER (WHERE existencia < minimo) > 0
  ) t;
  RETURN r;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.inicio_bajo_minimo(integer[], bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inicio_bajo_minimo(integer[], bigint) TO authenticated, service_role;
