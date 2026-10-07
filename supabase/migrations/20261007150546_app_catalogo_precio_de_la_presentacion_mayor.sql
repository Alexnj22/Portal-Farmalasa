SET lock_timeout = '5s';

-- La tarjeta del catálogo muestra el precio de la presentación MAYOR (la de
-- mayor factor: la caja, no la unidad), y dice cuántas más hay (usuario,
-- 2026-10-07). Partiendo de la definición de hace un momento.
CREATE OR REPLACE FUNCTION public.app_catalogo(p_q text, p_desde integer DEFAULT 0, p_limite integer DEFAULT 30)
RETURNS json LANGUAGE plpgsql STABLE
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan' AS $$
DECLARE
  v_ids integer[];
  v_q text := trim(coalesce(p_q, ''));
  v_lim integer := least(greatest(coalesce(p_limite, 30), 1), 50);
  v_res json;
BEGIN
  IF length(v_q) >= 2 THEN
    SELECT array_agg((x)::integer) INTO v_ids
      FROM json_array_elements_text((public.buscar_productos_ids(v_q, 200, true, false, true))->'ids') x;
  ELSE
    SELECT array_agg(product_id ORDER BY posicion) INTO v_ids FROM public.app_catalogo_destacados;
  END IF;
  IF v_ids IS NULL THEN RETURN json_build_object('productos', '[]'::json, 'hay_mas', false); END IF;

  SELECT json_agg(r ORDER BY r.orden) INTO v_res FROM (
    SELECT p.id, p.nombre, p.foto_url AS foto, p.principio_activo,
           (coalesce(p.es_antibiotico, false) OR coalesce(p.requiere_receta, false)) AS bajo_receta,
           pr.precio, pr.precio_vip, pr.presentacion, pr.presentaciones,
           EXISTS (SELECT 1 FROM public.inventory i
                     JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = i.erp_sucursal_id AND NOT m.es_bodega
                    WHERE i.erp_product_id = p.id AND i.cantidad > 0 AND NOT coalesce(i.is_vencidos, false)) AS disponible,
           array_position(v_ids, p.id) AS orden
      FROM public.products p
      CROSS JOIN LATERAL (
        -- Una por factor (la de mayor precio entre las de igual factor), y de
        -- ésas la de MAYOR factor: la presentación grande.
        SELECT u.precio, u.precio_vip, u.tipo AS presentacion, count(*) OVER ()::int AS presentaciones
          FROM (SELECT DISTINCT ON (coalesce(pp.factor, 1))
                       round(pp.vineta, 2) AS precio,
                       CASE WHEN pp.vip > 0 AND pp.vip < pp.vineta THEN round(pp.vip, 2) END AS precio_vip,
                       pre.tipo, coalesce(pp.factor, 1) AS factor
                  FROM public.product_precios pp LEFT JOIN public.presentaciones pre ON pre.id = pp.id_presentacion
                 WHERE pp.product_id = p.id AND pp.activo AND pp.vineta > 0
                 ORDER BY coalesce(pp.factor, 1), pp.vineta DESC) u
         ORDER BY u.factor DESC, u.precio DESC LIMIT 1
      ) pr
     WHERE p.id = ANY (v_ids) AND p.activo IS DISTINCT FROM false AND NOT coalesce(p.oculto_en_ventas, false)
     ORDER BY array_position(v_ids, p.id)
     OFFSET greatest(coalesce(p_desde, 0), 0) LIMIT v_lim + 1
  ) r;

  RETURN json_build_object(
    'productos', coalesce((SELECT json_agg(e) FROM (SELECT e FROM json_array_elements(coalesce(v_res, '[]'::json)) WITH ORDINALITY AS t(e, n) WHERE n <= v_lim) z), '[]'::json),
    'hay_mas', coalesce(json_array_length(v_res), 0) > v_lim);
END $$;
