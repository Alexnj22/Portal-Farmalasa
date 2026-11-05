-- La Tienda Salud por laboratorio (2026-11-05). Usuario: «y lo que hablamos de
-- promociones? laboratorios? en la tienda?».
--
-- Dos agregados a app_catalogo, sin tocar la edge function (que reenvía `q` y
-- esparce la respuesta con `...d`):
--   · `q = 'lab:<id>'` devuelve los productos de ese laboratorio, primero los
--     más vendidos (posición en app_catalogo_destacados) y después por nombre.
--   · Sin búsqueda y en la primera tanda, `laboratorios`: los 12 con más
--     productos entre los más vendidos, con el nombre sin el prefijo de orden
--     del ERP («1-ABBOTT NUTRICIONAL» → «ABBOTT NUTRICIONAL»).
-- El resto del cuerpo es la definición VIVA del 2026-11-05, sin cambios.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.app_catalogo(p_q text, p_desde integer DEFAULT 0, p_limite integer DEFAULT 30)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_ids integer[];
  v_q text := trim(coalesce(p_q, ''));
  v_lim integer := least(greatest(coalesce(p_limite, 30), 1), 50);
  v_res json;
  v_labs json;
BEGIN
  IF v_q ~ '^lab:[0-9]{1,9}$' THEN
    SELECT array_agg(id ORDER BY pos NULLS LAST, nombre) INTO v_ids FROM (
      SELECT p.id, d.posicion AS pos, p.nombre
        FROM public.products p
        LEFT JOIN public.app_catalogo_destacados d ON d.product_id = p.id
       WHERE p.laboratorio_id = substr(v_q, 5)::integer
         AND p.activo IS DISTINCT FROM false AND NOT coalesce(p.oculto_en_ventas, false)
       ORDER BY d.posicion NULLS LAST, p.nombre
       LIMIT 300) x;
  ELSIF length(v_q) >= 2 THEN
    SELECT array_agg((x)::integer) INTO v_ids
      FROM json_array_elements_text((public.buscar_productos_ids(v_q, 200, true, false, true))->'ids') x;
  ELSE
    SELECT array_agg(product_id ORDER BY posicion) INTO v_ids FROM public.app_catalogo_destacados;
    IF coalesce(p_desde, 0) = 0 THEN
      SELECT json_agg(json_build_object('id', id, 'nombre', nombre) ORDER BY n DESC, nombre) INTO v_labs FROM (
        SELECT l.id, trim(regexp_replace(l.nombre, '^[0-9]+\s*-\s*', '')) AS nombre, count(*) AS n
          FROM public.app_catalogo_destacados d
          JOIN public.products p ON p.id = d.product_id
          JOIN public.laboratorios l ON l.id = p.laboratorio_id
         GROUP BY 1, 2
         ORDER BY n DESC, 2
         LIMIT 12) z;
    END IF;
  END IF;
  IF v_ids IS NULL THEN RETURN json_build_object('productos', '[]'::json, 'hay_mas', false); END IF;

  SELECT json_agg(r ORDER BY r.orden) INTO v_res FROM (
    SELECT p.id, p.nombre, p.foto_url AS foto, p.principio_activo,
           (coalesce(p.es_antibiotico, false) OR coalesce(p.requiere_receta, false)) AS bajo_receta,
           pr.precio, pr.precio_vip, pr.precio_mayoreo, pr.precio_plus, pr.presentacion, pr.presentaciones,
           EXISTS (SELECT 1 FROM public.inventory i
                     JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = i.erp_sucursal_id AND NOT m.es_bodega
                    WHERE i.erp_product_id = p.id AND i.cantidad > 0 AND NOT coalesce(i.is_vencidos, false)) AS disponible,
           array_position(v_ids, p.id) AS orden
      FROM public.products p
      CROSS JOIN LATERAL (
        SELECT u.precio, u.precio_vip, u.precio_mayoreo, u.precio_plus, u.tipo AS presentacion, count(*) OVER ()::int AS presentaciones
          FROM (SELECT DISTINCT ON (coalesce(pp.factor, 1))
                       round(pp.vineta, 2) AS precio,
                       CASE WHEN pp.vip > 0 AND pp.vip < pp.vineta THEN round(pp.vip, 2) END AS precio_vip,
                       -- Mayoreo (2026-10-19): la regla única de precio_de_lista.
                       public.precio_de_lista('mayoreo', pp.vineta, pp.vip, pp.clinica, pp.mayoreo) AS precio_mayoreo,
                       public.precio_de_lista('mayoreo_plus', pp.vineta, pp.vip, pp.clinica, pp.mayoreo) AS precio_plus,
                       pre.tipo, coalesce(pp.factor, 1) AS factor
                  FROM public.product_precios pp LEFT JOIN public.presentaciones pre ON pre.id = pp.id_presentacion
                 WHERE pp.product_id = p.id AND pp.activo AND pp.vineta > 0
                 ORDER BY coalesce(pp.factor, 1), pp.vineta DESC) u
         ORDER BY u.factor DESC, u.precio DESC LIMIT 1
      ) pr
     WHERE p.id = ANY (v_ids) AND p.activo IS DISTINCT FROM false AND NOT coalesce(p.oculto_en_ventas, false)
       AND NOT EXISTS (SELECT 1 FROM public.app_catalogo_ocultos o WHERE o.product_id = p.id)
     ORDER BY array_position(v_ids, p.id)
     OFFSET greatest(coalesce(p_desde, 0), 0) LIMIT v_lim + 1
  ) r;

  RETURN json_build_object(
    'productos', coalesce((SELECT json_agg(e) FROM (SELECT e FROM json_array_elements(coalesce(v_res, '[]'::json)) WITH ORDINALITY AS t(e, n) WHERE n <= v_lim) z), '[]'::json),
    'hay_mas', coalesce(json_array_length(v_res), 0) > v_lim,
    'laboratorios', coalesce(v_labs, '[]'::json));
END $function$;
