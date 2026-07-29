-- Conteo de Inventario — traer las líneas de VARIOS productos en una llamada
--
-- La vista paginaba 25 productos y pedía las líneas de cada uno al expandirlo:
-- un viaje por producto, disparado por un click. Al dejar de contraer nada
-- (contar exige teclear seguido, no abrir acordeones) ese patrón se vuelve 25
-- viajes por página.
--
-- `p_erp_product_ids` recibe los ids de la página y devuelve sus líneas juntas.
-- Es Patrón A del CLAUDE.md al revés: acá el input ya viene acotado a 25 ids,
-- así que la respuesta nunca se acerca al techo de 1000 filas de PostgREST —
-- 25 productos con lotes reales son decenas de filas, no miles. Se mantiene
-- `p_erp_product_id` (singular) porque lo usa el detalle de una línea.
--
-- Se conserva TODO el comportamiento de v3: el ciego server-side, la autoría
-- con foto, el contador de ediciones y el filtro de diferencia neutralizado.

SET lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.get_conteo_items_search(uuid, text, text, integer, integer, integer);
CREATE FUNCTION public.get_conteo_items_search(
    p_conteo_id uuid,
    p_search text DEFAULT NULL::text,
    p_filtro text DEFAULT 'TODOS'::text,
    p_limit integer DEFAULT 50,
    p_offset integer DEFAULT 0,
    p_erp_product_id integer DEFAULT NULL::integer,
    p_erp_product_ids integer[] DEFAULT NULL::integer[]
) RETURNS TABLE(
    id uuid, erp_product_id integer, presentacion text, detalle text, lote text,
    fecha_vencimiento date, is_vencidos boolean, sistema_cantidad integer,
    fisico_cantidad integer, diferencia integer, estado_item text, nota text,
    costo_unitario numeric, es_agregado_manual boolean, product_nombre text,
    es_antibiotico boolean, foto_url text, laboratorio_nombre text,
    contado_por_nombre text, contado_at timestamp with time zone,
    fisico_primer_conteo integer, recontado_at timestamp with time zone,
    recontado_por_nombre text,
    contado_por_photo_url text, recontado_por_photo_url text,
    ediciones_count integer, ver_sistema boolean
)
LANGUAGE plpgsql STABLE
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_branch_id bigint;
  v_erp_sucursal_ids int[];
  v_ver boolean := public.conteo_puede_ver_sistema(p_conteo_id);
  v_filtro text;
  v_pats text[] := (
      SELECT array_agg('%' || tok || '%')
      FROM unnest(string_to_array(public.norm_search(p_search), ' ')) AS tok
      WHERE tok <> ''
  );
BEGIN
  SELECT c.branch_id INTO v_branch_id FROM public.conteos_inventario c WHERE c.id = p_conteo_id;
  SELECT array_agg(m.erp_sucursal_id) INTO v_erp_sucursal_ids FROM public.erp_sucursal_map m WHERE m.branch_id = v_branch_id;

  -- Filtrar por "con diferencia" con el conteo ciego señalaría exactamente las
  -- líneas que descuadran: el mismo dato, servido como filtro.
  v_filtro := CASE WHEN p_filtro = 'DIFERENCIA' AND NOT v_ver THEN 'TODOS' ELSE p_filtro END;

  RETURN QUERY
  WITH base AS MATERIALIZED (
    SELECT ci.*, p.nombre AS p_nombre, p.es_antibiotico AS p_es_antibiotico, p.foto_url AS p_foto_url,
           l.nombre AS l_nombre,
           NULLIF(TRIM(split_part(COALESCE(e.first_names,''), ' ', 1) || ' ' || split_part(COALESCE(e.last_names,''), ' ', 1)), '') AS e_nombre,
           NULLIF(TRIM(split_part(COALESCE(r.first_names,''), ' ', 1) || ' ' || split_part(COALESCE(r.last_names,''), ' ', 1)), '') AS r_nombre,
           e.photo_url AS e_photo, r.photo_url AS r_photo
    FROM public.conteo_inventario_items ci
    LEFT JOIN public.products p ON p.id = ci.erp_product_id
    LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
    LEFT JOIN public.employees e ON e.id = ci.contado_por
    LEFT JOIN public.employees r ON r.id = ci.recontado_por
    WHERE ci.conteo_id = p_conteo_id
      AND (p_erp_product_id IS NULL OR ci.erp_product_id = p_erp_product_id)
      AND (p_erp_product_ids IS NULL OR ci.erp_product_id = ANY(p_erp_product_ids))
  ),
  live_inv AS MATERIALIZED (
    SELECT i.sync_key, i.cantidad::int AS sistema_live
    FROM public.inventory i
    WHERE i.erp_sucursal_id = ANY(v_erp_sucursal_ids)
  ),
  filtered AS (
    SELECT b.* FROM base b
    WHERE (v_filtro = 'TODOS' OR v_filtro IS NULL
           OR (v_filtro = 'PENDIENTES' AND b.estado_item = 'PENDIENTE')
           OR (v_filtro = 'DIFERENCIA' AND b.diferencia IS NOT NULL AND b.diferencia != 0)
           OR (v_filtro = 'SIN_UBICAR' AND b.estado_item = 'SIN_UBICAR'))
      AND (v_pats IS NULL OR public.norm_search(
             coalesce(b.p_nombre,'') || ' ' || coalesce(b.lote,'') || ' ' ||
             coalesce(b.l_nombre,'') || ' ' || coalesce(b.presentacion,'')
           ) LIKE ALL (v_pats))
    ORDER BY b.l_nombre NULLS LAST, b.p_nombre, b.lote
    LIMIT p_limit OFFSET p_offset
  )
  SELECT
    f.id, f.erp_product_id, f.presentacion, f.detalle, f.lote, f.fecha_vencimiento, f.is_vencidos,
    CASE WHEN NOT v_ver THEN NULL
         WHEN f.fisico_cantidad IS NULL AND NOT f.es_agregado_manual THEN COALESCE(li.sistema_live, 0)
         ELSE f.sistema_cantidad END,
    f.fisico_cantidad,
    CASE WHEN v_ver THEN f.diferencia END,
    f.estado_item, f.nota,
    CASE WHEN v_ver THEN f.costo_unitario END,
    f.es_agregado_manual,
    f.p_nombre, f.p_es_antibiotico, f.p_foto_url, f.l_nombre,
    f.e_nombre, f.contado_at,
    CASE WHEN v_ver THEN f.fisico_primer_conteo END,
    f.recontado_at, f.r_nombre,
    f.e_photo, f.r_photo,
    (SELECT count(*)::int FROM public.conteo_inventario_item_history h
      WHERE h.item_id = f.id AND h.evento IN ('EDICION', 'BORRADO')),
    v_ver
  FROM filtered f
  LEFT JOIN live_inv li ON li.sync_key = f.source_sync_key
  ORDER BY f.l_nombre NULLS LAST, f.p_nombre, f.lote;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_conteo_items_search(uuid, text, text, integer, integer, integer, integer[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_conteo_items_search(uuid, text, text, integer, integer, integer, integer[]) TO authenticated, service_role;
