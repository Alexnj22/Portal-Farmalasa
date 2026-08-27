SET lock_timeout = '5s';

-- ── El id de quien contó, en el historial de un renglón ─────────────────────
--
-- Mismo motivo que `get_conteos` (migración 20260827185652): la función
-- resolvía el nombre y la foto en SQL y no devolvía el id, así que la foto no
-- podía llevar su aro de estado (DESIGN.md §5.4). La columna cruda
-- `conteo_inventario_item_history.contado_por` siempre fue el id.
--
-- `RETURNS TABLE` no admite agregar una columna con CREATE OR REPLACE, así que
-- va DROP + CREATE. En una sola migración eso es atómico: no hay un instante en
-- que la función no exista para quien la esté llamando.
DROP FUNCTION IF EXISTS public.get_conteo_item_history(uuid);

CREATE FUNCTION public.get_conteo_item_history(p_item_id uuid)
RETURNS TABLE(id uuid, evento text, fisico_cantidad integer, sistema_cantidad integer,
              diferencia integer, estado_item text, nota text,
              contado_por uuid, contado_por_nombre text, contado_por_photo_url text,
              contado_at timestamp with time zone)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ver boolean;
BEGIN
  SELECT public.conteo_puede_ver_sistema(ci.conteo_id) INTO v_ver
  FROM public.conteo_inventario_items ci WHERE ci.id = p_item_id;

  RETURN QUERY
  SELECT h.id, h.evento, h.fisico_cantidad,
         CASE WHEN v_ver THEN h.sistema_cantidad END,
         CASE WHEN v_ver THEN h.diferencia END,
         h.estado_item, h.nota,
         h.contado_por,
         NULLIF(TRIM(split_part(COALESCE(e.first_names,''), ' ', 1) || ' ' || split_part(COALESCE(e.last_names,''), ' ', 1)), '') AS contado_por_nombre,
         e.photo_url AS contado_por_photo_url,
         h.contado_at
  FROM public.conteo_inventario_item_history h
  LEFT JOIN public.employees e ON e.id = h.contado_por
  WHERE h.item_id = p_item_id
  ORDER BY h.contado_at DESC;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_conteo_item_history(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_conteo_item_history(uuid) TO authenticated, service_role;
