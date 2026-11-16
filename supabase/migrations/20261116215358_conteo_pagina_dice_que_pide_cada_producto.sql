-- `get_conteo_pagina` dice qué pide cada producto (2026-11-16).
--
-- «Solo pide lote y vence cuando es regulado… debe verse claro». La regla ya la
-- aplica la base (`editar_lote_conteo_item`, `agregar_item_conteo`): lote si es
-- regulado; vencimiento si es regulado o perecedero. Pero la lista no la
-- mostraba, y «Corregir lote» la descubría con un error al guardar. Cada fila
-- trae ahora `regulado` y `perecedero` del producto, para que la pantalla
-- diga qué falta antes de que se intente guardar.
--
-- Misma firma: CREATE OR REPLACE, conserva permisos.

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
         coalesce(json_agg((to_jsonb(t) - 'ordinality')
                           || jsonb_build_object('regulado', coalesce(p.regulado, false),
                                                 'perecedero', coalesce(p.perecedero, false))
                           ORDER BY t.ordinality)
                  FILTER (WHERE t.ordinality > p_offset AND t.ordinality <= p_offset + p_limit), '[]'::json),
         array_agg(t.erp_product_id ORDER BY t.ordinality)
                  FILTER (WHERE t.ordinality > p_offset AND t.ordinality <= p_offset + p_limit)
    INTO v_total, v_filas, v_ids
  FROM public.get_conteo_products_page(p_conteo_id, p_search, p_filtro, 1000000, 0,
                                       p_laboratorio_id, p_order_by, p_order_dir, p_area)
       WITH ORDINALITY AS t
  LEFT JOIN public.products p ON p.id = t.erp_product_id;

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
  'Una página del conteo en un viaje: {total, filas (get_conteo_products_page), lotes (get_conteo_items_search de esas filas; con la búsqueda si p_lotes_con_busqueda), aproximado}; cada fila con regulado y perecedero (qué pide al corregir el lote). INVOKER.';

REVOKE EXECUTE ON FUNCTION public.get_conteo_pagina(uuid, text, text, integer, integer, integer, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_conteo_pagina(uuid, text, text, integer, integer, integer, text, text, text, boolean) TO authenticated, service_role;
