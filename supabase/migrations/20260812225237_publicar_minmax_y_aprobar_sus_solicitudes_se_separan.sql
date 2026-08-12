-- Publicar Min/Max y aprobar sus solicitudes dejan de ser el mismo permiso.
--
-- Decisión del usuario (2026-08-12): «publicar min y max y aceptar solicitudes
-- de min y max son cosas distintas». Y lo eran de hecho: `minmax.can_approve`
-- gobernaba las dos, así que dárselo a alguien para que resolviera una
-- solicitud de ajuste le entregaba de arrastre la publicación de parámetros de
-- TODO el catálogo — y al revés, sacárselo para que no publicara lo dejaba sin
-- poder resolver una solicitud.
--
-- El reparto sale de dónde se cobra hoy el permiso, no de lo que uno suponga:
--
--   publicar            → `product_stock_params` (psp_insert/psp_update) y
--                         `stock_config`. Se quedan con `minmax`.
--   aprobar solicitudes → `minmax_change_requests`. Pasa a `requests_minmax`.
--
-- `minmax_ignored` se queda en `minmax`: es parte de administrar el análisis,
-- no de resolver una solicitud ajena.
--
-- Ojo con `approve_minmax_request`: es INVOKER (verificado, `prosecdef = false`),
-- así que su freno REAL es la policy `mmcr_update` y no una comprobación en su
-- cuerpo. Cambiando la policy cambia quién puede llamarla, sin tocar la función.

SET lock_timeout = '5s';

-- Nadie gana ni pierde: el módulo nuevo nace con lo que cada cargo ya tenía en
-- `minmax`, incluida su delegación por ausencia.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope, delega_en_ausencia)
SELECT rp.role_id, 'requests_minmax', false, false, rp.can_approve, rp.scope, rp.delega_en_ausencia
FROM public.role_permissions rp
WHERE rp.module_key = 'minmax'
ON CONFLICT (role_id, module_key) DO UPDATE
  SET can_approve        = EXCLUDED.can_approve,
      scope              = EXCLUDED.scope,
      delega_en_ausencia = EXCLUDED.delega_en_ausencia,
      updated_at         = now()
  WHERE role_permissions.can_approve IS DISTINCT FROM EXCLUDED.can_approve
     OR role_permissions.scope       IS DISTINCT FROM EXCLUDED.scope;

DROP POLICY IF EXISTS mmcr_update ON public.minmax_change_requests;
CREATE POLICY mmcr_update ON public.minmax_change_requests
FOR UPDATE
USING (
  (SELECT auth_has_module_permission('requests_minmax', 'can_approve'))
  AND CASE (SELECT auth_module_scope('requests_minmax'))
        WHEN 'ALL'  THEN true
        WHEN 'MINE' THEN false
        ELSE erp_sucursal_id = (SELECT auth_employee_erp_sucursal_id())
      END
);

-- En el SELECT sólo cambia la rama de «quien decide»; la tercera —ver la
-- bandeja con `requests.can_view`— se conserva tal cual, porque mirar la cola
-- sigue siendo un solo interruptor.
DROP POLICY IF EXISTS mmcr_select ON public.minmax_change_requests;
CREATE POLICY mmcr_select ON public.minmax_change_requests
FOR SELECT
USING (
  requested_by_id = (SELECT auth_employee_id())
  OR ((SELECT auth_has_module_permission('requests_minmax', 'can_approve'))
      AND CASE (SELECT auth_module_scope('requests_minmax'))
            WHEN 'ALL'  THEN true
            WHEN 'MINE' THEN false
            ELSE erp_sucursal_id = (SELECT auth_employee_erp_sucursal_id())
          END)
  OR ((SELECT auth_has_module_permission('requests', 'can_view'))
      AND CASE (SELECT auth_module_scope('requests'))
            WHEN 'ALL'  THEN true
            WHEN 'MINE' THEN false
            ELSE erp_sucursal_id = (SELECT auth_employee_erp_sucursal_id())
          END)
);
