SET lock_timeout = '5s';

-- Laboratorios que la app sugiere primero en «Mismo principio activo» (2026-11-09).
ALTER TABLE public.laboratorios
  ADD COLUMN IF NOT EXISTS sugerir_en_app boolean NOT NULL DEFAULT false;

-- La lista sale de la base: filtrar en el teléfono sobre una búsqueda ya
-- recortada podía dejar fuera justo al producto del laboratorio sugerido.
-- La coincidencia es EXACTA sobre el principio activo completo (sin tildes ni
-- espacios de sobra): una combinación no es la misma cosa.
CREATE OR REPLACE FUNCTION public.app_catalogo_mismo_principio(p_id integer)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_clave text;
  v_res json;
BEGIN
  SELECT upper(regexp_replace(trim(public.f_unaccent(p.principio_activo)), '\s+', ' ', 'g')) INTO v_clave
    FROM public.products p WHERE p.id = p_id;
  IF v_clave IS NULL OR length(v_clave) < 3 THEN RETURN '[]'::json; END IF;

  SELECT json_agg(r ORDER BY r.sugerido DESC, coalesce(r.precio_vip, r.precio), r.id) INTO v_res FROM (
    SELECT c.id, c.nombre, c.foto, c.principio_activo, c.bajo_receta, c.sugerido, true AS disponible,
           pr.precio, pr.precio_vip, pr.precio_mayoreo, pr.precio_plus, pr.presentacion, pr.presentaciones
      FROM (
        SELECT p.id, p.nombre, p.foto_url AS foto, p.principio_activo,
               (coalesce(p.es_antibiotico, false) OR coalesce(p.requiere_receta, false)) AS bajo_receta,
               coalesce(l.sugerir_en_app, false) AS sugerido
          FROM public.products p
          LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
         WHERE p.principio_activo IS NOT NULL
           AND p.id <> p_id
           AND upper(regexp_replace(trim(public.f_unaccent(p.principio_activo)), '\s+', ' ', 'g')) = v_clave
           AND p.activo IS DISTINCT FROM false AND NOT coalesce(p.oculto_en_ventas, false)
           AND NOT EXISTS (SELECT 1 FROM public.app_catalogo_ocultos o WHERE o.product_id = p.id)
           AND EXISTS (SELECT 1 FROM public.inventory i
                         JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = i.erp_sucursal_id AND NOT m.es_bodega
                        WHERE i.erp_product_id = p.id AND i.cantidad > 0 AND NOT coalesce(i.is_vencidos, false))
      ) c
      CROSS JOIN LATERAL (
        SELECT u.precio, u.precio_vip, u.precio_mayoreo, u.precio_plus, u.tipo AS presentacion, count(*) OVER ()::int AS presentaciones
          FROM (SELECT DISTINCT ON (coalesce(pp.factor, 1))
                       round(pp.vineta, 2) AS precio,
                       CASE WHEN pp.vip > 0 AND pp.vip < pp.vineta THEN round(pp.vip, 2) END AS precio_vip,
                       public.precio_de_lista('mayoreo', pp.vineta, pp.vip, pp.clinica, pp.mayoreo) AS precio_mayoreo,
                       public.precio_de_lista('mayoreo_plus', pp.vineta, pp.vip, pp.clinica, pp.mayoreo) AS precio_plus,
                       pre.tipo, coalesce(pp.factor, 1) AS factor
                  FROM public.product_precios pp LEFT JOIN public.presentaciones pre ON pre.id = pp.id_presentacion
                 WHERE pp.product_id = c.id AND pp.activo AND pp.vineta > 0
                 ORDER BY coalesce(pp.factor, 1), pp.vineta DESC) u
         ORDER BY u.factor DESC, u.precio DESC LIMIT 1
      ) pr
     ORDER BY c.sugerido DESC, coalesce(pr.precio_vip, pr.precio), c.id
     LIMIT 40
  ) r;
  RETURN coalesce(v_res, '[]'::json);
END $function$;

REVOKE EXECUTE ON FUNCTION public.app_catalogo_mismo_principio(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_catalogo_mismo_principio(integer) TO service_role;
