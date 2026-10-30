-- Las correcciones de factor ya aplicadas, por producto y sala, con cuándo.
-- Revisión de factor las usa para que el conteo de una sala hecho ANTES de
-- corregirla no se siga pintando como descuadre (2026-10-30, X-Ray Dol: Salud 3
-- y La Popular corregidas y en rojo).
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
             'at',              coalesce((ar.metadata->'erp_aplicado'->>'at')::timestamptz, ar.updated_at))), '[]'::json)
      FROM public.approval_requests ar
     WHERE ar.type IN ('INVENTORY_LOAD_REQUEST', 'INVENTORY_DISCARD_REQUEST')
       AND ar.status = 'APPROVED'
       AND ar.metadata ? 'correccion_de_factor'
       AND ar.metadata ? 'erp_aplicado'
       AND ar.created_at >= now() - interval '120 days');
END $function$;

REVOKE EXECUTE ON FUNCTION public.correcciones_de_factor_aplicadas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correcciones_de_factor_aplicadas() TO authenticated, service_role;
