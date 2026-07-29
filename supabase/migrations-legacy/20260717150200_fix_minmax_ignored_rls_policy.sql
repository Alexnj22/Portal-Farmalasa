SET lock_timeout = '5s';

-- Hallazgo nuevo de la auditoría MinMax 2026-07-17 (no estaba en el reporte original,
-- lo encontró el advisor de seguridad en la verificación): minmax_ignored tenía una única
-- policy ALL con USING(true)/WITH CHECK(true) — cualquier cuenta autenticada podía
-- insertar/actualizar/borrar filas sin chequeo de permiso. Viola la regla del proyecto
-- "NUNCA USING(true) para UPDATE/DELETE en tablas sensibles". Reemplaza por SELECT abierto
-- (igual que product_stock_params) + escritura gateada por auth_can_edit_any(['minmax']).
DROP POLICY IF EXISTS minmax_ignored_auth_all ON public.minmax_ignored;

CREATE POLICY minmax_ignored_select ON public.minmax_ignored
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY minmax_ignored_insert ON public.minmax_ignored
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth_can_edit_any(ARRAY['minmax'])));

CREATE POLICY minmax_ignored_update ON public.minmax_ignored
  FOR UPDATE TO authenticated
  USING ((SELECT auth_can_edit_any(ARRAY['minmax'])))
  WITH CHECK ((SELECT auth_can_edit_any(ARRAY['minmax'])));

CREATE POLICY minmax_ignored_delete ON public.minmax_ignored
  FOR DELETE TO authenticated
  USING ((SELECT auth_can_edit_any(ARRAY['minmax'])));
