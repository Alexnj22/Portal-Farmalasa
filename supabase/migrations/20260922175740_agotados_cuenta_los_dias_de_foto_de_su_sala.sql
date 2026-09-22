-- `get_quiebres_sala` contaba los días fotografiados mirando TODAS las salas
-- (1,554 bloques); mirando sólo la suya son 184, y además es más correcto: si
-- una sala no se fotografió un día, ese día no puede contar como «estuvo en
-- cero» para ella.
--
-- Medido con esta versión y los dos índices de la foto diaria: 89,716 → 9,141
-- bloques por llamada, 146 → 85 ms.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_quiebres_sala(p_erp_sucursal_id integer, p_dias integer DEFAULT 30)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_desde     date;
  v_dias_foto integer;
  v_filas     json;
BEGIN
  v_desde := CURRENT_DATE - GREATEST(1, LEAST(COALESCE(p_dias, 30), 180));

  SELECT count(*) INTO v_dias_foto
  FROM (SELECT DISTINCT d.fecha
          FROM public.inventory_daily d
         WHERE d.fecha >= v_desde AND d.erp_sucursal_id = p_erp_sucursal_id) x;

  IF COALESCE(v_dias_foto, 0) = 0 THEN
    RETURN json_build_object('dias_foto', 0, 'desde', v_desde, 'filas', '[]'::json);
  END IF;

  WITH con AS MATERIALIZED (
    SELECT d.erp_product_id AS pid,
           count(DISTINCT d.fecha) AS dias_con,
           max(d.fecha)            AS ultimo_dia_con
    FROM public.inventory_daily d
    WHERE d.fecha >= v_desde
      AND d.erp_sucursal_id = p_erp_sucursal_id
      AND d.unidades > 0
    GROUP BY 1
  ),
  hoy AS MATERIALIZED (
    SELECT i.erp_product_id AS pid
    FROM public.inventory i
    WHERE i.erp_sucursal_id = p_erp_sucursal_id
      AND i.is_vencidos = false
      AND i.cantidad > 0
    GROUP BY 1
  )
  SELECT coalesce(json_agg(to_json(t) ORDER BY t.dias_sin DESC, t.velocidad DESC NULLS LAST), '[]'::json)
    INTO v_filas
  FROM (
    SELECT psp.erp_product_id,
           p.nombre                                        AS descripcion,
           (v_dias_foto - COALESCE(c.dias_con, 0))         AS dias_sin,
           COALESCE(c.dias_con, 0)                         AS dias_con,
           c.ultimo_dia_con,
           (h.pid IS NOT NULL)                             AS hay_ahora,
           pls.last_sale_date                              AS ultima_venta,
           psp.min_units, psp.max_units,
           psp.daily_velocity                              AS velocidad,
           psp.abc_class
    FROM public.product_stock_params psp
    JOIN public.products p            ON p.id = psp.erp_product_id
    JOIN public.product_last_sale pls ON pls.erp_product_id  = psp.erp_product_id
                                     AND pls.erp_sucursal_id = psp.erp_sucursal_id
    LEFT JOIN con c  ON c.pid = psp.erp_product_id
    LEFT JOIN hoy h  ON h.pid = psp.erp_product_id
    WHERE psp.erp_sucursal_id = p_erp_sucursal_id
      AND psp.is_hidden IS NOT TRUE
      -- Sólo lo que de verdad se vende: un producto descontinuado también está
      -- en cero, y mezclarlos convierte la lista en ruido que nadie mira.
      AND pls.last_sale_date >= CURRENT_DATE - 90
      AND (v_dias_foto - COALESCE(c.dias_con, 0)) > 0
  ) t;

  RETURN json_build_object(
    'dias_foto', v_dias_foto,
    'desde',     v_desde,
    'filas',     v_filas
  );
END;
$function$;
