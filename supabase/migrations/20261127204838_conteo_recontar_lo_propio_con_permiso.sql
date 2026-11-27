SET lock_timeout = '5s';

-- 2026-11-27, lo pidió el usuario: quien tiene `conteo_inventario_recontar`
-- puede recontar también lo que contó. El registro queda igual: `contado_por`
-- dice quién contó y `recontado_por` + el evento RECUENTO del historial dicen
-- quién recontó. Para el resto (aprobadores) la guarda sigue igual.
-- Se parte de la definición VIVA y sólo se reemplaza la guarda.
DO $$
DECLARE
  v_def text := pg_get_functiondef('public.recontar_conteo_item(uuid, integer, text)'::regprocedure);
  v_old text := '  IF v_actor IS NOT NULL AND v_actor = v_item.contado_por THEN';
  v_new text := '  IF v_actor IS NOT NULL AND v_actor = v_item.contado_por
     AND NOT public.auth_has_module_permission(''conteo_inventario_recontar'', ''can_view'') THEN';
BEGIN
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'recontar_conteo_item: no se encontró la guarda del mismo contador';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $$;

REVOKE EXECUTE ON FUNCTION public.recontar_conteo_item(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recontar_conteo_item(uuid, integer, text) TO authenticated, service_role;
