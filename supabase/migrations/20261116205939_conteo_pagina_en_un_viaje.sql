-- Una página del conteo en UN viaje: productos, total y sus lotes (2026-11-16).
--
-- Bodega: «abrí bodega desde la app y tardó 1 a 3 s». La app pedía tres cosas:
-- `get_conteo_products_count` y `get_conteo_products_page` juntas, y después
-- `get_conteo_items_search` con los ids de la página. Medido con el conteo de
-- Bodega (3,983 renglones): página ~180 ms y lotes ~140 ms en el servidor; el
-- total repetía el MISMO cálculo que la página (en el historial, 524 ms de
-- promedio por llamada), y los lotes esperaban un viaje entero del teléfono.
--
-- Aquí la página se calcula una sola vez: `get_conteo_products_page` ya
-- materializa todo el conteo y el LIMIT es lo último que aplica, así que pedir
-- todas las filas cuesta lo mismo que pedir 20. De ahí salen el total (cuántas
-- filas) y la página (las de su tramo, en el mismo orden: WITH ORDINALITY), y
-- con esos ids, los lotes. Las tres funciones son las de siempre: misma regla,
-- mismo RLS (INVOKER), mismos números.
--
-- RETURNS json (no jsonb, no SETOF): un solo valor, fuera del techo de 1000
-- filas de PostgREST.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_conteo_pagina(
  p_conteo_id uuid,
  p_search text DEFAULT NULL,
  p_filtro text DEFAULT 'TODOS',
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0,
  p_laboratorio_id integer DEFAULT NULL,
  p_order_by text DEFAULT NULL,
  p_order_dir text DEFAULT 'asc',
  p_area text DEFAULT NULL
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
    -- Debajo del techo de 900 que usa la app: una página son 20 productos.
    SELECT coalesce(json_agg(to_json(i)), '[]'::json) INTO v_lotes
    FROM public.get_conteo_items_search(p_conteo_id, NULL, 'TODOS', 900, 0, NULL, v_ids, p_area) i;
  END IF;

  -- La lista dice si lo que salió es PARECIDO (la regla de búsqueda del portal).
  IF nullif(btrim(coalesce(p_search, '')), '') IS NOT NULL THEN
    v_aprox := coalesce(array_length(public.conteo_busqueda_aproximada(p_conteo_id, p_search), 1), 0) > 0;
  END IF;

  RETURN json_build_object('total', v_total, 'filas', v_filas, 'lotes', v_lotes, 'aproximado', v_aprox);
END;
$$;

COMMENT ON FUNCTION public.get_conteo_pagina(uuid, text, text, integer, integer, integer, text, text, text) IS
  'Una página del conteo en un viaje: {total, filas (get_conteo_products_page), lotes (get_conteo_items_search de esas filas), aproximado}. INVOKER.';

REVOKE EXECUTE ON FUNCTION public.get_conteo_pagina(uuid, text, text, integer, integer, integer, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_conteo_pagina(uuid, text, text, integer, integer, integer, text, text, text) TO authenticated, service_role;
