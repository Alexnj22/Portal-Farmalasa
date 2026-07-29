-- F4.1 — El candado por sucursal existia SOLO en el cliente.
--
-- psp_insert / psp_update usaban `(SELECT auth_can_edit_any(ARRAY['minmax','pedidos']))`
-- sin mirar erp_sucursal_id. Quien tuviera can_edit en CUALQUIERA de los dos
-- modulos podia escribir el MIN/MAX de CUALQUIER sucursal por PostgREST directo;
-- lo unico que lo impedia era `lockedErpId` en el frontend.
--
-- ══ LA EXPOSICION ERA MAYOR QUE LA DEL PLAN ══
--
-- El plan hablaba del rol 12 (Jefe/a de Compras y Logistica, 1 empleado). Medido
-- en prod, los roles con can_edit sobre minmax/pedidos y scope BRANCH son:
--   · rol 12 — minmax BRANCH ....................  1 empleado
--   · rol 19 — Jefe/a de Sala, pedidos BRANCH ...  6 empleados
--   · rol 30 — Dependiente de Farmacia, pedidos BRANCH ... 20 empleados
-- O sea 27 personas, no una. Los roles 19 y 30 no tienen can_edit en minmax,
-- pero `auth_can_edit_any` es un OR sobre el array: les alcanzaba con pedidos.
--
-- ══ COMO SE EXPRESA EL SCOPE ══
--
-- Se mantiene `auth_can_edit_any(...)` como primer termino — es el que trae el
-- candado de mantenimiento de F0 y la escotilla SUPERADMIN; reemplazarlo por
-- chequeos por modulo habria dejado esta tabla fuera del candado.
--
-- Y se agrega el scope con un helper nuevo, `auth_can_edit_scope_all`, en vez de
-- `auth_module_scope(...) = 'ALL'`: auth_module_scope devuelve 'ALL' por defecto
-- cuando el rol NO tiene fila para ese modulo (COALESCE final), asi que
-- `auth_module_scope('pedidos') = 'ALL'` le daria acceso total a alguien que solo
-- tiene minmax con scope BRANCH. El helper exige can_edit Y scope='ALL' en la
-- MISMA fila de role_permissions.
--
-- Todas las llamadas auth_* van envueltas en `(SELECT ...)`: sin el initplan,
-- Postgres las evalua POR FILA — es la causa del outage del 2026-07-08.
--
-- ══ BODEGA: POR QUE EL TRIGGER PASA A SECURITY DEFINER ══
--
-- sync_bodega_draft_from_branch_stmt NO era DEFINER, asi que corria con los
-- permisos de quien escribe y sus INSERT/UPDATE sobre la fila de Bodega
-- (erp_sucursal_id = 6) pasan por estas mismas policies. Con el scope puesto,
-- un usuario BRANCH que edita SU sucursal disparaba el trigger, el trigger
-- intentaba escribir la sucursal 6 — que no es la suya — y la policy lo
-- rechazaba: "new row violates row-level security policy". O sea que el scope
-- habria roto el guardado de las 27 personas de arriba.
--
-- La fila de Bodega no es un dato que el usuario escribe: es una suma derivada
-- que mantiene el sistema. Por eso el trigger pasa a SECURITY DEFINER. Asi la
-- policy puede ser estricta sin excepciones para la sucursal 6 (que serian un
-- agujero: dejarian editar Bodega a mano por API a cualquier usuario BRANCH).

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.auth_can_edit_scope_all(p_modules text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
  SELECT
    COALESCE(((select auth.jwt()) -> 'user_metadata') ->> 'systemRole', '') = 'SUPERADMIN'
    OR EXISTS (
      SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id IN (public.auth_employee_role_id(), public.auth_employee_secondary_role_id())
        AND rp.module_key = ANY(p_modules)
        AND rp.can_edit
        AND COALESCE(rp.scope, 'ALL') = 'ALL'
    );
$function$;

REVOKE EXECUTE ON FUNCTION public.auth_can_edit_scope_all(text[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.auth_can_edit_scope_all(text[]) TO authenticated, service_role;


-- Bodega la mantiene el sistema, no el usuario (ver cabecera).
ALTER FUNCTION public.sync_bodega_draft_from_branch_stmt() SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION public.sync_bodega_draft_from_branch_stmt() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sync_bodega_draft_from_branch_stmt() TO authenticated, service_role;


DROP POLICY IF EXISTS psp_update ON public.product_stock_params;
CREATE POLICY psp_update ON public.product_stock_params
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.auth_can_edit_any(ARRAY['minmax','pedidos']))
    AND (
      (SELECT public.auth_can_edit_scope_all(ARRAY['minmax','pedidos']))
      OR erp_sucursal_id = (SELECT public.auth_employee_erp_sucursal_id())
    )
  );

DROP POLICY IF EXISTS psp_insert ON public.product_stock_params;
CREATE POLICY psp_insert ON public.product_stock_params
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.auth_can_edit_any(ARRAY['minmax','pedidos']))
    AND (
      (SELECT public.auth_can_edit_scope_all(ARRAY['minmax','pedidos']))
      OR erp_sucursal_id = (SELECT public.auth_employee_erp_sucursal_id())
    )
  );


-- discard_stock_drafts: es SECURITY DEFINER, asi que la policy no la toca. El
-- scope va explicito. (calculate_stock_params y publish_stock_params llevan el
-- mismo guard en la migracion 20260729_minmax_f41_scope_en_rpcs.)

CREATE OR REPLACE FUNCTION public.discard_stock_drafts(p_erp_sucursal_id integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF NOT auth_can_edit_any(ARRAY['minmax']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Min/Max';
  END IF;

  IF NOT (SELECT public.auth_can_edit_scope_all(ARRAY['minmax']))
     AND p_erp_sucursal_id IS DISTINCT FROM (SELECT public.auth_employee_erp_sucursal_id()) THEN
    RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: tu permiso de Min/Max es solo para tu sucursal';
  END IF;

  UPDATE product_stock_params
  SET
    draft_min                = NULL,
    draft_max                = NULL,
    draft_abc_class          = NULL,
    draft_velocity           = NULL,
    draft_velocity_30d       = NULL,
    draft_cv                 = NULL,
    draft_demand_variability = NULL,
    draft_units_sold         = NULL,
    draft_revenue            = NULL,
    draft_data_days          = NULL,
    draft_calculated_at      = NULL,
    draft_status             = 'none',
    updated_at               = now()
  WHERE erp_sucursal_id = p_erp_sucursal_id
    AND draft_status IN ('pending', 'sparse_data');

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.discard_stock_drafts(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.discard_stock_drafts(integer) TO authenticated, service_role;
