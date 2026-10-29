-- Decisión del usuario 2026-10-29: «vamos a centralizar todas las compras a
-- bodega, incluidas comunicación, bebidas, etc. para que se carguen todas
-- ahí». Facturas de Sala deja de repartir: sólo Bodega toma facturas.
--
-- 1. La guarda rechaza cualquier sala que no sea Bodega. Bodega se resuelve
--    por `erp_sucursal_map` (sucursal 6 del sistema de origen), no por un id
--    escrito a mano.
-- 2. Recarga Movistar deja de asignarse por línea: las tres líneas apuntaban a
--    Salud 1/2/3 y con eso sus facturas no le aparecían a Bodega. Las filas de
--    `purchase_claim_lines` se conservan como historia; volver atrás es
--    devolver `asignacion = 'linea'`.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.facturas_sala_guarda(p_branch_id bigint, p_accion text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT public.auth_has_module_permission('dash_facturas_sala', p_accion) THEN
    RAISE EXCEPTION 'No tenés permiso para ver las facturas de la sala.';
  END IF;

  IF p_branch_id IS DISTINCT FROM
     (SELECT m.branch_id::bigint FROM public.erp_sucursal_map m WHERE m.erp_sucursal_id = 6) THEN
    RAISE EXCEPTION 'Las compras se cargan todas en Bodega.';
  END IF;

  IF public.auth_module_scope('dash_facturas_sala') <> 'ALL'
     AND p_branch_id IS DISTINCT FROM public.auth_employee_branch_id()::bigint THEN
    RAISE EXCEPTION 'Solo podés trabajar con las facturas de tu propia sala.';
  END IF;
END;
$function$;

UPDATE public.purchase_claim_rules SET asignacion = 'reclamo'
 WHERE asignacion = 'linea';
