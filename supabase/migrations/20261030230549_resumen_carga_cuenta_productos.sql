-- «Completados hoy» contaba cambios, no productos: un producto con foto Y
-- principio sumaba 2 (reportado el 2026-10-30, «solo le di finalizar a 1»).
-- Se agregan productos_hoy / productos_semana = productos DISTINTOS.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.resumen_carga_productos()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_hoy timestamptz := date_trunc('day', now() AT TIME ZONE 'America/El_Salvador') AT TIME ZONE 'America/El_Salvador';
BEGIN
    IF NOT ((SELECT public.auth_has_module_permission('fotos_productos', 'can_view'))
            OR (SELECT public.auth_can_edit_any(ARRAY['productos', 'dash_srs_inv']))) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: sin permiso de fotos de productos' USING ERRCODE = '42501';
    END IF;
    RETURN json_build_object(
        'activos', (SELECT count(*) FROM public.products WHERE activo),
        'faltan_foto', (SELECT count(*) FROM public.products WHERE activo AND coalesce(foto_url, '') = ''),
        'faltan_principio', (SELECT count(*) FROM public.products WHERE activo
                               AND coalesce(principio_activo, '') = '' AND NOT coalesce(sin_principio_activo, false)),
        'personas', (SELECT coalesce(json_agg(json_build_object(
                         'employee_id', r.employee_id, 'name', r.name, 'nombre_corto', r.nombre_corto, 'photo_url', r.photo_url,
                         'productos_hoy', r.productos_hoy, 'productos_semana', r.productos_semana,
                         'fotos_hoy', r.fotos_hoy, 'principios_hoy', r.principios_hoy,
                         'fotos_semana', r.fotos_semana, 'principios_semana', r.principios_semana)
                         ORDER BY r.productos_hoy DESC, r.productos_semana DESC), '[]'::json)
                       FROM (SELECT l.employee_id, e.name, e.nombre_corto, e.photo_url,
                                    count(DISTINCT l.product_id) FILTER (WHERE l.created_at >= v_hoy) AS productos_hoy,
                                    count(DISTINCT l.product_id) AS productos_semana,
                                    count(*) FILTER (WHERE l.que = 'foto' AND l.created_at >= v_hoy) AS fotos_hoy,
                                    count(*) FILTER (WHERE l.que = 'principio' AND l.created_at >= v_hoy) AS principios_hoy,
                                    count(*) FILTER (WHERE l.que = 'foto') AS fotos_semana,
                                    count(*) FILTER (WHERE l.que = 'principio') AS principios_semana
                               FROM public.producto_carga_log l JOIN public.employees e ON e.id = l.employee_id
                              WHERE l.created_at >= v_hoy - interval '6 days'
                              GROUP BY l.employee_id, e.name, e.nombre_corto, e.photo_url) r)
    );
END;
$function$;
