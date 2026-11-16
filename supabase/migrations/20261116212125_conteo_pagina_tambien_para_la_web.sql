-- `get_conteo_pagina` también para el portal web (2026-11-16).
--
-- Bodega contaba desde el navegador de un Android y la base se saturó: cada
-- búsqueda de la web pedía total + página + «¿es parecido?» + lotes, dos veces
-- (bodega y área de vencidos). Medido en los registros: 20–26 páginas y otros
-- tantos totales por minuto de ese teléfono, cada uno de 0.5–0.7 s de CPU sobre
-- los 3,984 renglones del conteo; con seis a la vez, cada una tardaba 5–16 s y
-- arrastraba a la app.
--
-- Dos cambios para que la web la pueda usar en vez de las cuatro llamadas:
--   * `p_lotes_con_busqueda`: la web filtra también los LOTES por la búsqueda y
--     el filtro (la app no). Por defecto, como hasta ahora: todos los lotes.
--   * los lotes ya no se cortan en 900: el área de vencidos pide hasta 500
--     productos de una vez, y esto es un JSON (fuera del techo de PostgREST).
--
-- Agregar un parámetro crea OTRA función; la vieja se borra en la misma
-- transacción para que no queden dos con permisos distintos.

SET lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.get_conteo_pagina(uuid, text, text, integer, integer, integer, text, text, text);

CREATE FUNCTION public.get_conteo_pagina(
  p_conteo_id uuid,
  p_search text DEFAULT NULL,
  p_filtro text DEFAULT 'TODOS',
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0,
  p_laboratorio_id integer DEFAULT NULL,
  p_order_by text DEFAULT NULL,
  p_order_dir text DEFAULT 'asc',
  p_area text DEFAULT NULL,
  p_lotes_con_busqueda boolean DEFAULT false
) RETURNS json
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_total integer;
  v_filas json;
  v_ids integer[];
  v_lotes json := '[]'::json;
  v_aprox boolean := false;
BEGIN
  SELECT count(*)::int,
         coalesce(json_agg(to_jsonb(t) - 'ordinality' ORDER BY t.ordinality)
                  FILTER (WHERE t.ordinality > p_offset AND t.ordinality <= p_offset + p_limit), '[]'::json),
         array_agg(t.erp_product_id ORDER BY t.ordinality)
                  FILTER (WHERE t.ordinality > p_offset AND t.ordinality <= p_offset + p_limit)
    INTO v_total, v_filas, v_ids
  FROM public.get_conteo_products_page(p_conteo_id, p_search, p_filtro, 1000000, 0,
                                       p_laboratorio_id, p_order_by, p_order_dir, p_area)
       WITH ORDINALITY AS t;

  IF v_ids IS NOT NULL THEN
    SELECT coalesce(json_agg(to_json(i)), '[]'::json) INTO v_lotes
    FROM public.get_conteo_items_search(
           p_conteo_id,
           CASE WHEN p_lotes_con_busqueda THEN p_search END,
           CASE WHEN p_lotes_con_busqueda THEN coalesce(p_filtro, 'TODOS') ELSE 'TODOS' END,
           1000000, 0, NULL, v_ids, p_area) i;
  END IF;

  IF nullif(btrim(coalesce(p_search, '')), '') IS NOT NULL THEN
    v_aprox := coalesce(array_length(public.conteo_busqueda_aproximada(p_conteo_id, p_search), 1), 0) > 0;
  END IF;

  RETURN json_build_object('total', v_total, 'filas', v_filas, 'lotes', v_lotes, 'aproximado', v_aprox);
END;
$$;

COMMENT ON FUNCTION public.get_conteo_pagina(uuid, text, text, integer, integer, integer, text, text, text, boolean) IS
  'Una página del conteo en un viaje: {total, filas (get_conteo_products_page), lotes (get_conteo_items_search de esas filas; con la búsqueda si p_lotes_con_busqueda), aproximado}. INVOKER.';

REVOKE EXECUTE ON FUNCTION public.get_conteo_pagina(uuid, text, text, integer, integer, integer, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_conteo_pagina(uuid, text, text, integer, integer, integer, text, text, text, boolean) TO authenticated, service_role;
