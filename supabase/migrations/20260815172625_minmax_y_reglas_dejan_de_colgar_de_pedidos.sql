-- Reportado el 2026-08-15: «un empleado que ve los pedidos puede modificar los
-- min y max, ¿por qué? no tienen permisos».
--
-- Porque la policy de MIN·MAX aceptaba `minmax` O `pedidos`, y `pedidos.can_edit`
-- lo tienen ONCE cargos: los de sala lo necesitan para RECIBIR un pedido. O sea
-- que el permiso de recibir traía adentro el de reescribir el MIN·MAX del
-- catálogo. Lo mismo con `dispatch_rules`, que pedía `pedidos` en vez de la
-- pestaña que las contiene.
SET lock_timeout = '5s';

-- ── 1 · product_stock_params: el MIN·MAX es del módulo MIN·MAX ──────────────
-- Se quita 'pedidos' de las DOS mitades: del permiso y del alcance. Dejarlo en
-- el alcance sería igual de silencioso — un cargo con `minmax` acotado a su
-- sala seguiría alcanzando toda la red por su `pedidos` con alcance ALL.
DROP POLICY IF EXISTS psp_update ON public.product_stock_params;
CREATE POLICY psp_update ON public.product_stock_params
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.auth_can_edit_any(ARRAY['minmax'::text]))
    AND (
      (SELECT public.auth_can_edit_scope_all(ARRAY['minmax'::text]))
      OR erp_sucursal_id = (SELECT public.auth_employee_erp_sucursal_id())
    )
  );

DROP POLICY IF EXISTS psp_insert ON public.product_stock_params;
CREATE POLICY psp_insert ON public.product_stock_params
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.auth_can_edit_any(ARRAY['minmax'::text]))
    AND (
      (SELECT public.auth_can_edit_scope_all(ARRAY['minmax'::text]))
      OR erp_sucursal_id = (SELECT public.auth_employee_erp_sucursal_id())
    )
  );

-- ── 2 · dispatch_rules: son de la pestaña «Reglas de despacho» ──────────────
-- Pedían `pedidos.can_edit` (11 cargos) cuando la pestaña que las edita se
-- gatea con `pedidos_tab_reglas` (6 cargos). La base era más permisiva que la
-- pantalla, y la pantalla no preguntaba nada.
DROP POLICY IF EXISTS dispatch_rules_update ON public.dispatch_rules;
CREATE POLICY dispatch_rules_update ON public.dispatch_rules
  FOR UPDATE TO authenticated
  USING       ((SELECT public.auth_can_edit_any(ARRAY['pedidos_tab_reglas'::text])))
  WITH CHECK  ((SELECT public.auth_can_edit_any(ARRAY['pedidos_tab_reglas'::text])));

DROP POLICY IF EXISTS dispatch_rules_insert ON public.dispatch_rules;
CREATE POLICY dispatch_rules_insert ON public.dispatch_rules
  FOR INSERT TO authenticated
  WITH CHECK  ((SELECT public.auth_can_edit_any(ARRAY['pedidos_tab_reglas'::text])));

DROP POLICY IF EXISTS dispatch_rules_delete ON public.dispatch_rules;
CREATE POLICY dispatch_rules_delete ON public.dispatch_rules
  FOR DELETE TO authenticated
  USING       ((SELECT public.auth_can_edit_any(ARRAY['pedidos_tab_reglas'::text])));

-- ── 3 · los permisos que el uso real ya demostraba ─────────────────────────
-- `pedidos_tab_reglas.can_edit` estaba en false para TODOS menos QA, y sin
-- embargo Jefe/a de Compras hizo 1.382 ediciones de reglas y Supervisor/a de
-- Ventas 101 (bitácora jun–ago). Ese `can_edit` no era una decisión: era un
-- valor que nadie leía. Se pone en true para los dos que hacen el trabajo; los
-- otros cuatro cargos con la pestaña quedan en solo lectura, que es lo que su
-- fila ya decía.
UPDATE public.role_permissions rp SET can_edit = true
  FROM public.roles r
 WHERE r.id = rp.role_id
   AND rp.module_key = 'pedidos_tab_reglas'
   AND r.name IN ('Jefe/a de Compras y Logistica', 'Supervisor/a de Ventas');

-- Y el ALCANCE de MIN·MAX de Jefe/a de Compras pasa de BRANCH a ALL. No es un
-- permiso nuevo: es el que YA ejercía. Alcanzaba toda la red porque la policy
-- vieja leía el alcance de `pedidos` (ALL); al acotarla a `minmax` quedaría
-- encerrado en una sola sala. Medido en la bitácora: sus 287 ediciones de
-- MIN·MAX desde un pedido tocaron SEIS sucursales distintas (1,2,3,4,5,7).
UPDATE public.role_permissions rp SET scope = 'ALL'
  FROM public.roles r
 WHERE r.id = rp.role_id
   AND rp.module_key = 'minmax'
   AND r.name = 'Jefe/a de Compras y Logistica';
