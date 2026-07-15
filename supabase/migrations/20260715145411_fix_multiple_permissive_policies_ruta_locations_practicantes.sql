SET lock_timeout = '5s';

-- Bloque 4.6: ruta_locations_write y practicantes_write son FOR ALL (incluye
-- SELECT), duplicando la evaluación de policy junto con ruta_locations_select/
-- practicantes_select en cada SELECT (7 warnings de multiple_permissive_policies
-- en el advisor). Verificado: hoy ningún role_permissions tiene can_edit=true
-- con can_view=false para pedidos_tab_rutas ni staff_list, así que angostar
-- _write a solo INSERT/UPDATE/DELETE no le quita acceso de lectura a nadie
-- real — _select ya cubre exactamente el mismo universo de can_view=true.

DROP POLICY ruta_locations_write ON public.ruta_locations;
CREATE POLICY ruta_locations_write ON public.ruta_locations
  FOR INSERT
  TO public
  WITH CHECK ((SELECT auth_has_module_permission('pedidos_tab_rutas', 'can_edit')));
CREATE POLICY ruta_locations_write_update ON public.ruta_locations
  FOR UPDATE
  TO public
  USING ((SELECT auth_has_module_permission('pedidos_tab_rutas', 'can_edit')))
  WITH CHECK ((SELECT auth_has_module_permission('pedidos_tab_rutas', 'can_edit')));
CREATE POLICY ruta_locations_write_delete ON public.ruta_locations
  FOR DELETE
  TO public
  USING ((SELECT auth_has_module_permission('pedidos_tab_rutas', 'can_edit')));

DROP POLICY practicantes_write ON public.practicantes;
CREATE POLICY practicantes_write ON public.practicantes
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth_can_edit_any(ARRAY['staff_list'])));
CREATE POLICY practicantes_write_update ON public.practicantes
  FOR UPDATE
  TO authenticated
  USING ((SELECT auth_can_edit_any(ARRAY['staff_list'])))
  WITH CHECK ((SELECT auth_can_edit_any(ARRAY['staff_list'])));
CREATE POLICY practicantes_write_delete ON public.practicantes
  FOR DELETE
  TO authenticated
  USING ((SELECT auth_can_edit_any(ARRAY['staff_list'])));
