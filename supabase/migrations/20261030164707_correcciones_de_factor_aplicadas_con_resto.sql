-- Agrega `resto` (lo que la sala contó y la corrección no cubrió): una sala
-- corregida con algo por pedir no se pinta en verde (2026-10-30, Salud 2).
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.correcciones_de_factor_aplicadas()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('productos_tab_presentaciones', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN: no tienes acceso a las presentaciones de productos';
  END IF;
  RETURN (
    SELECT coalesce(json_agg(json_build_object(
             'erp_product_id',  (ar.metadata->'items'->0->>'erp_product_id')::int,
             'erp_sucursal_id', (ar.metadata->>'erp_sucursal_id')::int,
             'at',              coalesce((ar.metadata->'erp_aplicado'->>'at')::timestamptz, ar.updated_at),
             -- Lo que la sala contó y la corrección no cubrió (sin cast: texto).
             'resto',           CASE WHEN ar.metadata->'correccion_de_factor'->>'resto' ~ '^-?[0-9]+$'
                                     THEN (ar.metadata->'correccion_de_factor'->>'resto')::int ELSE 0 END)), '[]'::json)
      FROM public.approval_requests ar
     WHERE ar.type IN ('INVENTORY_LOAD_REQUEST', 'INVENTORY_DISCARD_REQUEST')
       AND ar.status = 'APPROVED'
       AND ar.metadata ? 'correccion_de_factor'
       AND ar.metadata ? 'erp_aplicado'
       AND ar.created_at >= now() - interval '120 days');
END $function$;
