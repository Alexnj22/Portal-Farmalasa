SET lock_timeout = '5s';

-- Dos correcciones medidas al probarlo (2026-10-07):
-- 1. Los destacados por UNIDADES ponían arriba recargas de saldo y caramelos.
--    Ahora es por DINERO vendido y sin lo que no es de farmacia (lo mismo que
--    no acumula puntos: laboratorio o producto marcado).
-- 2. El precio y el VIP de la tarjeta salían de presentaciones distintas
--    (0.08 normal contra 0.45 VIP). Ahora los dos son de la MISMA: la más
--    barata, que es lo que dice «Desde».
CREATE OR REPLACE FUNCTION public.app_catalogo_rehacer_destacados()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v integer;
BEGIN
  DELETE FROM public.app_catalogo_destacados;
  INSERT INTO public.app_catalogo_destacados (product_id, unidades, posicion)
  SELECT x.id, x.vendido, row_number() OVER (ORDER BY x.vendido DESC, x.id)
    FROM (
      SELECT p.id, sum(ii.total_linea) AS vendido
        FROM public.sales_invoice_items ii
        JOIN public.sales_invoices si ON si.id = ii.invoice_id
        JOIN public.products p ON p.id = ii.erp_product_id
        LEFT JOIN public.laboratorios lab ON lab.id = p.laboratorio_id
       WHERE si.fecha > (now() AT TIME ZONE 'America/El_Salvador')::date - 60
         AND public.venta_valida(si.estado)
         AND p.activo IS DISTINCT FROM false AND NOT coalesce(p.oculto_en_ventas, false)
         AND coalesce(lab.acumula_puntos, true)
         AND NOT EXISTS (SELECT 1 FROM public.puntos_producto_no_acumula x WHERE x.product_id = p.id)
         AND EXISTS (SELECT 1 FROM public.product_precios pp WHERE pp.product_id = p.id AND pp.activo AND pp.vineta > 0)
       GROUP BY p.id
       ORDER BY 2 DESC
       LIMIT 300
    ) x;
  GET DIAGNOSTICS v = ROW_COUNT;
  RETURN v;
END $$;
SELECT public.app_catalogo_rehacer_destacados();

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
        SELECT round(pp.vineta, 2) AS precio,
               CASE WHEN pp.vip > 0 AND pp.vip < pp.vineta THEN round(pp.vip, 2) END AS precio_vip,
               pre.tipo AS presentacion,
               (SELECT count(*)::int FROM public.product_precios q WHERE q.product_id = p.id AND q.activo AND q.vineta > 0) AS presentaciones
          FROM public.product_precios pp LEFT JOIN public.presentaciones pre ON pre.id = pp.id_presentacion
         WHERE pp.product_id = p.id AND pp.activo AND pp.vineta > 0
         ORDER BY pp.vineta ASC LIMIT 1
      ) pr
     WHERE p.id = ANY (v_ids) AND p.activo IS DISTINCT FROM false AND NOT coalesce(p.oculto_en_ventas, false)
     ORDER BY array_position(v_ids, p.id)
     OFFSET greatest(coalesce(p_desde, 0), 0) LIMIT v_lim + 1
  ) r;

  RETURN json_build_object(
    'productos', coalesce((SELECT json_agg(e) FROM (SELECT e FROM json_array_elements(coalesce(v_res, '[]'::json)) WITH ORDINALITY AS t(e, n) WHERE n <= v_lim) z), '[]'::json),
    'hay_mas', coalesce(json_array_length(v_res), 0) > v_lim);
END $$;
